import { expect, it } from "vitest";
import { emptySnapshot } from "./domain";
import { load, save, STORAGE_KEY, type StorageLike } from "./storage";
class MemoryStorage implements StorageLike {
  values = new Map<string, string>();
  fail = false;
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    if (this.fail) throw new Error("配额不足");
    this.values.set(key, value);
  }
}
it("保存、刷新读取和JSON往返一致", () => {
  const storage = new MemoryStorage();
  const d = emptySnapshot();
  const saved = save(storage, d, null);
  expect(load(storage)).toEqual(saved);
  expect(saved.data.revision).not.toBe(d.revision);
});
it("写入失败不改变已保存内容", () => {
  const storage = new MemoryStorage();
  const saved = save(storage, emptySnapshot(), null);
  storage.fail = true;
  expect(() => save(storage, emptySnapshot(), saved.raw)).toThrow("配额不足");
  expect(storage.getItem(STORAGE_KEY)).toBe(saved.raw);
});
it("另一窗口或数据清空导致冲突，拒绝覆盖", () => {
  const storage = new MemoryStorage();
  const old = save(storage, emptySnapshot(), null);
  const newest = save(storage, emptySnapshot(), old.raw);
  expect(() => save(storage, emptySnapshot(), old.raw)).toThrow("其他窗口");
  expect(storage.getItem(STORAGE_KEY)).toBe(newest.raw);
});
it("损坏存储不写入空快照；可在明确恢复后替换", () => {
  const storage = new MemoryStorage();
  storage.setItem(STORAGE_KEY, "broken");
  expect(() => load(storage)).toThrow();
  expect(storage.getItem(STORAGE_KEY)).toBe("broken");
  const recovered = save(storage, emptySnapshot(), "broken");
  expect(load(storage)).toEqual(recovered);
});
