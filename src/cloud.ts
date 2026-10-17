import { createClient } from "@supabase/supabase-js";
import { parseSnapshot } from "./domain";
import { validatePublicConfig } from "./public-config";
const config = validatePublicConfig({
  VITE_SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL,
  VITE_SUPABASE_PUBLISHABLE_KEY: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
});
export const configIssues = config.ok ? [] : config.issues;
export const cloud = config.ok
  ? createClient(config.config.url, config.config.key, {
      db: { schema: "habit_mobile" },
    })
  : null;
export const authRedirect = () =>
  `${location.origin}${import.meta.env.BASE_URL}`;
export async function readSnapshot() {
  if (!cloud) throw new Error("尚未配置云端服务。");
  const { data, error } = await cloud
    .schema("habit_mobile")
    .rpc("read_snapshot");
  if (error) throw error;
  return parseSnapshot(data);
}
export async function writeCloud(
  name: string,
  args: Record<string, string | number | boolean>,
) {
  if (!cloud) throw new Error("尚未配置云端服务。");
  const { error } = await cloud.schema("habit_mobile").rpc(name, args);
  if (error) throw error;
}
export function message(error: unknown): string {
  const text =
    error instanceof Error
      ? error.message
      : typeof error === "object" && error !== null && "message" in error
        ? String(error.message)
        : "请求失败";
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
