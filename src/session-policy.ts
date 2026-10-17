// UX limits only: local clocks/storage are not a server-side security boundary.
export const DAY = 86400000;
export type SessionTimes = {
  loginAt: number;
  lastActiveAt: number;
  seenAt: number;
};
export function sessionExpired(
  value: SessionTimes | null,
  now: number,
): boolean {
  return (
    !value ||
    ![value.loginAt, value.lastActiveAt, value.seenAt, now].every(
      Number.isFinite,
    ) ||
    value.loginAt > value.lastActiveAt ||
    value.lastActiveAt > value.seenAt ||
    now < value.seenAt - 60000 ||
    now - value.loginAt >= 30 * DAY ||
    now - value.lastActiveAt >= 7 * DAY
  );
}
export function policyKey(base: string, project: string, uid: string) {
  return `daily-progress:${base}:${new URL(project).host}:${uid}:session-policy`;
}
export function readTimes(storage: Storage, key: string): SessionTimes | null {
  try {
    return JSON.parse(storage.getItem(key) ?? "null") as SessionTimes | null;
  } catch {
    return null;
  }
}
