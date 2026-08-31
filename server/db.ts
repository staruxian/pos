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
    price REAL NOT NULL,
    stock INTEGER NOT NULL DEFAULT 0,
    category TEXT NOT NULL DEFAULT 'Без категории',
    size TEXT NOT NULL DEFAULT '',
    color TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  )`,
  `CREATE TABLE IF NOT EXISTS sales (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    total REAL NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sale_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id),
    product_name TEXT NOT NULL,
    sku TEXT NOT NULL,
    qty INTEGER NOT NULL,
    unit_price REAL NOT NULL
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
    amount REAL NOT NULL CHECK (amount > 0),
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_client_ledger_client_id
    ON client_ledger(client_id, id DESC)`,
];

async function initializeDatabase() {
  await client.migrate(schema.map((sql) => ({ sql, args: [] })));

  const columns = await client.execute("PRAGMA table_info(products)");
  const names = new Set(columns.rows.map((column) => String(column.name)));
  const missingColumns = [
    ["category", "ALTER TABLE products ADD COLUMN category TEXT NOT NULL DEFAULT 'Без категории'"],
    ["size", "ALTER TABLE products ADD COLUMN size TEXT NOT NULL DEFAULT ''"],
    ["color", "ALTER TABLE products ADD COLUMN color TEXT NOT NULL DEFAULT ''"],
  ] as const;
  for (const [name, sql] of missingColumns) {
    if (!names.has(name)) await client.execute(sql);
  }

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
  price: number;
  stock: number;
  category: string;
  size: string;
  color: string;
  created_at: string;
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
  amount: number;
  note: string;
  created_at: string;
};
