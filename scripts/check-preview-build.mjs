import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { PREVIEW_BASE } from "../src/preview.ts";
const directory = resolve("dist-preview");
const html = readFileSync(resolve(directory, "index.html"), "utf8");
const urls = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(
  (match) => match[1],
);
if (
  !urls.length ||
  urls.some(
    (url) =>
      !url.startsWith(`${PREVIEW_BASE}assets/`) ||
      !existsSync(resolve(directory, url.slice(PREVIEW_BASE.length))),
  )
) {
  throw new Error("预览产物路径检查失败：资源必须存在且使用独立预览base。");
}
console.log("预览产物路径检查通过；仅生成本地文件，未发布网站。");
