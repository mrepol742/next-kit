#!/usr/bin/env node
import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Initializes the Next.js project with the Next Kit setup.
 *
 * @param string projectDirectory The directory of the project to initialize.
 * @return { created: string[], skipped: string[], app: string } The files created and skipped, and the app directory.
 */
export async function init(projectDirectory = process.cwd()) {
  const root = await realpath(projectDirectory);
  const pkg = JSON.parse(
    await readFile(path.join(root, "package.json"), "utf8"),
  );
  if (!pkg.dependencies?.next && !pkg.devDependencies?.next)
    throw new Error("Run init inside a Next.js project.");
  // Prefer the existing App Router directory, and never guess a Pages Router migration.
  let app;
  for (const candidate of ["src/app", "app"]) {
    try {
      const full = path.join(root, candidate);
      const resolved = await realpath(full);
      if (resolved !== root && !resolved.startsWith(root + path.sep))
        throw new Error("App directory must be inside the project.");
      if ((await lstat(resolved)).isDirectory()) {
        app = full;
        break;
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  if (!app)
    throw new Error(
      "No app or src/app directory found. This setup command supports the App Router.",
    );
  const files = new Map([
    [
      path.join(app, "up/page.tsx"),
      'export { UpPage as default } from "@mrepol742/next-kit/next/up";\n',
    ],
    [
      path.join(app, "next-kit-provider.tsx"),
      '"use client";\n\nimport type { ReactNode } from "react";\nimport { ConsentProvider, PrivacyPolicyPrompt } from "@mrepol742/next-kit/consent";\n\nexport function NextKitProvider({ children }: { children: ReactNode }) {\n  return <ConsentProvider>\n    {children}\n    <PrivacyPolicyPrompt policyUrl="/legal/privacy-policy" />\n  </ConsentProvider>;\n}\n',
    ],
    [
      path.join(root, "next-kit.env.example"),
      "# Copy the required values into your application environment.\nUPSTASH_REDIS_REST_URL=\nUPSTASH_REDIS_REST_TOKEN=\nGOOGLE_CLOUD_PROJECT=\nNEXT_PUBLIC_RECAPTCHA_SITE_KEY=\n# Optional: base64-encoded service account JSON, explicitly decoded by your app.\nGOOGLE_APPLICATION_CREDENTIALS_BASE64=\n",
    ],
  ]);
  const created = [];
  const skipped = [];
  for (const [target, content] of files) {
    await mkdir(path.dirname(target), { recursive: true });
    const parent = await realpath(path.dirname(target));
    if (!parent.startsWith(root + path.sep) && parent !== root)
      throw new Error("Generated files must remain inside the project.");
    try {
      await writeFile(target, content, { flag: "wx" });
      created.push(path.relative(root, target));
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      skipped.push(path.relative(root, target));
    }
  }
  return { created, skipped, app: path.relative(root, app) };
}

// npm launches bin entries through node_modules/.bin symlinks.
const entryPath = process.argv[1]
  ? await realpath(process.argv[1]).catch(() => null)
  : null;
if (entryPath === fileURLToPath(import.meta.url)) {
  if (process.argv[2] !== "init" || process.argv.length > 3) {
    console.error("Usage: next-kit init");
    process.exitCode = 1;
  } else {
    try {
      const result = await init();
      for (const file of result.created) console.log(`Created ${file}`);
      for (const file of result.skipped) console.log(`Kept existing ${file}`);
      console.log(
        `\nIn ${result.app}/layout.tsx, import "@mrepol742/next-kit/styles.css", import NextKitProvider from "./next-kit-provider", and wrap children with it.`,
      );
      console.log(
        "Configure server features explicitly; compose request checks with your existing proxy.ts.",
      );
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}
