import { useCallback, useEffect, useRef, useState } from "react";
import { cloud } from "./cloud";
import { businessDate, shiftDate, streaks } from "./domain";
import {
  earnedStreakBadges,
  numericHeatmapDays,
  numericPeriodProgress,
  numericProgressDates,
  numericTrend,
  weekStart,
} from "./insights";
import { boundedRequest } from "./request";
import {
  EMOJI,
  activeTimerStorageKey,
  eventTime,
  normalValue,
  numericMessage,
  parseActiveTimer,
  timerOwnerId,
  type Mode,
  splitDurationSession,
} from "./numeric";

type Habit = {
  id: string;
  name: string;
  emoji: string;
  habit_type: Mode;
  target: number | null;
  goal_direction: string;
  created_date: string;
  archived_on: string | null;
};
type Progress = {
  habit_id: string;
  date: string;
  actual_value: number;
  event_count: number;
};
type EventRecord = {
  event_id: string;
  revision: number;
  input_value: number;
  occurred_at: string;
  action: string;
  event_kind: string;
};
type Summary = {
  completion_rate: number | null;
  completed: number;
  due: number;
  pending: number;
};
async function requestRpc<T>(
  name: string,
  args: Record<string, unknown>,
  accessToken: string,
): Promise<T> {
  if (!cloud) throw new Error("云端配置不可用");
  const client = cloud;
  const { data, error } = await boundedRequest((signal) =>
    client
      .schema("habit_mobile")
      .rpc(name, args as never)
      .setHeader("Authorization", `Bearer ${accessToken}`)
      .abortSignal(signal),
  );
  if (error) throw error;
  return data as T;
}
export function NumericHabits({ accessToken }: { accessToken: string }) {
  const rpc = useCallback(
    <T,>(name: string, args: Record<string, unknown> = {}) =>
      requestRpc<T>(name, args, accessToken),
    [accessToken],
  );
  const [habits, setHabits] = useState<Habit[]>([]);
  const [progress, setProgress] = useState<Progress[]>([]);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [detailReady, setDetailReady] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("🌱");
  const [mode, setMode] = useState<Mode>("count");
  const [target, setTarget] = useState("5");
  const [entry, setEntry] = useState<Record<string, string>>({});
  const [selection, setSelection] = useState<{
    id: string;
    date: string;
  } | null>(null);
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [periods, setPeriods] = useState<Summary[]>([]);
  const [editId, setEditId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [pageAfter, setPageAfter] = useState<string | null>(null);
  const [timer, setTimer] = useState<{
    id: string;
    start: number;
    ownerId: string;
  } | null>(null);
  const [timerReady, setTimerReady] = useState(false);
  const [clock, setClock] = useState(Date.now());
  const ownerId = timerOwnerId(accessToken);
  const timerKey = ownerId ? activeTimerStorageKey(ownerId) : null;
  const activeTimer = timer?.ownerId === ownerId ? timer : null;
  const alive = useRef(true);
  const generation = useRef(0);
  const locked = useRef(false);
  const selected = useRef(selection);
  selected.current = selection;
  const today = businessDate();
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      generation.current++;
    };
  }, []);
  useEffect(() => {
    setTimerReady(false);
    if (!timerKey || !ownerId) {
      setTimer(null);
      setTimerReady(true);
      return;
    }
    try {
      const saved = parseActiveTimer(window.localStorage.getItem(timerKey));
      setTimer(saved ? { ...saved, ownerId } : null);
      setClock(Date.now());
    } catch {
      setTimer(null);
    } finally {
      setTimerReady(true);
    }
  }, [ownerId, timerKey]);
  useEffect(() => {
    if (!timerReady || !timerKey || !ownerId) return;
    try {
      if (activeTimer) {
        window.localStorage.setItem(
          timerKey,
          JSON.stringify({ id: activeTimer.id, start: activeTimer.start }),
        );
      } else {
        window.localStorage.removeItem(timerKey);
      }
    } catch {
      if (alive.current)
        setNotice("本机无法保存计时状态；请保持页面打开直至保存记录。");
    }
  }, [activeTimer, ownerId, timerKey, timerReady]);
  useEffect(() => {
    if (!activeTimer) return;
    const id = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(id);
  }, [activeTimer]);
  useEffect(() => {
    const syncClock = () => setClock(Date.now());
    window.addEventListener("focus", syncClock);
    document.addEventListener("visibilitychange", syncClock);
    return () => {
      window.removeEventListener("focus", syncClock);
      document.removeEventListener("visibilitychange", syncClock);
    };
  }, []);
  useEffect(() => {
    if (available !== true || !activeTimer) return;
    const habit = habits.find((item) => item.id === activeTimer.id);
    if (!habit || habit.habit_type !== "duration" || habit.archived_on) {
      setTimer(null);
      setNotice("上次计时对应的习惯已不存在或已归档，计时状态已清理。");
    }
  }, [activeTimer, available, habits]);
  const refresh = useCallback(async () => {
    const data = await rpc<{ habits: Habit[]; progress: Progress[] }>(
      "read_snapshot_v3",
      { p_start: shiftDate(today, -364), p_end: today },
    );
    if (!alive.current) return;
    if (!data || !Array.isArray(data.habits) || !Array.isArray(data.progress))
      throw new Error("invalid_snapshot");
    setHabits(
      data.habits.filter(
        (h) => h.habit_type === "count" || h.habit_type === "duration",
      ),
    );
    setProgress(data.progress ?? []);
    setAvailable(true);
  }, [today, rpc]);
  useEffect(() => {
    void refresh().catch((e) => {
      if (alive.current) {
        setAvailable(false);
        setError(numericMessage(e));
      }
    });
  }, [refresh]);
  async function detail(id: string, date: string, append = false) {
    const version = ++generation.current;
    setLoading(true);
    setDetailReady(false);
    if (!append) {
      setEvents([]);
      setPageAfter(null);
      setSummary(null);
      setPeriods([]);
      setEditId(null);
    }
    try {
      const [data, stats, week, month] = await Promise.all([
        rpc<EventRecord[]>("read_events_v3", {
          p_habit_id: id,
          p_date: date,
          p_limit: 100,
          ...(append && pageAfter ? { p_after: pageAfter } : {}),
        }),
        rpc<Summary>("read_summary_v3", {
          p_start: date,
          p_end: date,
          p_habit_id: id,
        }),
        rpc<Summary>("read_summary_v3", {
          p_start: shiftDate(date, -6),
          p_end: date,
          p_habit_id: id,
        }),
        rpc<Summary>("read_summary_v3", {
          p_start: shiftDate(date, -29),
          p_end: date,
          p_habit_id: id,
        }),
      ]);
      if (!alive.current || generation.current !== version) return;
      if (!Array.isArray(data) || !stats || !week || !month)
        throw new Error("invalid_event_response");
      setEvents((old) => (append ? [...old, ...data] : data));
      setPageAfter(data.length === 100 ? data[data.length - 1].event_id : null);
      setSummary(stats);
      setPeriods([week, month]);
      setDetailReady(true);
    } catch (e) {
      if (!alive.current || generation.current !== version) return;
      throw e;
    } finally {
      if (alive.current && generation.current === version) setLoading(false);
    }
  }
  async function reconcile() {
    await refresh();
    const s = selected.current;
    if (s) await detail(s.id, s.date);
  }
  async function submit(task: () => Promise<void>): Promise<boolean> {
    if (locked.current) return false;
    locked.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await task();
      if (!alive.current) return false;
      await reconcile();
      if (alive.current) {
        setUncertain(false);
        setNotice("已记录，云端数据已核对。");
      }
      return true;
    } catch (e) {
      if (!alive.current) return false;
      // Any transport failure may have committed. Never automatically resend +1.
      setUncertain(true);
      setEditId(null);
      let checked = false;
      try {
        await reconcile();
        checked = true;
      } catch {
        /* keep writes blocked */
      }
      if (alive.current)
        setError(
          `${numericMessage(e)}${checked ? " 已重新读取云端；请核对记录，确认后再操作。" : " 核对失败，写入已暂停，请联网重新核对。"}`,
        );
      return false;
    } finally {
      locked.current = false;
      if (alive.current) setBusy(false);
    }
  }
  function choose(id: string, date: string) {
    if (locked.current) return;
    setSelection({ id, date });
    selected.current = { id, date };
    setError("");
    void detail(id, date).catch((e) => {
      if (alive.current) setError(numericMessage(e));
    });
  }
  async function record(h: Habit, value: number) {
    const date = today;
    await submit(async () => {
      await rpc("record_progress_v3", {
        p_operation_id: crypto.randomUUID(),
        p_event_id: crypto.randomUUID(),
        p_habit_id: h.id,
        p_date: date,
        p_action: "record",
        p_value: value,
        p_occurred_at: eventTime(date, today),
        p_expected_revision: 0,
        p_kind: "occurrence",
      });
      if (alive.current) setEntry((v) => ({ ...v, [h.id]: "" }));
    });
  }
  function mutate(
    h: Habit,
    e: EventRecord,
    action: "revise" | "void",
    value: number,
  ) {
    const date = selection!.date;
    void submit(async () => {
      await rpc("record_progress_v3", {
        p_operation_id: crypto.randomUUID(),
        p_event_id: e.event_id,
        p_habit_id: h.id,
        p_date: date,
        p_action: action,
        p_value: value,
        p_occurred_at: e.occurred_at,
        p_expected_revision: e.revision,
        p_kind: "occurrence",
      });
      if (alive.current) setEditId(null);
    });
  }
  const disabled = busy || uncertain || available !== true;
  return (
    <section className="numeric-panel" aria-label="计次和计时习惯">
      <h3>计次／计时习惯 {available === null ? "· 正在检测" : ""}</h3>
      {error && <p role={available === false ? "status" : "alert"}>{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {(uncertain || available === false) && (
        <button
          type="button"
          disabled={busy || loading}
          onClick={() => {
            setBusy(true);
            void reconcile()
              .then(() => {
                if (alive.current) {
                  setUncertain(false);
                  setError("");
                  setNotice("云端数据已重新核对，请确认记录。 ");
                }
              })
              .catch((e) => {
                if (alive.current) setError(numericMessage(e));
              })
              .finally(() => {
                if (alive.current) setBusy(false);
              });
          }}
        >
          重新核对云端记录
        </button>
      )}
      {available && (
        <>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const goal = normalValue(target, mode);
              if (!goal || !name.trim() || disabled) return;
              const id = crypto.randomUUID();
              void submit(async () => {
                await rpc("create_habit_v3", {
                  p_id: id,
                  p_name: name.trim(),
                  p_color: 0,
                  p_emoji: emoji,
                  p_type: mode,
                  p_target: goal,
                  p_unit: mode === "count" ? "repetition" : "minute",
                  p_direction: "at_least",
                });
                if (alive.current) setName("");
              });
            }}
          >
            <h4>创建新习惯</h4>
            <label>
              名称
              <input
                value={name}
                required
                maxLength={30}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label>
              图标
              <select value={emoji} onChange={(e) => setEmoji(e.target.value)}>
                {EMOJI.map((icon) => (
                  <option key={icon}>{icon}</option>
                ))}
              </select>
            </label>
            <label>
              记录类型
              <select
                value={mode}
                onChange={(e) => {
                  const m = e.target.value as Mode;
                  setMode(m);
                  setTarget(m === "count" ? "5" : "30");
                }}
              >
                <option value="count">计次</option>
                <option value="duration">计时（分钟）</option>
              </select>
            </label>
            <label>
              每日目标
              <input
                type="number"
                inputMode="numeric"
                min="1"
                max={mode === "count" ? 1000000 : 1440}
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              />
            </label>
            <button
              disabled={disabled || !name.trim() || !normalValue(target, mode)}
            >
              创建计次／计时习惯
            </button>
          </form>
          {habits.map((h) => {
            const habitProgress = progress.filter((p) => p.habit_id === h.id);
            const p = habitProgress.find((p) => p.date === today);
            const unit = h.habit_type === "duration" ? "分钟" : "次";
            const completed = numericProgressDates(h, habitProgress);
            const streak = streaks(completed, today);
            const week = numericPeriodProgress(
              h,
              completed,
              weekStart(today),
              today,
              today,
            );
            const month = numericPeriodProgress(
              h,
              completed,
              `${today.slice(0, 7)}-01`,
              today,
              today,
            );
            const heatmap = numericHeatmapDays(h, completed, today);
            const trend = numericTrend(h.id, habitProgress, today);
            const s = selection?.id === h.id ? selection : null;
            const visible = events.filter(
              (e) => e.event_kind === "occurrence" && e.action !== "void",
            );
            return (
              <article className="numeric-item" key={h.id}>
                <h4>
                  {h.emoji} {h.name}
                  {h.archived_on ? "（已归档）" : ""}
                </h4>
                <p>
                  {h.goal_direction === "tracking_only"
                    ? "仅记录，不设置达标目标"
                    : h.goal_direction === "at_most"
                      ? `每日最多 ${h.target} ${unit} · ${Number(p?.actual_value ?? 0) > Number(h.target) ? "已超标" : "今天尚未结束，未超过上限"}`
                      : `每日至少 ${h.target} ${unit}`}
                </p>
                <p>
                  今日累计：{p?.actual_value ?? 0} / {h.target ?? "—"} {unit} ·
                  已记录 {p?.event_count ?? 0} 笔
                </p>
                <section
                  className="insights numeric-insights"
                  aria-label={`${h.name}进度与成就`}
                >
                  <h4>进度与成就</h4>
                  <p>
                    本周 {week.completed}/{week.eligible} 天 ·
                    {week.rate === null ? "暂无统计" : `完成率 ${week.rate}%`}
                  </p>
                  <p>
                    本月 {month.completed}/{month.eligible} 天 ·
                    {month.rate === null ? "暂无统计" : `完成率 ${month.rate}%`}
                  </p>
                  <p>
                    当前连续 {streak.current} 天 · 最长连续 {streak.longest} 天
                  </p>
                  <p>
                    近7天趋势：{trend.recentTotal} {unit} · 前7天：
                    {trend.previousTotal} {unit} ·
                    {trend.difference > 0
                      ? `增加 ${trend.difference}`
                      : trend.difference < 0
                        ? `减少 ${Math.abs(trend.difference)}`
                        : "保持不变"}
                  </p>
                  <div className="streak-badges" aria-label="连续记录成就">
                    {[7, 21, 30].map((days) => (
                      <span
                        key={days}
                        className={
                          earnedStreakBadges(streak.longest).includes(days)
                            ? "badge-earned"
                            : "badge-locked"
                        }
                        aria-label={`${days}天徽章${streak.longest >= days ? "已获得" : "未获得"}`}
                      >
                        {streak.longest >= days ? "🏅" : "🔒"} {days}天
                      </span>
                    ))}
                  </div>
                  <h4>过去365天</h4>
                  <div
                    className="year-heatmap"
                    role="img"
                    aria-label={`过去365天共有${heatmap.filter((day) => day.checked).length}天达成记录目标`}
                  >
                    {heatmap.map((day) => (
                      <span
                        key={day.date}
                        className={`heatmap-cell ${
                          !day.eligible
                            ? "heatmap-ineligible"
                            : day.checked
                              ? "heatmap-checked"
                              : "heatmap-empty"
                        }`}
                        title={`${day.date} ${
                          !day.eligible
                            ? "未开始或不可记录"
                            : day.checked
                              ? "已达成记录目标"
                              : "未达成记录目标"
                        }`}
                      />
                    ))}
                  </div>
                </section>
                {!h.archived_on && (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const value = normalValue(
                        entry[h.id] ?? "",
                        h.habit_type,
                      );
                      if (value && !disabled) void record(h, value);
                    }}
                  >
                    <label>
                      新增今日记录（{unit}）
                      <input
                        type="number"
                        inputMode="numeric"
                        min="1"
                        max={h.habit_type === "duration" ? 1440 : 1000000}
                        value={entry[h.id] ?? ""}
                        onChange={(e) =>
                          setEntry((v) => ({ ...v, [h.id]: e.target.value }))
                        }
                      />
                    </label>
                    <button
                      disabled={
                        disabled ||
                        !normalValue(entry[h.id] ?? "", h.habit_type)
                      }
                    >
                      记录一次
                    </button>
                  </form>
                )}
                {h.habit_type === "duration" && !h.archived_on && (
                  <div>
                    <p>
                      计时状态保存在本机，关闭或重新打开页面后可继续；跨越北京时间午夜会自动拆分。
                    </p>
                    {activeTimer?.id === h.id ? (
                      <>
                        <p role="status">
                          已计时{" "}
                          {Math.max(
                            0,
                            Math.floor((clock - activeTimer.start) / 1000),
                          )}{" "}
                          秒
                        </p>
                        <button
                          disabled={disabled || clock - activeTimer.start < 60000}
                          onClick={() => {
                            const segments = splitDurationSession(
                              activeTimer.start,
                              clock,
                            );
                            if (!segments.length) {
                              setError("计时不足一分钟，不会生成记录。");
                              return;
                            }
                            if (
                              segments.some(
                                (segment) =>
                                  !normalValue(
                                    String(segment.minutes),
                                    "duration",
                                  ),
                              )
                            ) {
                              setError("单日计时超过1440分钟上限，无法保存。");
                              return;
                            }
                            void submit(async () => {
                              for (const segment of segments) {
                                await rpc("record_progress_v3", {
                                  p_operation_id: crypto.randomUUID(),
                                  p_event_id: crypto.randomUUID(),
                                  p_habit_id: h.id,
                                  p_date: segment.date,
                                  p_action: "record",
                                  p_value: segment.minutes,
                                  p_occurred_at: segment.occurredAt,
                                  p_expected_revision: 0,
                                  p_kind: "occurrence",
                                });
                              }
                            }).then((saved) => {
                              if (saved && alive.current) setTimer(null);
                            });
                          }}
                        >
                          结束并保存计时
                        </button>
                        <button
                          className="secondary"
                          onClick={() => setTimer(null)}
                        >
                          取消计时
                        </button>
                      </>
                    ) : (
                      <button
                        disabled={disabled || activeTimer !== null}
                        onClick={() => {
                          setClock(Date.now());
                          setTimer(ownerId ? { id: h.id, start: Date.now(), ownerId } : null);
                        }}
                      >
                        开始计时
                      </button>
                    )}
                  </div>
                )}
                <label>
                  查看记录日期
                  <input
                    type="date"
                    min={h.created_date}
                    max={h.archived_on ?? today}
                    disabled={busy}
                    value={s?.date ?? today}
                    onChange={(e) => {
                      if (e.target.value) choose(h.id, e.target.value);
                    }}
                  />
                </label>
                <button
                  className="secondary"
                  disabled={busy || loading}
                  onClick={() => choose(h.id, s?.date ?? today)}
                >
                  查看指定日期记录
                </button>
                {s && (
                  <div aria-busy={loading}>
                    <p>{s.date} · 北京时间</p>
                    {loading ? (
                      <p role="status">正在读取所选日期…</p>
                    ) : !detailReady ? (
                      <p role="status">所选日期尚未成功读取，请重新查询。</p>
                    ) : (
                      <>
                        {summary && (
                          <p>
                            当日完成率：
                            {summary.completion_rate === null
                              ? "暂无可判定目标"
                              : `${summary.completion_rate}%`}{" "}
                            · 待确认 {summary.pending ?? 0}
                          </p>
                        )}
                        {periods.map((p, i) => (
                          <p key={i}>
                            截至所选日期近{i === 0 ? 7 : 30}天：{p.completed}/
                            {p.due} 项日目标 · 完成率{" "}
                            {p.completion_rate === null
                              ? "暂无可判定目标"
                              : `${p.completion_rate}%`}{" "}
                            · 待确认 {p.pending ?? 0}
                          </p>
                        ))}
                        <p>
                          已加载 {visible.length} 笔 · 合计{" "}
                          {visible.reduce((sum, e) => sum + e.input_value, 0)}{" "}
                          {unit}
                          {pageAfter ? "（还有更多）" : ""}
                        </p>
                        <ul className="numeric-events">
                          {!visible.length && <li>所选日期暂无记录</li>}
                          {visible.map((e) => (
                            <li key={e.event_id}>
                              <time>
                                {new Date(e.occurred_at).toLocaleTimeString(
                                  "zh-CN",
                                  {
                                    timeZone: "Asia/Shanghai",
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  },
                                )}
                              </time>{" "}
                              · {e.input_value} {unit}
                              <button
                                className="secondary"
                                disabled={disabled}
                                onClick={() => {
                                  setEditId(e.event_id);
                                  setEditValue(String(e.input_value));
                                }}
                              >
                                修改数值
                              </button>
                              {editId === e.event_id && (
                                <form
                                  onSubmit={(ev) => {
                                    ev.preventDefault();
                                    const value = normalValue(
                                      editValue,
                                      h.habit_type,
                                    );
                                    if (value && !disabled)
                                      mutate(h, e, "revise", value);
                                  }}
                                >
                                  <input
                                    aria-label="修改记录数值"
                                    type="number"
                                    min="1"
                                    max={
                                      h.habit_type === "duration"
                                        ? 1440
                                        : 1000000
                                    }
                                    value={editValue}
                                    onChange={(ev) =>
                                      setEditValue(ev.target.value)
                                    }
                                  />
                                  <button
                                    disabled={
                                      disabled ||
                                      !normalValue(editValue, h.habit_type)
                                    }
                                  >
                                    保存数值
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setEditId(null)}
                                  >
                                    取消
                                  </button>
                                </form>
                              )}
                              <button
                                className="secondary"
                                disabled={disabled}
                                onClick={() => {
                                  if (window.confirm("确认撤销这条记录？"))
                                    mutate(h, e, "void", e.input_value);
                                }}
                              >
                                撤销
                              </button>
                            </li>
                          ))}
                        </ul>
                        {pageAfter && (
                          <button
                            disabled={busy}
                            onClick={() =>
                              void detail(h.id, s.date, true).catch((e) =>
                                setError(numericMessage(e)),
                              )
                            }
                          >
                            加载更多记录
                          </button>
                        )}
                      </>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </>
      )}
    </section>
  );
}
