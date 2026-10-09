export const COLORS = ["青松", "海蓝", "暖橙", "紫藤", "玫瑰"] as const;
export interface Habit {
  id: string;
  name: string;
  color: number;
  createdDate: string;
  createdAt: number;
  archivedDate?: string;
}
export interface Completion {
  habitId: string;
  date: string;
}
export interface Snapshot {
  schemaVersion: 1;
  revision: string;
  habits: Habit[];
  completionRecords: Completion[];
}
// getRandomValues also works on a phone preview over a local HTTP network.
export function newId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
export const emptySnapshot = (): Snapshot => ({
  schemaVersion: 1,
  revision: newId(),
  habits: [],
  completionRecords: [],
});
export function localDate(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function validDate(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    value < "1900-01-01"
  )
    return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
  );
}
// UTC is used only for calendar arithmetic, never to determine the user's today.
export function shiftDate(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
export function monthDates(month: string): string[] {
  const result: string[] = [];
  for (
    let date = `${month}-01`;
    date.startsWith(`${month}-`);
    date = shiftDate(date, 1)
  )
    result.push(date);
  return result;
}
export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 7);
}
export function eligible(habit: Habit, date: string, today: string): boolean {
  return (
    validDate(date) &&
    date >= habit.createdDate &&
    date <= today &&
    (!habit.archivedDate || date < habit.archivedDate)
  );
}
export function completedDates(data: Snapshot, id: string): Set<string> {
  return new Set(
    data.completionRecords.filter((r) => r.habitId === id).map((r) => r.date),
  );
}
export function streaks(
  dates: Set<string>,
  today: string,
): { current: number; longest: number } {
  let current = 0;
  let day = dates.has(today) ? today : shiftDate(today, -1);
  while (dates.has(day)) {
    current++;
    day = shiftDate(day, -1);
  }
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
export function monthlyStats(
  habit: Habit,
  dates: Set<string>,
  month: string,
  today: string,
) {
  const eligibleDays = monthDates(month).filter((date) =>
    eligible(habit, date, today),
  );
  const completed = eligibleDays.filter((date) => dates.has(date)).length;
  return {
    completed,
    total: eligibleDays.length,
    rate: eligibleDays.length
      ? Math.round((completed / eligibleDays.length) * 100)
      : null,
  };
}
export function toggleCompletion(
  data: Snapshot,
  habit: Habit,
  date: string,
  today: string,
): Snapshot {
  if (habit.archivedDate || !eligible(habit, date, today))
    throw new Error("该日期不能修改记录。");
  const exists = data.completionRecords.some(
    (r) => r.habitId === habit.id && r.date === date,
  );
  return {
    ...data,
    completionRecords: exists
      ? data.completionRecords.filter(
          (r) => !(r.habitId === habit.id && r.date === date),
        )
      : [...data.completionRecords, { habitId: habit.id, date }],
  };
}
export function archiveHabit(
  data: Snapshot,
  id: string,
  today: string,
): Snapshot {
  return {
    ...data,
    habits: data.habits.map((h) =>
      h.id === id ? { ...h, archivedDate: today } : h,
    ),
    completionRecords: data.completionRecords.filter(
      (r) => r.habitId !== id || r.date < today,
    ),
  };
}
export const MAX_BACKUP_SIZE = 5 * 1024 * 1024;
export function parseSnapshot(raw: string, today = localDate()): Snapshot {
  if (new Blob([raw]).size > MAX_BACKUP_SIZE)
    throw new Error("文件超过5 MiB，无法导入。");
  let data: Snapshot;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error("不是有效的JSON文件。");
  }
  if (
    !data ||
    data.schemaVersion !== 1 ||
    typeof data.revision !== "string" ||
    !data.revision ||
    !Array.isArray(data.habits) ||
    !Array.isArray(data.completionRecords)
  )
    throw new Error("备份格式或版本不受支持。");
  const habits = new Map<string, Habit>();
  for (const h of data.habits) {
    if (
      !h ||
      typeof h.id !== "string" ||
      !h.id ||
      habits.has(h.id) ||
      typeof h.name !== "string" ||
      h.name !== h.name.trim() ||
      [...h.name].length < 1 ||
      [...h.name].length > 30 ||
      !Number.isInteger(h.color) ||
      h.color < 0 ||
      h.color >= COLORS.length ||
      !validDate(h.createdDate) ||
      h.createdDate > today ||
      !Number.isFinite(h.createdAt) ||
      h.createdAt < 0 ||
      (h.archivedDate !== undefined &&
        (!validDate(h.archivedDate) ||
          h.archivedDate < h.createdDate ||
          h.archivedDate > today))
    )
      throw new Error("习惯信息无效：请检查名称、日期、颜色和唯一ID。");
    habits.set(h.id, h);
  }
  const records = new Set<string>();
  for (const r of data.completionRecords) {
    const h = r && habits.get(r.habitId);
    const key = r && JSON.stringify([r.habitId, r.date]);
    if (!h || !eligible(h, r.date, today) || records.has(key))
      throw new Error("打卡记录无效：存在重复、无效日期或未知习惯。");
    records.add(key);
  }
  // Rebuild known fields; never retain arbitrary imported properties.
  return {
    schemaVersion: 1,
    revision: data.revision,
    habits: data.habits.map((h) => ({
      id: h.id,
      name: h.name,
      color: h.color,
      createdDate: h.createdDate,
      createdAt: h.createdAt,
      ...(h.archivedDate ? { archivedDate: h.archivedDate } : {}),
    })),
    completionRecords: data.completionRecords.map((r) => ({
      habitId: r.habitId,
      date: r.date,
    })),
  };
}
