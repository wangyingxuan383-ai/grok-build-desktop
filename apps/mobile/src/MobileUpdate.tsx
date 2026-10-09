import React, { useEffect, useState } from "react";
import { Linking, Platform, Text, View } from "react-native";
import { Button, space, ui, type Theme } from "./ui";
import { MOBILE_VERSION } from "./version";
import { mobileVersionIsNewer } from "./experience-model";
import { parseMobileRelease, RELEASE_PAGE, type MobileRelease } from "./mobile-update-model";
import { checkPublicRelease, downloadMobileUpdate, installMobileUpdate, cancelMobileUpdate, mobileUpdateStatus, watchMobileUpdate, type MobileUpdateState } from "./transport";

// Automatic checks are throttled app-wide: reopening the settings page does not re-query GitHub.
let lastAutomaticCheck = 0, knownRelease: MobileRelease | undefined;
const AUTOMATIC_INTERVAL = 6 * 60 * 60 * 1000;

/** Public updates work without a paired or online computer; Android owns install consent. */
export function MobileUpdate({ theme, automatic = false }: { theme: Theme; automatic?: boolean }) {
  const [release, setReleaseState] = useState<MobileRelease | undefined>(knownRelease);
  const setRelease = (value: MobileRelease) => { knownRelease = value; setReleaseState(value); };
  const [state, setState] = useState<MobileUpdateState>({ phase: "idle", received: 0 });
  const [checking, setChecking] = useState(false), [error, setError] = useState("");
  // A late initial snapshot must not overwrite newer download progress (R07).
  const apply = (next: MobileUpdateState) => setState(previous => (next.revision ?? 0) >= (previous.revision ?? 0) ? next : previous);
  const check = async () => {
    setChecking(true); setError("");
    try { setRelease(parseMobileRelease(JSON.parse(await checkPublicRelease()))); }
    catch (value) { setError(value instanceof Error ? value.message : String(value)); }
    finally { setChecking(false); }
  };
  useEffect(() => {
    let alive = true;
    void mobileUpdateStatus().then(value => { if (alive) apply(value); }).catch(() => undefined);
    const subscription = watchMobileUpdate(value => { if (alive) apply(value); });
    return () => { alive = false; subscription.remove(); };
  }, []);
  useEffect(() => { if (automatic && Platform.OS === "android" && Date.now() - lastAutomaticCheck > AUTOMATIC_INTERVAL) { lastAutomaticCheck = Date.now(); void check(); } }, [automatic]);
  const downloading = state.phase === "downloading";
  const newer = release && mobileVersionIsNewer(release.version, MOBILE_VERSION);
  const install = async () => {
    setError("");
    try {
      const result = await installMobileUpdate();
      if (result === "permission") setError("请在系统页面允许 Grok Remote 安装应用，返回后再次点击安装。");
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
      // The file may have been cleared by the system: refresh state so "download again" appears (R08).
      void mobileUpdateStatus().then(apply).catch(() => undefined);
      if (!release) void check();
    }
  };
  return <View style={{ padding: space.lg, gap: space.sm }}>
    <Text style={[ui.title, { color: theme.text }]}>手机客户端 {MOBILE_VERSION}</Text>
    <Text style={[ui.hint, { color: theme.muted }]}>{release ? newer ? `发现新版本 ${release.version}` : `已是最新版本（公开 ${release.version}）` : "从公开发布检查更新，无需电脑在线。"}</Text>
    {downloading ? <>
      <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: state.total ? Math.round(state.received / state.total * 100) : 0 }} style={{ height: 4, borderRadius: 2, backgroundColor: theme.raised, overflow: "hidden" }}>
        <View style={{ height: 4, backgroundColor: theme.primary, width: `${state.total ? Math.min(100, state.received / state.total * 100) : 0}%` }} />
      </View>
      <Text style={[ui.hint, { color: theme.muted }]}>正在下载 {state.version} · {state.total ? Math.round(state.received / state.total * 100) : 0}%</Text>
      <Button compact theme={theme} title="取消下载" onPress={() => void cancelMobileUpdate()} />
    </> : state.phase === "ready" && mobileVersionIsNewer(state.version || "0.0.0", MOBILE_VERSION) ? <>
      <Text style={[ui.hint, { color: theme.success }]}>校验通过，配对和草稿将保留。</Text>
      <Button compact primary theme={theme} title={`安装 ${state.version}`} onPress={() => void install()} />
    </> : newer ? <Button compact primary theme={theme} title={`下载更新 ${release.version}`} onPress={() => { setError(""); void downloadMobileUpdate(release).then(apply).catch(value => setError(String(value))); }} /> : null}
    <View style={[ui.row, { flexWrap: "wrap" }]}>
      <Button compact theme={theme} title={checking ? "正在检查…" : "检查更新"} disabled={checking || downloading || Platform.OS !== "android"} onPress={() => void check()} />
      <Button compact ghost theme={theme} title="发布与下载" onPress={() => void Linking.openURL(RELEASE_PAGE).catch(value => setError(String(value)))} />
    </View>
    {error || state.phase === "error" ? <Text accessibilityRole="alert" style={[ui.hint, { color: theme.danger }]}>{error || state.error}</Text> : null}
  </View>;
}
