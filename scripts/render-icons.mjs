// Re-render original vector artwork using the existing Playwright dependency.
import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";
const browser = await chromium.launch(
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
    ? {
        executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
        args: ["--no-sandbox"],
      }
    : {},
);
try {
  const source = readFileSync("public/icons/source.svg").toString("base64");
  for (const [size, name] of [
    [192, "icon-192"],
    [512, "icon-512"],
    [180, "apple-touch-icon"],
  ]) {
    const page = await browser.newPage({
      viewport: { width: size, height: size },
      deviceScaleFactor: 1,
    });
    await page.setContent(
      `<style>html,body{margin:0;background:#f4f7f3}img{display:block;width:100vw;height:100vh}</style><img src="data:image/svg+xml;base64,${source}">`,
    );
    await page.locator("img").evaluate((img) => img.decode());
    await page.screenshot({ path: `public/icons/${name}.png` });
    await page.close();
  }
} finally {
  await browser.close();
}
