import { useCallback, useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import {
  authRedirect,
  cloud,
  message,
  readSnapshot,
  writeCloud,
} from "./cloud";
import {
  businessDate,
  COLORS,
  completedDates,
  eligible,
  monthDates,
  statistics,
  streaks,
  type Snapshot,
} from "./domain";

type Form = { id: string; name: string; color: number; creating: boolean };
export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [fresh, setFresh] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"login" | "signup" | "reset">("login");
  const [recovery, setRecovery] = useState(false);
  const [form, setForm] = useState<Form | null>(null);
  const [page, setPage] = useState<"today" | "history" | "account">("today");
  const [selectedId, setSelectedId] = useState("");
  const [month, setMonth] = useState(businessDate().slice(0, 7));
  const account = useRef<string | null>(null);
  const running = useRef(false);
  const readGeneration = useRef(0);
  const accountEpoch = useRef(0);

  useEffect(() => {
    if (!cloud) return;
    let alive = true;
    let authEvents = 0;
    const accept = (next: Session | null) => {
      if (!alive) return;
      if (account.current !== (next?.user.id ?? null)) {
        account.current = next?.user.id ?? null;
        accountEpoch.current++;
        readGeneration.current++;
        setSnapshot(null);
        setFresh(false);
        setForm(null);
        setSelectedId("");
        setPage("today");
        setError("");
        setNotice("");
        setBusy(false);
        running.current = false;
      }
      setSession(next);
      setAuthReady(true);
    };
    const {
      data: { subscription },
    } = cloud.auth.onAuthStateChange((event, next) => {
      authEvents++;
      if (event === "PASSWORD_RECOVERY") setRecovery(true);
      if (event === "SIGNED_OUT") setRecovery(false);
      accept(next);
    });
    const generation = authEvents;
    void cloud.auth
      .getSession()
      .then(({ data, error: authError }) => {
        if (!alive || authEvents !== generation) return;
        accept(data.session);
        if (authError) setError(message(authError));
      })
      .catch((e: unknown) => {
        if (alive) {
          setAuthReady(true);
          setError(message(e));
        }
      });
    return () => {
      alive = false;
      subscription.unsubscribe();
    };
  }, []);

  const refresh = useCallback(async () => {
    const uid = account.current;
    if (!uid) return false;
    const generation = ++readGeneration.current;
    setLoading(true);
    setFresh(false);
    try {
      const data = await readSnapshot();
      if (account.current !== uid || generation !== readGeneration.current)
        return false;
      setSnapshot(data);
      setFresh(true);
      setError("");
      return true;
    } catch (e) {
      if (account.current === uid && generation === readGeneration.current)
        setError(`读取失败：${message(e)}`);
      return false;
    } finally {
      if (account.current === uid && generation === readGeneration.current)
        setLoading(false);
    }
  }, []);
  const uid = session?.user.id;
  useEffect(() => {
    if (uid) void refresh();
  }, [uid, refresh]);
  useEffect(() => {
    if (!uid) return;
    const reload = () => {
      if (document.visibilityState === "visible" && !running.current)
        void refresh();
    };
    document.addEventListener("visibilitychange", reload);
    window.addEventListener("online", reload);
    const timer = window.setInterval(() => {
      if (snapshot && snapshot.today !== businessDate() && !running.current)
        void refresh();
    }, 30000);
    return () => {
      document.removeEventListener("visibilitychange", reload);
      window.removeEventListener("online", reload);
      window.clearInterval(timer);
    };
  }, [uid, snapshot, refresh]);

  async function mutate(
    rpc: string,
    args: Record<string, string | number | boolean>,
  ) {
    if (running.current || !fresh || !account.current) return false;
    const owner = account.current;
    const epoch = accountEpoch.current;
    running.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    let committed = false;
    try {
      await writeCloud(rpc, args);
      committed = true;
      if (account.current !== owner || accountEpoch.current !== epoch)
        return false;
      const read = await refresh();
      if (account.current !== owner || accountEpoch.current !== epoch)
        return false;
      if (read) setNotice("已保存到云端。");
      else setError("已保存到云端，但读取最新数据失败。请刷新后继续。");
      return true;
    } catch (e) {
      if (account.current === owner && accountEpoch.current === epoch) {
        setFresh(false);
        setError(
          `${message(e)} 保存结果可能尚未确认，请先刷新核对；输入仍保留。`,
        );
      }
      return committed;
    } finally {
      if (account.current === owner && accountEpoch.current === epoch) {
        running.current = false;
        setBusy(false);
      }
    }
  }
  async function submitAuth() {
    if (!cloud || running.current) return;
    running.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (recovery) {
        const { error: e } = await cloud.auth.updateUser({ password });
        if (e) throw e;
        setRecovery(false);
        setNotice("密码已更新。");
      } else if (mode === "reset") {
        const { error: e } = await cloud.auth.resetPasswordForEmail(email, {
          redirectTo: authRedirect(),
        });
        if (e) throw e;
        setNotice("如果该邮箱已注册，将收到密码重置邮件。");
      } else if (mode === "signup") {
        const { data, error: e } = await cloud.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: authRedirect() },
        });
        if (e) throw e;
        if (!data.session) setNotice("请打开邮箱验证邮件，再回来登录。");
      } else {
        const { error: e } = await cloud.auth.signInWithPassword({
          email,
          password,
        });
        if (e) throw e;
      }
      setPassword("");
    } catch (e) {
      setError(message(e));
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  async function logout() {
    if (!cloud || running.current) return;
    running.current = true;
    setBusy(true);
    // Clear data immediately; a failed logout still cannot expose previous data.
    account.current = null;
    accountEpoch.current++;
    readGeneration.current++;
    setSnapshot(null);
    setFresh(false);
    setForm(null);
    const { error: e } = await cloud.auth.signOut({ scope: "local" });
    running.current = false;
    setBusy(false);
    if (e) {
      account.current = session?.user.id ?? null;
      setError(`退出未完成：${message(e)}`);
    }
  }

  if (!cloud)
    return (
      <main className="app">
        <h1>每日进步</h1>
        <p role="status">尚未配置 Supabase 云端服务。</p>
        <p>请按项目说明配置公开的项目 URL 和 publishable key 后重新构建。</p>
      </main>
    );
  if (!authReady)
    return (
      <main className="app">
        <p role="status">正在检查登录状态…</p>
      </main>
    );
  if (!session || recovery)
    return (
      <main className="app auth">
        <h1>每日进步</h1>
        <p>登录后，习惯和打卡记录保存在云端。</p>
        <h2>
          {recovery
            ? "设置新密码"
            : mode === "signup"
              ? "注册账号"
              : mode === "reset"
                ? "找回密码"
                : "登录"}
        </h2>
        {error && <p role="alert">{error}</p>}
        {notice && <p role="status">{notice}</p>}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submitAuth();
          }}
        >
          {!recovery && (
            <label>
              邮箱
              <input
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
          )}
          {(recovery || mode !== "reset") && (
            <label>
              密码
              <input
                type="password"
                minLength={8}
                autoComplete={
                  recovery || mode === "signup"
                    ? "new-password"
                    : "current-password"
                }
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
          )}
          <button disabled={busy}>
            {busy
              ? "处理中…"
              : recovery
                ? "更新密码"
                : mode === "signup"
                  ? "注册"
                  : mode === "reset"
                    ? "发送重置邮件"
                    : "登录"}
          </button>
        </form>
        {!recovery && (
          <div className="row">
            <button
              className="secondary"
              disabled={busy}
              onClick={() => {
                setMode(mode === "signup" ? "login" : "signup");
                setError("");
                setNotice("");
              }}
            >
              {mode === "signup" ? "返回登录" : "注册账号"}
            </button>
            <button
              className="secondary"
              disabled={busy}
              onClick={() => {
                setMode(mode === "reset" ? "login" : "reset");
                setError("");
                setNotice("");
              }}
            >
              {mode === "reset" ? "返回登录" : "忘记密码"}
            </button>
          </div>
        )}
      </main>
    );

  const active = snapshot?.habits.filter((h) => !h.archived_on) ?? [];
  const selected =
    snapshot?.habits.find((h) => h.id === selectedId) ?? snapshot?.habits[0];
  const dates =
    snapshot && selected
      ? completedDates(snapshot, selected.id)
      : new Set<string>();
  const today = snapshot?.today ?? businessDate();
  const stats = selected ? statistics(selected, dates, today, month) : null;
  const streak = streaks(dates, selected?.archived_on ?? today);
  const disabled = busy || loading || !fresh;
  const done = snapshot
    ? active.filter((h) => completedDates(snapshot, h.id).has(today)).length
    : 0;
  return (
    <div className="shell">
      <header>
        <h1>每日进步</h1>
        <button
          className="secondary"
          disabled={busy || loading}
          onClick={() => {
            setNotice("");
            void refresh();
          }}
        >
          刷新
        </button>
      </header>
      <main className="app">
        {error && <p role="alert">{error}</p>}
        {notice && <p role="status">{notice}</p>}
        {loading && <p role="status">正在读取云端数据…</p>}
        {page === "account" ? (
          <section>
            <h2>账号</h2>
            <p className="email">{session.user.email}</p>
            <p>
              习惯和打卡记录保存在 Supabase。更换手机后登录同一账号即可恢复。
            </p>
            <p>每天按北京时间计算。断网时无法保存。</p>
            <button disabled={busy} onClick={() => void logout()}>
              退出登录
            </button>
          </section>
        ) : !snapshot ? (
          <p>尚未读取到数据，请点击刷新重试。</p>
        ) : page === "today" ? (
          <section>
            <h2>
              今天 <small>{today}</small>
            </h2>
            <p>
              {active.length
                ? `已完成 ${done}/${active.length} · ${Math.round((done / active.length) * 100)}%`
                : "今天还没有进行中的习惯。"}
            </p>
            <button
              disabled={disabled}
              onClick={() =>
                setForm({
                  id: crypto.randomUUID(),
                  name: "",
                  color: 0,
                  creating: true,
                })
              }
            >
              创建习惯
            </button>
            <div className="habits">
              {active.map((h) => {
                const checked = completedDates(snapshot, h.id).has(today);
                const current = streaks(
                  completedDates(snapshot, h.id),
                  today,
                ).current;
                return (
                  <article key={h.id} className={`card color-${h.color}`}>
                    <div>
                      <h3>{h.name}</h3>
                      <p>连续 {current} 天</p>
                    </div>
                    <button
                      aria-pressed={checked}
                      disabled={disabled}
                      onClick={() =>
                        void mutate("set_checkin", {
                          p_habit_id: h.id,
                          p_date: today,
                          p_completed: !checked,
                        })
                      }
                    >
                      {checked ? "取消打卡" : "打卡"}
                    </button>
                    <button
                      className="secondary"
                      onClick={() => {
                        setSelectedId(h.id);
                        setPage("history");
                      }}
                    >
                      查看历史
                    </button>
                    <button
                      className="secondary"
                      disabled={disabled}
                      onClick={() =>
                        setForm({
                          id: h.id,
                          name: h.name,
                          color: h.color,
                          creating: false,
                        })
                      }
                    >
                      编辑
                    </button>
                  </article>
                );
              })}
            </div>
            {snapshot.habits.some((h) => h.archived_on) && (
              <details>
                <summary>已归档习惯</summary>
                {snapshot.habits
                  .filter((h) => h.archived_on)
                  .map((h) => (
                    <button
                      key={h.id}
                      className="secondary archived"
                      onClick={() => {
                        setSelectedId(h.id);
                        setPage("history");
                      }}
                    >
                      {h.name} · 查看历史
                    </button>
                  ))}
              </details>
            )}
          </section>
        ) : (
          <section>
            <h2>历史日历</h2>
            {!snapshot.habits.length ? (
              <p>创建习惯后即可查看历史。</p>
            ) : (
              <>
                <label>
                  习惯
                  <select
                    value={selected?.id ?? ""}
                    onChange={(e) => setSelectedId(e.target.value)}
                  >
                    {snapshot.habits.map((h) => (
                      <option key={h.id} value={h.id}>
                        {h.name}
                        {h.archived_on ? "（已归档）" : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  月份
                  <input
                    type="month"
                    value={month}
                    onChange={(e) => setMonth(e.target.value)}
                  />
                </label>
                <p>
                  本月 {stats?.completed}/{stats?.total} 天 · 完成率{" "}
                  {stats?.rate === null ? "暂无统计" : `${stats?.rate}%`}
                </p>
                <p>
                  {selected?.archived_on ? "归档时连续" : "当前连续"}{" "}
                  {streak.current} 天 · 最长连续 {streak.longest} 天
                </p>
                {selected?.archived_on && (
                  <p>已于 {selected.archived_on} 归档，历史记录只读。</p>
                )}
                <div className="calendar" aria-label="打卡日历">
                  {["一", "二", "三", "四", "五", "六", "日"].map((d) => (
                    <span key={d} className="weekday">
                      {d}
                    </span>
                  ))}
                  {Array.from(
                    {
                      length:
                        (new Date(`${month}-01T00:00:00Z`).getUTCDay() + 6) % 7,
                    },
                    (_, i) => (
                      <span key={`blank-${i}`} />
                    ),
                  )}
                  {monthDates(month).map((day) => {
                    const checked = dates.has(day);
                    const allowed =
                      !!selected && eligible(selected, day, today);
                    return (
                      <button
                        key={day}
                        className={checked ? "checked" : ""}
                        aria-label={`${day}${checked ? " 已打卡" : " 未打卡"}`}
                        aria-pressed={checked}
                        disabled={
                          disabled || !allowed || !!selected?.archived_on
                        }
                        onClick={() =>
                          selected &&
                          void mutate("set_checkin", {
                            p_habit_id: selected.id,
                            p_date: day,
                            p_completed: !checked,
                          })
                        }
                      >
                        {Number(day.slice(-2))}
                      </button>
                    );
                  })}
                </div>
                <p>点击可用日期打卡或取消。未来和创建前日期不可操作。</p>
                {selected && !selected.archived_on && (
                  <button
                    className="secondary"
                    disabled={disabled}
                    onClick={() => {
                      if (
                        window.confirm(
                          "归档后不能再修改打卡，已有记录会保留。确定归档？",
                        )
                      )
                        void mutate("archive_habit", { p_id: selected.id });
                    }}
                  >
                    归档习惯
                  </button>
                )}
              </>
            )}
          </section>
        )}
        {form && (
          <section className="editor" aria-label="习惯编辑">
            <h2>{form.creating ? "创建习惯" : "编辑习惯"}</h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const submitted = form;
                void mutate(
                  submitted.creating ? "create_habit" : "edit_habit",
                  {
                    p_id: submitted.id,
                    p_name: submitted.name.trim(),
                    p_color: submitted.color,
                  },
                ).then((ok) => {
                  if (ok && account.current) setForm(null);
                });
              }}
            >
              <label>
                名称
                <input
                  autoFocus
                  required
                  maxLength={30}
                  value={form.name}
                  disabled={busy}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </label>
              <label>
                颜色
                <select
                  value={form.color}
                  disabled={busy}
                  onChange={(e) =>
                    setForm({ ...form, color: Number(e.target.value) })
                  }
                >
                  {COLORS.map((c, i) => (
                    <option key={c} value={i}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
              <div className="row">
                <button disabled={disabled || !form.name.trim()}>
                  保存习惯
                </button>
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() => setForm(null)}
                >
                  取消
                </button>
              </div>
            </form>
          </section>
        )}
      </main>
      <nav aria-label="主导航">
        {(
          [
            ["today", "今天"],
            ["history", "历史"],
            ["account", "账号"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            aria-current={page === key ? "page" : undefined}
            onClick={() => setPage(key)}
          >
            {label}
          </button>
        ))}
      </nav>
    </div>
  );
}
