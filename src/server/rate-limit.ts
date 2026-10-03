import "server-only";
import type { Redis } from "@upstash/redis";

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
}

export interface RateLimitStore {
  /** Implementations must increment and expire atomically. */
  increment(
    key: string,
    windowMs: number,
  ): Promise<{ count: number; ttlMs: number }>;
}

export function createMemoryRateLimitStore(): RateLimitStore {
  const entries = new Map<string, { count: number; expires: number }>();
  return {
    async increment(key, windowMs) {
      const now = Date.now();
      // Bound retained state by pruning expired entries on each operation.
      for (const [id, entry] of entries)
        if (entry.expires <= now) entries.delete(id);
      let entry = entries.get(key);
      if (!entry) {
        entry = { count: 0, expires: now + windowMs };
        entries.set(key, entry);
      }
      entry.count++;
      return { count: entry.count, ttlMs: entry.expires - now };
    },
  };
}

const INCREMENT_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return {count, ttl}
`;

export function createRedisRateLimitStore(
  redis: Pick<Redis, "eval">,
): RateLimitStore {
  return {
    async increment(key, windowMs) {
      const [count, ttlMs] = await redis.eval<[number], [number, number]>(
        INCREMENT_SCRIPT,
        [key],
        [windowMs],
      );
      return { count, ttlMs };
    },
  };
}

export interface RateLimiterOptions {
  store: RateLimitStore;
  /** Use a different prefix for each application and route policy. */
  prefix: string;
  maxRequests: number;
  windowMs: number;
}

export function createRateLimiter(options: RateLimiterOptions) {
  if (
    !options.prefix ||
    !Number.isSafeInteger(options.maxRequests) ||
    options.maxRequests < 1 ||
    !Number.isSafeInteger(options.windowMs) ||
    options.windowMs < 1
  ) {
    throw new Error(
      "Rate limiting requires a prefix and positive integer limit and window.",
    );
  }
  return async (key: string): Promise<RateLimitResult> => {
    if (!key) throw new Error("A non-empty rate limit identity is required.");
    const { count, ttlMs } = await options.store.increment(
      `${options.prefix}:${key}`,
      options.windowMs,
    );
    return {
      allowed: count <= options.maxRequests,
      limit: options.maxRequests,
      remaining: Math.max(0, options.maxRequests - count),
      resetAt: Date.now() + ttlMs,
    };
  };
}
