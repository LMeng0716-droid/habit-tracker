import { message } from "./cloud";
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
