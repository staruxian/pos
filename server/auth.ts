// Аутентификация кассы: один общий пароль магазина и подписанная сессия в cookie.
// Токен не хранится в базе — он самодостаточен: срок жизни + HMAC-подпись.

const password = process.env.POS_PASSWORD;
const secret = process.env.SESSION_SECRET;

if (!password || !secret) {
  throw new Error(
    "Не заданы POS_PASSWORD и SESSION_SECRET. Смотрите .env.example",
  );
}

if (secret.length < 32) {
  throw new Error("SESSION_SECRET должен быть длиной не менее 32 символов");
}

export const SESSION_COOKIE = "pos_session";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

const encoder = new TextEncoder();
const key = await crypto.subtle.importKey(
  "raw",
  encoder.encode(secret),
  { name: "HMAC", hash: "SHA-256" },
  false,
  ["sign"],
);

function base64url(bytes: ArrayBuffer) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

async function sign(payload: string) {
  return base64url(await crypto.subtle.sign("HMAC", key, encoder.encode(payload)));
}

/** Сравнение за постоянное время: сначала хешируем, чтобы не утекала длина. */
async function equals(a: string, b: string) {
  const [left, right] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(a)),
    crypto.subtle.digest("SHA-256", encoder.encode(b)),
  ]);
  const x = new Uint8Array(left);
  const y = new Uint8Array(right);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i]! ^ y[i]!;
  return diff === 0;
}

export function checkPassword(candidate: unknown) {
  if (typeof candidate !== "string") return Promise.resolve(false);
  return equals(candidate, password!);
}

export async function createSessionToken() {
  const payload = `v1.${Date.now() + SESSION_TTL_MS}`;
  return `${payload}.${await sign(payload)}`;
}

async function isValidToken(token: string) {
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [version, expires, signature] = parts as [string, string, string];
  if (version !== "v1") return false;
  if (!(await equals(signature, await sign(`${version}.${expires}`)))) return false;
  const expiresAt = Number(expires);
  return Number.isFinite(expiresAt) && expiresAt > Date.now();
}

function readCookie(header: string | null, name: string) {
  if (!header) return null;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return null;
}

export async function hasSession(req: Request) {
  const token = readCookie(req.headers.get("cookie"), SESSION_COOKIE);
  return token ? isValidToken(token) : false;
}

function isSecure(req: Request) {
  return (req.headers.get("x-forwarded-proto") ?? new URL(req.url).protocol.replace(":", "")) === "https";
}

export function sessionCookie(req: Request, token: string) {
  const flags = ["Path=/", "HttpOnly", "SameSite=Strict", `Max-Age=${SESSION_TTL_MS / 1000}`];
  if (isSecure(req)) flags.push("Secure");
  return `${SESSION_COOKIE}=${token}; ${flags.join("; ")}`;
}

export function clearCookie(req: Request) {
  const flags = ["Path=/", "HttpOnly", "SameSite=Strict", "Max-Age=0"];
  if (isSecure(req)) flags.push("Secure");
  return `${SESSION_COOKIE}=; ${flags.join("; ")}`;
}
