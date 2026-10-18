import type { Snapshot } from "./domain";

export type CheckinOperation = {
  sequence: number;
  habitId: string;
  date: string;
  completed: boolean;
  status: "saving" | "uncertain";
};
export type CheckinOperations = Record<string, CheckinOperation>;

// The server-confirmed snapshot stays separate from provisional UI state.
export function applyCheckin(
  snapshot: Snapshot,
  habitId: string,
  date: string,
  completed: boolean,
): Snapshot {
  const checkins = snapshot.checkins.filter(
    (c) => c.habit_id !== habitId || c.date !== date,
  );
  if (completed) checkins.push({ habit_id: habitId, date });
  return { ...snapshot, checkins };
}
export function optimisticSnapshot(
  snapshot: Snapshot | null,
  operations: CheckinOperations,
): Snapshot | null {
  return (
    snapshot &&
    Object.values(operations).reduce(
      (value, operation) =>
        operation.status === "saving"
          ? applyCheckin(
              value,
              operation.habitId,
              operation.date,
              operation.completed,
            )
          : value,
      snapshot,
    )
  );
}
export function allCompleted(snapshot: Snapshot): boolean {
  const active = snapshot.habits.filter(
    (h) => !h.archived_on && h.created_date <= snapshot.today,
  );
  return (
    active.length > 0 &&
    active.every((h) =>
      snapshot.checkins.some(
        (c) => c.habit_id === h.id && c.date === snapshot.today,
      ),
    )
  );
}
