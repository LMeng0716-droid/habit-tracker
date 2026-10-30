import { describe, expect, it } from "vitest";
import { splitDurationSession } from "./numeric";

describe("splitDurationSession", () => {
  it("splits elapsed minutes at Beijing midnight without losing time", () => {
    const start = Date.parse("2026-10-29T15:59:00.000Z");
    const end = Date.parse("2026-10-29T16:01:00.000Z");
    expect(splitDurationSession(start, end)).toEqual([
      {
        date: "2026-10-29",
        minutes: 1,
        occurredAt: "2026-10-29T15:59:59.999Z",
      },
      {
        date: "2026-10-30",
        minutes: 1,
        occurredAt: "2026-10-29T16:01:00.000Z",
      },
    ]);
  });

  it("assigns a minute completed after midnight to the new day", () => {
    const start = Date.parse("2026-10-29T15:59:30.000Z");
    const end = Date.parse("2026-10-29T16:01:30.000Z");
    expect(splitDurationSession(start, end)).toEqual([
      {
        date: "2026-10-30",
        minutes: 2,
        occurredAt: "2026-10-29T16:01:30.000Z",
      },
    ]);
  });

  it("supports sessions spanning multiple Beijing days", () => {
    const start = Date.parse("2026-10-28T16:00:00.000Z");
    const end = Date.parse("2026-10-30T16:00:00.000Z");
    expect(
      splitDurationSession(start, end).map((x) => [x.date, x.minutes]),
    ).toEqual([
      ["2026-10-29", 1440],
      ["2026-10-30", 1440],
    ]);
  });

  it("does not create a record for less than one elapsed minute", () => {
    const start = Date.parse("2026-10-29T15:59:30.000Z");
    expect(splitDurationSession(start, start + 59_999)).toEqual([]);
  });

  it("rejects invalid or reversed timestamps", () => {
    expect(splitDurationSession(Number.NaN, 10)).toEqual([]);
    expect(splitDurationSession(10, 10)).toEqual([]);
    expect(splitDurationSession(20, 10)).toEqual([]);
  });
});
