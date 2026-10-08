import { useEffect, useState } from "react";

const RELEASE_PAGE = "https://github.com/wangyingxuan383-ai/grok-build-desktop/releases/latest";
export function MobileDownloadCard() {
  const [download, setDownload] = useState<{ version?: string; url?: string; qrDataUrl?: string; error?: string }>();
  const [busy, setBusy] = useState(false);
  const check = async () => {
    setBusy(true);
    try { setDownload(await window.grokDesktop.getMobileDownload()); }
    catch { setDownload({ error: "暂时无法获取 APK，请稍后重试或打开发布页。" }); }
    finally { setBusy(false); }
  };
  useEffect(() => { void check(); }, []);
  return <div className="remote-mobile-download">
    <div><h4>安装 Grok Remote {download?.version || "安卓客户端"}</h4>
      <p>用手机扫码下载 APK，安装后扫描电脑的配对二维码。应用内可检查并下载后续更新。</p>
      {download?.error ? <p className="muted-text">暂时无法获取 APK，可刷新或打开发布页。</p> : null}
      <div className="button-row">
        <button disabled={busy} onClick={() => void check()}>{busy ? "正在读取…" : "刷新下载入口"}</button>
        <button onClick={() => void window.grokDesktop.openExternal(download?.url || RELEASE_PAGE)}>{download?.url ? "下载手机 APK" : "手机发布与下载"}</button>
      </div>
    </div>
    {download?.qrDataUrl ? <img src={download.qrDataUrl} width={180} height={180} alt={`Grok Remote ${download.version} 下载二维码`} /> : null}
  </div>;
}
