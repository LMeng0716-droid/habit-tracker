/** Shared by Node/Vite and the browser. Never include values in diagnostics. */
export const PUBLIC_NAMES = [
  "VITE_SUPABASE_URL",
  "VITE_SUPABASE_PUBLISHABLE_KEY",
] as const;
type Config = { url: string; key: string };
export type ConfigResult =
  | { ok: true; config: Config; issues: []; unsafe: false }
  | { ok: false; issues: string[]; unsafe: boolean };
const placeholder =
  /(?:^|[\/._-])(?:your|replace|placeholder|changeme)(?:[\/._-]|$)|your[_ -]?(?:project|publishable|supabase|key|url)|replace[_ -]?with|change[_ -]?me|<|>/i;
function privileged(value: string): boolean {
  if (/sb_secret_|service[_-]?role/i.test(value)) return true;
  // Legacy JWT keys are not accepted. Also detect privileged JWTs in extra vars.
  const parts = value.split(".");
  if (parts.length !== 3) return false;
  try {
    const payload: unknown = JSON.parse(
      atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")),
    );
    return (
      typeof payload === "object" &&
      payload !== null &&
      "role" in payload &&
      payload.role === "service_role"
    );
  } catch {
    return false;
  }
}
export function validatePublicConfig(
  env: Record<string, unknown>,
): ConfigResult {
  const issues: string[] = [];
  let unsafe = false;
  // Vite publishes all VITE_* variables. An allowlist prevents accidental extras.
  for (const [name, value] of Object.entries(env)) {
    if (
      name.startsWith("VITE_") &&
      !PUBLIC_NAMES.some((allowed) => allowed === name)
    ) {
      issues.push("存在未允许公开的 VITE_* 变量，请从前端构建环境中移除。");
      unsafe = true;
    }
    if (
      name.startsWith("VITE_") &&
      typeof value === "string" &&
      privileged(value)
    ) {
      issues.push(
        "检测到禁止用于前端的服务端密钥；请移除并轮换可能已暴露的密钥。",
      );
      unsafe = true;
    }
  }
  const url = env.VITE_SUPABASE_URL;
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (typeof url !== "string" || !url.trim())
    issues.push("缺少 VITE_SUPABASE_URL，请配置 Supabase Project URL。");
  else {
    let valid = false;
    try {
      const parsed = new URL(url);
      const host = parsed.hostname.toLowerCase();
      const labels = host.split(".");
      valid =
        url === url.trim() &&
        parsed.protocol === "https:" &&
        !parsed.username &&
        !parsed.password &&
        !parsed.search &&
        !parsed.hash &&
        (parsed.pathname === "/" || parsed.pathname === "") &&
        !parsed.port &&
        labels.length >= 2 &&
        labels.every((label) =>
          /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label),
        ) &&
        !/^[\d.]+$/.test(host) &&
        !/(^|\.)(localhost|invalid|test|example)$/.test(host) &&
        !/(^|\.)example\.(com|net|org)$/.test(host) &&
        !placeholder.test(url);
    } catch {
      /* Return only fixed diagnostics, never the URL or parser error. */
    }
    if (!valid) {
      issues.push(
        "VITE_SUPABASE_URL 必须是有效的 HTTPS 项目根地址，不能包含凭据、路径、查询参数或占位符。",
      );
      unsafe = true;
    }
  }
  if (typeof key !== "string" || !key.trim())
    issues.push(
      "缺少 VITE_SUPABASE_PUBLISHABLE_KEY，请配置公开 publishable key。",
    );
  else if (
    !/^sb_publishable_[A-Za-z0-9_-]{20,}$/.test(key) ||
    placeholder.test(key) ||
    /fixture|example|changeme/i.test(key)
  ) {
    issues.push(
      "VITE_SUPABASE_PUBLISHABLE_KEY 必须是有效格式的公开 publishable key，不接受占位符、anon JWT 或服务端密钥。",
    );
    unsafe = true;
  }
  if (issues.length) return { ok: false, issues: [...new Set(issues)], unsafe };
  return {
    ok: true,
    config: { url: url as string, key: key as string },
    issues: [],
    unsafe: false,
  };
}
