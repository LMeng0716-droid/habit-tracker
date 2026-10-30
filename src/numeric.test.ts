import { describe, expect, test } from "vitest";
import {
  EMOJI,
  activeTimerStorageKey,
  eventTime,
  normalValue,
  numericMessage,
  parseActiveTimer,
  timerOwnerId,
} from "./numeric";
describe("numeric input and actionable errors", () => {
  test("integer units and exact bounds", () => {
    for (const input of [
      "",
      "0",
      "-1",
      "1.5",
      "1e3",
      "Infinity",
      "9007199254740993",
    ])
      expect(normalValue(input, "count")).toBeNull();
    expect(normalValue("1440", "duration")).toBe(1440);
    expect(normalValue("1441", "duration")).toBeNull();
    expect(normalValue("1000000", "count")).toBe(1000000);
    expect(normalValue("1000001", "count")).toBeNull();
  });
  test("conflicts, permissions and unknown install are distinct", () => {
    expect(numericMessage({ message: "event_revision_conflict" })).toContain(
      "重新核对",
    );
    expect(numericMessage({ message: "daily_value_out_of_range" })).toContain(
      "累计超过",
    );
    expect(numericMessage({ message: "permission denied" })).toContain("RLS");
    expect(numericMessage({ message: "PGRST202" })).toContain("尚未安装");
    expect(EMOJI).not.toContain("🎯");
  });
  test("historical time has explicit Beijing offset", () =>
    expect(eventTime("2026-01-01", "2026-10-30")).toBe(
      "2026-01-01T12:00:00+08:00",
    ));
  test("active timer persistence is validated and scoped to the authenticated account", () => {
    const payload = Buffer.from(JSON.stringify({ sub: "user-123" })).toString("base64url");
    const token = `header.${payload}.signature`;
    expect(timerOwnerId(token)).toBe("user-123");
    expect(timerOwnerId("invalid-token")).toBeNull();
    expect(activeTimerStorageKey("user-123")).not.toBe(
      activeTimerStorageKey("user-456"),
    );
    expect(parseActiveTimer(JSON.stringify({ id: "study", start: 1000 }))).toEqual({
      id: "study",
      start: 1000,
    });
    for (const invalid of [
      null,
      "not-json",
      JSON.stringify({ id: "", start: 1000 }),
      JSON.stringify({ id: "study", start: "1000" }),
      JSON.stringify({ id: "study", start: 0 }),
    ]) {
      expect(parseActiveTimer(invalid)).toBeNull();
    }
  });
});
