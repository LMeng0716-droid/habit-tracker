export const PREVIEW_BASE = "/habit-tracker-preview/";
export const PRODUCTION_BASE = "/habit-tracker/";
export function authStorageKey(
  projectUrl: string,
  base: string,
): string | undefined {
  // Preserve production SDK's default key. Preview also isolates SDK-generated
  // PKCE verifier and BroadcastChannel names, which derive from storageKey.
  return base === PREVIEW_BASE
    ? `habit-tracker-preview:${new URL(projectUrl).host}:auth`
    : undefined;
}
export function callbackUrl(origin: string, base: string): string {
  if (base !== PREVIEW_BASE && base !== PRODUCTION_BASE)
    throw new Error("不支持的应用基础路径。");
  return `${origin}${base}`;
}
