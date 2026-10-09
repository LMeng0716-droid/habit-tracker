import { useEffect, useRef, useState, type ReactNode } from "react";
import { COLORS, type Habit } from "./domain";

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
  onSave,
  onClose,
}: {
  habit?: Habit;
  names: string[];
  onSave: (name: string, color: number) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(habit?.name ?? "");
  const [color, setColor] = useState(habit?.color ?? 0);
  const [error, setError] = useState("");
  const dirty = name !== (habit?.name ?? "") || color !== (habit?.color ?? 0);
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
          onSave(value, color);
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
        <small>从一件小事开始 · 每天一次</small>
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
