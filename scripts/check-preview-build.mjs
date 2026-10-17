import { readFileSync, existsSync } from "node:fs";
import { resolve, sep } from "node:path";
import { PREVIEW_BASE } from "../src/preview.ts";
import { pwaManifest } from "../src/pwa.ts";
const directory = resolve("dist-preview");
const html = readFileSync(resolve(directory, "index.html"), "utf8");
const urls = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(
  (match) => match[1],
);
if (
  !urls.length ||
  urls.some((url) => {
    const path = new URL(url, "https://build.invalid").pathname;
    const file = resolve(directory, path.slice(PREVIEW_BASE.length));
    return (
      !path.startsWith(PREVIEW_BASE) ||
      !file.startsWith(directory + sep) ||
      !existsSync(file)
    );
  })
)
  throw new Error("预览产物资源缺失或base不正确。");
const manifest = JSON.parse(
  readFileSync(resolve(directory, "manifest.webmanifest"), "utf8"),
);
if (JSON.stringify(manifest) !== JSON.stringify(pwaManifest(PREVIEW_BASE)))
  throw new Error("预览manifest路径不正确。");
for (const [name, size] of [
  ["icon-192.png", 192],
  ["icon-512.png", 512],
  ["apple-touch-icon.png", 180],
]) {
  const png = readFileSync(resolve(directory, "icons", name));
  if (png.readUInt32BE(16) !== size || png.readUInt32BE(20) !== size)
    throw new Error("PWA图标尺寸不正确。");
}
console.log("预览资源、manifest和图标检查通过；未发布网站。");
