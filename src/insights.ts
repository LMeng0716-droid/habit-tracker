import { eligible, shiftDate, type Habit } from "./domain";

export type PeriodProgress = {
  completed: number;
  eligible: number;
  rate: number | null;
};

export function periodProgress(
  habit: Habit,
  dates: Set<string>,
  from: string,
  to: string,
  today: string,
): PeriodProgress {
  let completed = 0,
    eligibleDays = 0;
  for (let d = from; d <= to; d = shiftDate(d, 1)) {
    if (!eligible(habit, d, today)) continue;
    eligibleDays++;
    if (dates.has(d)) completed++;
  }
  return {
    completed,
    eligible: eligibleDays,
    rate: eligibleDays ? Math.round((completed / eligibleDays) * 100) : null,
  };
}
export function weekStart(date: string): string {
  const mondayOffset = (new Date(date + "T00:00:00Z").getUTCDay() + 6) % 7;
  return shiftDate(date, -mondayOffset);
}
export function earnedStreakBadges(longest: number): number[] {
  return [7, 21, 30].filter((days) => longest >= days);
}
export function heatmapDays(habit: Habit, dates: Set<string>, today: string) {
  const end =
    habit.archived_on && habit.archived_on < today ? habit.archived_on : today;
  return Array.from({ length: 365 }, (_, i) => {
    const date = shiftDate(end, i - 364);
    return {
      date,
      eligible: eligible(habit, date, today),
      checked: dates.has(date),
    };
  });
}

export type NumericProgressDay = {
  habit_id: string;
  date: string;
  actual_value: number;
  event_count: number;
};

type NumericHabitInsight = {
  id: string;
  created_date: string;
  archived_on: string | null;
  target: number | null;
  goal_direction: string;
};

export function numericProgressDates(
  habit: NumericHabitInsight,
  progress: NumericProgressDay[],
): Set<string> {
  return new Set(
    progress
      .filter((day) => {
        if (day.habit_id !== habit.id || day.event_count < 1) return false;
        if (habit.goal_direction === "at_least")
          return habit.target !== null && day.actual_value >= habit.target;
        if (habit.goal_direction === "at_most")
          return habit.target !== null && day.actual_value <= habit.target;
        return day.actual_value > 0;
      })
      .map((day) => day.date),
  );
}

export function numericPeriodProgress(
  habit: Pick<NumericHabitInsight, "created_date" | "archived_on">,
  dates: Set<string>,
  from: string,
  to: string,
  today: string,
): PeriodProgress {
  let completed = 0;
  let eligibleDays = 0;
  const end =
    habit.archived_on && habit.archived_on < today ? habit.archived_on : today;
  for (let date = from; date <= to; date = shiftDate(date, 1)) {
    if (date < habit.created_date || date > end) continue;
    eligibleDays++;
    if (dates.has(date)) completed++;
  }
  return {
    completed,
    eligible: eligibleDays,
    rate: eligibleDays ? Math.round((completed / eligibleDays) * 100) : null,
  };
}

export function numericHeatmapDays(
  habit: Pick<NumericHabitInsight, "created_date" | "archived_on">,
  dates: Set<string>,
  today: string,
) {
  const end =
    habit.archived_on && habit.archived_on < today ? habit.archived_on : today;
  return Array.from({ length: 365 }, (_, index) => {
    const date = shiftDate(end, index - 364);
    const eligible = date >= habit.created_date && date <= end;
    return { date, eligible, checked: eligible && dates.has(date) };
  });
}
