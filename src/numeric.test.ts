import { describe, expect, test } from "vitest";
import { EMOJI, eventTime, normalValue, numericMessage } from "./numeric";
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
});
