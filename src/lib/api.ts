export type Product = {
  id: number;
  sku: string;
  name: string;
  /** Цена в тийинах (1/100 сума). Форматируйте через money(). */
  price: number;
  stock: number;
  category: string;
  size: string;
  color: string;
  created_at: string;
};

export type Report = {
  range: { from: string; to: string };
  summary: { sales_count: number; revenue: number; units: number };
  byProduct: {
    product_id: number;
    product_name: string;
    sku: string;
    qty: number;
    revenue: number;
  }[];
  recent: { id: number; created_at: string; total: number }[];
  lowStock: Product[];
};

export type Client = {
  id: number;
  name: string;
  number: string;
  created_at: string;
  balance: number;
  ledger_count: number;
  last_activity: string | null;
};

export type ClientLedgerEntry = {
  id: number;
  client_id: number;
  kind: "debt" | "payment";
  /** Сумма в тийинах (1/100 сума). */
  amount: number;
  note: string;
  created_at: string;
};

export type ClientDetails = Client & { ledger: ClientLedgerEntry[] };

/** Сессия истекла или её не было — App перерисуется на экран входа. */
export class UnauthorizedError extends Error {}

export const UNAUTHORIZED_EVENT = "pos:unauthorized";

async function parse<T>(res: Response): Promise<T> {
  if (res.status === 401) {
    window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    throw new UnauthorizedError("Требуется вход в систему");
  }
  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    throw new Error(
      res.status === 404
        ? "API не найден. Проверьте настройки Vercel Functions"
        : `Сервер вернул неожиданный ответ (${res.status})`,
    );
  }
  const data = (await res.json()) as T | { error?: string };
  if (!res.ok) throw new Error((data as { error?: string }).error || "Не удалось выполнить запрос");
  return data as T;
}

export const api = {
  session: () => fetch("/api/session").then((r) => parse<{ authenticated: boolean }>(r)),
  /** Не использует parse(): 401 здесь означает «неверный пароль», а не потерю сессии. */
  login: async (password: string) => {
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (res.ok) return;
    const detail = await res
      .json()
      .then((body: { error?: string }) => body.error)
      .catch(() => null);
    throw new Error(detail || "Не удалось войти");
  },
  logout: () => fetch("/api/logout", { method: "POST" }).then((r) => parse<{ ok: boolean }>(r)),
  products: () => fetch("/api/products").then((r) => parse<Product[]>(r)),
  productByBarcode: (barcode: string) =>
    fetch(`/api/products/barcode/${encodeURIComponent(barcode)}`).then((r) => parse<Product>(r)),
  createProduct: (body: { name: string; price: number; stock: number; sku?: string; category: string; size: string; color: string }) =>
    fetch("/api/products", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => parse<Product>(r)),
  updateProduct: (
    id: number,
    body: { name: string; price: number; stock: number; sku: string; category: string; size: string; color: string },
  ) =>
    fetch(`/api/products/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => parse<Product>(r)),
  deleteProduct: (id: number) =>
    fetch(`/api/products/${id}`, { method: "DELETE" }).then((r) => parse<{ ok: boolean }>(r)),
  checkout: (items: { product_id: number; qty: number }[]) =>
    fetch("/api/sales", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ items }),
    }).then((r) => parse<{ id: number; total: number }>(r)),
  clients: () => fetch("/api/clients").then((r) => parse<Client[]>(r)),
  client: (id: number) => fetch(`/api/clients/${id}`).then((r) => parse<ClientDetails>(r)),
  createClient: (body: { name: string; number: string }) =>
    fetch("/api/clients", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => parse<Client>(r)),
  updateClient: (id: number, body: { name: string; number: string }) =>
    fetch(`/api/clients/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => parse<Client>(r)),
  deleteClient: (id: number) =>
    fetch(`/api/clients/${id}`, { method: "DELETE" }).then((r) => parse<{ ok: boolean }>(r)),
  addClientDebt: (id: number, body: { amount: number; note: string }) =>
    fetch(`/api/clients/${id}/debts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => parse<ClientLedgerEntry>(r)),
  addClientPayment: (id: number, body: { amount: number; note: string }) =>
    fetch(`/api/clients/${id}/payments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => parse<ClientLedgerEntry>(r)),
  reports: (from?: string, to?: string) => {
    const q = from && to ? `?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}` : "";
    return fetch(`/api/reports${q}`).then((r) => parse<Report>(r));
  },
};
