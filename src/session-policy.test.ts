import { expect, it } from "vitest";
import { DAY, policyKey, sessionExpired } from "./session-policy";
const start = 1800000000000;
it("expires exactly at seven idle days and thirty interactive-login days", () => {
  const value = { loginAt: start, lastActiveAt: start, seenAt: start };
  expect(sessionExpired(value, start + 7 * DAY - 1)).toBe(false);
  expect(sessionExpired(value, start + 7 * DAY)).toBe(true);
  const active = {
    ...value,
    lastActiveAt: start + 29 * DAY,
    seenAt: start + 29 * DAY,
  };
  expect(sessionExpired(active, start + 30 * DAY - 1)).toBe(false);
  expect(sessionExpired(active, start + 30 * DAY)).toBe(true);
});
it("fails closed for missing, invalid and backwards clocks", () => {
  expect(sessionExpired(null, start)).toBe(true);
  expect(
    sessionExpired({ loginAt: NaN, lastActiveAt: start, seenAt: start }, start),
  ).toBe(true);
  expect(
    sessionExpired(
      { loginAt: start, lastActiveAt: start, seenAt: start },
      start - 60001,
    ),
  ).toBe(true);
});
it("isolates metadata by application, project and account", () => {
  const key = policyKey("/habit-tracker/", "https://one.supabase.co", "A");
  expect(
    policyKey("/habit-tracker-preview/", "https://one.supabase.co", "A"),
  ).not.toBe(key);
  expect(policyKey("/habit-tracker/", "https://one.supabase.co", "B")).not.toBe(
    key,
  );
});
