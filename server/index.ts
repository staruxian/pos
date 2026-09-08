import { db, withTransaction, type Client, type ClientLedgerEntry, type Product } from "./db";
import bwipjs from "bwip-js/node";
import {
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

  if (method === "GET" && pathname === "/api/health") {
    return json({ ok: true });
  }

  if (method === "GET" && pathname === "/api/session") {
    return json({ authenticated: await hasSession(req) });
  }

  if (method === "POST" && pathname === "/api/login") {
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

  if (!publicPaths.has(pathname) && !(await hasSession(req))) {
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
      stock?: number;
      sku?: string;
      category?: string;
      size?: string;
      color?: string;
    }>(req);
    const name = trimmed(body.name);
    const price = parseMinor(body.price);
    const stock = Number(body.stock ?? 0);
    const category = trimmed(body.category) || "Без категории";
    const size = trimmed(body.size, 50) || "";
    const color = trimmed(body.color, 50) || "";
    if (!name) return error("Укажите название товара");
    if (price === null) return error("Укажите корректную цену");
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
            "INSERT INTO products (sku, name, price, stock, category, size, color) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *",
          )
          .get(sku, name, price, stock, category, size, color)) as Product;
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
      stock?: number;
      sku?: string;
      category?: string;
      size?: string;
      color?: string;
    }>(req);
    const name = trimmed(body.name) ?? existing.name;
    const price = body.price !== undefined ? parseMinor(body.price) : existing.price;
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
    if (!Number.isInteger(stock) || stock < 0 || stock > 1_000_000) {
      return error("Укажите корректное количество");
    }
    try {
      const result = (await db
        .query(
          "UPDATE products SET sku = ?, name = ?, price = ?, stock = ?, category = ?, size = ?, color = ? WHERE id = ? RETURNING *",
        )
        .get(sku, name, price, stock, category, size, color, id)) as Product;
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
    const body = await parseBody<{ items?: { product_id: number; qty: number }[] }>(req);
    const requestedItems = body.items ?? [];
    if (!Array.isArray(requestedItems) || !requestedItems.length) return error("Корзина пуста");
    if (requestedItems.length > 500) return error("Слишком много позиций в продаже");

    const combined = new Map<number, number>();
    for (const item of requestedItems) {
      const productId = Number(item?.product_id);
      const qty = Number(item?.qty);
      if (!Number.isInteger(productId) || !Number.isInteger(qty) || qty < 1) {
        return error("Некорректная позиция в продаже");
      }
      combined.set(productId, (combined.get(productId) ?? 0) + qty);
    }
    const items = [...combined].map(([product_id, qty]) => ({ product_id, qty }));

    try {
      const sale = await withTransaction(async (tx) => {
        let total = 0;
        const lines: { product: Product; qty: number; unit_price: number }[] = [];

        for (const item of items) {
          const qty = Number(item.qty);
          if (!Number.isInteger(qty) || qty < 1) throw new Error("Некорректное количество");
          const product = (await tx
            .query("SELECT * FROM products WHERE id = ?")
            .get(item.product_id)) as Product | null;
          if (!product) throw new Error("Товар не найден");
          if (product.stock < qty) {
            throw new Error(`Недостаточно товара «${product.name}» на складе`);
          }
          total += product.price * qty;
          lines.push({ product, qty, unit_price: product.price });
        }

        const insertedSale = (await tx
          .query("INSERT INTO sales (total) VALUES (?) RETURNING *")
          .get(total)) as { id: number; created_at: string; total: number };

        for (const line of lines) {
          await tx.query(
            "INSERT INTO sale_items (sale_id, product_id, product_name, sku, qty, unit_price) VALUES (?, ?, ?, ?, ?, ?)",
          ).run(
            insertedSale.id,
            line.product.id,
            line.product.name,
            line.product.sku,
            line.qty,
            line.unit_price,
          );
          await tx.query("UPDATE products SET stock = stock - ? WHERE id = ?").run(
            line.qty,
            line.product.id,
          );
        }

        return insertedSale;
      });
      return json(sale, 201);
    } catch (e) {
      return error(e instanceof Error ? e.message : "Не удалось оформить продажу");
    }
  }

  if (method === "GET" && pathname === "/api/reports") {
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    const range = from && to ? { from, to } : todayRange();

    const summary = (await db
      .query(
        `SELECT
           COUNT(*) AS sales_count,
           COALESCE(SUM(total), 0) AS revenue,
           COALESCE((SELECT SUM(qty) FROM sale_items si JOIN sales s ON s.id = si.sale_id WHERE s.created_at >= ? AND s.created_at < ?), 0) AS units
         FROM sales
         WHERE created_at >= ? AND created_at < ?`,
      )
      .get(range.from, range.to, range.from, range.to)) as {
      sales_count: number;
      revenue: number;
      units: number;
    };

    const byProduct = await db
      .query(
        `SELECT
           si.product_id,
           si.product_name,
           si.sku,
           SUM(si.qty) AS qty,
           SUM(si.qty * si.unit_price) AS revenue
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
