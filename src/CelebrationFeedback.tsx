import type { CSSProperties } from "react";
import type { Celebration } from "./useCelebrations";
export function StarParticles({ full = false }: { full?: boolean }) {
  return (
    <span
      className={full ? "confetti-field" : "card-sparkles"}
      aria-hidden="true"
    >
      {Array.from({ length: full ? 22 : 5 }, (_, index) => (
        <i
          key={index}
          style={
            {
              "--particle": index,
              "--lane": (index * 37 + 7) % 100,
              "--drift": `${(index % 2 ? 1 : -1) * (18 + (index % 5) * 9)}px`,
              "--delay": `${(index % 6) * 55}ms`,
            } as CSSProperties
          }
        >
          ✦
        </i>
      ))}
    </span>
  );
}
export function CelebrationFeedback({ event }: { event: Celebration }) {
  return (
    <div className="celebration-layer" key={event.sequence}>
      {event.all && <StarParticles full />}
      <div
        className={`success-toast ${event.all ? "all-celebration" : ""} ${event.dock === "top" ? "toast-top" : ""}`}
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {event.preview && <small>效果预览 · 不会打卡或保存数据</small>}
        <strong>{event.all ? "今天的目标全部完成！🌱" : "完成啦！✨"}</strong>
        {!event.preview && <small>{event.name} · 已保存到云端</small>}
      </div>
    </div>
  );
}
