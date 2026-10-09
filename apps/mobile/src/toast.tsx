import React, { useEffect, useState, useSyncExternalStore } from "react";
import { Pressable, Text, View } from "react-native";
import Animated, { FadeInDown, FadeOutDown } from "react-native-reanimated";
import { haptic } from "./haptics";
import { font, radius, space, type Theme } from "./ui";

/**
 * Short confirmation with an optional action (usually "撤销"), shown above the tab bar.
 * Reversible actions (archive, favourite, mute) use this instead of a confirmation dialog;
 * irreversible ones (deleting on the computer) still ask first.
 */
export interface ToastSpec { id: number; text: string; action?: { label: string; onPress: () => void }; duration: number }
let current: ToastSpec | undefined, seq = 0;
const listeners = new Set<() => void>();
const emit = () => { for (const listener of listeners) listener(); };

export function showToast(text: string, action?: ToastSpec["action"], duration = action ? 5000 : 2600) {
    current = { id: ++seq, text, action, duration };
    emit();
}
export function hideToast(id?: number) { if (!id || current?.id === id) { current = undefined; emit(); } }

export function ToastHost({ theme, bottom = 72 }: { theme: Theme; bottom?: number }) {
    const toast = useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => current);
    const [, force] = useState(0);
    useEffect(() => {
        if (!toast) return;
        const timer = setTimeout(() => hideToast(toast.id), toast.duration);
        return () => clearTimeout(timer);
    }, [toast?.id]);
    if (!toast) return null;
    return <Animated.View key={toast.id} entering={FadeInDown.duration(160)} exiting={FadeOutDown.duration(140)} pointerEvents="box-none"
      style={{ position: "absolute", left: space.lg, right: space.lg, bottom, alignItems: "center" }}>
      <View accessibilityLiveRegion="polite" style={{ flexDirection: "row", alignItems: "center", gap: space.md, minHeight: 48, maxWidth: 520, alignSelf: "stretch", paddingLeft: space.lg, paddingRight: toast.action ? space.xs : space.lg, borderRadius: radius.md, backgroundColor: theme === undefined ? "#222" : theme.text, elevation: 6, shadowColor: "#000", shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } }}>
        <Text numberOfLines={2} style={{ flex: 1, color: theme.bg, fontSize: font.small, fontWeight: "600" }}>{toast.text}</Text>
        {toast.action ? <Pressable accessibilityRole="button" accessibilityLabel={toast.action.label} hitSlop={8} onPress={() => { haptic("tap"); toast.action!.onPress(); hideToast(toast.id); force(v => v + 1); }}
          style={{ paddingHorizontal: space.md, minHeight: 40, justifyContent: "center" }}>
          <Text style={{ color: theme.accent === "#a5c3ff" ? "#4776d8" : "#a5c3ff", fontSize: font.small, fontWeight: "800" }}>{toast.action.label}</Text>
        </Pressable> : null}
      </View>
    </Animated.View>;
}
