import { PREVIEW_BASE, PRODUCTION_BASE } from "./preview.ts";
export function pwaManifest(base: string) {
  if (base !== PREVIEW_BASE && base !== PRODUCTION_BASE)
    throw new Error("不支持的 PWA 路径。");
  return {
    id: base,
    name: "每日进步",
    short_name: "每日进步",
    lang: "zh-CN",
    description: "登录后云端保存的每日习惯追踪器，需要联网使用。",
    start_url: base,
    scope: base,
    display: "standalone",
    background_color: "#f4f7f3",
    theme_color: "#23634e",
    icons: [
      {
        src: `${base}icons/icon-192.png?v=sprout-2`,
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: `${base}icons/icon-512.png?v=sprout-2`,
        sizes: "512x512",
        type: "image/png",
        purpose: "any maskable",
      },
    ],
  };
}
