import { defineConfig } from "vitest/config";
export default defineConfig({
  base: "/habit-tracker/",
  test: { include: ["src/**/*.test.ts"] },
});
