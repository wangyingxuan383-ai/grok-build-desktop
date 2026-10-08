import React, { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Modal, PanResponder, Platform, Pressable, ScrollView, Text, Vibration, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { font, radius, space, ui, type Theme } from "./ui";

/**
 * Touch gestures built only on React Native's PanResponder/Animated, so they add no native
 * module to the APK. Horizontal swipes start only after a clearly horizontal movement,
 * leaving vertical list scrolling and the Android edge back gesture untouched.
 */
export function haptic() { if (Platform.OS === "android") Vibration.vibrate(12); }

export interface SwipeAction { label: string; color: string; onPress: () => void; accessibilityLabel?: string }

/** Only one row stays open; opening another closes the previous one like system lists. */
let closeOpenRow: (() => void) | undefined;
/**
 * A finished swipe must not also count as a tap or long-press on the row underneath
 * (React Native Web, and some Android builds, still deliver the press on release).
 */
let swipeActive = false, swipeEndedAt = 0;
export function swipeInProgress(): boolean { return swipeActive || Date.now() - swipeEndedAt < 400; }
const endSwipe = () => { swipeActive = false; swipeEndedAt = Date.now(); };

export function SwipeRow({ children, theme, leading, trailing, disabled = false }: {
    children: React.ReactNode;
    theme: Theme;
    /** Swipe right: a single quick action that fires on release past the threshold (e.g. favourite). */
    leading?: SwipeAction;
    /** Swipe left: buttons that stay revealed until tapped or swiped closed (e.g. archive, delete). */
    trailing?: SwipeAction[];
    disabled?: boolean;
}) {
    const x = useRef(new Animated.Value(0)).current;
    const offset = useRef(0), armed = useRef(false);
    // Actions exist only while the row is being swiped or held open, so screen readers and
    // taps never reach buttons hidden under the row (TalkBack uses the long-press menu).
    const [revealed, setRevealed] = useState(false);
    const trailingWidth = (trailing?.length ?? 0) * 84;
    const motion = useRef({
        settle: (to: number) => { offset.current = to; Animated.spring(x, { toValue: to, useNativeDriver: true, bounciness: 0, speed: 18 }).start(({ finished }) => { if (finished && offset.current === 0) setRevealed(false); }); },
        close: () => motion.current.settle(0),
    });
    const { settle, close } = motion.current;
    useEffect(() => () => { if (closeOpenRow === close) closeOpenRow = undefined; }, []);
    const responder = useMemo(() => PanResponder.create({
        onMoveShouldSetPanResponder: (_e, g) => !disabled && Math.abs(g.dx) > 14 && Math.abs(g.dx) > Math.abs(g.dy) * 1.8,
        onPanResponderGrant: () => { swipeActive = true; setRevealed(true); if (closeOpenRow && closeOpenRow !== close) closeOpenRow(); armed.current = false; },
        onPanResponderMove: (_e, g) => {
            let next = offset.current + g.dx;
            if (!leading) next = Math.min(0, next);
            if (!trailingWidth) next = Math.max(0, next);
            // Resist past the natural reveal width so the row never flies off screen.
            if (next > 96) next = 96 + (next - 96) * 0.25;
            if (next < -trailingWidth) next = -trailingWidth + (next + trailingWidth) * 0.25;
            const nowArmed = next > 72;
            if (nowArmed !== armed.current) { armed.current = nowArmed; if (nowArmed) haptic(); }
            x.setValue(next);
        },
        onPanResponderRelease: (_e, g) => {
            endSwipe();
            const final = offset.current + g.dx;
            if (leading && final > 72) { settle(0); leading.onPress(); return; }
            if (trailingWidth && (final < -trailingWidth / 2 || g.vx < -0.6)) { settle(-trailingWidth); closeOpenRow = close; return; }
            settle(0);
        },
        onPanResponderTerminate: () => { endSwipe(); settle(0); },
        onPanResponderTerminationRequest: () => false,
    }), [disabled, leading, trailingWidth]);
    const leadingOpacity = x.interpolate({ inputRange: [0, 24, 72], outputRange: [0, 0.6, 1], extrapolate: "clamp" });
    return <View style={{ overflow: "hidden" }}>
      {revealed ? <View style={{ position: "absolute", top: 0, bottom: 0, left: 0, right: 0, flexDirection: "row", justifyContent: "space-between" }}>
        {leading ? <Animated.View style={{ justifyContent: "center", paddingHorizontal: space.xl, backgroundColor: leading.color, opacity: leadingOpacity, flex: 1 }}>
          <Text style={{ color: "#fff", fontWeight: "700", fontSize: font.small }}>{leading.label}</Text>
        </Animated.View> : <View style={{ flex: 1 }} />}
        {trailing?.length ? <View style={{ flexDirection: "row", position: "absolute", right: 0, top: 0, bottom: 0 }}>
          {trailing.map(action => <Pressable key={action.label} accessibilityRole="button" accessibilityLabel={action.accessibilityLabel || action.label} onPress={() => { close(); action.onPress(); }} style={{ width: 84, alignItems: "center", justifyContent: "center", backgroundColor: action.color }}>
            <Text style={{ color: "#fff", fontWeight: "700", fontSize: font.small }}>{action.label}</Text>
          </Pressable>)}
        </View> : null}
      </View> : null}
      <Animated.View {...responder.panHandlers} style={{ transform: [{ translateX: x }], backgroundColor: theme.bg }}>
        {children}
      </Animated.View>
    </View>;
}

export interface MenuItem { label: string; detail?: string; onPress: () => void; danger?: boolean; disabled?: boolean; keepOpen?: boolean }

/** Long-press menu: the phone's equivalent of a desktop right-click. */
export function ActionMenu({ visible, title, subtitle, items, theme, onClose, children }: {
    visible: boolean; title?: string; subtitle?: string; items: MenuItem[]; theme: Theme; onClose: () => void; children?: React.ReactNode;
}) {
    return <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={ui.modal}>
        <Pressable style={{ flex: 1 }} accessibilityLabel="关闭菜单" onPress={onClose} />
        <SafeAreaView edges={["bottom"]} style={[ui.sheet, { backgroundColor: theme.surface, gap: space.sm }]}>
          <View style={{ alignSelf: "center", width: 36, height: 4, borderRadius: 2, backgroundColor: theme.border }} />
          {title ? <Text numberOfLines={2} style={{ color: theme.text, fontSize: font.title, fontWeight: "700" }}>{title}</Text> : null}
          {subtitle ? <Text numberOfLines={2} style={{ color: theme.muted, fontSize: font.small }}>{subtitle}</Text> : null}
          {children}
          <ScrollView style={{ flexShrink: 1 }} keyboardShouldPersistTaps="handled">
            <View style={{ borderRadius: radius.md, overflow: "hidden", backgroundColor: theme.raised }}>
              {items.map((item, index) => <Pressable key={item.label} accessibilityRole="menuitem" disabled={item.disabled} onPress={() => { if (!item.keepOpen) onClose(); item.onPress(); }} style={({ pressed }) => ({ minHeight: 50, paddingHorizontal: space.lg, paddingVertical: space.md, justifyContent: "center", opacity: item.disabled ? 0.45 : 1, backgroundColor: pressed ? theme.border : "transparent", borderTopWidth: index ? 1 : 0, borderTopColor: theme.border })}>
                <Text style={{ color: item.danger ? theme.danger : theme.text, fontSize: font.body, fontWeight: "600" }}>{item.label}</Text>
                {item.detail ? <Text style={{ color: theme.muted, fontSize: font.caption, marginTop: 2 }}>{item.detail}</Text> : null}
              </Pressable>)}
            </View>
          </ScrollView>
        </SafeAreaView>
      </View>
    </Modal>;
}

/** Tracks which item a long-press menu is open for. */
export function useMenuTarget<T>() {
    const [target, setTarget] = useState<T>();
    return { target, open: (value: T) => { haptic(); setTarget(value); }, close: () => setTarget(undefined) };
}
