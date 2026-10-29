import { useCallback, useEffect, useState } from "react";
import { cloud, message } from "./cloud";
import { businessDate } from "./domain";

type Mode = "count" | "duration";
type NumericHabit = { id: string; name: string; emoji: string; habit_type: string; target: number | null; archived_on: string | null };
type Progress = { habit_id: string; date: string; actual_value: number; event_count: number };
type EventRecord = { event_id: string; revision: number; input_value: number; occurred_at: string; action: string; event_kind: string };
const rpc = async (name: string, args: Record<string, unknown> = {}) => {
  if (!cloud) throw new Error("云端配置不可用");
  // Supabase's RPC typing is intentionally resolved at runtime while V3 is staged.
  const { data, error } = await cloud.schema("habit_mobile").rpc(name, args as never);
  if (error) throw error;
  return data;
};
const normalValue = (value: string, mode: Mode): number | null => {
  if (!/^\d+$/.test(value)) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 1 && n <= (mode === "duration" ? 1440 : 1000000) ? n : null;
};
export function NumericHabits() {
  const [habits, setHabits] = useState<NumericHabit[]>([]);
  const [progress, setProgress] = useState<Progress[]>([]);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("🎯");
  const [mode, setMode] = useState<Mode>("count");
  const [target, setTarget] = useState("5");
  const [entry, setEntry] = useState<Record<string, string>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [events, setEvents] = useState<EventRecord[]>([]);
  const today = businessDate();
  const refresh = useCallback(async () => {
    try {
      const data = await rpc("read_snapshot_v3", { p_start: today, p_end: today }) as {habits: NumericHabit[]; progress: Progress[]};
      setHabits(data.habits.filter(h => h.habit_type === "count" || h.habit_type === "duration").filter(h => !h.archived_on));
      setProgress(data.progress ?? []);
      setAvailable(true);
      setError("");
    } catch (e) {
      setAvailable(false);
      setError("计次／计时功能需要先通过 V3 数据库审核与部署，目前不会修改旧打卡记录。"+ " " + message(e));
    }
  }, [today]);
  useEffect(() => { void refresh(); }, [refresh]);
  async function submit(task: () => Promise<void>) {
    setBusy(true); setError("");
    try { await task(); await refresh(); }
    catch (e) { setError(message(e)); await refresh().catch(() => {}); }
    finally { setBusy(false); }
  }
  async function loadEvents(id: string) {
    setSelectedId(id);
    try {
      const data = await rpc("read_events_v3", {p_habit_id:id,p_date:today,p_limit:100}) as EventRecord[];
      setEvents(data.filter(e => e.event_kind === "occurrence" && e.action !== "void"));
    } catch(e) { setError(message(e)); }
  }
  if (available === false) return <section className="numeric-panel"><h3>计次／计时习惯（预览）</h3><p role="status">{error}</p><button type="button" className="secondary" onClick={() => void refresh()}>重新检测 V3</button></section>;
  return <section className="numeric-panel" aria-label="计次和计时习惯">
    <h3>计次／计时习惯 {available === null ? "· 正在检测" : ""}</h3>
    {error && <p role="alert">{error}</p>}
    {available && <>
      <form onSubmit={e => {e.preventDefault();const goal=normalValue(target, mode);if(!name.trim()||!goal)return;
        void submit(async () => {await rpc("create_habit_v3",{p_id:crypto.randomUUID(),p_name:name.trim(),p_color:0,p_emoji:emoji.trim()||"🎯",p_type:mode,p_target:goal,p_unit:mode==="count"?"repetition":"minute",p_direction:"at_least"});setName("");});}}>
        <h4>创建新习惯</h4>
        <label>名称<input value={name} required maxLength={30} onChange={e=>setName(e.target.value)} placeholder="如：喝水、阅读"/></label>
        <label>图标<input value={emoji} maxLength={16} onChange={e=>setEmoji(e.target.value)}/></label>
        <label>记录类型<select value={mode} onChange={e=>{const next=e.target.value as Mode;setMode(next);setTarget(next==="count"?"5":"30");}}><option value="count">计次</option><option value="duration">计时（分钟）</option></select></label>
        <label>每日目标<input inputMode="numeric" type="number" min="1" max={mode==="count"?1000000:1440} value={target} onChange={e=>setTarget(e.target.value)}/></label>
        <button disabled={busy || !name.trim() || !normalValue(target,mode)}>创建计次／计时习惯</button>
      </form>
      {habits.map(h => {const m=h.habit_type as Mode;const p=progress.find(p=>p.habit_id===h.id);const actual=Number(p?.actual_value ?? 0);const unit=m==="duration"?"分钟":"次";
      return <article className="numeric-item" key={h.id}>
        <h4>{h.emoji} {h.name}</h4>
        <p>今日累计：{actual} / {h.target ?? "—"} {unit} · 已记录 {p?.event_count ?? 0} 笔</p>
        <form onSubmit={e=>{e.preventDefault();const value=normalValue(entry[h.id]??"",m);if(!value)return;
          void submit(async()=>{await rpc("record_progress_v3",{p_operation_id:crypto.randomUUID(),p_event_id:crypto.randomUUID(),p_habit_id:h.id,p_date:today,p_action:"record",p_value:value,p_occurred_at:new Date().toISOString(),p_expected_revision:0,p_kind:"occurrence"});setEntry(v=>({...v,[h.id]:""}));if(selectedId===h.id)await loadEvents(h.id);});}}>
          <label>新增记录（{unit}）<input type="number" inputMode="numeric" min="1" max={m==="duration"?1440:1000000} value={entry[h.id]??""} onChange={e=>setEntry(v=>({...v,[h.id]:e.target.value}))}/></label>
          <button disabled={busy || !normalValue(entry[h.id]??"",m)}>记录一次</button>
        </form>
        <button type="button" className="secondary" disabled={busy} onClick={()=>void loadEvents(h.id)}>查看今天的记录</button>
        {selectedId===h.id && <ul className="numeric-events">{events.length===0 && <li>今天暂无记录</li>}{events.map(e=><li key={e.event_id}><time>{new Date(e.occurred_at).toLocaleTimeString("zh-CN",{hour:"2-digit",minute:"2-digit"})}</time> · {e.input_value} {unit}
          <button type="button" className="secondary" disabled={busy} onClick={()=>{if(!window.confirm("确认撤销这条记录？"))return;void submit(async()=>{await rpc("record_progress_v3",{p_operation_id:crypto.randomUUID(),p_event_id:e.event_id,p_habit_id:h.id,p_date:today,p_action:"void",p_value:e.input_value,p_occurred_at:e.occurred_at,p_expected_revision:e.revision,p_kind:"occurrence"});await loadEvents(h.id);});}}>撤销</button></li>)}</ul>}
      </article>})}
    </>}
  </section>;
}
