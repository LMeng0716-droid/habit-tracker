export const COLORS = ["青松", "海蓝", "暖橙", "紫藤", "玫瑰"] as const;
export type Schedule =
  | { kind: "daily" }
  | { kind: "weekdays"; days: number[] }
  | { kind: "weeklyQuota"; count: number };
export interface Plan {
  id: string;
  effectiveDate: string;
  schedule: Schedule;
}
export interface Category {
  id: string;
  name: string;
  preset: boolean;
}
export interface Note {
  id: string;
  habitId: string | null;
  date: string;
  text: string;
}
export const presetCategories = (): Category[] =>
  ["学习", "运动", "生活", "健康", "工作", "其他"].map((name, i) => ({
    id: `preset-${i}`,
    name,
    preset: true,
  }));
export interface Habit {
  id: string;
  name: string;
  color: number;
  createdDate: string;
  createdAt: number;
  archivedDate?: string;
  categoryId?: string | null;
  order?: number;
  scheduleHistory?: Plan[];
}
export interface Completion {
  id?: string;
  habitId: string;
  date: string;
}
export interface Snapshot {
  schemaVersion: 1 | 2;
  categories?: Category[];
  notes?: Note[];
  revision: string;
  habits: Habit[];
  completionRecords: Completion[];
}
// Normalized v2 data is returned only after validation; optional fields above
// describe legacy-compatible inputs to pure domain operations.
export interface NormalizedHabit extends Habit {
  categoryId: string | null;
  order: number;
  scheduleHistory: Plan[];
}
export interface NormalizedSnapshot extends Snapshot {
  schemaVersion: 2;
  categories: Category[];
  notes: Note[];
  habits: NormalizedHabit[];
  completionRecords: (Completion & { id: string })[];
}
// getRandomValues also works on a phone preview over a local HTTP network.
export function newId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
export const emptySnapshot = (): NormalizedSnapshot => ({
  schemaVersion: 2,
  categories: presetCategories(),
  notes: [],
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
export function weekStart(date: string): string {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay() || 7;
  return shiftDate(date, 1 - day);
}
export function scheduleAt(habit: Habit, date: string): Schedule {
  return (
    [...(habit.scheduleHistory ?? [])]
      .reverse()
      .find((p) => p.effectiveDate <= date)?.schedule ?? { kind: "daily" }
  );
}
export function planned(habit: Habit, date: string, today: string): boolean {
  if (!eligible(habit, date, today)) return false;
  const plan = scheduleAt(habit, date);
  return (
    plan.kind === "daily" ||
    (plan.kind === "weekdays" &&
      plan.days.includes(new Date(`${date}T00:00:00Z`).getUTCDay() || 7))
  );
}
export function canComplete(
  habit: Habit,
  date: string,
  today: string,
): boolean {
  return (
    eligible(habit, date, today) &&
    (scheduleAt(habit, date).kind === "weeklyQuota" ||
      planned(habit, date, today))
  );
}
export function changeSchedule(
  habit: Habit,
  schedule: Schedule,
  today: string,
): Habit {
  const effectiveDate = shiftDate(weekStart(today), 7);
  const history = habit.scheduleHistory ?? [
    {
      id: `initial:${habit.id}`,
      effectiveDate: habit.createdDate,
      schedule: { kind: "daily" } as Schedule,
    },
  ];
  if (
    JSON.stringify(scheduleAt(habit, effectiveDate)) ===
    JSON.stringify(schedule)
  )
    return habit;
  return {
    ...habit,
    scheduleHistory: [
      ...history.filter((p) => p.effectiveDate < effectiveDate),
      {
        id:
          history.find((p) => p.effectiveDate === effectiveDate)?.id ?? newId(),
        effectiveDate,
        schedule,
      },
    ],
  };
}
export function removeCategory(data: Snapshot, id: string): Snapshot {
  return {
    ...data,
    categories: data.categories?.filter((c) => c.id !== id),
    habits: data.habits.map((h) =>
      h.categoryId === id ? { ...h, categoryId: null } : h,
    ),
  };
}
export function reorderHabits(
  data: Snapshot,
  from: string,
  to: string,
): Snapshot {
  const habits = [...data.habits].sort(
    (a, b) => (a.order ?? 0) - (b.order ?? 0),
  );
  const a = habits.findIndex((h) => h.id === from),
    b = habits.findIndex((h) => h.id === to);
  if (a < 0 || b < 0) return data;
  habits.splice(b, 0, habits.splice(a, 1)[0]);
  return { ...data, habits: habits.map((h, order) => ({ ...h, order })) };
}
export function noteEligible(h: Habit, date: string, today: string): boolean {
  return (
    validDate(date) &&
    date >= h.createdDate &&
    date <= today &&
    (!h.archivedDate || date <= h.archivedDate)
  );
}
export function setNote(
  data: Snapshot,
  habitId: string | null,
  date: string,
  text: string,
  today: string,
): Snapshot {
  if (
    !validDate(date) ||
    date > today ||
    [...text].length > 2000 ||
    (habitId !== null &&
      !data.habits.some(
        (h) => h.id === habitId && noteEligible(h, date, today),
      ))
  )
    throw new Error("备注日期或内容无效。");
  const id = JSON.stringify([habitId, date]);
  return {
    ...data,
    notes: [
      ...(data.notes ?? []).filter((n) => n.id !== id),
      ...(text.trim() ? [{ id, habitId, date, text }] : []),
    ],
  };
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
    planned(habit, date, today),
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
  if (habit.archivedDate || !canComplete(habit, date, today))
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
      : [
          ...data.completionRecords,
          { id: JSON.stringify([habit.id, date]), habitId: habit.id, date },
        ],
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
export function parseSnapshot(
  raw: string,
  today = localDate(),
): NormalizedSnapshot {
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
    ![1, 2].includes(data.schemaVersion) ||
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
  const v2 = data.schemaVersion === 2;
  const categories = v2 ? data.categories : presetCategories();
  const notes = v2 ? data.notes : [];
  if (!Array.isArray(categories) || !Array.isArray(notes))
    throw new Error("分类或备注格式无效。");
  const categoryIds = new Set<string>();
  for (const c of categories) {
    if (
      !c ||
      typeof c.id !== "string" ||
      !c.id ||
      categoryIds.has(c.id) ||
      typeof c.name !== "string" ||
      !c.name.trim() ||
      c.name !== c.name.trim() ||
      [...c.name].length > 30 ||
      typeof c.preset !== "boolean"
    )
      throw new Error("分类无效。");
    categoryIds.add(c.id);
  }
  const planIds = new Set<string>();
  const orders = new Set<number>();
  const upgradedHabits = data.habits.map((h, order) => {
    const history: Plan[] = v2
      ? h.scheduleHistory!
      : [
          {
            id: `initial:${h.id}`,
            effectiveDate: h.createdDate,
            schedule: { kind: "daily" },
          },
        ];
    if (
      v2 &&
      ((h.categoryId !== null && !categoryIds.has(h.categoryId!)) ||
        !Number.isInteger(h.order) ||
        h.order! < 0 ||
        orders.has(h.order!))
    )
      throw new Error("分类引用或排序无效。");
    orders.add(h.order ?? order);
    if (
      !Array.isArray(history) ||
      !history.length ||
      history[0].effectiveDate !== h.createdDate
    )
      throw new Error("初始计划无效。");
    let previous = "";
    const cleanHistory = history.map((p) => {
      if (
        !p ||
        typeof p.id !== "string" ||
        !p.id ||
        planIds.has(p.id) ||
        !validDate(p.effectiveDate) ||
        p.effectiveDate <= previous ||
        (previous && weekStart(p.effectiveDate) !== p.effectiveDate) ||
        p.effectiveDate > shiftDate(weekStart(today), 7)
      )
        throw new Error("计划历史无效。");
      planIds.add(p.id);
      previous = p.effectiveDate;
      const r = p.schedule;
      if (
        !r ||
        (r.kind !== "daily" &&
          r.kind !== "weekdays" &&
          r.kind !== "weeklyQuota") ||
        (r.kind === "weeklyQuota" &&
          (!Number.isInteger(r.count) || r.count < 1 || r.count > 7)) ||
        (r.kind === "weekdays" &&
          (!Array.isArray(r.days) ||
            !r.days.length ||
            new Set(r.days).size !== r.days.length ||
            r.days.some((d) => !Number.isInteger(d) || d < 1 || d > 7)))
      )
        throw new Error("重复周期无效。");
      const schedule: Schedule =
        r.kind === "daily"
          ? { kind: "daily" }
          : r.kind === "weekdays"
            ? { kind: "weekdays", days: [...r.days] }
            : { kind: "weeklyQuota", count: r.count };
      return { id: p.id, effectiveDate: p.effectiveDate, schedule };
    });
    return {
      id: h.id,
      name: h.name,
      color: h.color,
      createdDate: h.createdDate,
      createdAt: h.createdAt,
      ...(h.archivedDate ? { archivedDate: h.archivedDate } : {}),
      categoryId: v2 ? h.categoryId! : null,
      order: v2 ? h.order! : order,
      scheduleHistory: cleanHistory,
    };
  });
  const upgradedRecords = data.completionRecords.map((r) => {
    const id = JSON.stringify([r.habitId, r.date]);
    if (
      v2 &&
      (r.id !== id ||
        !canComplete(
          upgradedHabits.find((h) => h.id === r.habitId)!,
          r.date,
          today,
        ))
    )
      throw new Error("打卡标识或计划日期无效。");
    return { id, habitId: r.habitId, date: r.date };
  });
  const noteIds = new Set<string>();
  const cleanNotes = notes.map((n) => {
    if (
      !n ||
      n.id !== JSON.stringify([n.habitId, n.date]) ||
      noteIds.has(n.id) ||
      !validDate(n.date) ||
      n.date > today ||
      typeof n.text !== "string" ||
      !n.text.trim() ||
      [...n.text].length > 2000 ||
      (n.habitId !== null &&
        !upgradedHabits.some(
          (h) => h.id === n.habitId && noteEligible(h, n.date, today),
        ))
    )
      throw new Error("备注无效。");
    noteIds.add(n.id);
    return { id: n.id, habitId: n.habitId, date: n.date, text: n.text };
  });
  return {
    schemaVersion: 2,
    revision: data.revision,
    habits: upgradedHabits,
    completionRecords: upgradedRecords,
    categories: categories.map((c) => ({
      id: c.id,
      name: c.name,
      preset: c.preset,
    })),
    notes: cleanNotes,
  };
}
