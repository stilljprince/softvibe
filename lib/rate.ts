// lib/rate.ts
// Kleines In-Memory Sliding-Window Rate-Limit (pro Prozess)
// Für Vercel/Serverless nur als Basis – später Redis o.ä. nehmen.

type Bucket = {
  stamps: number[];         // Unix ms timestamps innerhalb des Fensters
};

const store = new Map<string, Bucket>();

export type RateResult = {
  ok: boolean;
  headers: Record<string, string>;
  remaining: number;
  resetMs: number;
};

export function rateLimit(key: string, limit: number, windowMs: number): RateResult {
  const now = Date.now();
  const bucket = store.get(key) ?? { stamps: [] };
  // Altes Fenster rauswerfen
  bucket.stamps = bucket.stamps.filter((t) => now - t < windowMs);

  const remainingBefore = Math.max(0, limit - bucket.stamps.length);
  let ok = true;

  if (remainingBefore <= 0) {
    ok = false;
  } else {
    bucket.stamps.push(now);
  }

  store.set(key, bucket);

  const oldest = bucket.stamps[0] ?? now;
  const resetMs = Math.max(0, windowMs - (now - oldest));
  const headers: Record<string, string> = {
    "X-RateLimit-Limit": String(limit),
    "X-RateLimit-Remaining": String(Math.max(0, limit - bucket.stamps.length)),
    "Retry-After": String(Math.ceil(resetMs / 1000)),
  };

  return { ok, headers, remaining: Math.max(0, limit - bucket.stamps.length), resetMs };
}

/** IP aus Request-Headern ziehen (Fallbacks) */
export function clientIpFromRequest(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd && fwd.trim() !== "") return fwd.split(",")[0]!.trim();
  const real = req.headers.get("x-real-ip");
  if (real && real.trim() !== "") return real.trim();
  return "0.0.0.0";
}