// Аутентификация кассы: один общий пароль магазина и подписанная сессия в cookie.
// Токен не хранится в базе — он самодостаточен: срок жизни + HMAC-подпись.

// process.env читаем на каждом обращении, а не при загрузке модуля: Vercel фиксирует
// переменные в момент создания деплоя, и значение, добавленное позже, на верхнем
// уровне модуля может не увидеться.
const posPassword = () => process.env.POS_PASSWORD;
const sessionSecret = () => process.env.SESSION_SECRET;

/**
 * Вход по паролю включается наличием POS_PASSWORD и SESSION_SECRET. Если их нет,
 * касса работает без пароля и API открыт всем, у кого есть адрес.
 */
export function authEnabled() {
  return Boolean(posPassword() && sessionSecret());
}

/**
 * Ошибка — только если вход настроен наполовину: заполнить одну переменную из двух
 * почти наверняка означает, что пароль хотели включить. Проверяем на каждом запросе,
 * а не при импорте: иначе функция падает целиком, ещё до маршрутизации, и наружу
 * уходит безликий 500 даже на /api/health.
 */
export function authConfigError(): string | null {
  const password = posPassword();
  const secret = sessionSecret();
  if (!password && !secret) return null;
  if (!password || !secret) return "задана только одна из POS_PASSWORD и SESSION_SECRET";
  if (secret.length < 32) return "SESSION_SECRET короче 32 символов";
  return null;
}

export const SESSION_COOKIE = "pos_session";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

const encoder = new TextEncoder();

// Ключ создаётся при первом обращении, а не на верхнем уровне модуля: top-level await
// в бессерверной сборке — лишний риск на ровном месте.
let cachedKey: { secret: string; key: Promise<CryptoKey> } | null = null;

function hmacKey() {
  const secret = sessionSecret()!;
  if (!cachedKey || cachedKey.secret !== secret) {
    cachedKey = {
      secret,
      key: crypto.subtle.importKey(
        "raw",
        encoder.encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
      ),
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

async function sign(payload: string) {
  return base64url(await crypto.subtle.sign("HMAC", await hmacKey(), encoder.encode(payload)));
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
  if (!authEnabled() || authConfigError() || typeof candidate !== "string") {
    return Promise.resolve(false);
  }
  return equals(candidate, posPassword()!);
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
  if (!authEnabled() || authConfigError()) return false;
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
