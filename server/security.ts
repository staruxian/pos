// Общие защитные обвязки HTTP: разбор пути, ограничение размера тела и частоты запросов.

/** Путь вида /api или /api/<сегменты>, без пустых сегментов и без «..». */
const API_PATH = /^\/api(?:\/[^/?#]+)*$/;

/**
 * На Vercel все /api/* переписываются в одну функцию, а исходный путь приходит
 * в параметре __path. Параметр подконтролен клиенту, поэтому доверяем ему только
 * когда запрос действительно пришёл на /api, и только если это корректный путь /api/...
 * Иначе любой фильтр по пути на уровне платформы обходился бы через ?__path=.
 * Возвращает null, если __path подделан.
 */
export function resolvePath(url: URL): string | null {
  const override = url.searchParams.get("__path");
  if (override === null) return url.pathname;
  if (url.pathname !== "/api" && url.pathname !== "/api/") return url.pathname;
  const candidate = override.split(/[?#]/)[0] ?? "";
  if (!API_PATH.test(candidate)) return null;
  if (candidate.split("/").includes("..")) return null;
  return candidate;
}

const MAX_BODY_BYTES = 64 * 1024;

export class BodyTooLarge extends Error {}
export class BadJson extends Error {}

/** Читает JSON с жёстким потолком по размеру: req.json() буферизует что угодно. */
export async function readJson<T>(req: Request): Promise<T> {
  const declared = Number(req.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) throw new BodyTooLarge();
  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) throw new BodyTooLarge();
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new BadJson();
  }
}

export function clientIp(req: Request) {
  const forwarded = req.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";
}

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 10_000;

/**
 * Счётчик в памяти процесса. На Vercel инстансов несколько, поэтому лимит там
 * приблизительный — он гасит перебор и наплыв, но не заменяет внешний rate limiter.
 */
export function rateLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  if (buckets.size > MAX_BUCKETS) {
    for (const [id, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(id);
    if (buckets.size > MAX_BUCKETS) buckets.clear();
  }
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfter: 0 };
  }
  bucket.count += 1;
  if (bucket.count > limit) {
    return { allowed: false, retryAfter: Math.ceil((bucket.resetAt - now) / 1000) };
  }
  return { allowed: true, retryAfter: 0 };
}

/** libSQL сообщает о нарушении UNIQUE текстом ошибки — ловим только его. */
export function isUniqueViolation(e: unknown) {
  const message = e instanceof Error ? e.message : String(e);
  return /UNIQUE constraint failed/i.test(message) || /SQLITE_CONSTRAINT_UNIQUE/i.test(message);
}

/** Криптостойкие цифры: Math.random() предсказуем, а штрихкод не должен угадываться. */
export function randomDigits(length: number) {
  const digits: string[] = [];
  const buffer = new Uint8Array(length * 2);
  while (digits.length < length) {
    crypto.getRandomValues(buffer);
    for (const byte of buffer) {
      if (digits.length >= length) break;
      // 250 = 25 * 10: отбрасываем хвост, иначе остаток по модулю смещён.
      if (byte < 250) digits.push(String(byte % 10));
    }
  }
  return digits.join("");
}
