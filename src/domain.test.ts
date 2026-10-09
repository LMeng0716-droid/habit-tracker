import { describe, expect, it } from "vitest";
import {
  archiveHabit,
  completedDates,
  eligible,
  localDate,
  MAX_BACKUP_SIZE,
  monthlyStats,
  parseSnapshot,
  shiftDate,
  streaks,
  toggleCompletion,
  type Habit,
  type Snapshot,
} from "./domain";
const today = "2026-10-09";
const habit: Habit = {
  id: "reading",
  name: "阅读",
  color: 0,
  createdDate: "2026-09-28",
  createdAt: 1,
};
const data = (dates: string[] = []): Snapshot => ({
  schemaVersion: 1,
  revision: "test",
  habits: [habit],
  completionRecords: dates.map((date) => ({ habitId: habit.id, date })),
});
describe("本地日期与日历算术", () => {
  it("使用本地年月日，跨周跨月跨年和闰年正确", () => {
    expect(localDate(new Date(2026, 9, 9, 0, 30))).toBe(today);
    expect(shiftDate("2026-12-31", 1)).toBe("2027-01-01");
    expect(shiftDate("2024-02-28", 1)).toBe("2024-02-29");
    expect(shiftDate("2025-02-28", 1)).toBe("2025-03-01");
    expect(shiftDate("2026-09-30", 1)).toBe("2026-10-01");
  });
  it("不因夏令时切换少一天或重复一天", () => {
    expect(shiftDate("2026-03-08", 1)).toBe("2026-03-09");
    expect(shiftDate("2026-11-01", -1)).toBe("2026-10-31");
  });
});
describe("打卡与连续记录", () => {
  it("今天未完成仍保留昨天结束的连续；断一天后归零", () => {
    const dates = new Set(["2026-10-07", "2026-10-08"]);
    expect(streaks(dates, today)).toEqual({ current: 2, longest: 2 });
    expect(streaks(dates, "2026-10-10")).toEqual({ current: 0, longest: 2 });
  });
  it("乱序数据、跨月连续、补记连接及撤销拆分", () => {
    let d = data(["2026-10-01", "2026-09-29", "2026-09-28"]);
    expect(streaks(completedDates(d, habit.id), "2026-10-01").longest).toBe(2);
    d = toggleCompletion(d, habit, "2026-09-30", today);
    expect(streaks(completedDates(d, habit.id), "2026-10-01")).toEqual({
      current: 4,
      longest: 4,
    });
    d = toggleCompletion(d, habit, "2026-09-30", today);
    expect(streaks(completedDates(d, habit.id), "2026-10-01")).toEqual({
      current: 1,
      longest: 2,
    });
  });
  it("重复点击撤销，无重复记录；非法日期不能打卡", () => {
    let d = toggleCompletion(data(), habit, today, today);
    expect(d.completionRecords).toHaveLength(1);
    expect(
      toggleCompletion(d, habit, today, today).completionRecords,
    ).toHaveLength(0);
    for (const date of ["2026-10-10", "2026-09-27", "2026-02-30"])
      expect(() => toggleCompletion(d, habit, date, today)).toThrow();
  });
  it("归档同一次操作去掉当天记录，保留过去且详情只读", () => {
    const d = archiveHabit(data(["2026-10-08", today]), habit.id, today);
    expect(d.completionRecords.map((r) => r.date)).toEqual(["2026-10-08"]);
    expect(d.habits[0].archivedDate).toBe(today);
    expect(() =>
      toggleCompletion(d, d.habits[0], "2026-10-08", today),
    ).toThrow();
    expect(eligible(d.habits[0], today, today)).toBe(false);
  });
});
describe("月完成率", () => {
  it("从月中创建至今天而非整月计算", () => {
    const h = { ...habit, createdDate: "2026-10-05" };
    expect(
      monthlyStats(
        h,
        new Set(["2026-10-05", "2026-10-06", "2026-10-08"]),
        "2026-10",
        "2026-10-08",
      ),
    ).toEqual({ completed: 3, total: 4, rate: 75 });
  });
  it("历史月完整、归档截止前一天、零分母不是0%", () => {
    expect(
      monthlyStats(habit, new Set(["2026-09-28"]), "2026-09", today),
    ).toEqual({ completed: 1, total: 3, rate: 33 });
    expect(
      monthlyStats(
        { ...habit, archivedDate: "2026-10-03" },
        new Set(["2026-10-02"]),
        "2026-10",
        today,
      ),
    ).toEqual({ completed: 1, total: 2, rate: 50 });
    expect(monthlyStats(habit, new Set(), "2026-08", today)).toEqual({
      completed: 0,
      total: 0,
      rate: null,
    });
  });
});
describe("备份校验", () => {
  it("往返保存习惯及记录且不保留外来字段", () => {
    const d = data(["2026-10-08"]);
    expect(parseSnapshot(JSON.stringify(d), today)).toEqual(d);
    expect(
      parseSnapshot(JSON.stringify({ ...d, untrusted: 1 }), today),
    ).not.toHaveProperty("untrusted");
  });
  it.each([
    ["未知版本", { ...data(), schemaVersion: 2 }],
    ["重复ID", { ...data(), habits: [habit, habit] }],
    ["空名称", { ...data(), habits: [{ ...habit, name: " " }] }],
    ["超长名称", { ...data(), habits: [{ ...habit, name: "文".repeat(31) }] }],
    ["无效颜色", { ...data(), habits: [{ ...habit, color: 99 }] }],
    [
      "无效创建日期",
      { ...data(), habits: [{ ...habit, createdDate: "2026-02-30" }] },
    ],
    [
      "未来创建日期",
      { ...data(), habits: [{ ...habit, createdDate: "2026-10-10" }] },
    ],
    ["重复记录", data(["2026-10-08", "2026-10-08"])],
    ["未来记录", data(["2026-10-10"])],
    ["创建前记录", data(["2026-09-01"])],
    [
      "未知引用",
      { ...data(), completionRecords: [{ habitId: "missing", date: today }] },
    ],
    [
      "归档当天记录",
      { ...data([today]), habits: [{ ...habit, archivedDate: today }] },
    ],
  ])("拒绝%s", (_, value) => {
    expect(() => parseSnapshot(JSON.stringify(value), today)).toThrow();
  });
  it("拒绝坏JSON、null与超过5MiB文件", () => {
    for (const value of ["{", "null", " ".repeat(MAX_BACKUP_SIZE + 1)])
      expect(() => parseSnapshot(value, today)).toThrow();
  });
  it("50个习惯两年历史在上限内且可以恢复", () => {
    const habits = Array.from({ length: 50 }, (_, i) => ({
      ...habit,
      id: `h-${i}`,
      createdDate: "2024-10-09",
    }));
    const completionRecords = habits.flatMap((h) =>
      Array.from({ length: 730 }, (_, i) => ({
        habitId: h.id,
        date: shiftDate(h.createdDate, i),
      })),
    );
    const d = { ...data(), habits, completionRecords };
    expect(
      parseSnapshot(JSON.stringify(d), today).completionRecords,
    ).toHaveLength(36500);
  });
});
