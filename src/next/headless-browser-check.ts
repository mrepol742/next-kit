import { NextResponse } from "next/server.js";

const DEFAULT_PATTERNS = [
  "headless",
  "phantomjs",
  "slimerjs",
  "puppeteer",
  "playwright",
  "selenium",
  "webkittestrunner",
  "curl",
  "wget",
  "bot",
  "crawler",
  "spider",
  "lighthouse",
  "slurp",
  "scrape",
  "postmanruntime",
];

const DEFAULT_ALLOWED = [
  "googlebot",
  "bingbot",
  "duckduckbot",
  "applebot",
  "baiduspider",
  "yandexbot",
  "facebookexternalhit",
  "whatsapp",
  "facebot",
  "twitterbot",
  "xbot",
  "linkedinbot",
  "slackbot",
  "discordbot",
];

export interface HeadlessBrowserCheckOptions {
  patterns?: readonly string[];
  allowPatterns?: readonly string[];
  blockMissingUserAgent?: boolean;
  excludedPaths?: readonly string[];
}

/**
 * An opt-in user-agent heuristic, not proof of automation.
 *
 * @param options Configuration options for the headless browser check.
 * @returns A middleware function that checks the user-agent and blocks headless browsers.
 */
export function createHeadlessBrowserCheck(
  options: HeadlessBrowserCheckOptions = {},
) {
  const patterns = (options.patterns ?? DEFAULT_PATTERNS).map((value) =>
    value.toLowerCase(),
  );
  const allowed = (options.allowPatterns ?? DEFAULT_ALLOWED).map((value) =>
    value.toLowerCase(),
  );
  return (request: Request): NextResponse | undefined => {
    if (
      (options.excludedPaths ?? ["/up"]).includes(new URL(request.url).pathname)
    )
      return;
    const ua = (request.headers.get("user-agent") ?? "").toLowerCase();
    if (allowed.some((pattern) => ua.includes(pattern))) return;
    if (
      (!ua && (options.blockMissingUserAgent ?? true)) ||
      patterns.some((pattern) => ua.includes(pattern))
    ) {
      return NextResponse.json(
        { error: "Access denied: automated user agent." },
        { status: 403 },
      );
    }
  };
}
