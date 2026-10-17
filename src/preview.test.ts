import { expect, it } from "vitest";
import {
  authStorageKey,
  callbackUrl,
  PREVIEW_BASE,
  PRODUCTION_BASE,
} from "./preview";
it("uses exact preview and production email callback roots", () => {
  const origin = "https://lmeng0716-droid.github.io";
  expect(callbackUrl(origin, PREVIEW_BASE)).toBe(
    `${origin}/habit-tracker-preview/`,
  );
  expect(callbackUrl(origin, PRODUCTION_BASE)).toBe(`${origin}/habit-tracker/`);
  expect(() => callbackUrl(origin, "https://other.invalid/")).toThrow();
});
it("isolates preview auth by application and project, preserving production defaults", () => {
  expect(
    authStorageKey("https://project.supabase.co", PRODUCTION_BASE),
  ).toBeUndefined();
  expect(authStorageKey("https://project.supabase.co", PREVIEW_BASE)).toBe(
    "habit-tracker-preview:project.supabase.co:auth",
  );
  expect(authStorageKey("https://other.supabase.co", PREVIEW_BASE)).not.toBe(
    authStorageKey("https://project.supabase.co", PREVIEW_BASE),
  );
});
