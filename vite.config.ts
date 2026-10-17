import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
import { validatePublicConfig } from "./src/public-config.ts";
export default defineConfig(({ command, mode }) => {
  const config = validatePublicConfig(loadEnv(mode, process.cwd(), "VITE_"));
  // Tests need no real configuration. Serving an unconfigured setup screen is
  // safe; invalid/privileged values must never reach any browser transformation.
  if (mode !== "test" && !config.ok && (command === "build" || config.unsafe)) {
    throw new Error("Supabase 配置校验失败：\n" + config.issues.join("\n"));
  }
  return { base: "/habit-tracker/", test: { include: ["src/**/*.test.ts"] } };
});
