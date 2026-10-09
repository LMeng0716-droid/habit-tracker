import { describe, expect, it } from "vitest";
import {
  changeSchedule,
  emptySnapshot,
  monthlyStats,
  parseSnapshot,
  planned,
  canComplete,
  weekStart,
  setNote,
  toggleCompletion,
  archiveHabit,
  removeCategory,
  reorderHabits,
  type Snapshot,
} from "./domain";
import {
  load,
  save,
  STORAGE_KEY,
  LEGACY_KEY,
  sourceRaw,
  readRaw,
  type StorageLike,
} from "./storage";
const today = "2026-10-09";
const legacy = {
  schemaVersion: 1,
  revision: "old",
  habits: [
    {
      id: "h",
      name: "阅读",
      color: 0,
      createdDate: "2026-09-28",
      createdAt: 1,
    },
  ],
  completionRecords: [{ habitId: "h", date: "2026-10-08" }],
};
const fixture = () => parseSnapshot(JSON.stringify(legacy), today);
class Memory implements StorageLike {
  values = new Map<string, string>();
  fail = false;
  getItem(k: string) {
    return this.values.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    if (this.fail) throw new Error("quota");
    this.values.set(k, v);
  }
}
describe("计划历史及统计口径", () => {
  it("编辑下周生效；跨周跨年周一日期不会错位", () => {
    const h = changeSchedule(
      fixture().habits[0],
      { kind: "weekdays", days: [1, 3, 5] },
      today,
    );
    expect(h.scheduleHistory?.at(-1)?.effectiveDate).toBe("2026-10-12");
    expect(planned(h, "2026-10-10", "2026-10-20")).toBe(true);
    expect(planned(h, "2026-10-13", "2026-10-20")).toBe(false);
    expect(planned(h, "2026-10-14", "2026-10-20")).toBe(true);
    expect(weekStart("2027-01-01")).toBe("2026-12-28");
    expect(
      changeSchedule(
        h,
        { kind: "weeklyQuota", count: 2 },
        "2026-12-31",
      ).scheduleHistory?.at(-1)?.effectiveDate,
    ).toBe("2027-01-04");
    expect(monthlyStats(h, new Set(["2026-10-08"]), "2026-10", today)).toEqual({
      completed: 1,
      total: 9,
      rate: 11,
    });
  });
  it("无计划日无分母，不能打卡，也不是失败", () => {
    const d = fixture();
    const h = {
      ...d.habits[0],
      scheduleHistory: [
        {
          id: "p",
          effectiveDate: "2026-09-28",
          schedule: { kind: "weekdays" as const, days: [1] },
        },
      ],
    };
    expect(monthlyStats(h, new Set(), "2026-10", "2026-10-04")).toEqual({
      completed: 0,
      total: 0,
      rate: null,
    });
    expect(() =>
      toggleCompletion({ ...d, habits: [h] }, h, today, today),
    ).toThrow();
  });
  it("周次数可在任何有效日期打卡，但不进入每日统计", () => {
    const d = fixture();
    const h = {
      ...d.habits[0],
      scheduleHistory: [
        {
          id: "p",
          effectiveDate: "2026-09-28",
          schedule: { kind: "weeklyQuota" as const, count: 3 },
        },
      ],
    };
    expect(canComplete(h, today, today)).toBe(true);
    expect(monthlyStats(h, new Set([today]), "2026-10", today)).toEqual({
      completed: 0,
      total: 0,
      rate: null,
    });
  });
  it("未来计划替换幂等，过去计划 ID 和内容不改", () => {
    const h = fixture().habits[0];
    const a = changeSchedule(h, { kind: "weeklyQuota", count: 3 }, today);
    const b = changeSchedule(a, { kind: "weekdays", days: [2] }, today);
    expect(b.scheduleHistory).toHaveLength(2);
    expect(b.scheduleHistory?.[0]).toEqual(h.scheduleHistory?.[0]);
    expect(b.scheduleHistory?.[1].id).toBe(a.scheduleHistory?.[1].id);
    expect(changeSchedule(b, { kind: "weekdays", days: [2] }, today)).toEqual(
      b,
    );
  });
});
describe("迁移与新实体保护", () => {
  it("迁移确定且保留全部记录、ID、原始 v1；读取不写入", () => {
    const storage = new Memory();
    const raw = JSON.stringify(legacy);
    storage.setItem(LEGACY_KEY, raw);
    const first = load(storage);
    expect(storage.getItem(STORAGE_KEY)).toBeNull();
    expect(sourceRaw(first.raw)).toBe(raw);
    const saved = save(storage, first.data, first.raw, today);
    expect(storage.getItem(LEGACY_KEY)).toBe(raw);
    expect(load(storage)).toEqual(saved);
    expect(parseSnapshot(raw, today)).toEqual(first.data);
    expect(first.data.completionRecords[0].id).toBe('["h","2026-10-08"]');
  });
  it("迁移配额不足、旧标签修改及新键损坏都不覆盖旧数据", () => {
    const s = new Memory();
    s.setItem(LEGACY_KEY, JSON.stringify(legacy));
    const first = load(s);
    s.fail = true;
    expect(() => save(s, first.data, first.raw, today)).toThrow("quota");
    expect(s.getItem(STORAGE_KEY)).toBeNull();
    s.fail = false;
    s.setItem(LEGACY_KEY, "changed");
    expect(() => save(s, first.data, first.raw, today)).toThrow("其他窗口");
    s.setItem(STORAGE_KEY, "broken");
    expect(() => load(s)).toThrow();
    expect(s.getItem(STORAGE_KEY)).toBe("broken");
  });
  it("损坏 v1 只能在明确恢复后写新键，原文保留", () => {
    const s = new Memory();
    s.setItem(LEGACY_KEY, "broken");
    expect(() => load(s)).toThrow();
    save(s, emptySnapshot(), readRaw(s), today);
    expect(s.getItem(LEGACY_KEY)).toBe("broken");
  });
  it("备注和当天总结独立，撤销及归档不删备注，历史可编辑", () => {
    let d = setNote(fixture(), "h", today, "习惯笔记", today);
    d = setNote(d, null, today, "总结", today);
    d = toggleCompletion(d, d.habits[0], today, today);
    d = toggleCompletion(d, d.habits[0], today, today);
    expect(d.notes).toHaveLength(2);
    const id = d.notes?.[0].id;
    d = setNote(d, "h", today, "修改", today);
    expect(d.notes?.find((n) => n.habitId === "h")?.id).toBe(id);
    d = archiveHabit(d, "h", today);
    expect(parseSnapshot(JSON.stringify(d), today).notes).toHaveLength(2);
    expect(
      setNote(d, "h", today, "归档历史", today).notes?.find(
        (n) => n.habitId === "h",
      )?.text,
    ).toBe("归档历史");
    expect(() => setNote(d, "h", "2026-10-10", "x", today)).toThrow();
  });
  it("分类删除仅解除关联，排序持久化并保留记录备注", () => {
    const d = fixture();
    d.categories?.push({ id: "custom", name: "自定义", preset: false });
    d.habits[0].categoryId = "custom";
    const removed = removeCategory(d, "custom");
    expect(removed.habits).toHaveLength(1);
    expect(removed.habits[0].categoryId).toBeNull();
    expect(removed.completionRecords).toEqual(d.completionRecords);
    const next = {
      ...removed,
      habits: [
        ...removed.habits,
        {
          ...removed.habits[0],
          id: "b",
          order: 1,
          scheduleHistory: [
            {
              id: "pb",
              effectiveDate: "2026-09-28",
              schedule: { kind: "daily" as const },
            },
          ],
        },
      ],
    };
    const sorted = reorderHabits(next, "b", "h");
    expect(
      parseSnapshot(JSON.stringify(sorted), today).habits.map((h) => h.id),
    ).toEqual(["b", "h"]);
  });
  it.each(["badCategory", "badPlan", "badNote", "badRecord", "duplicateOrder"])(
    "拒绝 v2 非法字段 %s",
    (kind) => {
      const d: Snapshot = fixture();
      if (kind === "badCategory") d.habits[0].categoryId = "missing";
      if (kind === "badPlan")
        d.habits[0].scheduleHistory![0].schedule = {
          kind: "weeklyQuota",
          count: 8,
        };
      if (kind === "badNote")
        d.notes = [{ id: "wrong", habitId: "h", date: today, text: "x" }];
      if (kind === "badRecord") d.completionRecords[0].id = "wrong";
      if (kind === "duplicateOrder") d.habits.push({ ...d.habits[0], id: "b" });
      expect(() => parseSnapshot(JSON.stringify(d), today)).toThrow();
    },
  );
});
