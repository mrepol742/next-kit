import "server-only";
import { Redis } from "@upstash/redis";

export interface RedisOptions {
  url?: string;
  token?: string;
}

/** Lazily read server environment values when called, never on import. */
export function createRedis(options: RedisOptions = {}): Redis {
  const url = options.url ?? process.env.UPSTASH_REDIS_REST_URL;
  const token = options.token ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error("Redis requires a REST URL and token.");
  return new Redis({ url, token });
}
