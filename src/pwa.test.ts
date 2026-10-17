import { expect, it } from "vitest";
import { pwaManifest } from "./pwa";
import { PREVIEW_BASE, PRODUCTION_BASE } from "./preview";
it("isolates manifests by path and uses correct standalone icons", () => {
  for (const base of [PREVIEW_BASE, PRODUCTION_BASE]) {
    const manifest = pwaManifest(base);
    expect(manifest.name).toBe("每日进步");
    expect(manifest.id).toBe(base);
    expect(manifest.scope).toBe(base);
    expect(manifest.start_url).toBe(base);
    expect(manifest.display).toBe("standalone");
    expect(manifest.icons.map((icon) => icon.sizes)).toEqual([
      "192x192",
      "512x512",
    ]);
    expect(manifest.icons.every((icon) => icon.src.startsWith(base))).toBe(
      true,
    );
  }
  expect(pwaManifest(PREVIEW_BASE).id).not.toBe(
    pwaManifest(PRODUCTION_BASE).id,
  );
  expect(() => pwaManifest("/")).toThrow();
});
