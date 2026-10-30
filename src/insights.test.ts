import { describe, it, expect } from "vitest";
import {
  earnedStreakBadges,
  heatmapDays,
  periodProgress,
  weekStart,
} from "./insights";
import type { Habit } from "./domain";
const habit: Habit = {
  id: "a",
  name: "读书",
  color: 0,
  created_date: "2026-10-01",
  archived_on: null,
  emoji: "📚",
  sort_order: 1024,
};
describe("insights", () => {
  it("computes the Monday-based week across month boundaries", () =>
    expect(weekStart("2026-10-29")).toBe("2026-10-26"));
  it("counts eligible dates, not dates before creation", () =>
    expect(
      periodProgress(
        habit,
        new Set(["2026-10-01", "2026-10-03"]),
        "2026-09-29",
        "2026-10-03",
        "2026-10-03",
      ),
    ).toEqual({ completed: 2, eligible: 3, rate: 67 }));
  it("awards only achieved streak milestones", () => {
    expect(earnedStreakBadges(6)).toEqual([]);
    expect(earnedStreakBadges(21)).toEqual([7, 21]);
  });
  it("renders exactly 365 days and marks pre-creation days unavailable", () => {
    const days = heatmapDays(habit, new Set(["2026-10-29"]), "2026-10-29");
    expect(days).toHaveLength(365);
    expect(days.at(-1)).toMatchObject({
      date: "2026-10-29",
      eligible: true,
      checked: true,
    });
    expect(days[0].eligible).toBe(false);
  });
});
