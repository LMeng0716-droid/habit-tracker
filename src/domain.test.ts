import { describe, expect, it } from "vitest";
import {
  businessDate,
  completedDates,
  eligible,
  monthDates,
  parseSnapshot,
  shiftDate,
  statistics,
  streaks,
  validDate,
  type Habit,
} from "./domain";
const habit: Habit = {
  id: "reading",
  name: "阅读",
  color: 0,
  created_date: "2026-12-29",
  archived_on: null,
};
describe("cloud daily habit domain", () => {
  it("uses Shanghai's midnight regardless of device timezone", () => {
    expect(businessDate(new Date("2026-12-31T15:59:59Z"))).toBe("2026-12-31");
    expect(businessDate(new Date("2026-12-31T16:00:00Z"))).toBe("2027-01-01");
  });
  it("validates leap days and month length", () => {
    expect(validDate("2024-02-29")).toBe(true);
    expect(validDate("2026-02-29")).toBe(false);
    expect(monthDates("2024-02")).toHaveLength(29);
    expect(monthDates("bad")).toEqual([]);
    expect(shiftDate("2026-12-31", 1)).toBe("2027-01-01");
  });
  it("rejects future and creation-before days", () => {
    expect(eligible(habit, "2026-12-28", "2027-01-02")).toBe(false);
    expect(eligible(habit, "2027-01-03", "2027-01-02")).toBe(false);
    expect(eligible(habit, "2026-12-29", "2027-01-02")).toBe(true);
  });
  it("keeps archive day eligible in historical statistics", () => {
    const archived = { ...habit, archived_on: "2026-12-31" };
    expect(eligible(archived, "2026-12-31", "2027-01-02")).toBe(true);
    expect(eligible(archived, "2027-01-01", "2027-01-02")).toBe(false);
    expect(
      statistics(archived, new Set(["2026-12-29", "2026-12-31"]), "2027-01-02"),
    ).toEqual({ completed: 2, total: 3, rate: 67 });
  });
  it("calculates cross-year streaks including yesterday", () => {
    const dates = new Set(["2026-12-29", "2026-12-30", "2026-12-31"]);
    expect(streaks(dates, "2027-01-01")).toEqual({ current: 3, longest: 3 });
    expect(streaks(dates, "2027-01-02").current).toBe(0);
  });
  it("excludes future days and caps monthly denominator", () => {
    expect(
      statistics(habit, new Set(["2026-12-29"]), "2026-12-30", "2026-12"),
    ).toEqual({ completed: 1, total: 2, rate: 50 });
    expect(statistics(habit, new Set(), "2027-01-02", "2027-01").total).toBe(2);
    expect(
      statistics(habit, new Set(), "2027-01-02", "2026-11").rate,
    ).toBeNull();
  });
  it("parses cloud responses without local data or extra identity fields", () => {
    const snapshot = parseSnapshot({
      today: "2026-12-31",
      habits: [{ ...habit, user_id: "private" }],
      checkins: [{ habit_id: habit.id, date: "2026-12-31" }],
    });
    expect(completedDates(snapshot, habit.id).has("2026-12-31")).toBe(true);
    expect(snapshot.habits[0]).not.toHaveProperty("user_id");
    expect(() =>
      parseSnapshot({ today: "invalid", habits: [], checkins: [] }),
    ).toThrow();
    expect(() =>
      parseSnapshot({
        today: "2026-12-31",
        habits: [{ ...habit, color: 6 }],
        checkins: [],
      }),
    ).toThrow();
  });
});
