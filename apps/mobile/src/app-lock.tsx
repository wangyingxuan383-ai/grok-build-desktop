import React, { useEffect, useRef, useState } from "react";
import { AppState, BackHandler, Modal, Platform, Pressable, Text, View } from "react-native";
import * as LocalAuthentication from "expo-local-authentication";
import { configurePrivacy } from "./transport";
import { Icon } from "./icons";
import { font, radius, space, type Theme } from "./ui";

/**
 * App lock. The phone can make a paired computer run commands (including auto-approve mode),
 * so the app can require the phone's biometrics or screen-lock credential to open.
 * Off by default; turning it on requires one successful check first.
 */
export interface LockPreferences { enabled: boolean; /** Minutes away before asking again; 0 = every time. */ timeout: number; secure: boolean }
export const defaultLock: LockPreferences = { enabled: false, timeout: 1, secure: false };

/** Pure: should the app be locked after being away? */
export function shouldLock(lock: LockPreferences, leftAt: number | undefined, now: number) {
    if (!lock.enabled) return false;
    if (leftAt === undefined) return true;
    return now - leftAt >= lock.timeout * 60_000;
}

export async function lockAvailability(): Promise<{ ok: boolean; reason?: string }> {
    if (Platform.OS === "web") return { ok: false, reason: "当前平台不支持应用锁" };
    const level = await LocalAuthentication.getEnrolledLevelAsync().catch(() => LocalAuthentication.SecurityLevel.NONE);
    if (level === LocalAuthentication.SecurityLevel.NONE) return { ok: false, reason: "请先在系统设置里设置锁屏密码或指纹，再开启应用锁" };
    return { ok: true };
}

export async function authenticate(reason: string): Promise<{ ok: boolean; error?: string }> {
    try {
        const result = await LocalAuthentication.authenticateAsync({ promptMessage: reason, cancelLabel: "取消", disableDeviceFallback: false, requireConfirmation: false });
        if (result.success) return { ok: true };
        return { ok: false, error: result.error === "user_cancel" || result.error === "system_cancel" || result.error === "app_cancel" ? undefined : "验证未通过，请重试" };
    } catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) }; }
}

/** Locked state for the shell: locks on launch and after the chosen time in the background. */
export function useAppLock(lock: LockPreferences, ready: boolean) {
    const [locked, setLocked] = useState(false);
    const leftAt = useRef<number | undefined>(undefined), started = useRef(false), latest = useRef(lock);
    latest.current = lock;
    useEffect(() => { if (ready && !started.current) { started.current = true; setLocked(shouldLock(lock, undefined, Date.now())); } }, [ready]);
    useEffect(() => { if (!lock.enabled) setLocked(false); }, [lock.enabled]);
    useEffect(() => { if (ready && Platform.OS === "android") void configurePrivacy(lock.enabled, lock.secure).catch(() => undefined); }, [ready, lock.enabled, lock.secure]);
    useEffect(() => {
        const sub = AppState.addEventListener("change", state => {
            if (state === "background") leftAt.current = Date.now();
            else if (state === "active" && leftAt.current !== undefined) { if (shouldLock(latest.current, leftAt.current, Date.now())) setLocked(true); leftAt.current = undefined; }
        });
        return () => sub.remove();
    }, []);
    // Render the launch lock immediately, before the effect runs or any private modal mounts.
    return { locked: locked || (ready && lock.enabled && !started.current), unlock: () => setLocked(false) };
}

export function LockScreen({ theme, onUnlock }: { theme: Theme; onUnlock: () => void }) {
    const [error, setError] = useState(""), [busy, setBusy] = useState(false);
    const attempt = async () => {
        if (busy) return; setBusy(true); setError("");
        const result = await authenticate("解锁 Grok Remote");
        setBusy(false);
        if (result.ok) onUnlock(); else if (result.error) setError(result.error);
    };
    useEffect(() => { void attempt(); }, []);
    // A Modal mounted after any open viewer or menu, so nothing private stays above the lock.
    return <Modal visible animationType="none" statusBarTranslucent navigationBarTranslucent onRequestClose={() => BackHandler.exitApp()}>
    <View accessibilityViewIsModal style={{ flex: 1, backgroundColor: theme.bg, alignItems: "center", justifyContent: "center", padding: space.xxl, gap: space.lg }}>
      <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: theme.accentSoft, alignItems: "center", justifyContent: "center" }}><Icon name="lock" size={34} color={theme.accent} /></View>
      <Text accessibilityRole="header" style={{ color: theme.text, fontSize: font.heading, fontWeight: "700" }}>Grok Remote 已锁定</Text>
      <Text style={{ color: theme.muted, fontSize: font.body, textAlign: "center", lineHeight: 22 }}>使用指纹、面容或手机锁屏密码解锁。电脑上的任务不受影响，仍在继续。</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="解锁" onPress={() => void attempt()} disabled={busy}
        style={{ minWidth: 180, minHeight: 48, borderRadius: radius.md, backgroundColor: theme.primary, alignItems: "center", justifyContent: "center", opacity: busy ? 0.6 : 1 }}>
        <Text style={{ color: "#fff", fontSize: font.body, fontWeight: "700" }}>{busy ? "正在验证…" : "解锁"}</Text>
      </Pressable>
      {error ? <Text accessibilityRole="alert" style={{ color: theme.danger }}>{error}</Text> : null}
    </View>
    </Modal>;
}
