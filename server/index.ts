import {
  db,
  withTransaction,
  type Client,
  type ClientLedgerEntry,
  type Expense,
  type Product,
  type Sale,
} from "./db";
import bwipjs from "bwip-js/node";
import {
  authConfigError,
  authEnabled,
  checkPassword,
  clearCookie,
  createSessionToken,
  hasSession,
  sessionCookie,
} from "./auth";
import {
  BadJson,
  BodyTooLarge,
  clientIp,
  isUniqueViolation,
  randomDigits,
  rateLimit,
  readJson,
  resolvePath,
} from "./security";

const PORT = Number(process.env.PORT ?? 3001);

// Заголовки, которые должны стоять на каждом ответе API.
const baseHeaders = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
};

function json(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...baseHeaders, ...headers },
  });
}

function error(message: string, status = 400) {
  return json({ error: message }, status);
}

function parseBody<T>(req: Request): Promise<T> {
  return readJson<T>(req);
}

/** Обрезает строку и ограничивает длину; undefined, если поле не передали. */
function trimmed(value: unknown, max = 200) {
  return typeof value === "string" ? value.trim().slice(0, max) : undefined;
}

// Деньги везде — целое число тийинов (1/100 сума). Потолок отсекает мусор и переполнение.
const MAX_MINOR = 1e12;

function parseMinor(value: unknown) {
  const amount = Number(value);
  if (!Number.isInteger(amount) || amount < 0 || amount > MAX_MINOR) return null;
  return amount;
}

function normalizeBarcode(value?: string) {
  const digits = value?.trim();
  if (!digits) return null;
  if (digits.length > 64) throw new Error("Штрихкод слишком длинный");
  if (/^\d+$/.test(digits)) return digits;
  throw new Error("Штрихкод может содержать только цифры");
}

async function newBarcode() {
  while (true) {
    const barcode = randomDigits(12);
    if (!(await db.query("SELECT 1 FROM products WHERE sku = ?").get(barcode))) return barcode;
  }
}

function barcodeSvg(value: string) {
  return bwipjs.toSVG({
    bcid: "code128",
    text: value,
    scale: 3,
    height: 14,
    includetext: true,
    textxalign: "center",
    textsize: 11,
    paddingwidth: 8,
    paddingheight: 6,
    backgroundcolor: "FFFFFF",
  });
}

function todayRange() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
  return { from: fmt(start), to: fmt(end) };
}

// Маршруты, доступные без входа в систему.
const publicPaths = new Set(["/api/health", "/api/login", "/api/logout", "/api/session"]);

