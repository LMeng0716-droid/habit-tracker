import { defineConfig } from "vitest/config";
import { pwaManifest } from "./src/pwa.ts";
import { loadEnv } from "vite";
import { validatePublicConfig } from "./src/public-config.ts";
export default defineConfig(({ command, mode }) => {
  let base = "/habit-tracker/";
  const config = validatePublicConfig(loadEnv(mode, process.cwd(), "VITE_"));
  // Tests need no real configuration. Serving an unconfigured setup screen is
  // safe; invalid/privileged values must never reach any browser transformation.
  if (mode !== "test" && !config.ok && (command === "build" || config.unsafe)) {
    throw new Error("Supabase 配置校验失败：\n" + config.issues.join("\n"));
  }
  return {
    base: "/habit-tracker/",
    test: { include: ["src/**/*.test.ts"] },
    plugins: [
      {
        name: "online-pwa-manifest",
        configResolved(resolved) {
          base = resolved.base;
        },
        transformIndexHtml: {
          order: "post",
          handler() {
            return [
              {
                tag: "link",
                attrs: { rel: "manifest", href: `${base}manifest.webmanifest` },
                injectTo: "head" as const,
              },
              {
                tag: "link",
                attrs: {
                  rel: "apple-touch-icon",
                  sizes: "180x180",
                  href: `${base}icons/apple-touch-icon.png`,
                },
                injectTo: "head" as const,
              },
              {
                tag: "link",
                attrs: {
                  rel: "icon",
                  type: "image/png",
                  sizes: "192x192",
                  href: `${base}icons/icon-192.png`,
                },
                injectTo: "head" as const,
              },
            ];
          },
        },
        configureServer(server) {
          server.middlewares.use((req, res, next) => {
            const path = req.url?.split("?")[0];
            if (
              path !== `${base}manifest.webmanifest` &&
              path !== "/manifest.webmanifest"
            )
              return next();
            res.setHeader("Content-Type", "application/manifest+json");
            res.setHeader("Cache-Control", "no-store");
            res.end(JSON.stringify(pwaManifest(base)));
          });
        },
        generateBundle() {
          this.emitFile({
            type: "asset",
            fileName: "manifest.webmanifest",
            source: JSON.stringify(pwaManifest(base)),
          });
        },
      },
    ],
  };
});
