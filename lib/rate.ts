// lib/rate.ts
//
// Rate limiting with two backends:
//   - Upstash Redis (distributed): used when UPSTASH_REDIS_REST_URL +
//     UPSTASH_REDIS_REST_TOKEN are set. Safe across multiple serverless instances.
//   - In-memory fallback: used in local dev / when Upstash is not configured.
//     Effective only within a single process — not suitable for production at scale.
//
// Redis failures always fail OPEN (allow the request) so a Redis outage never
// blocks legitimate users.
//
// rateLimit() is async — callers must await it.

import { Redis } from "@upstash/redis";

export type RateResult = {
  ok: boolean;
  headers: Record<string, string>;
  remaining: number;
  resetMs: number;
};

// ── In-memory fallback (single-process sliding window) ────────────────────────

type Bucket = { stamps: number[] };
const store = new Map<string, Bucket>();

function inMemoryRateLimit(key: string, limit: number, windowMs: number): RateResult {
  const now = Date.now();
  const bucket = store.get(key) ?? { stamps: [] };
  bucket.stamps = bucket.stamps.filter((t) => now - t < windowMs);

  const ok = bucket.stamps.length < limit;
  if (ok) bucket.stamps.push(now);
  store.set(key, bucket);

  const oldest = bucket.stamps[0] ?? now;
  const resetMs = Math.max(0, windowMs - (now - oldest));
  const remaining = Math.max(0, limit - bucket.stamps.length);

  return {
    ok,
    remaining,
    resetMs,
    headers: {
      "X-RateLimit-Limit": String(limit),
      "X-RateLimit-Remaining": String(remaining),
      "Retry-After": String(Math.ceil(resetMs / 1000)),
    },
  };
}

// ── Upstash Redis client (lazy, singleton) ────────────────────────────────────

let _redis: Redis | null = null;

function getRedis(): Redis | null {
  if (
    !process.env.UPSTASH_REDIS_REST_URL ||
    !process.env.UPSTASH_REDIS_REST_TOKEN
  ) {
    return null;
  }
  if (!_redis) {
    _redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
  }
  return _redis;
}

// ── Distributed rate limit via Redis INCR + EXPIRE (fixed window) ─────────────
// Fixed window is sufficient for our use case (10 req/60s) and is simpler than
// sliding window — a sliding window can be added later if needed.

async function redisRateLimit(
  redis: Redis,
  key: string,
  limit: number,
  windowMs: number
): Promise<RateResult> {
  const windowSec = Math.ceil(windowMs / 1000);
  const redisKey = `rl:${key}`;

  const count = await redis.incr(redisKey);
  if (count === 1) {
    // First request in this window — set the expiry
    await redis.expire(redisKey, windowSec);
  }

  const ok = count <= limit;
  const remaining = Math.max(0, limit - count);

  return {
    ok,
    remaining,
    resetMs: windowMs, // approximate — exact reset time requires a TTL call
    headers: {
      "X-RateLimit-Limit": String(limit),
      "X-RateLimit-Remaining": String(remaining),
      "Retry-After": String(windowSec),
    },
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function rateLimit(
  key: string,
  limit: number,
  windowMs: number
): Promise<RateResult> {
  const redis = getRedis();

  if (redis) {
    try {
      return await redisRateLimit(redis, key, limit, windowMs);
    } catch {
      // Fail open: Redis error → allow the request.
      // Log but do not surface as a 5xx to the caller.
      console.warn("[rate] Redis error — failing open for key:", key);
      return {
        ok: true,
        remaining: limit,
        resetMs: windowMs,
        headers: {
          "X-RateLimit-Limit": String(limit),
          "X-RateLimit-Remaining": String(limit),
          "Retry-After": "0",
        },
      };
    }
  }

  return inMemoryRateLimit(key, limit, windowMs);
}

// ── IP helper (unchanged) ─────────────────────────────────────────────────────

export function clientIpFromRequest(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd && fwd.trim() !== "") return fwd.split(",")[0]!.trim();
  const real = req.headers.get("x-real-ip");
  if (real && real.trim() !== "") return real.trim();
  return "0.0.0.0";
}
