import {
  createClient,
  type Client as LibsqlClient,
  type InArgs,
  type InValue,
  type Transaction,
} from "@libsql/client";

const configuredUrl = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;

if (!configuredUrl || !authToken) {
  throw new Error("Не заданы TURSO_DATABASE_URL и TURSO_AUTH_TOKEN");
}

// Turso CLI may display turso://, while the libSQL JavaScript client uses libsql://.
const url = configuredUrl.replace(/^turso:/, "libsql:");
const client = createClient({ url, authToken, intMode: "number" });

const schema = [
  `CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sku TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    price INTEGER NOT NULL,
    cost_price INTEGER NOT NULL DEFAULT 0,
    stock INTEGER NOT NULL DEFAULT 0,
    category TEXT NOT NULL DEFAULT 'Без категории',
    size TEXT NOT NULL DEFAULT '',
    color TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  )`,
  `CREATE TABLE IF NOT EXISTS sales (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    total INTEGER NOT NULL,
    payment_method TEXT NOT NULL DEFAULT 'cash'
      CHECK (payment_method IN ('cash', 'card', 'debt')),
    client_id INTEGER REFERENCES clients(id)
  )`,
  `CREATE TABLE IF NOT EXISTS sale_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id),
    product_name TEXT NOT NULL,
    sku TEXT NOT NULL,
    qty INTEGER NOT NULL,
    unit_price INTEGER NOT NULL,
    cost_price INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS clients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    number TEXT UNIQUE NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  )`,
  `CREATE TABLE IF NOT EXISTS client_ledger (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER NOT NULL REFERENCES clients(id),
    kind TEXT NOT NULL CHECK (kind IN ('debt', 'payment')),
    amount INTEGER NOT NULL CHECK (amount > 0),
    note TEXT NOT NULL DEFAULT '',
    sale_id INTEGER REFERENCES sales(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_client_ledger_client_id
    ON client_ledger(client_id, id DESC)`,
  `CREATE TABLE IF NOT EXISTS expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    amount INTEGER NOT NULL CHECK (amount > 0),
    note TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'expense' CHECK (kind IN ('expense', 'withdrawal')),
    account TEXT NOT NULL DEFAULT 'cash' CHECK (account IN ('cash', 'card')),
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_expenses_created_at ON expenses(created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
];

async function initializeDatabase() {
  await client.migrate(schema.map((sql) => ({ sql, args: [] })));

  await addMissingColumns("products", [
    ["category", "ALTER TABLE products ADD COLUMN category TEXT NOT NULL DEFAULT 'Без категории'"],
    ["size", "ALTER TABLE products ADD COLUMN size TEXT NOT NULL DEFAULT ''"],
    ["color", "ALTER TABLE products ADD COLUMN color TEXT NOT NULL DEFAULT ''"],
    ["cost_price", "ALTER TABLE products ADD COLUMN cost_price INTEGER NOT NULL DEFAULT 0"],
  ]);
  // Закупочная цена копируется в позицию продажи, чтобы прибыль за прошлый период
  // не менялась задним числом при переоценке товара.
  await addMissingColumns("sale_items", [
    ["cost_price", "ALTER TABLE sale_items ADD COLUMN cost_price INTEGER NOT NULL DEFAULT 0"],
  ]);
  // Записи, созданные до появления изъятий, — обычные расходы из наличных.
  await addMissingColumns("expenses", [
    ["kind", "ALTER TABLE expenses ADD COLUMN kind TEXT NOT NULL DEFAULT 'expense'"],
    ["account", "ALTER TABLE expenses ADD COLUMN account TEXT NOT NULL DEFAULT 'cash'"],
  ]);
  // Продажи, оформленные до выбора способа оплаты, считаем наличными.
  await addMissingColumns("sales", [
    ["payment_method", "ALTER TABLE sales ADD COLUMN payment_method TEXT NOT NULL DEFAULT 'cash'"],
    ["client_id", "ALTER TABLE sales ADD COLUMN client_id INTEGER"],
  ]);
  await addMissingColumns("client_ledger", [
    ["sale_id", "ALTER TABLE client_ledger ADD COLUMN sale_id INTEGER"],
  ]);

  await client.batch(
    [
      ["UPDATE products SET category = ? WHERE category = ?", ["Без категории", "Uncategorized"]],
      ["UPDATE products SET category = ? WHERE category = ?", ["Верх", "Tops"]],
      ["UPDATE products SET category = ? WHERE category = ?", ["Низ", "Bottoms"]],
      ["UPDATE products SET category = ? WHERE category = ?", ["Платья", "Dresses"]],
      ["UPDATE products SET category = ? WHERE category = ?", ["Верхняя одежда", "Outerwear"]],
      ["UPDATE products SET category = ? WHERE category = ?", ["Обувь", "Footwear"]],
      ["UPDATE products SET category = ? WHERE category = ?", ["Аксессуары", "Accessories"]],
    ],
    "write",
  );

  await migrateMoneyToMinorUnits();
}

async function addMissingColumns(table: string, columns: readonly (readonly [string, string])[]) {
  const info = await client.execute(`PRAGMA table_info(${table})`);
  const names = new Set(info.rows.map((column) => String(column.name)));
  for (const [name, sql] of columns) {
    if (!names.has(name)) await client.execute(sql);
  }
}

const MONEY_MIGRATION = "money-minor-units-v1";

/**
 * Раньше суммы хранились как REAL и накапливали ошибку округления, поэтому сравнение
 * долга приходилось делать с допуском. Теперь всё хранится в тийинах целым числом.
 *
 * Миграция одноразовая и необратимая: суммы умножаются на 100. Отметка в `meta`
 * ставится в той же транзакции, поэтому повторный (в том числе одновременный на
 * нескольких инстансах) запуск ничего не пересчитает.
 */
async function migrateMoneyToMinorUnits() {
  const done = await client.execute({
    sql: "SELECT 1 FROM meta WHERE key = ?",
    args: [MONEY_MIGRATION],
  });
  if (done.rows.length) return;

  const tx = await client.transaction("write");
  try {
    const again = await tx.execute({
      sql: "SELECT 1 FROM meta WHERE key = ?",
      args: [MONEY_MIGRATION],
    });
    if (!again.rows.length) {
      await tx.execute("UPDATE products SET price = CAST(ROUND(price * 100) AS INTEGER)");
      await tx.execute("UPDATE sales SET total = CAST(ROUND(total * 100) AS INTEGER)");
      await tx.execute("UPDATE sale_items SET unit_price = CAST(ROUND(unit_price * 100) AS INTEGER)");
      await tx.execute("UPDATE client_ledger SET amount = CAST(ROUND(amount * 100) AS INTEGER)");
      await tx.execute({
        sql: "INSERT INTO meta (key, value) VALUES (?, datetime('now', 'localtime'))",
        args: [MONEY_MIGRATION],
      });
    }
    await tx.commit();
  } catch (error) {
    if (!tx.closed) await tx.rollback();
    throw error;
  } finally {
    tx.close();
  }
}

export const dbReady = initializeDatabase();

type SqlExecutor = Pick<LibsqlClient, "execute"> | Pick<Transaction, "execute">;

function queryFor(executor: SqlExecutor, sql: string, ready?: Promise<void>) {
  async function execute(args: InArgs) {
    if (ready) await ready;
    return executor.execute({ sql, args });
  }

  return {
    async all(...args: InValue[]) {
      return (await execute(args)).rows as unknown[];
    },
    async get(...args: InValue[]) {
      return ((await execute(args)).rows[0] as unknown) ?? null;
    },
    async run(...args: InValue[]) {
      const result = await execute(args);
      return { changes: result.rowsAffected, lastInsertRowid: result.lastInsertRowid };
    },
  };
}

export type DatabaseExecutor = {
  query(sql: string): ReturnType<typeof queryFor>;
};

export const db: DatabaseExecutor = {
  query(sql) {
    return queryFor(client, sql, dbReady);
  },
};

export async function withTransaction<T>(work: (tx: DatabaseExecutor) => Promise<T>): Promise<T> {
  await dbReady;
  const transaction = await client.transaction("write");
  const executor: DatabaseExecutor = {
    query(sql) {
      return queryFor(transaction, sql);
    },
  };
  try {
    const result = await work(executor);
    await transaction.commit();
    return result;
  } catch (error) {
    if (!transaction.closed) await transaction.rollback();
    throw error;
  } finally {
    transaction.close();
  }
}

export type Product = {
  id: number;
  sku: string;
  name: string;
  /** Продажная цена в тийинах (1/100 сума), целое число. */
  price: number;
  /** Закупочная цена в тийинах (1/100 сума), целое число. */
  cost_price: number;
  stock: number;
  category: string;
  size: string;
  color: string;
  created_at: string;
};

export type Expense = {
  id: number;
  /** Сумма в тийинах (1/100 сума), целое число. */
  amount: number;
  note: string;
  /** `expense` — трата магазина, `withdrawal` — деньги забрали из кассы. */
  kind: "expense" | "withdrawal";
  /** С какого баланса списано: наличные или карта. */
  account: "cash" | "card";
  created_at: string;
};

export type Sale = {
  id: number;
  created_at: string;
  /** Сумма в тийинах (1/100 сума), целое число. */
  total: number;
  /** `debt` — товар отдан в долг, деньги в кассу не пришли. */
  payment_method: "cash" | "card" | "debt";
  client_id: number | null;
};

export type Client = {
  id: number;
  name: string;
  number: string;
  created_at: string;
};

export type ClientLedgerEntry = {
  id: number;
  client_id: number;
  kind: "debt" | "payment";
  /** Сумма в тийинах (1/100 сума), целое число. */
  amount: number;
  note: string;
  /** Продажа, породившая запись, — у долга из кассы. */
  sale_id: number | null;
  created_at: string;
};
