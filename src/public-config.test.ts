/// <reference types="node" />
import { afterAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { validatePublicConfig } from "./public-config";
const valid = {
  VITE_SUPABASE_URL: "https://configuration-check.supabase.co",
  VITE_SUPABASE_PUBLISHABLE_KEY:
    "sb_publishable_0123456789abcdefghijklmnopqrstuvwxyzABCDEF",
};
const secret = "sb_secret_DO_NOT_EXPOSE_0123456789abcdefghijklmnopqrstuvwxyz";
const jwt = `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role: "service_role", unique: "must_not_leak" })).toString("base64url")}.signature`;
const dirs: string[] = [];
const cwd = () => {
  const path = mkdtempSync(join(tmpdir(), "habit-config-"));
  dirs.push(path);
  return path;
};
function environment(extra: Record<string, string> = {}) {
  const result = { ...process.env };
  for (const name of Object.keys(result))
    if (name.startsWith("VITE_")) delete result[name];
  return { ...result, ...extra };
}
function check(env: Record<string, string>, directory = cwd()) {
  return spawnSync(
    process.execPath,
    [resolve("scripts/check-public-config.mjs")],
    { cwd: directory, env: environment(env), encoding: "utf8" },
  );
}
afterAll(() => {
  for (const path of dirs) rmSync(path, { recursive: true, force: true });
});
describe("public configuration validation", () => {
  it("accepts publishable keys and root HTTPS project/custom URLs", () => {
    expect(validatePublicConfig(valid).ok).toBe(true);
    expect(
      validatePublicConfig({
        ...valid,
        VITE_SUPABASE_URL: "https://cloud.my-habits.com/",
      }).ok,
    ).toBe(true);
  });
  it.each([
    {},
    { VITE_SUPABASE_URL: valid.VITE_SUPABASE_URL },
    { VITE_SUPABASE_PUBLISHABLE_KEY: valid.VITE_SUPABASE_PUBLISHABLE_KEY },
  ])("rejects missing variables", (env) => {
    expect(validatePublicConfig(env).ok).toBe(false);
  });
  it.each([
    "https://",
    "http://project.supabase.co",
    "https://example.com",
    "https://project.invalid",
    "https://YOUR_PROJECT.supabase.co",
    "https://user:private@real.supabase.co",
    "https://real.supabase.co/rest/v1",
    "https://real.supabase.co?key=private",
    "https://real.supabase.co/#token",
    " https://real.supabase.co",
    "https://127.0.0.1",
    "https://real.supabase.co:8443",
  ])("rejects malformed/placeholder URL %s", (url) => {
    expect(validatePublicConfig({ ...valid, VITE_SUPABASE_URL: url }).ok).toBe(
      false,
    );
  });
  it.each([
    secret,
    jwt,
    "eyJhbGciOiJIUzI1NiJ9.anon.signature",
    "sb_publishable_REPLACE_WITH_PUBLIC_KEY",
    "sb_publishable_browser_fixture",
    "sb_publishable_short",
    "sb_publishable_your_actual_public_key_goes_here",
    "sb_publishable_REPLACE_THIS_KEY_WITH_REAL_VALUE",
    "sb_publishable_YourPublishableKeyHere",
    valid.VITE_SUPABASE_PUBLISHABLE_KEY + "\n",
  ])("rejects unsafe or placeholder keys without echoing them", (key) => {
    const result = validatePublicConfig({
      ...valid,
      VITE_SUPABASE_PUBLISHABLE_KEY: key,
    });
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain(key);
  });
  it("rejects unintended VITE variables, including hidden secret and legacy service-role JWT", () => {
    for (const value of [secret, jwt, "unreviewed-public-value"]) {
      const result = validatePublicConfig({ ...valid, VITE_OTHER: value });
      expect(result.ok).toBe(false);
      expect(JSON.stringify(result)).not.toContain(value);
    }
  });
});
describe("build entry points", () => {
  it("CLI stops on missing/privileged values with sanitized output", () => {
    for (const env of [
      {},
      { ...valid, VITE_SUPABASE_PUBLISHABLE_KEY: secret },
      { ...valid, VITE_SUPABASE_PUBLISHABLE_KEY: jwt },
      { ...valid, VITE_FORGOTTEN: secret },
    ]) {
      const result = check(env);
      expect(result.status).toBe(1);
      expect(result.stdout + result.stderr).not.toContain(secret);
      expect(result.stdout + result.stderr).not.toContain(jwt);
    }
  });
  it("validates .env.production.local and rejects secrets before bundling", () => {
    const directory = cwd();
    writeFileSync(
      join(directory, ".env.production.local"),
      `VITE_SUPABASE_URL=${valid.VITE_SUPABASE_URL}\nVITE_SUPABASE_PUBLISHABLE_KEY=${secret}\n`,
    );
    const result = check({}, directory);
    expect(result.status).toBe(1);
    expect(result.stdout + result.stderr).not.toContain(secret);
    expect(existsSync(join(directory, "dist"))).toBe(false);
  });
  it("process variables override dotenv and accepted CLI configuration is not printed", () => {
    const directory = cwd();
    writeFileSync(
      join(directory, ".env.production.local"),
      "VITE_SUPABASE_URL=https://example.com\n",
    );
    const result = check(valid, directory);
    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain(valid.VITE_SUPABASE_PUBLISHABLE_KEY);
  });
  it("direct vite build cannot bypass validation or emit a secret", () => {
    const directory = cwd();
    const result = spawnSync(
      process.execPath,
      [
        resolve("node_modules/vite/bin/vite.js"),
        "build",
        "--config",
        resolve("vite.config.ts"),
      ],
      {
        cwd: directory,
        env: environment({ ...valid, VITE_SUPABASE_PUBLISHABLE_KEY: secret }),
        encoding: "utf8",
      },
    );
    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).not.toContain(secret);
    expect(existsSync(join(directory, "dist"))).toBe(false);
  });
  it("renders actionable missing-config errors without initializing Auth", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "");
    try {
      vi.resetModules();
      const { default: App } = await import("./App");
      const { createElement } = await import("react");
      const { renderToStaticMarkup } = await import("react-dom/server");
      const html = renderToStaticMarkup(createElement(App));
      expect(html).toContain("VITE_SUPABASE_URL");
      expect(html).toContain("VITE_SUPABASE_PUBLISHABLE_KEY");
      expect(html).toContain("配置未就绪");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
