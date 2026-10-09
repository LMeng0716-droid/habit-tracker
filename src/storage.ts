import {
  emptySnapshot,
  localDate,
  newId,
  parseSnapshot,
  type Snapshot,
} from "./domain";
export const STORAGE_KEY = "daily-progress:v1";
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
export function load(storage: StorageLike): {
  data: Snapshot;
  raw: string | null;
} {
  const raw = storage.getItem(STORAGE_KEY);
  return { data: raw === null ? emptySnapshot() : parseSnapshot(raw), raw };
}
export function save(
  storage: StorageLike,
  data: Snapshot,
  expectedRaw: string | null,
  today = localDate(),
): { data: Snapshot; raw: string } {
  if (storage.getItem(STORAGE_KEY) !== expectedRaw)
    throw new Error("其他窗口已修改数据，请刷新后继续。");
  const next = parseSnapshot(
    JSON.stringify({ ...data, revision: newId() }),
    today,
  );
  const raw = JSON.stringify(next);
  storage.setItem(STORAGE_KEY, raw);
  return { data: next, raw };
}
