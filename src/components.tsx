import { useEffect, useRef, useState, type ReactNode } from "react";
import { COLORS, type Category, type Schedule, type Habit } from "./domain";

export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = ref.current;
    dialog?.showModal();
    dialog?.querySelector<HTMLElement>("[data-initial-focus]")?.focus();
    return () => {
      dialog?.close();
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      aria-labelledby="dialog-title"
    >
      <div className="dialog-heading">
        <h2 id="dialog-title">{title}</h2>
        <button onClick={onClose} aria-label="关闭弹窗">
          ×
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function HabitForm({
  habit,
  names,
  categories,
  onSave,
  onClose,
}: {
  habit?: Habit;
  names: string[];
  categories: Category[];
  onSave: (
    name: string,
    color: number,
    categoryId: string | null,
    schedule: Schedule,
  ) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(habit?.name ?? "");
  const [color, setColor] = useState(habit?.color ?? 0);
  const [categoryId, setCategoryId] = useState(habit?.categoryId ?? "");
  const originalSchedule =
    habit?.scheduleHistory?.at(-1)?.schedule ?? ({ kind: "daily" } as Schedule);
  const [schedule, setSchedule] = useState<Schedule>(originalSchedule);
  const [error, setError] = useState("");
  const dirty =
    name !== (habit?.name ?? "") ||
    color !== (habit?.color ?? 0) ||
    categoryId !== (habit?.categoryId ?? "") ||
    JSON.stringify(schedule) !== JSON.stringify(originalSchedule);
  const close = () => {
    if (!dirty || window.confirm("还未保存修改，确定放弃吗？")) onClose();
  };
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);
  return (
    <Modal title={habit ? "编辑习惯" : "添加新习惯"} onClose={close}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const value = name.trim();
          if (![...value].length || [...value].length > 30) {
            setError("请输入1～30个字的习惯名称。");
            return;
          }
          if (schedule.kind === "weekdays" && !schedule.days.length) {
            setError("请选择至少一个星期。");
            return;
          }
          onSave(value, color, categoryId || null, schedule);
        }}
      >
        <label className="field">
          习惯名称
          <input
            data-initial-focus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例如：每天阅读10分钟"
          />
        </label>
        <label className="field">
          分类
          <select
            aria-label="分类"
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
          >
            <option value="">未分类</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          重复周期
          <select
            aria-label="重复周期"
            value={schedule.kind}
            onChange={(e) =>
              setSchedule(
                e.target.value === "daily"
                  ? { kind: "daily" }
                  : e.target.value === "weekdays"
                    ? { kind: "weekdays", days: [1] }
                    : { kind: "weeklyQuota", count: 3 },
              )
            }
          >
            <option value="daily">每天一次</option>
            <option value="weekdays">每周指定星期</option>
            <option value="weeklyQuota">每周 N 次</option>
          </select>
        </label>
        {schedule.kind === "weekdays" && (
          <fieldset>
            <legend>计划星期</legend>
            {["一", "二", "三", "四", "五", "六", "日"].map((d, i) => (
              <label key={d}>
                <input
                  type="checkbox"
                  checked={schedule.days.includes(i + 1)}
                  onChange={(e) =>
                    setSchedule({
                      ...schedule,
                      days: e.target.checked
                        ? [...schedule.days, i + 1].sort()
                        : schedule.days.filter((x) => x !== i + 1),
                    })
                  }
                />
                周{d}{" "}
              </label>
            ))}
          </fieldset>
        )}
        {schedule.kind === "weeklyQuota" && (
          <label className="field">
            每周次数
            <input
              type="number"
              min="1"
              max="7"
              value={schedule.count}
              onChange={(e) =>
                setSchedule({ ...schedule, count: Number(e.target.value) })
              }
            />
          </label>
        )}
        {habit && (
          <p className="muted">周期修改从下周一生效，保留历史和当前周计划。</p>
        )}
        {names.includes(name.trim()) && (
          <p className="notice">已有同名习惯，你仍可以继续保存。</p>
        )}
        <fieldset>
          <legend>选择颜色</legend>
          <div className="color-options">
            {COLORS.map((c, i) => (
              <label key={c} className={`color-choice color-${i}`}>
                <input
                  type="radio"
                  name="color"
                  checked={color === i}
                  onChange={() => setColor(i)}
                />
                {c}
              </label>
            ))}
          </div>
        </fieldset>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <div className="actions">
          <button type="button" onClick={close}>
            取消
          </button>
          <button className="primary" type="submit">
            保存习惯
          </button>
        </div>
      </form>
    </Modal>
  );
}
export function MonthPicker({
  month,
  onChange,
  latest,
}: {
  month: string;
  onChange: (value: string) => void;
  latest: string;
}) {
  const [y, m] = month.split("-");
  return (
    <label className="month-picker">
      查看月份
      <input
        type="month"
        aria-label="查看月份"
        value={month}
        min="1900-01"
        max={latest}
        onChange={(e) => {
          if (
            /^\d{4}-\d{2}$/.test(e.target.value) &&
            e.target.value >= "1900-01" &&
            e.target.value <= latest
          )
            onChange(e.target.value);
        }}
      />
      <span aria-hidden="true">
        {y}年{Number(m)}月
      </span>
    </label>
  );
}
