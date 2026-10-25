import { describe, expect, it } from "vitest";
import {
  EMOJI_CHOICES,
  emptyHabitPrefs,
  moveHabit,
  parseHabitPrefs,
  prefsKey,
  sortedHabits,
} from "./habit-prefs";

describe("device-only habit customization", () => {
  it("keeps default state when browser storage has no preferences or bad JSON", () => {
    expect(parseHabitPrefs(null)).toEqual(emptyHabitPrefs());
    expect(parseHabitPrefs("{broken")).toEqual(emptyHabitPrefs());
  });
  it("accepts known icons but rejects arbitrary stored properties", () => {
    expect(
      parseHabitPrefs(
        JSON.stringify({
          icons: { a: EMOJI_CHOICES[1], b: "<script>" },
          order: ["b", "a", "b", 6],
        }),
      ),
    ).toEqual({ icons: { a: EMOJI_CHOICES[1] }, order: ["b", "a"] });
  });
  it("sorts without altering the server response and preserves unspecified habits", () => {
    const server = [{ id: "a" }, { id: "b" }, { id: "c" }];
    expect(sortedHabits(server, ["c", "a"]).map((h) => h.id)).toEqual([
      "c",
      "a",
      "b",
    ]);
    expect(server.map((h) => h.id)).toEqual(["a", "b", "c"]);
  });
  it("moves one habit and keeps all IDs", () => {
    expect(moveHabit([], ["a", "b", "c"], "a", "c")).toEqual(["b", "c", "a"]);
    expect(moveHabit(["c", "a", "b"], ["c", "a", "b"], "c", "b")).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(moveHabit(["a", "b"], ["a", "b"], "z", "b")).toEqual(["a", "b"]);
  });
  it("separates preferences by account and preview base", () => {
    expect(prefsKey("project", "/preview/", "user-a")).not.toBe(
      prefsKey("project", "/preview/", "user-b"),
    );
    expect(prefsKey("project", "/preview/", "user-a")).not.toBe(
      prefsKey("project", "/mobile/", "user-a"),
    );
  });
});
