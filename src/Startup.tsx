export function Startup({
  syncing = false,
  error = "",
  retry,
  logout,
}: {
  syncing?: boolean;
  error?: string;
  retry?: () => void;
  logout?: () => void;
}) {
  return (
    <main className="startup" aria-label="每日进步启动画面" aria-busy={!error}>
      <div className="startup-brand">
        <img
          src={`${import.meta.env.BASE_URL}icons/source.svg?v=sprout-2`}
          width="112"
          height="112"
          alt="嫩芽"
        />
        <h1>每日进步</h1>
        <p>每天一点点，慢慢变更好。</p>
      </div>
      <div className="startup-progress">
        {error ? (
          <>
            <p role="alert">{error}</p>
            <button onClick={retry}>刷新</button>
            {logout && (
              <button className="secondary" onClick={logout}>
                退出登录
              </button>
            )}
          </>
        ) : (
          <p role="status">
            <span className="loading-seed" aria-hidden="true">
              · · ·
            </span>
            {syncing ? "正在同步今日记录" : "正在打开你的每日进步"}
          </p>
        )}
      </div>
    </main>
  );
}
