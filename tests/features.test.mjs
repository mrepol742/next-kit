import assert from "node:assert/strict";
import { test } from "node:test";
import { createEmailChecker, validateEmail } from "../dist/email.js";
import { messageHtmlToText, sanitizeMessageHtml } from "../dist/message.js";
import {
  createRateLimiter,
  createMemoryRateLimitStore,
  createRedisRateLimitStore,
} from "../dist/server/rate-limit.js";
import { createRecaptchaVerifier } from "../dist/server/recaptcha.js";
import { createRedis } from "../dist/server/redis.js";
import { createHeadlessBrowserCheck } from "../dist/next/headless-browser-check.js";
import { createNextRateLimiter } from "../dist/next/rate-limiter.js";
import { NextRequest } from "next/server.js";

test("HTML helpers remove executable content and unsafe links", () => {
  const html = sanitizeMessageHtml(
    '<script>alert(1)</script><p>Hello <strong>there</strong></p><a href="javascript:alert(1)">bad</a>',
  );
  assert.ok(!html.includes("script"));
  assert.ok(!html.includes("javascript:"));
  assert.ok(html.includes("noopener noreferrer"));
  assert.equal(
    messageHtmlToText("<p>Hello <strong>there</strong></p>"),
    "Hello there",
  );
});

test("email checker validates format, deduplicates concurrent fetches, and caches", async () => {
  assert.equal(validateEmail("name @example.com"), false);
  assert.equal(validateEmail("admin@example.com"), true);
  let calls = 0;
  const checker = createEmailChecker({
    fetch: async () => {
      calls++;
      return new Response("# comment\nthrowaway.test\n");
    },
  });
  assert.deepEqual(
    await Promise.all([
      checker.isDisposableEmail("a@THROWAWAY.test"),
      checker.isDisposableEmail("b@real.test"),
    ]),
    [true, false],
  );
  assert.equal(await checker.isDisposableEmail("c@real.test"), false);
  assert.equal(calls, 1);
  assert.equal(await checker.isDisposableEmail("invalid"), true);
});

test("email checker exposes outage policy and retries after a failed refresh", async () => {
  let attempts = 0;
  const checker = createEmailChecker({
    fetch: async () => {
      if (++attempts === 1) throw new Error("offline");
      return new Response("disposable.test");
    },
  });
  await assert.rejects(
    checker.isDisposableEmail("a@disposable.test"),
    /offline/,
  );
  assert.equal(await checker.isDisposableEmail("a@disposable.test"), true);
  assert.equal(
    await createEmailChecker({
      fetch: async () => {
        throw new Error();
      },
      onFetchError: "block",
    }).isDisposableEmail("a@real.test"),
    true,
  );
});

test("rate limiting isolates identities and namespaces, and resets expired windows", async () => {
  const store = createMemoryRateLimitStore();
  const check = createRateLimiter({
    store,
    prefix: "app:contact",
    maxRequests: 2,
    windowMs: 20,
  });
  assert.equal((await check("user-a")).remaining, 1);
  assert.equal((await check("user-a")).allowed, true);
  assert.equal((await check("user-a")).allowed, false);
  assert.equal((await check("user-b")).allowed, true);
  const other = createRateLimiter({
    store,
    prefix: "other:contact",
    maxRequests: 2,
    windowMs: 20,
  });
  assert.equal((await other("user-a")).allowed, true);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal((await check("user-a")).remaining, 1);
  await assert.rejects(check(""), /identity/);
});

test("Redis limiter uses one atomic script with expiry and namespaced keys", async () => {
  let invocation;
  const store = createRedisRateLimitStore({
    eval: async (...args) => {
      invocation = args;
      return [4, 500];
    },
  });
  const check = createRateLimiter({
    store,
    prefix: "app:api",
    maxRequests: 3,
    windowMs: 1000,
  });
  assert.equal((await check("u1")).allowed, false);
  assert.deepEqual(invocation.slice(1), [["app:api:u1"], [1000]]);
  assert.match(invocation[0], /PEXPIRE/);
});

test("Next adapter applies origins, match scope, status, and retry metadata", async () => {
  const check = createNextRateLimiter({
    store: createMemoryRateLimitStore(),
    prefix: "test",
    maxRequests: 1,
    windowMs: 60_000,
    getKey: () => "trusted-user",
    allowedOrigins: ["https://app.test"],
  });
  assert.equal(
    await check(new NextRequest("https://app.test/about")),
    undefined,
  );
  assert.equal(
    (
      await check(
        new NextRequest("https://app.test/api/contact", {
          headers: { origin: "https://evil.test" },
        }),
      )
    ).status,
    403,
  );
  const request = new NextRequest("https://app.test/api/contact", {
    headers: { origin: "https://app.test" },
  });
  assert.equal(await check(request), undefined);
  const response = await check(request);
  assert.equal(response.status, 429);
  assert.ok(Number(response.headers.get("Retry-After")) > 0);
});

test("user-agent checks allow health probes and configurable exceptions", () => {
  const check = createHeadlessBrowserCheck({ allowPatterns: ["Googlebot"] });
  assert.equal(check(new Request("https://app.test/up")), undefined);
  assert.equal(
    check(
      new Request("https://app.test/", { headers: { "user-agent": "curl/8" } }),
    ).status,
    403,
  );
  assert.equal(
    check(
      new Request("https://app.test/", {
        headers: { "user-agent": "Googlebot" },
      }),
    ),
    undefined,
  );
  assert.equal(
    check(
      new Request("https://app.test/", {
        headers: { "user-agent": "Mozilla/5.0" },
      }),
    ),
    undefined,
  );
});

test("reCAPTCHA checks action, score, validity, and service failures", async () => {
  let assessment = {
    tokenProperties: { valid: true, action: "contact" },
    riskAnalysis: { score: 0.7 },
  };
  let calls = 0;
  const client = {
    projectPath: (id) => `projects/${id}`,
    createAssessment: async () => {
      calls++;
      return [assessment];
    },
  };
  const verify = createRecaptchaVerifier({
    projectId: "test",
    siteKey: "site",
    client,
  });
  assert.equal(await verify("", "contact"), false);
  assert.equal(calls, 0);
  assert.equal(await verify("token", "contact"), true);
  assert.equal(await verify("token", "other"), false);
  assessment.riskAnalysis.score = 0.2;
  assert.equal(await verify("token", "contact"), false);
  assessment.tokenProperties.valid = false;
  assert.equal(await verify("token", "contact"), false);
  const failing = createRecaptchaVerifier({
    projectId: "test",
    siteKey: "site",
    client: {
      ...client,
      createAssessment: async () => {
        throw new Error("offline");
      },
    },
  });
  assert.equal(await failing("token", "contact"), false);
  assert.throws(
    () =>
      createRecaptchaVerifier({
        projectId: "test",
        siteKey: "site",
        minimumScore: 2,
      }),
    /minimumScore/,
  );
});

test("Redis configuration is read on creation, with clear errors", () => {
  assert.throws(() => createRedis({ url: "", token: "" }), /requires/);
});