export async function handle(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const pathname = resolvePath(url);
  if (pathname === null) return error("Некорректный путь запроса");
  const method = req.method;

  // Health отвечает всегда — по нему видно, включён ли вход и что настроено не так.
  const configError = authConfigError();
  const authOn = authEnabled();
  if (method === "GET" && pathname === "/api/health") {
    if (configError) return json({ ok: false, error: configError }, 503);
    return json({ ok: true, auth: authOn ? "enabled" : "disabled" });
  }

  // Настройка наполовину — закрываем всё: непонятно, хотели включить вход или нет.
  if (configError) return error(`Сервер не настроен: ${configError}`, 503);

  if (method === "GET" && pathname === "/api/session") {
    return json({ authenticated: authOn ? await hasSession(req) : true, authRequired: authOn });
  }

  if (method === "POST" && pathname === "/api/login") {
    if (!authOn) return error("Вход отключён: POS_PASSWORD не задан");
    const limit = rateLimit(`login:${clientIp(req)}`, 10, 15 * 60_000);
    if (!limit.allowed) {
      return json({ error: "Слишком много попыток входа. Подождите немного" }, 429, {
        "retry-after": String(limit.retryAfter),
      });
    }
    const body = await parseBody<{ password?: unknown }>(req);
    if (!(await checkPassword(body.password))) return error("Неверный пароль", 401);
    return json({ ok: true }, 200, { "set-cookie": sessionCookie(req, await createSessionToken()) });
  }

  if (method === "POST" && pathname === "/api/logout") {
    return json({ ok: true }, 200, { "set-cookie": clearCookie(req) });
  }

  if (authOn && !publicPaths.has(pathname) && !(await hasSession(req))) {
    return error("Требуется вход в систему", 401);
  }

  if (method === "GET" && pathname === "/api/products") {
    const products = (await db
      .query("SELECT * FROM products ORDER BY name COLLATE NOCASE")
      .all()) as Product[];
    return json(products);
  }

  if (method === "GET" && pathname.startsWith("/api/products/barcode/")) {
    let sku: string;
    try {
      sku = decodeURIComponent(pathname.slice("/api/products/barcode/".length));
    } catch {
      return error("Некорректный штрихкод");
    }
    const product = (await db
      .query("SELECT * FROM products WHERE sku = ?")
      .get(sku)) as Product | null;
    if (!product) return error("Товар не найден", 404);
    return json(product);
  }

  if (method === "GET" && pathname.match(/^\/api\/products\/\d+\/barcode$/)) {
    const id = Number(pathname.split("/")[3]);
    const product = (await db.query("SELECT * FROM products WHERE id = ?").get(id)) as Product | null;
    if (!product) return error("Товар не найден", 404);
    return new Response(barcodeSvg(product.sku), {
      headers: {
        ...baseHeaders,
        "content-type": "image/svg+xml",
        "cache-control": "no-store",
        // Картинку могут открыть отдельной вкладкой — SVG там не должен ничего исполнять.
        "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      },
    });
  }

  if (method === "POST" && pathname === "/api/products") {
    const body = await parseBody<{
      name?: string;
      price?: number;
      cost_price?: number;
      stock?: number;
      sku?: string;
      category?: string;
      size?: string;
      color?: string;
    }>(req);
    const name = trimmed(body.name);
    const price = parseMinor(body.price);
    const costPrice = body.cost_price === undefined ? 0 : parseMinor(body.cost_price);
    const stock = Number(body.stock ?? 0);
    const category = trimmed(body.category) || "Без категории";
    const size = trimmed(body.size, 50) || "";
    const color = trimmed(body.color, 50) || "";
    if (!name) return error("Укажите название товара");
    if (price === null) return error("Укажите корректную цену");
    if (costPrice === null) return error("Укажите корректную закупочную цену");
    if (!Number.isInteger(stock) || stock < 0 || stock > 1_000_000) {
      return error("Укажите корректное количество");
    }

    const generated = !trimmed(body.sku, 64);
    let sku: string;
    try {
      sku = generated ? await newBarcode() : normalizeBarcode(body.sku)!;
    } catch (e) {
      return error(e instanceof Error ? e.message : "Некорректный штрихкод");
    }

    // Между проверкой уникальности и вставкой возможна гонка, поэтому для
    // сгенерированного номера просто пробуем ещё раз.
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const result = (await db
          .query(
            "INSERT INTO products (sku, name, price, cost_price, stock, category, size, color) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *",
          )
          .get(sku, name, price, costPrice, stock, category, size, color)) as Product;
        return json(result, 201);
      } catch (e) {
        if (!isUniqueViolation(e)) throw e;
        if (!generated) return error("Такой штрихкод уже существует");
        sku = await newBarcode();
      }
    }
    return error("Не удалось подобрать свободный штрихкод", 500);
  }

  if (method === "PATCH" && pathname.match(/^\/api\/products\/\d+$/)) {
    const id = Number(pathname.split("/").at(-1));
    const existing = (await db.query("SELECT * FROM products WHERE id = ?").get(id)) as Product | null;
    if (!existing) return error("Товар не найден", 404);
    const body = await parseBody<{
      name?: string;
      price?: number;
      cost_price?: number;
      stock?: number;
      sku?: string;
      category?: string;
      size?: string;
      color?: string;
    }>(req);
    const name = trimmed(body.name) ?? existing.name;
    const price = body.price !== undefined ? parseMinor(body.price) : existing.price;
    const costPrice =
      body.cost_price !== undefined ? parseMinor(body.cost_price) : existing.cost_price;
    const stock = body.stock !== undefined ? Number(body.stock) : existing.stock;
    const category = trimmed(body.category) ?? existing.category;
    const size = trimmed(body.size, 50) ?? existing.size;
    const color = trimmed(body.color, 50) ?? existing.color;
    let sku: string;
    try {
      sku = body.sku === undefined ? existing.sku : (normalizeBarcode(body.sku) ?? existing.sku);
    } catch (e) {
      return error(e instanceof Error ? e.message : "Некорректный штрихкод");
    }
    if (!name) return error("Укажите название товара");
    if (price === null) return error("Укажите корректную цену");
    if (costPrice === null) return error("Укажите корректную закупочную цену");
    if (!Number.isInteger(stock) || stock < 0 || stock > 1_000_000) {
      return error("Укажите корректное количество");
    }
    try {
      const result = (await db
        .query(
          "UPDATE products SET sku = ?, name = ?, price = ?, cost_price = ?, stock = ?, category = ?, size = ?, color = ? WHERE id = ? RETURNING *",
        )
        .get(sku, name, price, costPrice, stock, category, size, color, id)) as Product;
      return json(result);
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      return error("Такой штрихкод уже существует");
    }
  }

  if (method === "DELETE" && pathname.match(/^\/api\/products\/\d+$/)) {
    const id = Number(pathname.split("/").at(-1));
    const used = await db
      .query("SELECT 1 FROM sale_items WHERE product_id = ? LIMIT 1")
      .get(id);
    if (used) return error("Нельзя удалить товар, который уже продавался");
    const info = await db.query("DELETE FROM products WHERE id = ?").run(id);
    if (info.changes === 0) return error("Товар не найден", 404);
    return json({ ok: true });
  }

  if (method === "GET" && pathname === "/api/clients") {
    const clients = await db
      .query(
        `SELECT
           c.*,
           COALESCE(SUM(CASE WHEN l.kind = 'debt' THEN l.amount ELSE -l.amount END), 0) AS balance,
           COUNT(l.id) AS ledger_count,
           MAX(l.created_at) AS last_activity
         FROM clients c
         LEFT JOIN client_ledger l ON l.client_id = c.id
         GROUP BY c.id
         ORDER BY c.name COLLATE NOCASE`,
      )
      .all();
    return json(clients);
  }

  if (method === "POST" && pathname === "/api/clients") {
    const body = await parseBody<{ name?: string; number?: string }>(req);
    const name = trimmed(body.name);
    const number = trimmed(body.number, 40);
    if (!name) return error("Укажите имя клиента");
    if (!number) return error("Укажите номер клиента");
    try {
      const client = (await db
        .query("INSERT INTO clients (name, number) VALUES (?, ?) RETURNING *")
        .get(name, number)) as Client;
      return json({ ...client, balance: 0, ledger_count: 0, last_activity: null }, 201);
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      return error("Клиент с таким номером уже существует");
    }
  }

  if (method === "GET" && pathname.match(/^\/api\/clients\/\d+$/)) {
    const id = Number(pathname.split("/").at(-1));
    const client = (await db.query("SELECT * FROM clients WHERE id = ?").get(id)) as Client | null;
    if (!client) return error("Клиент не найден", 404);
    const ledger = (await db
      .query("SELECT * FROM client_ledger WHERE client_id = ? ORDER BY id DESC")
      .all(id)) as ClientLedgerEntry[];
    const balance = ledger.reduce(
      (sum, entry) => sum + (entry.kind === "debt" ? entry.amount : -entry.amount),
      0,
    );
    return json({
      ...client,
      balance,
      ledger_count: ledger.length,
      last_activity: ledger[0]?.created_at ?? null,
      ledger,
    });
  }

  if (method === "PATCH" && pathname.match(/^\/api\/clients\/\d+$/)) {
    const id = Number(pathname.split("/").at(-1));
    const existing = (await db.query("SELECT * FROM clients WHERE id = ?").get(id)) as Client | null;
    if (!existing) return error("Клиент не найден", 404);
    const body = await parseBody<{ name?: string; number?: string }>(req);
    const name = trimmed(body.name) ?? existing.name;
    const number = trimmed(body.number, 40) ?? existing.number;
    if (!name) return error("Укажите имя клиента");
    if (!number) return error("Укажите номер клиента");
    try {
      const client = (await db
        .query("UPDATE clients SET name = ?, number = ? WHERE id = ? RETURNING *")
        .get(name, number, id)) as Client;
      return json(client);
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      return error("Клиент с таким номером уже существует");
    }
  }

  if (method === "DELETE" && pathname.match(/^\/api\/clients\/\d+$/)) {
    const id = Number(pathname.split("/").at(-1));
    const hasHistory = await db.query("SELECT 1 FROM client_ledger WHERE client_id = ? LIMIT 1").get(id);
    if (hasHistory) return error("Нельзя удалить клиента с историей долга");
    const info = await db.query("DELETE FROM clients WHERE id = ?").run(id);
    if (info.changes === 0) return error("Клиент не найден", 404);
    return json({ ok: true });
  }

  if (method === "POST" && pathname.match(/^\/api\/clients\/\d+\/(debts|payments)$/)) {
    const parts = pathname.split("/");
    const id = Number(parts[3]);
    const kind = parts[4] === "debts" ? "debt" : "payment";
    const client = (await db.query("SELECT * FROM clients WHERE id = ?").get(id)) as Client | null;
    if (!client) return error("Клиент не найден", 404);
    const body = await parseBody<{ amount?: number; note?: string }>(req);
    const amount = parseMinor(body.amount);
    const note = trimmed(body.note) || "";
    if (amount === null || amount <= 0) return error("Укажите сумму больше нуля");

    try {
      const entry = await withTransaction(async (tx) => {
      if (kind === "payment") {
        const row = (await tx
          .query(
            `SELECT COALESCE(SUM(CASE WHEN kind = 'debt' THEN amount ELSE -amount END), 0) AS balance
             FROM client_ledger WHERE client_id = ?`,
          )
          .get(id)) as { balance: number };
        // Суммы целые, поэтому сравнение точное — допуск больше не нужен.
        if (amount > row.balance) {
          throw new Error("Сумма погашения больше текущего долга");
        }
      }
      return (await tx
        .query(
          "INSERT INTO client_ledger (client_id, kind, amount, note) VALUES (?, ?, ?, ?) RETURNING *",
        )
        .get(id, kind, amount, note)) as ClientLedgerEntry;
      });
      return json(entry, 201);
    } catch (e) {
      return error(e instanceof Error ? e.message : "Не удалось сохранить операцию");
    }
  }

  if (method === "POST" && pathname === "/api/sales") {
    const body = await parseBody<{
      items?: { product_id: number; qty: number; unit_price?: number }[];
      payment_method?: string;
      client_id?: number;
    }>(req);
    const paymentMethod =
      body.payment_method === "card" || body.payment_method === "debt"
        ? body.payment_method
        : "cash";
    // Долг всегда привязан к клиенту: иначе непонятно, с кого спрашивать деньги.
    let clientId: number | null = null;
    if (paymentMethod === "debt") {
      clientId = Number(body.client_id);
      if (!Number.isInteger(clientId)) return error("Выберите клиента для продажи в долг");
      if (!(await db.query("SELECT 1 FROM clients WHERE id = ?").get(clientId))) {
        return error("Клиент не найден", 404);
      }
    }
    const requestedItems = body.items ?? [];
    if (!Array.isArray(requestedItems) || !requestedItems.length) return error("Корзина пуста");
    if (requestedItems.length > 500) return error("Слишком много позиций в продаже");

    // Один и тот же товар может уйти в одной продаже по разной цене, поэтому позиции
    // схлопываются по паре «товар + цена», а не по одному товару.
    const combined = new Map<string, { product_id: number; qty: number; unit_price: number | null }>();
    for (const item of requestedItems) {
      const productId = Number(item?.product_id);
      const qty = Number(item?.qty);
      if (!Number.isInteger(productId) || !Number.isInteger(qty) || qty < 1) {
        return error("Некорректная позиция в продаже");
      }
      // Цену можно не передавать — тогда берётся продажная цена товара.
      let unitPrice: number | null = null;
      if (item?.unit_price !== undefined && item?.unit_price !== null) {
        unitPrice = parseMinor(item.unit_price);
        if (unitPrice === null) return error("Укажите корректную цену продажи");
      }
      const key = `${productId}:${unitPrice ?? "default"}`;
      const existing = combined.get(key);
      if (existing) existing.qty += qty;
      else combined.set(key, { product_id: productId, qty, unit_price: unitPrice });
    }
    const items = [...combined.values()];

    try {
      const sale = await withTransaction(async (tx) => {
        let total = 0;
        const lines: { product: Product; qty: number; unit_price: number }[] = [];
        const products = new Map<number, Product>();
        const soldQty = new Map<number, number>();

        for (const item of items) {
          let product = products.get(item.product_id);
          if (!product) {
            product = ((await tx
              .query("SELECT * FROM products WHERE id = ?")
              .get(item.product_id)) as Product | null) ?? undefined;
            if (!product) throw new Error("Товар не найден");
            products.set(item.product_id, product);
          }
          // Остаток проверяется по суммарному количеству: у товара может быть
          // несколько строк с разной ценой.
          const qty = (soldQty.get(item.product_id) ?? 0) + item.qty;
          if (product.stock < qty) {
            throw new Error(`Недостаточно товара «${product.name}» на складе`);
          }
          soldQty.set(item.product_id, qty);
          const unitPrice = item.unit_price ?? product.price;
          total += unitPrice * item.qty;
          lines.push({ product, qty: item.qty, unit_price: unitPrice });
        }

        const insertedSale = (await tx
          .query(
            "INSERT INTO sales (total, payment_method, client_id) VALUES (?, ?, ?) RETURNING *",
          )
          .get(total, paymentMethod, clientId)) as Sale;

        for (const line of lines) {
          await tx.query(
            "INSERT INTO sale_items (sale_id, product_id, product_name, sku, qty, unit_price, cost_price) VALUES (?, ?, ?, ?, ?, ?, ?)",
          ).run(
            insertedSale.id,
            line.product.id,
            line.product.name,
            line.product.sku,
            line.qty,
            line.unit_price,
            line.product.cost_price,
          );
        }

        for (const [productId, qty] of soldQty) {
          await tx.query("UPDATE products SET stock = stock - ? WHERE id = ?").run(qty, productId);
        }

        // Продажа в долг деньгами не оплачена — она становится долгом клиента.
        if (paymentMethod === "debt") {
          await tx
            .query(
              "INSERT INTO client_ledger (client_id, kind, amount, note, sale_id) VALUES (?, 'debt', ?, ?, ?)",
            )
            .run(clientId, total, `Продажа №${insertedSale.id}`, insertedSale.id);
        }

        return insertedSale;
      });
      return json(sale, 201);
    } catch (e) {
      return error(e instanceof Error ? e.message : "Не удалось оформить продажу");
    }
  }

  if (method === "GET" && pathname.match(/^\/api\/sales\/\d+$/)) {
    const id = Number(pathname.split("/").at(-1));
    const sale = (await db.query("SELECT * FROM sales WHERE id = ?").get(id)) as Sale | null;
    if (!sale) return error("Продажа не найдена", 404);
    const items = await db
      .query("SELECT * FROM sale_items WHERE sale_id = ? ORDER BY id")
      .all(id);
    return json({ ...sale, items });
  }

  // Правится только цена продажи: количество и состав продажи трогать нельзя,
  // иначе пришлось бы пересчитывать остатки задним числом.
  if (method === "PATCH" && pathname.match(/^\/api\/sales\/\d+$/)) {
    const id = Number(pathname.split("/").at(-1));
    const body = await parseBody<{ items?: { id?: number; unit_price?: number }[] }>(req);
    const requested = body.items ?? [];
    if (!Array.isArray(requested) || !requested.length) return error("Нечего сохранять");
    if (requested.length > 500) return error("Слишком много позиций в продаже");

    const prices = new Map<number, number>();
    for (const item of requested) {
      const itemId = Number(item?.id);
      const unitPrice = parseMinor(item?.unit_price);
      if (!Number.isInteger(itemId)) return error("Некорректная позиция продажи");
      if (unitPrice === null) return error("Укажите корректную цену продажи");
      prices.set(itemId, unitPrice);
    }

    const existing = (await db
      .query("SELECT id FROM sale_items WHERE sale_id = ?")
      .all(id)) as { id: number }[];
    if (!existing.length) return error("Продажа не найдена", 404);
    const known = new Set(existing.map((row) => row.id));
    for (const itemId of prices.keys()) {
      if (!known.has(itemId)) return error("Позиция не найдена в этой продаже", 404);
    }

    const sale = await withTransaction(async (tx) => {
      for (const [itemId, unitPrice] of prices) {
        await tx
          .query("UPDATE sale_items SET unit_price = ? WHERE id = ? AND sale_id = ?")
          .run(unitPrice, itemId, id);
      }
      // Итог продажи всегда пересобирается из позиций, а не правится на разницу.
      const recalculated = (await tx
        .query("SELECT COALESCE(SUM(qty * unit_price), 0) AS total FROM sale_items WHERE sale_id = ?")
        .get(id)) as { total: number };
      // Долг по продаже в долг обязан совпадать с её суммой.
      await tx
        .query("UPDATE client_ledger SET amount = ? WHERE sale_id = ? AND kind = 'debt'")
        .run(recalculated.total, id);
      return (await tx
        .query("UPDATE sales SET total = ? WHERE id = ? RETURNING *")
        .get(recalculated.total, id)) as Sale;
    });
    return json(sale);
  }

  if (method === "DELETE" && pathname.match(/^\/api\/sales\/\d+$/)) {
    const id = Number(pathname.split("/").at(-1));
    if (!(await db.query("SELECT 1 FROM sales WHERE id = ?").get(id))) {
      return error("Продажа не найдена", 404);
    }
    await withTransaction(async (tx) => {
      // Отменённая продажа возвращает товар на склад.
      const items = (await tx
        .query("SELECT product_id, qty FROM sale_items WHERE sale_id = ?")
        .all(id)) as { product_id: number; qty: number }[];
      for (const item of items) {
        await tx
          .query("UPDATE products SET stock = stock + ? WHERE id = ?")
          .run(item.qty, item.product_id);
      }
      // ON DELETE CASCADE работает только при включённых внешних ключах, поэтому
      // позиции удаляем явно.
      await tx.query("DELETE FROM sale_items WHERE sale_id = ?").run(id);
      // Отменённая продажа в долг не должна оставлять долг за клиентом.
      await tx.query("DELETE FROM client_ledger WHERE sale_id = ?").run(id);
      await tx.query("DELETE FROM sales WHERE id = ?").run(id);
    });
    return json({ ok: true });
  }

  // Деньги магазина. Ничего не хранится — всё считается заново при каждом запросе.
  //
  // Балансов два, наличные и карта: деньги физически лежат в разных местах, и
  // расход с карты не уменьшает пачку купюр в ящике.
  //
  // Продажа в долг не пополняет ни один баланс: товар отдан, денег нет. Деньги
  // приходят позже погашением долга (`client_ledger`, kind = payment) и попадают
  // в наличные. Расход уменьшает и баланс, и прибыль; изъятие — только баланс.
  if (method === "GET" && pathname === "/api/balance") {
    const income = (await db
      .query(
        `SELECT
           COALESCE(SUM(CASE WHEN payment_method = 'cash' THEN total END), 0) AS cash,
           COALESCE(SUM(CASE WHEN payment_method = 'card' THEN total END), 0) AS card,
           COALESCE(SUM(CASE WHEN payment_method = 'debt' THEN total END), 0) AS debt
         FROM sales`,
      )
      .get()) as { cash: number; card: number; debt: number };
    const payments = (await db
      .query("SELECT COALESCE(SUM(amount), 0) AS value FROM client_ledger WHERE kind = 'payment'")
      .get()) as { value: number };
    const outflow = (await db
      .query(
        `SELECT
           COALESCE(SUM(CASE WHEN kind = 'expense' AND account = 'cash' THEN amount END), 0) AS spent_cash,
           COALESCE(SUM(CASE WHEN kind = 'expense' AND account = 'card' THEN amount END), 0) AS spent_card,
           COALESCE(SUM(CASE WHEN kind = 'withdrawal' AND account = 'cash' THEN amount END), 0) AS taken_cash,
           COALESCE(SUM(CASE WHEN kind = 'withdrawal' AND account = 'card' THEN amount END), 0) AS taken_card
         FROM expenses`,
      )
      .get()) as {
      spent_cash: number;
      spent_card: number;
      taken_cash: number;
      taken_card: number;
    };
    // Реализованная маржа: только то, что уже продано, по ценам и закупке той продажи.
    const margin = (await db
      .query("SELECT COALESCE(SUM(qty * (unit_price - cost_price)), 0) AS value FROM sale_items")
      .get()) as { value: number };

    // Каждый вид операций показывается своим списком, поэтому и отдаём их порознь.
    const sales = await db
      .query(
        "SELECT id, total, payment_method, client_id, created_at FROM sales ORDER BY id DESC LIMIT 50",
      )
      .all();
    const expenses = await db
      .query(
        "SELECT id, amount, note, kind, account, created_at FROM expenses WHERE kind = 'expense' ORDER BY id DESC LIMIT 50",
      )
      .all();
    const withdrawals = await db
      .query(
        "SELECT id, amount, note, kind, account, created_at FROM expenses WHERE kind = 'withdrawal' ORDER BY id DESC LIMIT 50",
      )
      .all();

    const cashIn = income.cash + payments.value;
    const cash = {
      balance: cashIn - outflow.spent_cash - outflow.taken_cash,
      income: income.cash,
      payments: payments.value,
      spent: outflow.spent_cash,
      withdrawn: outflow.taken_cash,
    };
    const card = {
      balance: income.card - outflow.spent_card - outflow.taken_card,
      income: income.card,
      spent: outflow.spent_card,
      withdrawn: outflow.taken_card,
    };
    const spent = outflow.spent_cash + outflow.spent_card;

    return json({
      cash,
      card,
      total: cash.balance + card.balance,
      debt: income.debt,
      spent,
      withdrawn: outflow.taken_cash + outflow.taken_card,
      margin: margin.value,
      profit: margin.value - spent,
      sales,
      expenses,
      withdrawals,
    });
  }

  if (method === "POST" && pathname === "/api/expenses") {
    const body = await parseBody<{
      amount?: number;
      note?: string;
      kind?: string;
      account?: string;
    }>(req);
    const amount = parseMinor(body.amount);
    const note = trimmed(body.note);
    const kind = body.kind === "withdrawal" ? "withdrawal" : "expense";
    const account = body.account === "card" ? "card" : "cash";
    if (amount === null || amount <= 0) return error("Укажите сумму больше нуля");
    // У расхода комментарий обязателен: трату без пояснения нельзя разобрать потом.
    // У изъятия он нужен не всегда — деньги просто вынули из кассы.
    if (kind === "expense" && !note) return error("Напишите, на что потрачены деньги");
    const expense = (await db
      .query("INSERT INTO expenses (amount, note, kind, account) VALUES (?, ?, ?, ?) RETURNING *")
      .get(amount, note ?? "", kind, account)) as Expense;
    return json(expense, 201);
  }

  if (method === "DELETE" && pathname.match(/^\/api\/expenses\/\d+$/)) {
    const id = Number(pathname.split("/").at(-1));
    const info = await db.query("DELETE FROM expenses WHERE id = ?").run(id);
    if (info.changes === 0) return error("Расход не найден", 404);
    return json({ ok: true });
  }

  if (method === "GET" && pathname === "/api/reports") {
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    const range = from && to ? { from, to } : todayRange();

    const totals = (await db
      .query(
        `SELECT
           COUNT(*) AS sales_count,
           COALESCE(SUM(total), 0) AS revenue,
           COALESCE((SELECT SUM(si.qty) FROM sale_items si JOIN sales s ON s.id = si.sale_id WHERE s.created_at >= ? AND s.created_at < ?), 0) AS units,
           COALESCE((SELECT SUM(si.qty * si.cost_price) FROM sale_items si JOIN sales s ON s.id = si.sale_id WHERE s.created_at >= ? AND s.created_at < ?), 0) AS cost
         FROM sales
         WHERE created_at >= ? AND created_at < ?`,
      )
      .get(range.from, range.to, range.from, range.to, range.from, range.to)) as {
      sales_count: number;
      revenue: number;
      units: number;
      cost: number;
    };
    // Прибыль считается по закупочной цене, записанной в момент продажи.
    const summary = { ...totals, profit: totals.revenue - totals.cost };

    const byProduct = await db
      .query(
        `SELECT
           si.product_id,
           si.product_name,
           si.sku,
           SUM(si.qty) AS qty,
           SUM(si.qty * si.unit_price) AS revenue,
           SUM(si.qty * si.cost_price) AS cost,
           SUM(si.qty * (si.unit_price - si.cost_price)) AS profit
         FROM sale_items si
         JOIN sales s ON s.id = si.sale_id
         WHERE s.created_at >= ? AND s.created_at < ?
         GROUP BY si.product_id, si.product_name, si.sku
         ORDER BY revenue DESC`,
      )
      .all(range.from, range.to);

    const recent = await db
      .query(
        `SELECT id, created_at, total FROM sales
         WHERE created_at >= ? AND created_at < ?
         ORDER BY id DESC
         LIMIT 50`,
      )
      .all(range.from, range.to);

    const lowStock = await db
      .query("SELECT * FROM products WHERE stock <= 5 ORDER BY stock ASC, name")
      .all();

    return json({ range, summary, byProduct, recent, lowStock });
  }

  return error("Страница не найдена", 404);
}

export async function fetchApi(req: Request): Promise<Response> {
  // Фронтенд и API живут на одном origin (в разработке — через прокси Vite),
  // поэтому CORS не нужен: браузер не должен пускать сюда чужие сайты.
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: { ...baseHeaders, allow: "GET,POST,PATCH,DELETE" } });
  }

  const limit = rateLimit(`api:${clientIp(req)}`, 300, 60_000);
  if (!limit.allowed) {
    return json({ error: "Слишком много запросов. Попробуйте позже" }, 429, {
      "retry-after": String(limit.retryAfter),
    });
  }

  try {
    return await handle(req);
  } catch (e) {
    if (e instanceof BodyTooLarge) return error("Запрос слишком большой", 413);
    if (e instanceof BadJson) return error("Некорректный JSON в запросе");
    console.error(e);
    return error("Ошибка сервера", 500);
  }
}

if (import.meta.main) {
  Bun.serve({
    port: PORT,
    hostname: "127.0.0.1",
    fetch: fetchApi,
  });

  console.log(`Сервер кассы: http://127.0.0.1:${PORT}`);
}
