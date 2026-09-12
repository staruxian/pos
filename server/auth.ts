// Аутентификация кассы: один общий пароль магазина и подписанная сессия в cookie.
// Токен сессии в базе не хранится — он самодостаточен: срок жизни + HMAC-подпись.
//
// Пароль и ключ подписи живут в таблице `meta`, а не в переменных окружения.
// Переменная окружения, заданная в оболочке, молча перекрывает значение из .env,
// и тогда касса открывается не тем паролем, что записан в файле — ищи потом, каким.
// В базе значение одно, и оно то же самое для всех инстансов Vercel.
import { db, withTransaction } from "./db";

const PASSWORD_KEY = "auth_password";
const SECRET_KEY = "auth_session_secret";

export const SESSION_COOKIE = "pos_session";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const PBKDF2_ITERATIONS = 210_000;
/** Дольше — лишние обращения к базе; короче — пароль меняется дольше, чем терпимо. */
const STATE_TTL_MS = 60_000;

const encoder = new TextEncoder();

async function readMeta(key: string) {
  const row = (await db.query("SELECT value FROM meta WHERE key = ?").get(key)) as
    | { value: string }
    | null;
  return row?.value ?? null;
}

function toBase64(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes));
}

function fromBase64(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// --- пароль ---------------------------------------------------------------

async function derive(password: string, salt: BufferSource, iterations: number) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    key,
    256,
  );
  return new Uint8Array(bits);
}

/** PBKDF2-SHA256, а не голый хеш: подбор по словарю должен стоить дорого. */
export async function hashPassword(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${toBase64(salt)}$${toBase64(hash)}`;
}

function sameBytes(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

async function verifyPassword(password: string, stored: string) {
  const [scheme, iterations, salt, hash] = stored.split("$");
  if (scheme !== "pbkdf2" || !iterations || !salt || !hash) return false;
  const rounds = Number(iterations);
  if (!Number.isInteger(rounds) || rounds < 1) return false;
  try {
    return sameBytes(await derive(password, fromBase64(salt), rounds), fromBase64(hash));
  } catch {
    return false;
  }
}

/**
 * Пишет новый пароль магазина и выбрасывает все открытые сессии: пароль меняют,
 * когда доступ кому-то больше не нужен, а старый cookie пережил бы смену.
 */
export async function setPassword(password: string) {
  const hash = await hashPassword(password);
  await withTransaction(async (tx) => {
    await tx
      .query("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(PASSWORD_KEY, hash);
    await tx.query("DELETE FROM meta WHERE key = ?").run(SECRET_KEY);
  });
  cached = null;
}

/** Пароль читаем из базы на каждой попытке входа: их мало, и они ограничены по частоте. */
export async function checkPassword(candidate: unknown) {
  if (typeof candidate !== "string") return false;
  const stored = await readMeta(PASSWORD_KEY);
  return stored ? verifyPassword(candidate, stored) : false;
}

// --- состояние входа ------------------------------------------------------

type AuthState = { enabled: boolean; secret: string };

let cached: { at: number; state: AuthState } | null = null;

async function ensureSecret() {
  const existing = await readMeta(SECRET_KEY);
  if (existing) return existing;
  const secret = toBase64(crypto.getRandomValues(new Uint8Array(48)));
  // OR IGNORE, а не проверка-и-вставка: два инстанса могут стартовать одновременно,
  // и разойтись в ключе подписи им нельзя — иначе сессии одного не примет другой.
  await db.query("INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)").run(SECRET_KEY, secret);
  return (await readMeta(SECRET_KEY)) ?? secret;
}

/**
 * Вход включён, пока в базе есть пароль. Нет пароля — касса работает открытой:
 * запертая касса хуже открытой, если запереть её получилось случайно.
 */
async function authState(): Promise<AuthState> {
  const now = Date.now();
  if (cached && now - cached.at < STATE_TTL_MS) return cached.state;
  const password = await readMeta(PASSWORD_KEY);
  const state: AuthState = password
    ? { enabled: true, secret: await ensureSecret() }
    : { enabled: false, secret: "" };
  cached = { at: now, state };
  return state;
}

export async function authEnabled() {
  return (await authState()).enabled;
}

// --- сессия ---------------------------------------------------------------

let cachedKey: { secret: string; key: Promise<CryptoKey> } | null = null;

function hmacKey(secret: string) {
  if (!cachedKey || cachedKey.secret !== secret) {
    cachedKey = {
      secret,
      key: crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
        "sign",
      ]),
    };
  }
  return cachedKey.key;
}

function base64url(bytes: ArrayBuffer) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

async function sign(payload: string, secret: string) {
  return base64url(await crypto.subtle.sign("HMAC", await hmacKey(secret), encoder.encode(payload)));
}

/** Сравнение за постоянное время: сначала хешируем, чтобы не утекала длина. */
async function equals(a: string, b: string) {
  const [left, right] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(a)),
    crypto.subtle.digest("SHA-256", encoder.encode(b)),
  ]);
  return sameBytes(new Uint8Array(left), new Uint8Array(right));
}

export async function createSessionToken() {
  const { secret } = await authState();
  const payload = `v1.${Date.now() + SESSION_TTL_MS}`;
  return `${payload}.${await sign(payload, secret)}`;
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
  const { enabled, secret } = await authState();
  if (!enabled) return false;
  const token = readCookie(req.headers.get("cookie"), SESSION_COOKIE);
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [version, expires, signature] = parts as [string, string, string];
  if (version !== "v1") return false;
  if (!(await equals(signature, await sign(`${version}.${expires}`, secret)))) return false;
  const expiresAt = Number(expires);
  return Number.isFinite(expiresAt) && expiresAt > Date.now();
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
