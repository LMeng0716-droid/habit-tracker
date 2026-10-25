import { boundedRequest } from "./request";
import { passwordError } from "./password";
import { createClient } from "@supabase/supabase-js";
import { authStorageKey, callbackUrl } from "./preview";
import { parseSnapshot } from "./domain";
import { validatePublicConfig } from "./public-config";
const config = validatePublicConfig({
  VITE_SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL,
  VITE_SUPABASE_PUBLISHABLE_KEY: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
});
export const projectUrl = config.ok ? config.config.url : "";
export const configIssues = config.ok ? [] : config.issues;
const storageKey = config.ok
  ? authStorageKey(config.config.url, import.meta.env.BASE_URL)
  : undefined;
export const cloud = config.ok
  ? createClient(config.config.url, config.config.key, {
      db: { schema: "habit_mobile" },
      ...(storageKey ? { auth: { storageKey } } : {}),
    })
  : null;
export const authRedirect = () =>
  callbackUrl(location.origin, import.meta.env.BASE_URL);
export async function readSnapshot(signal?: AbortSignal) {
  if (!cloud) throw new Error("尚未配置云端服务。");
  const client = cloud;
  const { data, error } = await boundedRequest(
    (requestSignal) =>
      client
        .schema("habit_mobile")
        .rpc("read_snapshot")
        .abortSignal(requestSignal),
    signal,
  );
  if (error) throw error;
  return parseSnapshot(data);
}
export async function writeCloud(
  name: string,
  args: Record<string, string | number | boolean | string[]>,
  signal?: AbortSignal,
) {
  if (!cloud) throw new Error("尚未配置云端服务。");
  const client = cloud;
  const { error } = await boundedRequest(
    (requestSignal) =>
      client.schema("habit_mobile").rpc(name, args).abortSignal(requestSignal),
    signal,
  );
  if (error) throw error;
}
export function message(error: unknown): string {
  const policyMessage = passwordError(error);
  if (policyMessage) return policyMessage;
  const text =
    error instanceof Error
      ? error.message
      : typeof error === "object" && error !== null && "message" in error
        ? String(error.message)
        : "请求失败";
  if (text.includes("request_timeout"))
    return "连接超时，保存结果需要重新核对。";
  if (text.includes("Invalid login credentials")) return "邮箱或密码不正确。";
  if (text.includes("Email not confirmed"))
    return "请先打开验证邮件完成邮箱验证。";
  if (text.includes("habit_archived")) return "习惯已归档，请刷新后查看。";
  if (text.includes("date_not_eligible"))
    return "该日期不能打卡，请刷新后重试。";
  if (text.includes("Failed to fetch") || text.includes("NetworkError"))
    return "网络连接失败，请检查网络并重试。";
  return "请求未完成，请重试。若持续失败，请检查云端配置或联系管理员。";
}
