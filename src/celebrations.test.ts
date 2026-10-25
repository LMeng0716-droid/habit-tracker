import { expect, it } from "vitest";
import { applyCheckin } from "./checkins";
import {
  ALL_CELEBRATION_MS,
  CARD_CELEBRATION_MS,
  celebrationFor,
} from "./celebrations";
import type { Snapshot } from "./domain";
const today = "2026-10-18";
const before: Snapshot = {
  today,
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
it("celebrates each new completion, with extra feedback only for the confirmed last habit", () => {
  const first = applyCheckin(before, "A", today, true);
  expect(celebrationFor(before, first, "A", today, true, today)).toEqual({
    ordinary: true,
    all: false,
  });
  const last = applyCheckin(first, "B", today, true);
  expect(celebrationFor(first, last, "B", today, true, today)).toEqual({
    ordinary: true,
    all: true,
  });
  expect(celebrationFor(last, last, "B", today, true, today)).toEqual({
    ordinary: false,
    all: false,
  });
  const cancelled = applyCheckin(last, "B", today, false);
  expect(celebrationFor(last, cancelled, "B", today, false, today)).toEqual({
    ordinary: false,
    all: false,
  });
  expect(celebrationFor(cancelled, last, "B", today, true, today)).toEqual({
    ordinary: true,
    all: true,
  });
});
it("does not celebrate history, future, midnight rollover or pure snapshot recovery", () => {
  for (const date of ["2026-10-17", "2026-10-19"])
    expect(
      celebrationFor(
        before,
        applyCheckin(before, "A", date, true),
        "A",
        date,
        true,
        today,
      ).ordinary,
    ).toBe(false);
  expect(
    celebrationFor(
      before,
      applyCheckin(before, "A", today, true),
      "A",
      today,
      true,
      "2026-10-19",
    ).ordinary,
  ).toBe(false);
  expect(celebrationFor(before, before, "A", today, false, today).all).toBe(
    false,
  );
});
it("keeps card feedback around one second and all-complete feedback around two seconds", () => {
  expect(CARD_CELEBRATION_MS).toBeGreaterThanOrEqual(800);
  expect(CARD_CELEBRATION_MS).toBeLessThanOrEqual(1200);
  expect(ALL_CELEBRATION_MS).toBe(2100);
});
