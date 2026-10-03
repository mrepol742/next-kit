import "server-only";
import { NextResponse, type NextRequest } from "next/server.js";
import {
  createRateLimiter,
  type RateLimiterOptions,
} from "../server/rate-limit.js";

export interface NextRateLimiterOptions extends RateLimiterOptions {
  getKey: (request: NextRequest) => string | Promise<string>;
  matches?: (request: NextRequest) => boolean;
  allowedOrigins?: readonly string[];
  allowMissingOrigin?: boolean;
}

/**
 * Creates a rate limiter middleware for Next.js requests.
 *
 * @param options Configuration options for the rate limiter.
 * @returns A middleware function that checks the user-agent and blocks headless browsers.
 */
export function createNextRateLimiter(options: NextRateLimiterOptions) {
  const check = createRateLimiter(options);
  return async (request: NextRequest): Promise<NextResponse | undefined> => {
    const matches =
      options.matches ??
      ((req: NextRequest) => req.nextUrl.pathname.startsWith("/api/"));
    if (!matches(request)) return;
    if (options.allowedOrigins) {
      const origin = request.headers.get("origin");
      if (
        (!origin && options.allowMissingOrigin === false) ||
        (origin && !options.allowedOrigins.includes(origin))
      ) {
        return NextResponse.json(
          { error: "Origin not allowed" },
          { status: 403 },
        );
      }
    }
    const result = await check(await options.getKey(request));
    if (!result.allowed) {
      return NextResponse.json(
        { error: "Too many requests" },
        {
          status: 429,
          headers: {
            "Retry-After": String(
              Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000)),
            ),
            "X-RateLimit-Limit": String(result.limit),
            "X-RateLimit-Remaining": String(result.remaining),
            "X-RateLimit-Reset": String(Math.ceil(result.resetAt / 1000)),
          },
        },
      );
    }
  };
}
