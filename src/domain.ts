export const COLORS = ["青松", "海蓝", "暖橙", "紫藤", "玫瑰"] as const;
export interface Habit {
  id: string;
  name: string;
  color: number;
  created_date: string;
  archived_on: string | null;
  emoji: string;
  sort_order: number;
}
export interface Checkin {
  habit_id: string;
  date: string;
}
export interface Snapshot {
  today: string;
  habits: Habit[];
  checkins: Checkin[];
}
export function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const date = new Date(`${value}T00:00:00Z`);
  return (
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}
export function businessDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
export function shiftDate(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
export function monthDates(month: string): string[] {
  const first = `${month}-01`;
  if (!validDate(first)) return [];
  const dates: string[] = [];
  for (let date = first; date.startsWith(month); date = shiftDate(date, 1))
    dates.push(date);
  return dates;
}
export function eligible(habit: Habit, date: string, today: string): boolean {
  return (
    validDate(date) &&
    date >= habit.created_date &&
    date <= today &&
    (!habit.archived_on || date <= habit.archived_on)
  );
}
export function completedDates(snapshot: Snapshot, id: string): Set<string> {
  return new Set(
    snapshot.checkins.filter((c) => c.habit_id === id).map((c) => c.date),
  );
}
export function streaks(dates: Set<string>, today: string) {
  let current = 0;
  for (
    let day = dates.has(today) ? today : shiftDate(today, -1);
    dates.has(day);
    day = shiftDate(day, -1)
  )
    current++;
  let longest = 0,
    length = 0,
    previous = "";
  for (const date of [...dates].sort()) {
    length = previous && shiftDate(previous, 1) === date ? length + 1 : 1;
    longest = Math.max(longest, length);
    previous = date;
  }
  return { current, longest };
}
export function statistics(
  habit: Habit,
  dates: Set<string>,
  today: string,
  month?: string,
) {
  const end =
    habit.archived_on && habit.archived_on < today ? habit.archived_on : today;
  const first = month ? `${month}-01` : habit.created_date;
  const start = first > habit.created_date ? first : habit.created_date;
  const last = month ? monthDates(month).at(-1) : end;
  const limit = last && last < end ? last : end;
  const total =
    start <= limit
      ? Math.round(
          (Date.parse(`${limit}T00:00:00Z`) -
            Date.parse(`${start}T00:00:00Z`)) /
            86400000,
        ) + 1
      : 0;
  const completed = [...dates].filter((d) => d >= start && d <= limit).length;
  return {
    completed,
    total,
    rate: total ? Math.round((completed / total) * 100) : null,
  };
}
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;
export function parseSnapshot(value: unknown): Snapshot {
  if (
    !record(value) ||
    !validDate(value.today) ||
    !Array.isArray(value.habits) ||
    !Array.isArray(value.checkins)
  )
    throw new Error("云端数据格式不正确，请重试或联系管理员。");
  const habits = value.habits.map((h: unknown, index: number): Habit => {
    if (
      !record(h) ||
      typeof h.id !== "string" ||
      typeof h.name !== "string" ||
      typeof h.color !== "number" ||
      !Number.isInteger(h.color) ||
      h.color < 0 ||
      h.color > 4 ||
      !validDate(h.created_date) ||
      !(h.archived_on === null || validDate(h.archived_on)) ||
      (h.emoji !== undefined && typeof h.emoji !== "string") ||
      (h.sort_order !== undefined && (!Number.isInteger(h.sort_order) || (h.sort_order as number) < 0))
    )
      throw new Error("云端习惯格式不正确。");
    return {
      id: h.id,
      name: h.name,
      color: h.color,
      created_date: h.created_date,
      archived_on: h.archived_on,
      emoji: typeof h.emoji === "string" ? h.emoji : "🌱",
      sort_order: typeof h.sort_order === "number" ? h.sort_order : (index + 1) * 1024,
    };
  });
  const checkins = value.checkins.map((c: unknown): Checkin => {
    if (!record(c) || typeof c.habit_id !== "string" || !validDate(c.date))
      throw new Error("云端打卡格式不正确。");
    return { habit_id: c.habit_id, date: c.date };
  });
  return { today: value.today, habits, checkins };
}
