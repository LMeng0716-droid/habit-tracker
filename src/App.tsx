import { CelebrationFeedback, StarParticles } from "./CelebrationFeedback";
import { useCelebrations } from "./useCelebrations";
import { celebrationFor } from "./celebrations";
import { PREVIEW_BASE } from "./preview";
import { useCallback, useEffect, useRef, useState } from "react";
import { Startup } from "./Startup";
import {
  applyCheckin,
  optimisticSnapshot,
  type CheckinOperations,
} from "./checkins";
import { REQUEST_TIMEOUT } from "./request";
import { EMOJI_CHOICES, moveHabit } from "./habit-prefs";
import { policyKey, readTimes, sessionExpired } from "./session-policy";
import { PASSWORD_POLICY, passwordRules, passwordValid } from "./password";
import { InstallHelp } from "./InstallHelp";
import type { Session } from "@supabase/supabase-js";
import {
  authRedirect,
  projectUrl,
  cloud,
  configIssues,
  message,
  readSnapshot,
  writeCloud,
} from "./cloud";
import {
  businessDate,
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
  const [confirmedSnapshot, setConfirmedSnapshot] = useState<Snapshot | null>(
    null,
  );
  const confirmed = useRef<Snapshot | null>(null);
  const setSnapshot = useCallback((value: Snapshot | null) => {
    confirmed.current = value;
    setConfirmedSnapshot(value);
  }, []);
  const [operations, setOperations] = useState<CheckinOperations>({});
  const operationsRef = useRef<CheckinOperations>({});
  const snapshot = optimisticSnapshot(confirmedSnapshot, operations);
  const writeRevision = useRef(0);
  const operationSequence = useRef(0);
  const writeControllers = useRef(new Map<string, AbortController>());
  const readFlight = useRef<{
    key: string;
    promise: Promise<boolean>;
    controller: AbortController;
  } | null>(null);
  const {
    celebrating,
    feedback,
    play: playCelebration,
    clearHabit: clearCelebration,
    reset: resetCelebrations,
  } = useCelebrations();
  const [authInitError, setAuthInitError] = useState("");
  const updateOperations = useCallback((value: CheckinOperations) => {
    operationsRef.current = value;
    setOperations(value);
  }, []);
  const resetCheckins = useCallback(() => {
    writeRevision.current++;
    for (const controller of writeControllers.current.values())
      controller.abort();
    writeControllers.current.clear();
    readFlight.current?.controller.abort();
    readFlight.current = null;
    updateOperations({});
    resetCelebrations();
  }, [updateOperations, resetCelebrations]);
  useEffect(
    () => () => {
      for (const controller of writeControllers.current.values())
        controller.abort();
      readFlight.current?.controller.abort();
    },
    [],
  );
  const [fresh, setFresh] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [email, setEmail] = useState("");
  const interactiveLogin = useRef(false);
  const expirationRunning = useRef(false);
  const [showPassword, setShowPassword] = useState(false);
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"login" | "signup" | "reset">("login");
  const [recovery, setRecovery] = useState(false);
  const [form, setForm] = useState<Form | null>(null);
  const draggingHabit = useRef<string | null>(null);
  const touchHabit = useRef<string | null>(null);
  const [page, setPage] = useState<"today" | "history" | "account">("today");
  const [managing, setManaging] = useState(false);
  const [emojiDraft, setEmojiDraft] = useState("");
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
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
    const authTimer = window.setTimeout(() => {
      if (alive) setAuthInitError("暂时无法恢复登录，请检查网络后重试。");
    }, REQUEST_TIMEOUT);
    const accept = (next: Session | null, interactive = false) => {
      if (!alive) return;
      clearTimeout(authTimer);
      setAuthInitError("");
      if (next) {
        const key = policyKey(
          import.meta.env.BASE_URL,
          projectUrl,
          next.user.id,
        );
        const now = Date.now();
        try {
          if (interactive) {
            localStorage.setItem(
              key,
              JSON.stringify({ loginAt: now, lastActiveAt: now, seenAt: now }),
            );
            expirationRunning.current = false;
          } else if (sessionExpired(readTimes(localStorage, key), now)) {
            next = null;
            if (!expirationRunning.current) {
              expirationRunning.current = true;
              // Never await another Auth method inside its state-change callback.
              window.setTimeout(() => {
                if (alive && expirationRunning.current)
                  void cloud?.auth.signOut({ scope: "local" });
              }, 0);
            }
          }
        } catch {
          next = null;
          setError("无法保存登录状态，请允许本站存储后重新登录。");
        }
      }

      if (!alive) return;
      if (account.current !== (next?.user.id ?? null)) {
        resetCheckins();
        account.current = next?.user.id ?? null;
        accountEpoch.current++;
        readGeneration.current++;
        setSnapshot(null);
        setFresh(false);
        setForm(null);
        setManaging(false);
        setSelectedId("");
        setPage("today");
        setError("");
        setNotice("");
        setBusy(false);
        running.current = false;
      }
      if (expirationRunning.current)
        setNotice("为了保护你的账号安全，请重新登录。");
      setSession(next);
      setAuthReady(true);
    };
    const {
      data: { subscription },
    } = cloud.auth.onAuthStateChange((event, next) => {
      authEvents++;
      if (event === "PASSWORD_RECOVERY") setRecovery(true);
      if (event === "SIGNED_OUT") setRecovery(false);
      accept(
        next,
        event === "PASSWORD_RECOVERY" ||
          (event === "SIGNED_IN" && interactiveLogin.current),
      );
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
          clearTimeout(authTimer);
          setAuthInitError(message(e));
        }
      });
    return () => {
      alive = false;
      clearTimeout(authTimer);
      subscription.unsubscribe();
    };
  }, [resetCheckins, setSnapshot]);

  const ensureSession = useCallback(
    (activity = false) => {
      const owner = account.current;
      if (!owner) return false;
      const key = policyKey(import.meta.env.BASE_URL, projectUrl, owner);
      const now = Date.now();
      try {
        const value = readTimes(localStorage, key);
        if (!sessionExpired(value, now) && value) {
          localStorage.setItem(
            key,
            JSON.stringify({
              ...value,
              seenAt: Math.max(value.seenAt, now),
              lastActiveAt: activity
                ? Math.max(value.lastActiveAt, now)
                : value.lastActiveAt,
            }),
          );
          return true;
        }
      } catch {
        /* Fail closed if browser storage becomes unavailable. */
      }
      expirationRunning.current = true;
      resetCheckins();
      account.current = null;
      accountEpoch.current++;
      readGeneration.current++;
      setSession(null);
      setSnapshot(null);
      setFresh(false);
      setForm(null);
      setNotice("为了保护你的账号安全，请重新登录。");
      void cloud?.auth.signOut({ scope: "local" });
      return false;
    },
    [resetCheckins, setSnapshot],
  );
  useEffect(() => {
    const action = (event: Event) => {
      if (event.isTrusted) ensureSession(true);
    };
    const resume = () => {
      if (document.visibilityState === "visible") ensureSession();
    };
    document.addEventListener("click", action, true);
    document.addEventListener("keydown", action, true);
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("pageshow", resume);
    const timer = window.setInterval(resume, 30000);
    return () => {
      document.removeEventListener("click", action, true);
      document.removeEventListener("keydown", action, true);
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("pageshow", resume);
      clearInterval(timer);
    };
  }, [ensureSession]);

  const refresh = useCallback((): Promise<boolean> => {
    const owner = account.current;
    if (!owner || !ensureSession()) return Promise.resolve(false);
    const epoch = accountEpoch.current;
    const revision = writeRevision.current;
    const key = `${owner}:${epoch}:${revision}`;
    if (readFlight.current?.key === key) return readFlight.current.promise;
    readFlight.current?.controller.abort();
    const controller = new AbortController();
    const generation = ++readGeneration.current;
    const uncertain = Object.values(operationsRef.current).filter(
      (op) => op.status === "uncertain",
    );
    setLoading(true);
    const promise = (async () => {
      try {
        const data = await readSnapshot(controller.signal);
        if (
          account.current !== owner ||
          accountEpoch.current !== epoch ||
          generation !== readGeneration.current ||
          revision !== writeRevision.current
        )
          return false;
        setSnapshot(data);
        setFresh(true);
        setError("");
        const next = { ...operationsRef.current };
        for (const op of uncertain)
          if (next[op.habitId]?.sequence === op.sequence)
            delete next[op.habitId];
        updateOperations(next);
        if (uncertain.length)
          setNotice(
            "本次保存未获确认，已重新读取云端记录，请核对结果后再操作。",
          );
        return true;
      } catch (e) {
        if (
          account.current === owner &&
          accountEpoch.current === epoch &&
          generation === readGeneration.current &&
          !controller.signal.aborted
        ) {
          setFresh(false);
          setError(`读取失败：${message(e)}`);
        }
        return false;
      } finally {
        if (
          account.current === owner &&
          accountEpoch.current === epoch &&
          generation === readGeneration.current
        )
          setLoading(false);
        if (readFlight.current?.controller === controller)
          readFlight.current = null;
      }
    })();
    readFlight.current = { key, promise, controller };
    return promise;
  }, [ensureSession, setSnapshot, updateOperations]);
  const uid = session?.user.id;
  useEffect(() => {
    if (uid) void refresh();
  }, [uid, refresh]);
  useEffect(() => {
    if (!uid) return;
    const reload = () => {
      if (
        document.visibilityState === "visible" &&
        !running.current &&
        !Object.keys(operationsRef.current).length
      )
        void refresh();
    };
    document.addEventListener("visibilitychange", reload);
    window.addEventListener("online", reload);
    window.addEventListener("pageshow", reload);
    const offline = () => {
      setFresh(false);
      setError(
        "网络已断开，暂时无法保存。联网后请刷新核对云端记录；没有离线待同步队列。",
      );
    };
    window.addEventListener("offline", offline);
    const timer = window.setInterval(() => {
      if (
        snapshot &&
        snapshot.today !== businessDate() &&
        !running.current &&
        !Object.keys(operationsRef.current).length
      )
        void refresh();
    }, 30000);
    return () => {
      document.removeEventListener("visibilitychange", reload);
      window.removeEventListener("online", reload);
      window.removeEventListener("pageshow", reload);
      window.removeEventListener("offline", offline);
      window.clearInterval(timer);
    };
  }, [uid, snapshot, refresh]);

  async function mutate(
    rpc: string,
    args: Record<string, string | number | boolean | string[]>,
  ) {
    if (
      running.current ||
      Object.keys(operationsRef.current).length ||
      !fresh ||
      !account.current ||
      !ensureSession()
    )
      return false;
    const owner = account.current;
    const epoch = accountEpoch.current;
    running.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    let committed = false;
    try {
      writeRevision.current++;
      await writeCloud(rpc, args);
      committed = true;
      writeRevision.current++;
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
  async function checkin(habitId: string, date: string, completed: boolean) {
    if (
      running.current ||
      !fresh ||
      !account.current ||
      operationsRef.current[habitId] ||
      !ensureSession() ||
      !confirmed.current
    )
      return;
    const owner = account.current;
    const epoch = accountEpoch.current;
    const startedSnapshot = confirmed.current;
    const sequence = ++operationSequence.current;
    const controller = new AbortController();
    writeControllers.current.set(habitId, controller);
    writeRevision.current++;
    updateOperations({
      ...operationsRef.current,
      [habitId]: { sequence, habitId, date, completed, status: "saving" },
    });
    clearCelebration(habitId, !completed);
    // React's optimistic overlay updates the button immediately; keep
    // confetti strictly tied to confirmed persistence.
    setNotice("");
    setError("");
    const current = () =>
      account.current === owner &&
      accountEpoch.current === epoch &&
      operationsRef.current[habitId]?.sequence === sequence;
    try {
      await writeCloud(
        "set_checkin",
        { p_habit_id: habitId, p_date: date, p_completed: completed },
        controller.signal,
      );
      if (!current() || !confirmed.current) return;
      writeRevision.current++;
      const before = confirmed.current;
      const after = applyCheckin(before, habitId, date, completed);
      setSnapshot(after);
      const next = { ...operationsRef.current };
      delete next[habitId];
      updateOperations(next);
      setNotice(
        completed ? "完成啦 ✨ 已保存到云端。" : "已取消打卡并保存到云端。",
      );
      const celebration = celebrationFor(
        startedSnapshot,
        after,
        habitId,
        date,
        completed,
        businessDate(),
      );
      if (celebration.ordinary) {
        const card = document.querySelector(
          `[data-habit-id="${CSS.escape(habitId)}"]`,
        );
        const dock =
          card && card.getBoundingClientRect().top > window.innerHeight / 2
            ? "top"
            : "bottom";
        playCelebration({
          sequence,
          habitId,
          name: after.habits.find((h) => h.id === habitId)?.name ?? "习惯",
          all:
            celebration.all &&
            !Object.values(next).some((op) => op.date === after.today),
          dock,
        });
      }
    } catch (e) {
      if (!current()) return;
      clearCelebration(habitId, true);
      writeRevision.current++;
      // Discard only this provisional overlay; preserve other pending habits.
      updateOperations({
        ...operationsRef.current,
        [habitId]: { sequence, habitId, date, completed, status: "uncertain" },
      });
      setError(
        `${message(e)} 未确认保存，已恢复原显示；正在核对云端记录，请勿直接重试。`,
      );
      const reconciled = await refresh();
      if (
        account.current === owner &&
        accountEpoch.current === epoch &&
        !reconciled
      ) {
        setError(
          "保存结果仍未确认，已恢复原显示。请点击刷新核对云端记录后再操作。",
        );
      }
    } finally {
      if (writeControllers.current.get(habitId) === controller)
        writeControllers.current.delete(habitId);
    }
  }
  async function submitAuth() {
    if (!cloud || running.current) return;
    if ((recovery || mode === "signup") && !passwordValid(password)) {
      setError(`请先满足密码规则：${PASSWORD_POLICY}`);
      return;
    }
    running.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    interactiveLogin.current = mode === "login" || mode === "signup";
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
      interactiveLogin.current = false;
      running.current = false;
      setBusy(false);
    }
  }
  async function logout() {
    if (!cloud || running.current) return;
    running.current = true;
    setBusy(true);
    // Clear data immediately; a failed logout still cannot expose previous data.
    resetCheckins();
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
        <p role="alert">Supabase 云端配置未就绪，暂时无法登录或保存。</p>
        <ul>
          {configIssues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
        <p>
          请由维护者检查构建配置后重新构建。仅使用项目 URL 和公开 publishable
          key，不要填写或发送 secret/service_role 密钥。
        </p>
      </main>
    );
  if (!authReady)
    return <Startup error={authInitError} retry={() => location.reload()} />;
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
          <InstallHelp />
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
                type={showPassword ? "text" : "password"}
                minLength={recovery || mode === "signup" ? 12 : undefined}
                aria-describedby={
                  recovery || mode === "signup" ? "password-policy" : undefined
                }
                aria-invalid={
                  recovery || mode === "signup"
                    ? !!password && !passwordValid(password)
                    : undefined
                }
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
          {(recovery || mode !== "reset") && (
            <button
              type="button"
              className="secondary"
              aria-pressed={showPassword}
              onClick={() => setShowPassword(!showPassword)}
            >
              {showPassword ? "隐藏密码" : "显示密码"}
            </button>
          )}
          {(recovery || mode === "signup") && (
            <div id="password-policy">
              <p>{PASSWORD_POLICY}</p>
              <ul
                className="password-rules"
                aria-live="polite"
                aria-label="密码规则"
              >
                {passwordRules(password).map((rule) => (
                  <li key={rule.id} className={rule.met ? "met" : "unmet"}>
                    {rule.met ? "✓ 已满足" : "未满足"}：{rule.label}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <button
            disabled={
              busy ||
              ((recovery || mode === "signup") && !passwordValid(password))
            }
          >
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

  if (!snapshot)
    return (
      <Startup
        syncing
        error={error}
        retry={() => void refresh()}
        logout={() => void logout()}
      />
    );

  const active = [
    ...(snapshot?.habits.filter((h) => !h.archived_on) ?? []),
  ].sort((a, b) => a.sort_order - b.sort_order);
  function reorder(source: string, target: string) {
    if (!fresh || busy || Object.keys(operations).length) return;
    const ids = moveHabit(
      active.map((h) => h.id),
      active.map((h) => h.id),
      source,
      target,
    );
    if (ids.some((id, index) => id !== active[index]?.id))
      void mutate("reorder_habits", { p_ids: ids });
  }
  const selected =
    snapshot?.habits.find((h) => h.id === selectedId) ?? snapshot?.habits[0];
  const dates =
    snapshot && selected
      ? completedDates(snapshot, selected.id)
      : new Set<string>();
  const today = snapshot?.today ?? businessDate();
  const stats = selected ? statistics(selected, dates, today, month) : null;
  const streak = streaks(dates, selected?.archived_on ?? today);
  const editingHabit = form && !form.creating ? snapshot?.habits.find(h => h.id === form.id) : undefined;
  const nameChanged = !!editingHabit && !!form && form.name.trim() !== editingHabit.name;
  const emojiChanged = !!editingHabit && emojiDraft.trim() !== editingHabit.emoji;
  const emojiValid = !emojiChanged || (
    emojiDraft.trim().length > 0 &&
    emojiDraft.trim().length <= 16 &&
    !/[\\p{Cc}\\p{Cf}]/u.test(emojiDraft.trim()) &&
    /[\\p{Extended_Pictographic}\\p{Regional_Indicator}\\u20E3]/u.test(emojiDraft.trim()) &&
    [...new Intl.Segmenter("en", { granularity: "grapheme" }).segment(emojiDraft.trim())].length === 1
  );
  const disabled = busy || loading || !fresh;
  const hasOperations = Object.keys(operations).length > 0;
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
      {feedback && <CelebrationFeedback event={feedback} />}
      <main className="app">
        {error && <p role="alert">{error}</p>}
        {notice && <p role="status">{notice}</p>}
        {loading && <p role="status">正在读取云端数据…</p>}
        {page === "account" ? (
          <section>
            <h2>账号</h2>
            <button
              className="manage-entry"
              onClick={() => {
                setManaging((v) => !v);
                setForm(null);
              }}
            >
              {managing ? "← 返回账号" : "编辑习惯"}
            </button>
            {managing && (
              <div className="manage-panel">
                <h3>管理习惯</h3>
                <p className="muted">选择需要修改的习惯，编辑名称和图标。排序请在「今天」页面长按 ☰ 完成。</p>
                <div className="manage-list">
                  {active.map((h) => (
                    <button key={h.id} className="manage-pick manage-item"
                      onClick={() => {
                        setEmojiDraft(h.emoji);
                        setForm({id:h.id,name:h.name,color:h.color,creating:false});
                      }}>
                      <span>{h.emoji}</span><span>{h.name}</span><span aria-hidden="true">›</span>
                    </button>
                  ))}
                </div>
                {snapshot.habits.some((h) => h.archived_on) && (
                  <details className="manage-archive">
                    <summary>已归档习惯</summary>
                    {snapshot.habits
                      .filter((h) => h.archived_on)
                      .map((h) => (
                        <div className="manage-item" key={h.id}>
                          <span>
                            {h.emoji} {h.name}
                          </span>
                          <button
                            className="secondary"
                            disabled={disabled || hasOperations}
                            onClick={() => {
                              if (
                                window.confirm(
                                  `恢复「${h.name}」？原记录将保留。`,
                                )
                              )
                                void mutate("restore_habit", { p_id: h.id });
                            }}
                          >
                            恢复
                          </button>
                        </div>
                      ))}
                  </details>
                )}
              </div>
            )}
            {!managing && (
              <>
                <p className="email">{session.user.email}</p>
                <p>
                  习惯和打卡记录保存在
                  Supabase。更换手机后登录同一账号即可恢复。
                </p>
                <p>每天按北京时间计算。断网时无法保存。</p>
                <InstallHelp />
                {(import.meta.env.DEV ||
                  import.meta.env.BASE_URL === PREVIEW_BASE) && (
                  <button
                    className="secondary"
                    disabled={busy || hasOperations}
                    onClick={() =>
                      playCelebration({
                        sequence: ++operationSequence.current,
                        habitId: "preview",
                        name: "",
                        all: true,
                        preview: true,
                      })
                    }
                  >
                    预览庆祝效果（不会打卡）
                  </button>
                )}
                <button disabled={busy} onClick={() => void logout()}>
                  退出登录
                </button>
              </>
            )}
          </section>
        ) : !snapshot ? (
          <p>尚未读取到数据，请点击刷新重试。</p>
        ) : page === "today" ? (
          <section>
            <div className="welcome">
              <p>今天也在慢慢变好 🌱</p>
              <h2>
                今天 <small>{today}</small>
              </h2>
              <p>
                {active.length
                  ? `已完成 ${done}/${active.length} · ${Math.round((done / active.length) * 100)}%`
                  : "今天还没有进行中的习惯。"}
              </p>
              <progress
                aria-label="今日完成进度"
                value={done}
                max={active.length || 1}
              />
            </div>
            {!active.length && (
              <p className="empty">先种下你的第一个习惯吧 🌱</p>
            )}
            <button
              disabled={disabled || hasOperations}
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
                const habitDates = completedDates(snapshot, h.id);
                const checked = habitDates.has(today);
                const habitStreak = streaks(habitDates, today);
                return (
                  <article
                    key={h.id}
                    data-habit-id={h.id}
                    className={`card color-${h.color} ${checked ? "completed" : ""} ${celebrating[h.id] ? "celebrate-confirmed" : ""} ${draggingId === h.id ? "dragging" : ""} ${dropTargetId === h.id && draggingId !== h.id ? "drop-target" : ""}`}
                    aria-busy={operations[h.id]?.status === "saving"}
                    onDragOver={(event) => {
                      event.preventDefault();
                      if (draggingHabit.current) setDropTargetId(h.id);
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      if (draggingHabit.current) reorder(draggingHabit.current, h.id);
                      draggingHabit.current = null;
                      touchHabit.current = null;
                      setDraggingId(null);
                      setDropTargetId(null);
                    }}
                  >
                    <span
                      className="today-drag-handle" role="button" tabIndex={0}
                      aria-label={`按住拖动${h.name}排序`}
                      draggable={!disabled && !hasOperations}
                      onDragStart={() => { draggingHabit.current = h.id; setDraggingId(h.id); }}
                      onDragEnd={() => { draggingHabit.current = null; setDraggingId(null); setDropTargetId(null); }}
                      onPointerDown={(event) => {
                        if (event.pointerType !== "mouse" && !disabled && !hasOperations) {
                          touchHabit.current = h.id;
                          setDraggingId(h.id);
                          event.currentTarget.setPointerCapture(event.pointerId);
                        }
                      }}
                      onPointerMove={(event) => {
                        if (!touchHabit.current) return;
                        const destination = document.elementFromPoint(event.clientX,event.clientY)?.closest("[data-habit-id]");
                        if (destination instanceof HTMLElement) setDropTargetId(destination.dataset.habitId ?? null);
                      }}
                      onPointerUp={(event) => {
                        if (!touchHabit.current) return;
                        const target = document.elementFromPoint(event.clientX,event.clientY)?.closest("[data-habit-id]");
                        if (target instanceof HTMLElement) reorder(touchHabit.current,target.dataset.habitId ?? "");
                        touchHabit.current = null;
                        setDraggingId(null);
                        setDropTargetId(null);
                      }}
                      onPointerCancel={() => {touchHabit.current = null;setDraggingId(null);setDropTargetId(null);}}
                      onKeyDown={(event) => {
                        const index = active.findIndex((item) => item.id === h.id);
                        if (event.key === "ArrowUp" && index > 0) { event.preventDefault(); reorder(h.id, active[index-1].id); }
                        if (event.key === "ArrowDown" && index < active.length-1) { event.preventDefault(); reorder(h.id, active[index+1].id); }
                      }}
                    >☰</span>
                    <span className="habit-symbol" aria-hidden="true">
                      {h.emoji}
                    </span>
                    <div className="habit-main">
                      <h3>{h.name}</h3>
                      {celebrating[h.id] && (
                        <span className="card-success" key={celebrating[h.id]}>
                          <StarParticles />
                          <strong>完成啦！✨</strong>
                        </span>
                      )}
                      <p>
                        {operations[h.id]?.status === "saving"
                          ? operations[h.id]?.completed
                            ? "✓ 已打卡 · 同步中 · "
                            : "正在取消 · 同步中 · "
                          : operations[h.id]?.status === "uncertain"
                            ? "待核对 · "
                            : checked
                              ? "✓ 已完成 · "
                              : ""}
                        当前连续 {habitStreak.current} 天
                      </p>
                      <p className="habit-history-stats">
                        <span>累计打卡 {habitDates.size} 天</span>
                        <span> · </span>
                        <span>最长连续 {habitStreak.longest} 天</span>
                      </p>
                    </div>
                    <button
                      className="check-button"
                      aria-label={checked ? "取消打卡" : "打卡"}
                      aria-pressed={checked}
                      disabled={busy || !fresh || !!operations[h.id]}
                      onClick={() => void checkin(h.id, today, !checked)}
                    >
                      <span
                        className="check-glyph"
                        key={celebrating[h.id] ?? "idle"}
                        aria-hidden="true"
                      >
                        {checked ? "✓" : "打卡"}
                      </span>
                    </button>
                  </article>
                );
              })}
            </div>
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
                          busy ||
                          !fresh ||
                          !!operations[selected?.id ?? ""] ||
                          !allowed ||
                          !!selected?.archived_on
                        }
                        onClick={() =>
                          selected && void checkin(selected.id, day, !checked)
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
                    disabled={disabled || hasOperations}
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
        {form && (form.creating || (page === "account" && managing)) && (
          <section className="editor" aria-label="习惯编辑">
            <h2>{form.creating ? "创建习惯" : "编辑习惯"}</h2>
            <form onSubmit={(event) => {
              event.preventDefault();
              const submitted = form;
              const nextName = submitted.name.trim();
              const nextEmoji = emojiDraft.trim();
              if (submitted.creating) {
                void mutate("create_habit", {p_id:submitted.id,p_name:nextName,p_color:submitted.color})
                  .then(ok => { if(ok && account.current) setForm(null); });
                return;
              }
              if (!emojiValid || !(nameChanged || emojiChanged)) return;
              void (async () => {
                if (nameChanged) {
                  const ok = await mutate("edit_habit",{
                    p_id:submitted.id,p_name:nextName,p_color:submitted.color
                  });
                  if(!ok) return;
                }
                if (emojiChanged) {
                  const ok = await mutate("set_habit_emoji",{p_id:submitted.id,p_emoji:nextEmoji});
                  if(!ok) return;
                }
                if(account.current) setForm(null);
              })();
            }}>
              <label>
                名称
                <input autoFocus required maxLength={30}
                  value={form.name} disabled={disabled || hasOperations}
                  onChange={(event) => setForm({...form,name:event.target.value})}/>
              </label>
              {!form.creating && (
                <label>
                  Emoji（使用手机键盘输入）
                  <input aria-label="自定义习惯 Emoji" inputMode="text" maxLength={16}
                    value={emojiDraft} disabled={disabled || hasOperations}
                    onChange={(event) => setEmojiDraft(event.target.value)}
                    placeholder="例如 💩 🥗 ☀️" />
                  <small>从键盘输入一个 Emoji，和名称一起保存。</small>
                  {!emojiValid && <p role="alert">请输入一个有效的 Emoji。</p>}
                </label>
              )}
              <div className="row editor-actions">
                <button type="submit"
                  disabled={disabled || hasOperations || !form.name.trim() ||
                    (!form.creating && (!(nameChanged || emojiChanged) || !emojiValid))}>
                  {form.creating ? "创建习惯" : "保存修改"}
                </button>
                {!form.creating && (
                  <button type="button" className="secondary" disabled={disabled || hasOperations}
                    onClick={() => {
                      if(window.confirm(`归档「${editingHabit?.name ?? form.name}」？历史打卡将保留，可在账号管理中恢复。`))
                        void mutate("archive_habit",{p_id:form.id}).then(ok => {if(ok)setForm(null);});
                    }}>归档</button>
                )}
                <button type="button" className="secondary" disabled={busy}
                  onClick={() => setForm(null)}>取消</button>
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
