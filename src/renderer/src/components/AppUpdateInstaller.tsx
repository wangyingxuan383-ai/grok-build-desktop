import { useEffect, useState } from "react";
import type { AppReleaseStatus, AppUpdateDownloadState } from "../../../shared/types";

const megabytes = (value?: number) => value ? `${(value / 1024 / 1024).toFixed(1)} MB` : "";

/**
 * In-app update: download the official Setup asset, verify it, then hand over to the
 * installer. Portable copies and releases without an installer keep the release-page link.
 */
export function AppUpdateInstaller({ release, compact = false }: { release?: AppReleaseStatus; compact?: boolean }) {
  const [state, setState] = useState<AppUpdateDownloadState>({ phase: "idle", received: 0 });
  const [error, setError] = useState("");
  useEffect(() => {
    void window.grokDesktop.getAppUpdateDownload().then(setState).catch(() => undefined);
    return window.grokDesktop.onAppUpdateProgress(setState);
  }, []);
  if (!release?.updateAvailable) return null;
  const openPage = <button onClick={() => void window.grokDesktop.openAppRelease(release.releaseUrl)}>打开发布页</button>;
  if (!release.installer || state.installable === false) return <div className="update-installer">
    <p className="update-status">{state.installable === false ? "当前是便携版：请从发布页下载新的便携版 ZIP，解压后替换。" : "此版本没有提供安装包，请在发布页手动下载。"}</p>
    <div className="button-row">{openPage}</div>
  </div>;
  const same = state.version === release.latestVersion;
  const percent = state.total ? Math.min(100, Math.round((state.received / state.total) * 100)) : 0;
  const download = () => { setError(""); void window.grokDesktop.downloadAppUpdate().then(setState).catch((value) => setError(value instanceof Error ? value.message : String(value))); };
  const install = () => {
    if (!state.verified && !window.confirm("发布信息没有提供 SHA-256，只校验了文件大小。仍要运行这个安装包吗？")) return;
    setError("");
    void window.grokDesktop.installAppUpdate().catch((value) => setError(value instanceof Error ? value.message : String(value)));
  };
  return <div className={compact ? "update-installer compact" : "update-installer"}>
    {same && state.phase === "downloading" ? <>
      <div className="update-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label="下载进度"><span style={{ width: `${percent}%` }} /></div>
      <p className="update-status" aria-live="polite">正在下载 {release.latestVersion} · {percent}%{state.total ? `（${megabytes(state.received)} / ${megabytes(state.total)}）` : ""}</p>
      <div className="button-row"><button onClick={() => void window.grokDesktop.cancelAppUpdate()}>取消下载</button></div>
    </> : same && state.phase === "ready" ? <>
      <p className="update-status">{release.latestVersion} 已下载{state.verified ? "，SHA-256 校验通过" : "（发布信息未提供 SHA-256，仅校验了大小）"}。安装时应用会关闭，会话与设置会保留。</p>
      <div className="button-row"><button className="primary" onClick={install}>重启并安装</button>{openPage}</div>
    </> : <>
      {state.phase === "error" && same ? <p className="update-status error">下载失败：{state.error}</p> : null}
      <div className="button-row"><button className="primary" onClick={download}>下载并安装 {release.latestVersion}{release.installer.size ? `（${megabytes(release.installer.size)}）` : ""}</button>{compact ? null : openPage}</div>
    </>}
    {error ? <p className="update-status error" role="alert">{error}</p> : null}
  </div>;
}
