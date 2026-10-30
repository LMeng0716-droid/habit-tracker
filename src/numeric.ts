import { message } from "./cloud";
import { businessDate, shiftDate } from "./domain";
export type Mode = "count" | "duration";
export const EMOJI = [
  "🌱",
  "📚",
  "💧",
  "🏃",
  "🌙",
  "🎨",
  "🧘",
  "🍎",
  "🧹",
  "✨",
];
export function normalValue(value: string, mode: Mode): number | null {
  if (!/^\d+$/.test(value)) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) &&
    n >= 1 &&
    n <= (mode === "duration" ? 1440 : 1000000)
    ? n
    : null;
}
export function numericMessage(error: unknown): string {
  const text =
    error instanceof Error
      ? error.message
      : typeof error === "object" && error && "message" in error
        ? String(error.message)
        : "";
  const code =
    typeof error === "object" && error && "code" in error
      ? String(error.code)
      : "";
  if (/JWT expired|Invalid JWT|PGRST301/.test(text) || code === "PGRST301")
    return "登录状态已失效，请重新登录并核对保存结果。";
  if (/habit_not_found/.test(text))
    return "习惯不存在或当前账号无权访问，请重新核对。";
  if (code === "40001" || /event_revision_conflict|40001/.test(text))
    return "该记录已在其他操作中更改，请重新核对后再编辑。";
  if (/daily_value_out_of_range/.test(text))
    return "当日累计超过允许上限（1440分钟或1000000次）。";
  if (/value_out_of_range/.test(text)) return "请输入允许范围内的正整数。";
  if (/date_not_eligible|immutable_event_identity/.test(text))
    return "记录日期不符合规则，请核对北京时间及习惯创建日期。";
  if (
    code === "42501" ||
    /42501|permission denied|row-level security/.test(text)
  )
    return "没有访问权限，请检查沙盒授权与 RLS，不要扩大客户端权限。";
  if (
    /PGRST202|function .*does not exist|Could not find the function/.test(text)
  )
    return "V3 接口尚未安装或未开放，请先完成沙盒迁移审核。";
  return message(error);
}
export function eventTime(date: string, today: string) {
  return date === today ? new Date().toISOString() : `${date}T12:00:00+08:00`;
}

export type DurationSegment = {
  date: string;
  minutes: number;
  occurredAt: string;
};

/**
 * Split a foreground timer into Beijing-calendar-day records.
 * Whole elapsed minutes are assigned to the day on which each minute ends,
 * so the sum of all segments is exactly floor(total elapsed seconds / 60).
 */
export function splitDurationSession(
  startMs: number,
  endMs: number,
): DurationSegment[] {
  if (
    !Number.isFinite(startMs) ||
    !Number.isFinite(endMs) ||
    startMs < 0 ||
    endMs <= startMs
  ) {
    return [];
  }
  const totalMinutes = Math.floor((endMs - startMs) / 60_000);
  if (totalMinutes < 1) return [];

  const segments: DurationSegment[] = [];
  let cursor = startMs;
  while (cursor < endMs) {
    const date = businessDate(new Date(cursor));
    const nextMidnight = Date.parse(`${shiftDate(date, 1)}T00:00:00+08:00`);
    const segmentEnd = Math.min(endMs, nextMidnight);
    const minutes =
      Math.floor((segmentEnd - startMs) / 60_000) -
      Math.floor((cursor - startMs) / 60_000);
    if (minutes > 0) {
      segments.push({
        date,
        minutes,
        occurredAt: new Date(
          segmentEnd === nextMidnight ? nextMidnight - 1 : segmentEnd,
        ).toISOString(),
      });
    }
    cursor = segmentEnd;
  }
  return segments;
}

export type PendingDurationSegment = DurationSegment & {
  operationId: string;
  eventId: string;
};

export type ActiveDurationTimer = {
  id: string;
  start: number;
  pending?: PendingDurationSegment[];
};

export function timerOwnerId(accessToken: string): string | null {
  try {
    const payload = accessToken.split(".")[1];
    if (!payload) return null;
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = atob(
      normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="),
    );
    const subject = JSON.parse(decoded)?.sub;
    return typeof subject === "string" && subject.length > 0 ? subject : null;
  } catch {
    return null;
  }
}

export function parseActiveTimer(
  raw: string | null,
): ActiveDurationTimer | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    if (
      !value ||
      typeof value.id !== "string" ||
      value.id.length === 0 ||
      !Number.isFinite(value.start) ||
      value.start <= 0
    ) {
      return null;
    }
    let pending: PendingDurationSegment[] | undefined;
    if (value.pending !== undefined) {
      if (!Array.isArray(value.pending) || value.pending.length === 0)
        return null;
      pending = value.pending.map((segment: unknown) => {
        if (!segment || typeof segment !== "object") throw new Error("invalid");
        const item = segment as Record<string, unknown>;
        if (
          typeof item.date !== "string" ||
          !/^\d{4}-\d{2}-\d{2}$/.test(item.date) ||
          !Number.isInteger(item.minutes) ||
          Number(item.minutes) < 1 ||
          Number(item.minutes) > 1440 ||
          typeof item.occurredAt !== "string" ||
          !Number.isFinite(Date.parse(item.occurredAt)) ||
          typeof item.operationId !== "string" ||
          item.operationId.length === 0 ||
          typeof item.eventId !== "string" ||
          item.eventId.length === 0
        ) {
          throw new Error("invalid");
        }
        return item as unknown as PendingDurationSegment;
      });
    }
    return {
      id: value.id,
      start: value.start,
      ...(pending ? { pending } : {}),
    };
  } catch {
    return null;
  }
}

export function activeTimerStorageKey(ownerId: string): string {
  return `habit-tracker:numeric-timer:v1:${ownerId}`;
}
