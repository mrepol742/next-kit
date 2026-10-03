import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, readFile, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { init } from "../bin/next-kit.mjs";

test("init scaffolds both App Router layouts and preserves existing files", async () => {
  for (const app of ["src/app", "app"]) {
    const root = await mkdtemp(path.join(tmpdir(), "next-kit-init-"));
    await mkdir(path.join(root, app, "up"), { recursive: true });
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ dependencies: { next: "^16" } }),
    );
    await writeFile(path.join(root, app, "up/page.tsx"), "existing page");
    const result = await init(root);
    assert.equal(result.created.length, 2);
    assert.deepEqual(result.skipped, [path.join(app, "up/page.tsx")]);
    assert.equal(
      await readFile(path.join(root, app, "up/page.tsx"), "utf8"),
      "existing page",
    );
    assert.match(
      await readFile(path.join(root, app, "next-kit-provider.tsx"), "utf8"),
      /"use client"/,
    );
    assert.equal((await init(root)).created.length, 0);
  }
});

test("init refuses non-Next projects", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "next-kit-init-"));
  await writeFile(path.join(root, "package.json"), "{}");
  await assert.rejects(init(root), /Next.js project/);
});

test("init runs through an npm-style bin symlink", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "next-kit-cli-"));
  await mkdir(path.join(root, "app"));
  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ dependencies: { next: "^16" } }),
  );
  const bin = path.join(root, "next-kit");
  await symlink(
    fileURLToPath(new URL("../bin/next-kit.mjs", import.meta.url)),
    bin,
  );
  const output = execFileSync(process.execPath, [bin, "init"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.match(output, /Created app\/up\/page.tsx/);
  assert.match(
    await readFile(path.join(root, "app/up/page.tsx"), "utf8"),
    /UpPage/,
  );
});

test("compiled package preserves client directive and CSS assets", async () => {
  assert.match(
    await readFile(
      new URL("../dist/consent/index.js", import.meta.url),
      "utf8",
    ),
    /^"use client";/,
  );
  const pkg = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  assert.match(
    await readFile(
      new URL(`../${pkg.exports["./styles.css"]}`, import.meta.url),
      "utf8",
    ),
    /next-kit-consent/,
  );
});

test("consent accepts only valid persisted categories and renders without SSR browser access", () => {
  // Use regular React in this subprocess; server-only feature tests use react-server conditions.
  const output = execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    import assert from 'node:assert/strict';
    import { createElement } from 'react';
    import { renderToString } from 'react-dom/server';
    import { ConsentProvider, PrivacyPolicyPrompt, isConsentPreferences } from './dist/consent/index.js';
    assert.equal(isConsentPreferences({ necessary: true, analytics: false, functional: true, advertising: false }), true);
    assert.equal(isConsentPreferences({ necessary: false, analytics: true, functional: true, advertising: true }), false);
    assert.equal(isConsentPreferences({ necessary: true, analytics: 'yes' }), false);
    assert.equal(isConsentPreferences(null), false);
    const html = renderToString(createElement(ConsentProvider, null, createElement('p', null, 'Application'), createElement(PrivacyPolicyPrompt)));
    assert.ok(html.includes('Application'));
    assert.ok(!html.includes('Cookie Preferences'));
    console.log('ok');
  `,
    ],
    { cwd: new URL("..", import.meta.url), encoding: "utf8" },
  );
  assert.equal(output.trim(), "ok");
});
