import { useEffect, useRef, useState } from "react";
import {
  archiveHabit,
  planned,
  canComplete,
  scheduleAt,
  changeSchedule,
  removeCategory,
  reorderHabits,
  setNote,
  completedDates,
  emptySnapshot,
  eligible,
  localDate,
  newId,
  MAX_BACKUP_SIZE,
  monthDates,
  monthlyStats,
  parseSnapshot,
  streaks,
  toggleCompletion,
  type Habit,
  type Snapshot,
  type NormalizedSnapshot,
} from "./domain";
import {
  load,
  save,
  readRaw,
  sourceRaw,
  STORAGE_KEY,
  LEGACY_KEY,
} from "./storage";
import { HabitForm, Modal, MonthPicker } from "./components";

type Mode = "ready" | "damaged" | "unavailable" | "conflict";
function initialState(): {
  data: NormalizedSnapshot;
  raw: string | null;
  mode: Mode;
  error: string;
} {
  let result: { data: NormalizedSnapshot; raw: string | null };
  let raw: string | null = null;
  try {
    raw = readRaw(localStorage);
    result = load(localStorage);
  } catch (e) {
    return {
      data: emptySnapshot(),
      raw,
      mode: raw !== null ? "damaged" : "unavailable",
      error: message(e),
    };
  }
  try {
    const probe = `daily-progress:probe:${newId()}`;
    localStorage.setItem(probe, "1");
    localStorage.removeItem(probe);
    return { ...result, mode: "ready", error: "" };
  } catch (e) {
    return {
      ...result,
      mode: "unavailable",
      error: `${message(e)} 数据仍可查看或导出。`,
    };
  }
}
const message = (e: unknown) =>
  e instanceof Error ? e.message : "浏览器存储不可用。";
