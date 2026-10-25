import { expect, it } from "vitest";
import {
  allCompleted,
  applyCheckin,
  optimisticSnapshot,
  type CheckinOperations,
} from "./checkins";
import type { Snapshot } from "./domain";
const snapshot: Snapshot = {
  today: "2026-10-18",
  habits: ["A", "B"].map((id) => ({
    id,
    name: id,
    color: 0,
    created_date: "2026-01-01",
    archived_on: null,
    emoji: "🌱",
    sort_order: 1024,
  })),
  checkins: [],
};
it("overlays independent habits without changing confirmed history and rolls back only uncertainty", () => {
  const operations: CheckinOperations = {
    A: {
      habitId: "A",
      date: snapshot.today,
      completed: true,
      sequence: 1,
      status: "saving",
    },
    B: {
      habitId: "B",
      date: snapshot.today,
      completed: true,
      sequence: 2,
      status: "saving",
    },
  };
  expect(optimisticSnapshot(snapshot, operations)?.checkins).toHaveLength(2);
  expect(snapshot.checkins).toEqual([]);
  operations.A.status = "uncertain";
  expect(optimisticSnapshot(snapshot, operations)?.checkins).toEqual([
    { habit_id: "B", date: snapshot.today },
  ]);
});
it("confirmation is an idempotent target, never a toggle, and cancellation keeps unrelated days", () => {
  const historical = applyCheckin(snapshot, "A", "2026-10-17", true);
  const first = applyCheckin(historical, "A", snapshot.today, true);
  expect(applyCheckin(first, "A", snapshot.today, true)).toEqual(first);
  expect(applyCheckin(first, "A", snapshot.today, false)).toEqual(historical);
});
it("all-completed excludes archived/future habits and empty accounts", () => {
  expect(allCompleted(snapshot)).toBe(false);
  const completed = applyCheckin(
    applyCheckin(snapshot, "A", snapshot.today, true),
    "B",
    snapshot.today,
    true,
  );
  expect(allCompleted(completed)).toBe(true);
  expect(allCompleted({ ...snapshot, habits: [] })).toBe(false);
  expect(
    allCompleted({
      ...completed,
      habits: [
        ...completed.habits,
        { ...snapshot.habits[0], id: "future", created_date: "2026-12-01" },
      ],
    }),
  ).toBe(true);
});
