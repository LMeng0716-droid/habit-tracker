import {
  emptySnapshot,
  localDate,
  newId,
  parseSnapshot,
  type Snapshot,
  type NormalizedSnapshot,
} from "./domain";
export const STORAGE_KEY = "daily-progress:v2";
export const LEGACY_KEY = "daily-progress:v1";
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
// A prefixed expectedRaw tracks the exact legacy source while the v2 key is absent.
const legacyPrefix = "legacy:";
export function readRaw(storage: StorageLike): string | null {
  const raw = storage.getItem(STORAGE_KEY);
  const legacy = raw === null ? storage.getItem(LEGACY_KEY) : null;
  return raw ?? (legacy === null ? null : legacyPrefix + legacy);
}
export function load(storage: StorageLike): {
  data: NormalizedSnapshot;
  raw: string | null;
} {
  const raw = storage.getItem(STORAGE_KEY);
  if (raw !== null) return { data: parseSnapshot(raw), raw };
  const legacy = storage.getItem(LEGACY_KEY);
  return {
    data: legacy === null ? emptySnapshot() : parseSnapshot(legacy),
    raw: legacy === null ? null : legacyPrefix + legacy,
  };
}
export function sourceRaw(raw: string | null): string | null {
  return raw?.startsWith(legacyPrefix) ? raw.slice(legacyPrefix.length) : raw;
}
export function save(
  storage: StorageLike,
  data: Snapshot,
  expectedRaw: string | null,
  today = localDate(),
): { data: NormalizedSnapshot; raw: string } {
  const legacy = expectedRaw?.startsWith(legacyPrefix);
  if (
    legacy
      ? storage.getItem(STORAGE_KEY) !== null ||
        storage.getItem(LEGACY_KEY) !== sourceRaw(expectedRaw)
      : storage.getItem(STORAGE_KEY) !== expectedRaw ||
        (expectedRaw === null && storage.getItem(LEGACY_KEY) !== null)
  )
    throw new Error("其他窗口已修改数据，请刷新后继续。");
  const next = parseSnapshot(
    JSON.stringify({ ...data, revision: newId() }),
    today,
  );
  const raw = JSON.stringify(next);
  storage.setItem(STORAGE_KEY, raw);
  return { data: next, raw };
}