function download(text: string, filename: string) {
  const url = URL.createObjectURL(
    new Blob([text], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function route() {
  return location.hash.slice(1) || "today";
}
export default function App() {
  const [state, setState] = useState(initialState);
  const [today, setToday] = useState(localDate);
  const [page, setPage] = useState(route);
  const [month, setMonth] = useState(today.slice(0, 7));
  const [form, setForm] = useState<Habit | "new" | null>(null);
  const [confirmation, setConfirmation] = useState<{
    title: string;
    text: string;
    action: () => void;
  } | null>(null);
  const [imported, setImported] = useState<Snapshot | null>(null);
  const [notice, setNotice] = useState("");
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [noteEditor, setNoteEditor] = useState<{
    habitId: string | null;
    date: string;
    text: string;
  } | null>(null);
  const [categoryEditor, setCategoryEditor] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const data = state.data;
  const writable = state.mode === "ready";
  const active = data.habits
    .filter((h) => !h.archivedDate)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const visible = active.filter(
    (h) => categoryFilter === "all" || (h.categoryId ?? "") === categoryFilter,
  );
  const scheduled = active.filter((h) => planned(h, today, today));
  const editNote = (habitId: string | null, date: string) =>
    setNoteEditor({
      habitId,
      date,
      text:
        data.notes?.find((n) => n.habitId === habitId && n.date === date)
          ?.text ?? "",
    });
  const selectedHabit = page.startsWith("habit/")
    ? data.habits.find((h) => h.id === page.slice(6))
    : undefined;
  const headingRef = useRef<HTMLHeadingElement>(null);
  const navigate = (next: string) => {
    location.hash = next;
  };
  useEffect(() => {
    const tick = () => setToday(localDate());
    const timer = setInterval(tick, 1000);
    const storage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY || e.key === LEGACY_KEY || e.key === null)
        setState((s) => ({
          ...s,
          mode: "conflict",
          error: "其他窗口已修改数据。为避免覆盖，请刷新后继续。",
        }));
    };
    const hash = () => {
      setPage(route());
      setSelectedDate(null);
    };
    window.addEventListener("storage", storage);
    window.addEventListener("hashchange", hash);
    window.addEventListener("focus", tick);
    return () => {
      clearInterval(timer);
      window.removeEventListener("storage", storage);
      window.removeEventListener("hashchange", hash);
      window.removeEventListener("focus", tick);
    };
  }, []);
  useEffect(() => {
    headingRef.current?.focus();
  }, [page]);
  function commit(next: Snapshot, success: string, recovery = false): boolean {
    if (!writable && !(recovery && state.mode === "damaged")) return false;
    try {
      const result = save(localStorage, next, state.raw, localDate());
      setState({ ...result, mode: "ready", error: "" });
      setNotice(success);
      return true;
    } catch (e) {
      const error = message(e);
      setState((s) => ({
        ...s,
        mode: error.includes("其他窗口") ? "conflict" : "unavailable",
        error: `${error} 未保存修改，原数据保留。`,
      }));
      return false;
    }
  }
  function toggle(h: Habit, date: string) {
    try {
      if (
        commit(toggleCompletion(data, h, date, localDate()), "打卡记录已保存。")
      )
        setSelectedDate(null);
    } catch (e) {
      setNotice(message(e));
    }
  }
  const confirm = (title: string, text: string, action: () => void) =>
    setConfirmation({ title, text, action });
  async function readBackup(file?: File) {
    if (!file) return;
    try {
      if (file.size > MAX_BACKUP_SIZE)
        throw new Error("文件超过5 MiB，无法导入。");
      const backup = parseSnapshot(await file.text(), localDate());
      setImported(backup);
      setNotice("");
    } catch (e) {
      setNotice(`导入失败：${message(e)} 原数据未修改。`);
    }
  }
  const done = scheduled.filter((h) =>
    completedDates(data, h.id).has(today),
  ).length;
  const dates = selectedHabit
    ? completedDates(data, selectedHabit.id)
    : new Set<string>();
  const stats = streaks(dates, today);
  const monthDays = monthDates(month);
  const first = new Date(`${month}-01T12:00:00`);
  const offset = (first.getDay() + 6) % 7;
  const pageTitle =
    page === "stats"
      ? "看见每一点积累"
      : page === "settings"
        ? "把数据握在自己手中"
        : selectedHabit
          ? selectedHabit.name
          : "今天，向前一小步";
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a href="#today" className="brand">
          <span className="brand-mark">↗</span>
          <span>
            每日进步<small>小习惯，大改变</small>
          </span>
        </a>
        <nav aria-label="主要导航">
          {[
            ["today", "今天", "◉"],
            ["stats", "统计", "▥"],
            ["settings", "设置", "⚙"],
          ].map(([value, label, icon]) => (
            <a
              key={value}
              href={`#${value}`}
              aria-current={
                page === value || (value === "today" && selectedHabit)
                  ? "page"
                  : undefined
              }
            >
              <span aria-hidden="true">{icon}</span>
              {label}
            </a>
          ))}
        </nav>
        <div className="sidebar-note">
          <span>日积月累</span>
          <p>
            不必一下子走很远，
            <br />
            每天一点就很好。
          </p>
          <small>本地保存 · 无需注册</small>
        </div>
      </aside>
      <main>
        <header className="page-header">
          <div>
            <p className="eyebrow">
              {today.replaceAll("-", " / ")} ·{" "}
              {new Date().toLocaleDateString("zh-CN", { weekday: "long" })}
            </p>
            <h1 tabIndex={-1} ref={headingRef}>
              {pageTitle}
            </h1>
          </div>
          {page === "today" && (
            <button
              className="primary"
              disabled={!writable}
              onClick={() => setForm("new")}
            >
              ＋ 添加习惯
            </button>
          )}
        </header>
        {state.mode !== "ready" && (
          <section className="error banner" role="alert">
            <strong>
              {state.mode === "damaged" ? "数据需要恢复" : "当前为只读模式"}
            </strong>
            <p>{state.error}</p>
            <button onClick={() => location.reload()}>刷新并重试</button>
            {state.raw !== null && (
              <button
                onClick={() =>
                  download(sourceRaw(state.raw)!, "每日进步-原始数据.json")
                }
              >
                导出原始数据
              </button>
            )}
            {state.mode === "damaged" && (
              <button onClick={() => navigate("settings")}>从备份恢复</button>
            )}
          </section>
        )}
        {state.raw?.startsWith("legacy:") && state.mode === "ready" && (
          <section className="notice banner">
            <p>已安全读取 v1。首次保存将写入 v2，原 v1 保留。建议先备份。</p>
            <button
              onClick={() =>
                download(sourceRaw(state.raw)!, "每日进步-升级前-v1.json")
              }
            >
              导出升级前原始数据
            </button>
          </section>
        )}
        {notice && (
          <div role="status" className="notice banner">
            {notice}
            <button aria-label="关闭提示" onClick={() => setNotice("")}>
              ×
            </button>
          </div>
        )}
        {page === "today" && (
          <>
            <section className="daily-summary">
              <div>
                <p className="eyebrow">你的今日进度</p>
                <h2>
                  {active.length ? (
                    <>
                      已完成 <strong>{done}</strong> / {scheduled.length}{" "}
                      个计划习惯
                    </>
                  ) : (
                    "让第一件小事，成为开始"
                  )}
                </h2>
                <p>
                  {active.length &&
                  scheduled.length > 0 &&
                  done === scheduled.length
                    ? "今天的小目标都完成了，给自己一点肯定。"
                    : "认真对待每一小步，进步会慢慢发生。"}
                </p>
                {active.length > 0 && (
                  <progress
                    aria-label="今日整体完成进度"
                    value={done}
                    max={Math.max(1, scheduled.length)}
                  />
                )}
              </div>
              <span className="summary-art" aria-hidden="true">
                ↗
              </span>
            </section>
            <div className="section-heading">
              <h2>
                我的习惯 <span>{active.length}</span>
              </h2>
              <label>
                按分类筛选{" "}
                <select
                  aria-label="按分类筛选"
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                >
                  <option value="all">全部习惯</option>
                  <option value="">未分类</option>
                  {data.categories?.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {!active.length ? (
              <section className="empty">
                <span aria-hidden="true">✦</span>
                <h2>从一个小习惯开始</h2>
                <p>阅读几页书、散步十分钟，或者早一点休息。</p>
                <button
                  className="primary"
                  disabled={!writable}
                  onClick={() => setForm("new")}
                >
                  创建第一个习惯
                </button>
              </section>
            ) : (
              <div className="habit-grid">
                {visible.map((h) => {
                  const completed = completedDates(data, h.id);
                  const checked = completed.has(today);
                  const current = streaks(completed, today).current;
                  return (
                    <article
                      key={h.id}
                      draggable={writable && categoryFilter === "all"}
                      onDragStart={() => setDragId(h.id)}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={() => {
                        if (dragId && categoryFilter === "all")
                          commit(
                            reorderHabits(data, dragId, h.id),
                            "排序已保存。",
                          );
                        setDragId(null);
                      }}
                      className={`habit-card color-${h.color} ${checked ? "is-done" : ""}`}
                    >
                      <div className="card-top">
                        <span className="habit-symbol" aria-hidden="true">
                          {checked ? "✓" : "✦"}
                        </span>
                        <button
                          className="text-button"
                          disabled={!writable}
                          onClick={() => setForm(h)}
                          aria-label={`编辑${h.name}`}
                        >
                          编辑
                        </button>
                      </div>
                      <h3>
                        <a href={`#habit/${h.id}`}>{h.name}</a>
                      </h3>
                      <p>
                        {data.categories?.find((c) => c.id === h.categoryId)
                          ?.name ?? "未分类"}{" "}
                        ·{" "}
                        {scheduleAt(h, today).kind === "weeklyQuota"
                          ? "周次数计划（不计每日完成率）"
                          : planned(h, today, today)
                            ? "今日计划"
                            : "今日未计划"}
                      </p>
                      <p>
                        {checked
                          ? "今天已完成，做得很好"
                          : canComplete(h, today, today)
                            ? "今天还未完成"
                            : "今天未计划"}
                      </p>
                      <div className="actions">
                        <button
                          disabled={!writable}
                          onClick={() => editNote(h.id, today)}
                        >
                          今日备注
                        </button>
                        {categoryFilter === "all" &&
                          [-1, 1].map((delta) => {
                            const i = active.findIndex((x) => x.id === h.id);
                            const target = active[i + delta];
                            return (
                              <button
                                key={delta}
                                aria-label={`${delta < 0 ? "上移" : "下移"}${h.name}`}
                                disabled={!writable || !target}
                                onClick={() =>
                                  commit(
                                    reorderHabits(data, h.id, target.id),
                                    "排序已保存。",
                                  )
                                }
                              >
                                {delta < 0 ? "上移" : "下移"}
                              </button>
                            );
                          })}
                      </div>
                      <div className="streak">
                        <strong>{current}</strong> 天连续{" "}
                        <span>· 累计 {completed.size} 天</span>
                      </div>
                      <button
                        className={
                          checked ? "check-button checked" : "check-button"
                        }
                        disabled={!writable || !canComplete(h, today, today)}
                        onClick={() => toggle(h, today)}
                      >
                        {checked ? "✓ 已完成 · 撤销打卡" : "＋ 今日打卡"}
                      </button>
                    </article>
                  );
                })}
              </div>
            )}
            <section className="panel">
              <h2>当天总体总结</h2>
              <p>
                {data.notes?.find((n) => n.habitId === null && n.date === today)
                  ?.text || "尚未记录"}
              </p>
              <button
                disabled={!writable}
                onClick={() => editNote(null, today)}
              >
                编辑当天总结
              </button>
              <label className="field">
                历史总结日期
                <input
                  type="date"
                  max={today}
                  onChange={(e) => {
                    if (e.target.value) editNote(null, e.target.value);
                  }}
                />
              </label>
            </section>
            <p className="page-footnote">每天的记录，都是你认真生活的证据。</p>
          </>
        )}
        {selectedHabit && (
          <>
            <button
              className="back"
              onClick={() =>
                navigate(selectedHabit.archivedDate ? "settings" : "today")
              }
            >
              ← 返回{selectedHabit.archivedDate ? "设置" : "今天"}
            </button>
            <div className="detail-toolbar">
              <p>
                {selectedHabit.createdDate} 开始 ·{" "}
                {selectedHabit.archivedDate
                  ? `已于 ${selectedHabit.archivedDate} 归档，打卡历史只读，备注可编辑`
                  : "周期按历史计划执行"}
              </p>
              <div className="actions">
                {!selectedHabit.archivedDate && (
                  <>
                    <button
                      disabled={!writable}
                      onClick={() => setForm(selectedHabit)}
                    >
                      编辑习惯
                    </button>
                    <button
                      disabled={!writable}
                      onClick={() =>
                        confirm(
                          "归档这个习惯？",
                          "归档后不再出现在今天，历史只读，第一版不支持恢复。当天打卡记录将被移除，之前的记录保留。",
                          () => {
                            if (
                              commit(
                                archiveHabit(
                                  data,
                                  selectedHabit.id,
                                  localDate(),
                                ),
                                "习惯已归档，历史仍然保留。",
                              )
                            )
                              navigate("settings");
                          },
                        )
                      }
                    >
                      归档
                    </button>
                  </>
                )}
                <button
                  className="danger"
                  disabled={!writable}
                  onClick={() =>
                    confirm(
                      "永久删除习惯？",
                      `「${selectedHabit.name}」及其所有打卡记录将永久删除。建议先到设置导出备份。`,
                      () => {
                        if (
                          commit(
                            {
                              ...data,
                              notes: data.notes?.filter(
                                (n) => n.habitId !== selectedHabit.id,
                              ),
                              habits: data.habits.filter(
                                (h) => h.id !== selectedHabit.id,
                              ),
                              completionRecords: data.completionRecords.filter(
                                (r) => r.habitId !== selectedHabit.id,
                              ),
                            },
                            "习惯已删除。",
                          )
                        )
                          navigate("today");
                      },
                    )
                  }
                >
                  永久删除
                </button>
              </div>
            </div>
            <div className="metrics">
              {!selectedHabit.archivedDate && (
                <div>
                  <span>当前连续</span>
                  <strong>
                    {stats.current}
                    <small>天</small>
                  </strong>
                  <small>
                    {dates.has(today) ? "今天已完成" : "今天尚未完成"}
                  </small>
                </div>
              )}
              <div>
                <span>历史最长连续</span>
                <strong>
                  {stats.longest}
                  <small>天</small>
                </strong>
              </div>
              <div>
                <span>累计完成</span>
                <strong>
                  {dates.size}
                  <small>天</small>
                </strong>
              </div>
            </div>
            <section className="panel">
              <div className="section-heading">
                <h2>打卡日历</h2>
                <MonthPicker
                  month={month}
                  onChange={(value) => {
                    setMonth(value);
                    setSelectedDate(null);
                  }}
                  latest={today.slice(0, 7)}
                />
              </div>
              <p className="muted">
                选择日期确认补记或撤销。未来与创建前日期不可操作。
              </p>
              <div className="calendar">
                {["周一", "周二", "周三", "周四", "周五", "周六", "周日"].map(
                  (day) => (
                    <div key={day} className="weekday">
                      {day}
                    </div>
                  ),
                )}
                {Array.from({ length: offset }, (_, i) => (
                  <div key={`blank-${i}`} />
                ))}
                {monthDays.map((date) => {
                  const ok = canComplete(selectedHabit, date, today);
                  const checked = dates.has(date);
                  return (
                    <button
                      key={date}
                      className={`day ${checked ? "completed" : ""} ${date === today ? "today" : ""}`}
                      disabled={
                        !writable || !ok || !!selectedHabit.archivedDate
                      }
                      aria-label={`${date} ${checked ? "已完成" : ok ? "未完成" : "不可操作"}${date === today ? " 今天" : ""}`}
                      aria-pressed={selectedDate === date}
                      onClick={() => setSelectedDate(date)}
                    >
                      <span>{Number(date.slice(-2))}</span>
                      <small>
                        {checked
                          ? "✓"
                          : date === today
                            ? "今天"
                            : ok
                              ? "·"
                              : "—"}
                      </small>
                    </button>
                  );
                })}
              </div>
              <p className="calendar-legend">
                ✓ 已完成 · 未完成　— 不可操作　边框标记今天
              </p>
              {selectedDate && (
                <div className="date-confirm">
                  <div>
                    <strong>{selectedDate}</strong>
                    <p>
                      {dates.has(selectedDate)
                        ? "这一天已完成，是否撤销？"
                        : "这一天未完成，是否补记？"}
                    </p>
                  </div>
                  <button
                    className="primary"
                    disabled={!writable || !!selectedHabit.archivedDate}
                    onClick={() => toggle(selectedHabit, selectedDate)}
                  >
                    {dates.has(selectedDate) ? "确认撤销" : "确认补记"}
                  </button>
                  <button onClick={() => setSelectedDate(null)}>取消</button>
                </div>
              )}
            </section>
            <section className="panel">
              <h2>习惯每日备注</h2>
              <label className="field">
                备注日期
                <input
                  type="date"
                  min={selectedHabit.createdDate}
                  max={selectedHabit.archivedDate ?? today}
                  defaultValue={today}
                  onChange={(e) => {
                    if (e.target.value)
                      editNote(selectedHabit.id, e.target.value);
                  }}
                />
              </label>
              <button
                disabled={!writable || !!selectedHabit.archivedDate}
                onClick={() => editNote(selectedHabit.id, today)}
              >
                编辑今日备注
              </button>
              {data.notes
                ?.filter((n) => n.habitId === selectedHabit.id)
                .sort((a, b) => b.date.localeCompare(a.date))
                .map((n) => (
                  <div key={n.id}>
                    <strong>{n.date}</strong>
                    <p className="note-text">{n.text}</p>
                    <button
                      disabled={!writable}
                      onClick={() => editNote(n.habitId, n.date)}
                    >
                      编辑 {n.date} 备注
                    </button>
                  </div>
                ))}
            </section>
          </>
        )}
        {page === "stats" && (
          <>
            <div className="section-heading">
              <h2>月度完成情况</h2>
              <MonthPicker
                month={month}
                onChange={setMonth}
                latest={today.slice(0, 7)}
              />
            </div>
            <p className="muted">
              完成率仅统计历史计划中的每天/指定星期有效日；每周 N
              次不计每日分母（周期达标统计将在阶段 2
              提供）。归档当天起不计入。连续天数表示实际连续打卡日，不是连续达标周。
            </p>
            {!data.habits.length && (
              <section className="empty">
                <h2>记录第一步，再看看进步</h2>
                <p>添加习惯并打卡后，这里会展示你的积累。</p>
                <button onClick={() => navigate("today")}>去今天</button>
              </section>
            )}
            <div className="habit-grid">
              {data.habits.map((h) => {
                const dates = completedDates(data, h.id);
                const result = monthlyStats(h, dates, month, today);
                const series = streaks(dates, today);
                return (
                  <article key={h.id} className={`panel color-${h.color}`}>
                    <h3>
                      <a href={`#habit/${h.id}`}>{h.name}</a>
                      {h.archivedDate && <small> · 已归档</small>}
                    </h3>
                    <p className="stat-rate">
                      {result.rate === null ? "暂无数据" : `${result.rate}%`}
                    </p>
                    <p>
                      {result.completed} / {result.total} 个有效日完成
                    </p>
                    {result.total > 0 && (
                      <progress
                        value={result.completed}
                        max={result.total}
                        aria-label={`${h.name}月完成率`}
                      />
                    )}
                    <div className="stat-footer">
                      {!h.archivedDate && (
                        <span>当前连续 {series.current} 天</span>
                      )}
                      <span>历史最长 {series.longest} 天</span>
                    </div>
                  </article>
                );
              })}
            </div>
          </>
        )}
        {page === "settings" && (
          <>
            <section className="panel">
              <p className="eyebrow">本地优先 · 私密记录</p>
              <h2>你的数据，只在这个浏览器</h2>
              <p>
                清除站点数据、更换浏览器或设备可能导致记录不可用。请定期导出备份；导入可手动迁移记录。
              </p>
              <div className="actions">
                <button
                  className="primary"
                  disabled={state.mode === "damaged"}
                  onClick={() =>
                    download(
                      JSON.stringify(data, null, 2),
                      `每日进步-${today}.json`,
                    )
                  }
                >
                  导出 JSON 备份
                </button>
                <button
                  disabled={!writable && state.mode !== "damaged"}
                  onClick={() => fileInput.current?.click()}
                >
                  导入备份
                </button>
                <input
                  ref={fileInput}
                  hidden
                  type="file"
                  accept=".json,application/json"
                  aria-label="选择JSON备份"
                  onChange={(e) => {
                    void readBackup(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
              </div>
              <p className="muted">
                支持本应用v1/v2格式，最大5 MiB。导入将整体替换，不会合并。
              </p>
            </section>
            <section className="panel">
              <h2>已归档的习惯</h2>
              <p className="muted">
                归档保留历史；第一版不支持恢复为活跃习惯。
              </p>
              {data.habits
                .filter((h) => h.archivedDate)
                .map((h) => (
                  <a className="archive-row" key={h.id} href={`#habit/${h.id}`}>
                    <span>{h.name}</span>
                    <span>{h.archivedDate}　→</span>
                  </a>
                ))}
              {!data.habits.some((h) => h.archivedDate) && (
                <p>还没有归档的习惯。</p>
              )}
            </section>
            <section className="panel">
              <h2>习惯分类</h2>
              {data.categories?.map((c) => (
                <div className="actions" key={c.id}>
                  <span>{c.name}</span>
                  {!c.preset && (
                    <>
                      <button
                        disabled={!writable}
                        onClick={() =>
                          setCategoryEditor({ id: c.id, name: c.name })
                        }
                      >
                        重命名{c.name}
                      </button>
                      <button
                        disabled={!writable}
                        onClick={() =>
                          confirm(
                            "删除分类？",
                            "关联习惯保留并变为未分类。",
                            () =>
                              commit(
                                removeCategory(data, c.id),
                                "分类已删除，习惯保留。",
                              ),
                          )
                        }
                      >
                        删除分类{c.name}
                      </button>
                    </>
                  )}
                </div>
              ))}
              <button
                disabled={!writable}
                onClick={() => setCategoryEditor({ id: newId(), name: "" })}
              >
                创建分类
              </button>
            </section>
            <section className="panel danger-zone">
              <h2>清空全部数据</h2>
              <p>删除全部习惯和记录，无法撤销。请先导出备份。</p>
              <button
                className="danger"
                disabled={!writable}
                onClick={() =>
                  confirm(
                    "清空全部数据？",
                    "全部习惯和记录将永久删除。请先取消并导出JSON备份，再继续操作。",
                    () => commit(emptySnapshot(), "全部数据已清空。"),
                  )
                }
              >
                清空全部数据
              </button>
            </section>
            <p className="page-footnote">
              每日进步 v2 阶段1 · 无账户，无云同步，无追踪
            </p>
          </>
        )}
        {!["today", "stats", "settings"].includes(page) && !selectedHabit && (
          <section className="empty">
            <h2>这个页面或习惯不存在</h2>
            <button onClick={() => navigate("today")}>返回今天</button>
          </section>
        )}
        {form && (
          <HabitForm
            habit={form === "new" ? undefined : form}
            names={data.habits
              .filter((h) => form === "new" || h.id !== form.id)
              .map((h) => h.name)}
            onClose={() => setForm(null)}
            categories={data.categories ?? []}
            onSave={(name, color, categoryId, schedule) => {
              const next =
                form === "new"
                  ? {
                      ...data,
                      habits: [
                        ...data.habits,
                        {
                          id: newId(),
                          name,
                          color,
                          createdDate: localDate(),
                          createdAt: Date.now(),
                          categoryId,
                          order:
                            Math.max(
                              -1,
                              ...data.habits.map((h) => h.order ?? 0),
                            ) + 1,
                          scheduleHistory: [
                            {
                              id: newId(),
                              effectiveDate: localDate(),
                              schedule,
                            },
                          ],
                        },
                      ],
                    }
                  : {
                      ...data,
                      habits: data.habits.map((h) =>
                        h.id === form.id
                          ? {
                              ...changeSchedule(h, schedule, localDate()),
                              name,
                              color,
                              categoryId,
                            }
                          : h,
                      ),
                    };
              if (commit(next, "习惯已保存。")) setForm(null);
            }}
          />
        )}
        {categoryEditor && (
          <Modal title="编辑分类" onClose={() => setCategoryEditor(null)}>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const name = categoryEditor.name.trim();
                if (!name || [...name].length > 30) {
                  setNotice("分类名称需1～30个字。");
                  return;
                }
                const categories = data.categories ?? [];
                if (
                  commit(
                    {
                      ...data,
                      categories: categories.some(
                        (c) => c.id === categoryEditor.id,
                      )
                        ? categories.map((c) =>
                            c.id === categoryEditor.id ? { ...c, name } : c,
                          )
                        : [
                            ...categories,
                            { id: categoryEditor.id, name, preset: false },
                          ],
                    },
                    "分类已保存。",
                  )
                )
                  setCategoryEditor(null);
              }}
            >
              <label className="field">
                分类名称
                <input
                  data-initial-focus
                  value={categoryEditor.name}
                  onChange={(e) =>
                    setCategoryEditor({
                      ...categoryEditor,
                      name: e.target.value,
                    })
                  }
                />
              </label>
              <button disabled={!writable} type="submit">
                保存分类
              </button>
            </form>
          </Modal>
        )}
        {noteEditor && (
          <Modal
            title="编辑每日备注"
            onClose={() => {
              if (!noteEditor.text || window.confirm("放弃未保存的备注？"))
                setNoteEditor(null);
            }}
          >
            <form
              onSubmit={(e) => {
                e.preventDefault();
                try {
                  if (
                    commit(
                      setNote(
                        data,
                        noteEditor.habitId,
                        noteEditor.date,
                        noteEditor.text,
                        today,
                      ),
                      "备注已保存。",
                    )
                  )
                    setNoteEditor(null);
                } catch (e) {
                  setNotice(message(e));
                }
              }}
            >
              <p>
                {noteEditor.date} ·{" "}
                {noteEditor.habitId === null ? "当天总结" : "习惯备注"}
              </p>
              <label className="field">
                备注内容
                <textarea
                  data-initial-focus
                  maxLength={2000}
                  value={noteEditor.text}
                  onChange={(e) =>
                    setNoteEditor({ ...noteEditor, text: e.target.value })
                  }
                />
              </label>
              <button disabled={!writable} type="submit">
                保存备注
              </button>
            </form>
          </Modal>
        )}
        {confirmation && (
          <Modal
            title={confirmation.title}
            onClose={() => setConfirmation(null)}
          >
            <p>{confirmation.text}</p>
            <div className="actions">
              <button onClick={() => setConfirmation(null)}>取消</button>
              <button
                className="danger"
                disabled={!writable}
                onClick={() => {
                  confirmation.action();
                  setConfirmation(null);
                }}
              >
                确认
              </button>
            </div>
          </Modal>
        )}
        {imported && (
          <Modal title="确认替换数据？" onClose={() => setImported(null)}>
            <p>
              备份包含 <strong>{imported.habits.length}</strong> 个习惯、
              <strong>{imported.completionRecords.length}</strong>{" "}
              条记录，将替换当前全部数据。建议先导出当前数据。
            </p>
            <div className="actions">
              <button
                onClick={() =>
                  download(
                    sourceRaw(state.raw) ?? JSON.stringify(data, null, 2),
                    `每日进步-替换前-${today}.json`,
                  )
                }
              >
                先导出当前数据
              </button>
              <button onClick={() => setImported(null)}>取消</button>
              <button
                className="primary"
                disabled={!writable && state.mode !== "damaged"}
                onClick={() => {
                  if (commit(imported, "备份已恢复。", true)) {
                    setImported(null);
                    setSelectedDate(null);
                    navigate("settings");
                  }
                }}
              >
                确认替换并导入
              </button>
            </div>
          </Modal>
        )}
      </main>
    </div>
  );
}
