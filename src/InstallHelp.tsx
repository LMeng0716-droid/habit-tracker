import { useEffect, useState } from "react";
export function InstallHelp() {
  const [standalone, setStandalone] = useState(false);
  const [controlled, setControlled] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(display-mode: standalone)");
    const update = () =>
      setStandalone(
        media.matches ||
          (navigator as Navigator & { standalone?: boolean }).standalone ===
            true,
      );
    update();
    media.addEventListener("change", update);
    // Read-only inspection: never unregister workers/cache belonging to another app.
    setControlled(!!navigator.serviceWorker?.controller);
    return () => media.removeEventListener("change", update);
  }, []);
  return (
    <details className="install-help">
      <summary>
        {standalone ? "主屏幕应用使用说明" : "添加到 iPhone 主屏幕"}
      </summary>
      <p>在 Safari 打开本页，点“分享”→“添加到主屏幕”，名称为“每日进步”。</p>
      <p>
        从主屏幕首次打开可能需要重新登录；同一账号的习惯仍保存在云端。之后登录状态由此入口保存。
      </p>
      <p>
        这是在线应用，不支持离线打卡。更新时联网重新打开；若资源加载失败，请使用页面的重新加载入口。
      </p>
      {controlled && (
        <p>
          检测到此页面受已有 Service Worker
          控制。本版不会注册或删除它，请按更新排查说明检查其作用域。
        </p>
      )}
    </details>
  );
}
