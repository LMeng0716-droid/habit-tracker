import type { Snapshot } from "./domain";
import { allCompleted } from "./checkins";
export const CARD_CELEBRATION_MS = 1100;
export const ALL_CELEBRATION_MS = 2100;
// Call only after a successful current-account RPC. Pure snapshot reads do not
// enter this path. Re-completing after a confirmed cancellation is a new event.
export function celebrationFor(
  before: Snapshot,
  after: Snapshot,
  habitId: string,
  date: string,
  completed: boolean,
  today: string,
) {
  const wasComplete = before.checkins.some(
    (c) => c.habit_id === habitId && c.date === date,
  );
  const ordinary =
    completed && !wasComplete && date === after.today && date === today;
  return {
    ordinary,
    all: ordinary && !allCompleted(before) && allCompleted(after),
  };
}
