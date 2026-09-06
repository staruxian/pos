import { db, withTransaction, type Client, type ClientLedgerEntry, type Product } from "./db";
import bwipjs from "bwip-js/node";

const PORT = Number(process.env.PORT ?? 3001);

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function error(message: string, status = 400) {
  return json({ error: message }, status);
}

function parseBody<T>(req: Request): Promise<T> {
  return req.json() as Promise<T>;
}

function normalizeBarcode(value?: string) {
  const digits = value?.trim();
  if (!digits) return null;
  if (/^\d+$/.test(digits)) return digits;
  throw new Error("Штрихкод может содержать только цифры");
}

async function newBarcode() {
  while (true) {
    const barcode = `${Date.now()}`.slice(-8) + String(Math.floor(Math.random() * 10_000)).padStart(4, "0");
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

export async function handle(req: Request): Promise<Response> {
  const url = new URL(req.url);
  // На Vercel все запросы /api/* переписываются на одну функцию,
  // а исходный путь приходит в параметре __path.
  const pathname = url.searchParams.get("__path") ?? url.pathname;
  const method = req.method;

  if (method === "GET" && pathname === "/api/health") {
    return json({ ok: true });
  }

  if (method === "GET" && pathname === "/api/products") {
    const products = (await db
      .query("SELECT * FROM products ORDER BY name COLLATE NOCASE")
      .all()) as Product[];
    return json(products);
  }

  if (method === "GET" && pathname.startsWith("/api/products/barcode/")) {
    const sku = decodeURIComponent(pathname.slice("/api/products/barcode/".length));
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
      headers: { "content-type": "image/svg+xml", "cache-control": "no-store" },
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
    const name = body.name?.trim();
    const price = Number(body.price);
    const stock = Number(body.stock ?? 0);
    const category = body.category?.trim() || "Без категории";
    const size = body.size?.trim() || "";
    const color = body.color?.trim() || "";
    if (!name) return error("Укажите название товара");
    if (!Number.isFinite(price) || price < 0) return error("Укажите корректную цену");
    if (!Number.isInteger(stock) || stock < 0) return error("Укажите корректное количество");
    let sku: string;
    try {
      sku = normalizeBarcode(body.sku) ?? await newBarcode();
    } catch (e) {
      return error(e instanceof Error ? e.message : "Некорректный штрихкод");
    }
    try {
      const result = (await db
        .query(
          "INSERT INTO products (sku, name, price, stock, category, size, color) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *",
        )
        .get(sku, name, price, stock, category, size, color)) as Product;
      return json(result, 201);
    } catch {
      return error("Такой штрихкод уже существует");
    }
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
    const name = body.name?.trim() ?? existing.name;
    const price = body.price !== undefined ? Number(body.price) : existing.price;
    const stock = body.stock !== undefined ? Number(body.stock) : existing.stock;
    const category = body.category?.trim() ?? existing.category;
    const size = body.size?.trim() ?? existing.size;
    const color = body.color?.trim() ?? existing.color;
    let sku: string;
    try {
      sku = body.sku === undefined ? existing.sku : (normalizeBarcode(body.sku) ?? existing.sku);
    } catch (e) {
      return error(e instanceof Error ? e.message : "Некорректный штрихкод");
    }
    if (!name) return error("Укажите название товара");
    if (!Number.isFinite(price) || price < 0) return error("Укажите корректную цену");
    if (!Number.isInteger(stock) || stock < 0) return error("Укажите корректное количество");
    try {
      const result = (await db
        .query(
          "UPDATE products SET sku = ?, name = ?, price = ?, stock = ?, category = ?, size = ?, color = ? WHERE id = ? RETURNING *",
        )
        .get(sku, name, price, stock, category, size, color, id)) as Product;
      return json(result);
    } catch {
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
    const name = body.name?.trim();
    const number = body.number?.trim();
    if (!name) return error("Укажите имя клиента");
    if (!number) return error("Укажите номер клиента");
    try {
      const client = (await db
        .query("INSERT INTO clients (name, number) VALUES (?, ?) RETURNING *")
        .get(name, number)) as Client;
      return json({ ...client, balance: 0, ledger_count: 0, last_activity: null }, 201);
    } catch {
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
    const name = body.name?.trim() ?? existing.name;
    const number = body.number?.trim() ?? existing.number;
    if (!name) return error("Укажите имя клиента");
    if (!number) return error("Укажите номер клиента");
    try {
      const client = (await db
        .query("UPDATE clients SET name = ?, number = ? WHERE id = ? RETURNING *")
        .get(name, number, id)) as Client;
      return json(client);
    } catch {
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
    const amount = Number(body.amount);
    const note = body.note?.trim() || "";
    if (!Number.isFinite(amount) || amount <= 0) return error("Укажите сумму больше нуля");

    try {
      const entry = await withTransaction(async (tx) => {
      if (kind === "payment") {
        const row = (await tx
          .query(
            `SELECT COALESCE(SUM(CASE WHEN kind = 'debt' THEN amount ELSE -amount END), 0) AS balance
             FROM client_ledger WHERE client_id = ?`,
          )
          .get(id)) as { balance: number };
        if (amount > row.balance + 0.000001) {
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
    if (!requestedItems.length) return error("Корзина пуста");

    const combined = new Map<number, number>();
    for (const item of requestedItems) {
      const productId = Number(item.product_id);
      const qty = Number(item.qty);
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
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
        "access-control-allow-headers": "content-type",
      },
    });
  }
  try {
    const res = await handle(req);
    res.headers.set("access-control-allow-origin", "*");
    return res;
  } catch (e) {
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
