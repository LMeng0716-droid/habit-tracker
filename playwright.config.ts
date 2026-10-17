import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  use: {
    timezoneId: "Asia/Shanghai",
    browserName: "chromium",
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? {
          executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
          args: ["--no-sandbox"],
        }
      : {},
  },
  projects: [
    {
      name: "production",
      use: { baseURL: "http://127.0.0.1:5173/habit-tracker/" },
    },
    {
      name: "preview",
      use: { baseURL: "http://127.0.0.1:5174/habit-tracker-preview/" },
    },
  ],
  webServer: [5173, 5174].map((port) => {
    const base = port === 5174 ? "/habit-tracker-preview/" : "/habit-tracker/";
    return {
      command: `npm run dev -- --host 127.0.0.1 --port ${port} --strictPort --base=${base}`,
      url: `http://127.0.0.1:${port}${base}`,
      reuseExistingServer: false,
      env: {
        VITE_SUPABASE_URL: "https://browser-check.supabase.co",
        VITE_SUPABASE_PUBLISHABLE_KEY:
          "sb_publishable_0123456789abcdefghijklmnopqrstuvwxyzABCDEF",
      },
    };
  }),
});
