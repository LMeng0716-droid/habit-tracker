export const EMOJI_CHOICES = ["🌱", "📖", "💪", "🧘", "💤", "💧", "🥗", "🏃", "🪥", "🛁", "🧴", "🎨", "🎯", "☀️", "❤️", "✨"] as const;
export type HabitPrefs = { icons: Record<string, string>; order: string[] };
export const emptyHabitPrefs = (): HabitPrefs => ({ icons: {}, order: [] });
export function parseHabitPrefs(raw: string | null): HabitPrefs {
  if (!raw) return emptyHabitPrefs();
  try {
    const v: unknown = JSON.parse(raw);
    if (!v || typeof v !== "object") return emptyHabitPrefs();
    const data = v as Record<string, unknown>;
    const icons: Record<string, string> = {};
    if (data.icons && typeof data.icons === "object" && !Array.isArray(data.icons))
      for (const [id, value] of Object.entries(data.icons))
        if (typeof value === "string" && EMOJI_CHOICES.includes(value as typeof EMOJI_CHOICES[number]))
          icons[id] = value;
    const order = Array.isArray(data.order)
      ? [...new Set(data.order.filter((id): id is string => typeof id === "string" && id.length > 0))]
      : [];
    return { icons, order };
  } catch {
    return emptyHabitPrefs();
  }
}
export function sortedHabits<T extends { id: string }>(habits: T[], order: string[]): T[] {
  const ranks = new Map(order.map((id, index) => [id, index]));
  return [...habits].sort((a, b) => {
    const ai = ranks.get(a.id) ?? Number.MAX_SAFE_INTEGER;
    const bi = ranks.get(b.id) ?? Number.MAX_SAFE_INTEGER;
    return ai - bi;
  });
}
export function moveHabit(order: string[], visibleIds: string[], moving: string, target: string): string[] {
  if (moving === target || !visibleIds.includes(moving) || !visibleIds.includes(target))
    return order;
  const all = [...new Set([...visibleIds, ...order])];
  const src = all.indexOf(moving);
  all.splice(src, 1);
  all.splice(all.indexOf(target), 0, moving);
  return all;
}
export function prefsKey(project: string, base: string, user: string): string {
  return `daily-progress:device-habits:${encodeURIComponent(project)}:${encodeURIComponent(base)}:${user}`;
}
