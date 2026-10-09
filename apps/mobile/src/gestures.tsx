import React, { useEffect, useRef, useState } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { interpolate, runOnJS, useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { haptic as hapticIntent } from "./haptics";
import { Icon, type IconName } from "./icons";
import { font, radius, space, ui, type Theme } from "./ui";

/** Light tap feedback; kept for callers that predate the intent-based haptics module. */
export function haptic() { hapticIntent("longPress"); }

export interface SwipeAction { label: string; color: string; onPress: () => void; accessibilityLabel?: string; icon?: IconName }

/** Only one row stays open; opening another closes the previous one like system lists. */
let closeOpenRow: (() => void) | undefined;
/** A finished swipe must not also count as a tap or long-press on the row underneath. */
let swipeActive = false, swipeEndedAt = 0;
export function swipeInProgress(): boolean { return swipeActive || Date.now() - swipeEndedAt < 400; }
const startSwipe = () => { swipeActive = true; };
const endSwipe = () => { swipeActive = false; swipeEndedAt = Date.now(); };
const cancelSwipe = () => { swipeActive = false; };

const ARM = 72, ACTION_WIDTH = 84;

/**
 * Swipe row on the native gesture thread. It activates only after a clearly horizontal move
 * and fails on vertical movement, so list scrolling and the Android edge-back gesture are
 * untouched. Swiping right past the threshold fires one quick action on release (with a
 * haptic tick when armed); swiping left reveals buttons that stay until tapped or closed.
 */
export function SwipeRow({ children, theme, leading, trailing, disabled = false }: {
    children: React.ReactNode;
    theme: Theme;
    leading?: SwipeAction;
    trailing?: SwipeAction[];
    disabled?: boolean;
}) {
    const x = useSharedValue(0), start = useSharedValue(0), armed = useSharedValue(false);
    const [revealed, setRevealed] = useState(false);
    const trailingWidth = (trailing?.length ?? 0) * ACTION_WIDTH;
    const hasLeading = Boolean(leading);
    const closeRef = useRef(() => { x.value = withSpring(0, { damping: 22, stiffness: 220 }, done => { if (done) runOnJS(setRevealed)(false); }); });
    const close = closeRef.current;
    useEffect(() => () => { if (closeOpenRow === close) closeOpenRow = undefined; }, []);
    const fireLeading = () => { leading?.onPress(); };
    const opened = () => { if (closeOpenRow && closeOpenRow !== close) closeOpenRow(); closeOpenRow = close; };
    const began = () => { startSwipe(); setRevealed(true); if (closeOpenRow && closeOpenRow !== close) closeOpenRow(); };
    const tick = () => hapticIntent("threshold");
    const pan = Gesture.Pan().enabled(!disabled).activeOffsetX([-14, 14]).failOffsetY([-10, 10])
        .onStart(() => { start.value = x.value; armed.value = false; runOnJS(began)(); })
        .onUpdate(e => {
            let next = start.value + e.translationX;
            if (!hasLeading) next = Math.min(0, next);
            if (!trailingWidth) next = Math.max(0, next);
            // Resist past the natural reveal width so the row never flies off screen.
            if (next > 96) next = 96 + (next - 96) * 0.25;
            if (next < -trailingWidth) next = -trailingWidth + (next + trailingWidth) * 0.25;
            const nowArmed = next > ARM;
            if (nowArmed !== armed.value) { armed.value = nowArmed; if (nowArmed) runOnJS(tick)(); }
            x.value = next;
        })
        .onEnd(e => {
            const final = x.value;
            if (hasLeading && final > ARM) { x.value = withSpring(0, { damping: 22, stiffness: 220 }, done => { if (done) runOnJS(setRevealed)(false); }); runOnJS(fireLeading)(); }
            else if (trailingWidth && (final < -trailingWidth / 2 || e.velocityX < -600)) { x.value = withSpring(-trailingWidth, { damping: 22, stiffness: 220 }); runOnJS(opened)(); }
            else x.value = withSpring(0, { damping: 22, stiffness: 220 }, done => { if (done) runOnJS(setRevealed)(false); });
        })
        .onFinalize((_event, success) => {
            // A tap or a vertical scroll fails this recognizer; it must not suppress the tap.
            if (success) runOnJS(endSwipe)();
            else { x.value = withSpring(0); runOnJS(setRevealed)(false); runOnJS(cancelSwipe)(); }
        });
    const rowStyle = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
    const leadingStyle = useAnimatedStyle(() => ({ opacity: interpolate(x.value, [0, 24, ARM], [0, 0.6, 1], "clamp") }));
    const leadingIcon = useAnimatedStyle(() => ({ transform: [{ scale: interpolate(x.value, [ARM - 8, ARM + 8], [0.85, 1.15], "clamp") }] }));
    return <View style={{ overflow: "hidden" }}>
      {revealed ? <View style={{ position: "absolute", top: 0, bottom: 0, left: 0, right: 0, flexDirection: "row", justifyContent: "space-between" }}>
        {leading ? <Animated.View style={[{ justifyContent: "center", paddingHorizontal: space.xl, backgroundColor: leading.color, flex: 1 }, leadingStyle]}>
          <Animated.View style={[{ flexDirection: "row", alignItems: "center", gap: 6 }, leadingIcon]}>
            {leading.icon ? <Icon name={leading.icon} size={18} color="#fff" /> : null}
            <Text style={{ color: "#fff", fontWeight: "700", fontSize: font.small }}>{leading.label}</Text>
          </Animated.View>
        </Animated.View> : <View style={{ flex: 1 }} />}
        {trailing?.length ? <View style={{ flexDirection: "row", position: "absolute", right: 0, top: 0, bottom: 0 }}>
          {trailing.map(action => <Pressable key={action.label} accessibilityRole="button" accessibilityLabel={action.accessibilityLabel || action.label} onPress={() => { close(); action.onPress(); }} style={{ width: ACTION_WIDTH, alignItems: "center", justifyContent: "center", gap: 3, backgroundColor: action.color }}>
            {action.icon ? <Icon name={action.icon} size={18} color="#fff" /> : null}
            <Text style={{ color: "#fff", fontWeight: "700", fontSize: font.small }}>{action.label}</Text>
          </Pressable>)}
        </View> : null}
      </View> : null}
      <GestureDetector gesture={pan}>
        <Animated.View style={[{ backgroundColor: theme.bg }, rowStyle]}>
          {children}
        </Animated.View>
      </GestureDetector>
    </View>;
}

export interface MenuItem { label: string; detail?: string; onPress: () => void; danger?: boolean; disabled?: boolean; keepOpen?: boolean; icon?: IconName; /** Marks the current choice with a trailing check instead of greying it out. */ checked?: boolean }

/** Long-press menu: the phone's equivalent of a desktop right-click. */
export function ActionMenu({ visible, title, subtitle, items, theme, onClose, children }: {
    visible: boolean; title?: string; subtitle?: string; items: MenuItem[]; theme: Theme; onClose: () => void; children?: React.ReactNode;
}) {
    return <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <View style={ui.modal}>
        <Pressable style={{ flex: 1 }} accessibilityLabel="关闭菜单" onPress={onClose} />
        <SafeAreaView edges={["bottom"]} style={[ui.sheet, { backgroundColor: theme.surface, gap: space.sm }]}>
          <View style={{ alignSelf: "center", width: 36, height: 4, borderRadius: 2, backgroundColor: theme.border }} />
          {title ? <Text numberOfLines={2} style={{ color: theme.text, fontSize: font.title, fontWeight: "700" }}>{title}</Text> : null}
          {subtitle ? <Text numberOfLines={2} style={{ color: theme.muted, fontSize: font.small }}>{subtitle}</Text> : null}
          {children}
          <ScrollView style={{ flexShrink: 1 }} keyboardShouldPersistTaps="handled">
            <View style={{ borderRadius: radius.md, overflow: "hidden", backgroundColor: theme.raised }}>
              {items.map((item, index) => <Pressable key={item.label} accessibilityRole="menuitem" accessibilityLabel={item.label} accessibilityHint={item.detail} accessibilityState={{ disabled: item.disabled, checked: item.checked }} disabled={item.disabled} onPress={() => { hapticIntent("tap"); if (!item.keepOpen) onClose(); item.onPress(); }} style={({ pressed }) => ({ minHeight: 50, paddingHorizontal: space.lg, paddingVertical: space.md, flexDirection: "row", alignItems: "center", gap: space.md, opacity: item.disabled ? 0.45 : 1, backgroundColor: pressed ? theme.border : "transparent", borderTopWidth: index ? 1 : 0, borderTopColor: theme.border })}>
                {item.icon ? <Icon name={item.icon} size={20} color={item.danger ? theme.danger : item.checked ? theme.accent : theme.muted} /> : null}
                <View style={{ flex: 1 }}>
                  <Text style={{ color: item.danger ? theme.danger : theme.text, fontSize: font.body, fontWeight: "600" }}>{item.label}</Text>
                  {item.detail ? <Text style={{ color: theme.muted, fontSize: font.caption, marginTop: 2 }}>{item.detail}</Text> : null}
                </View>
                {item.checked ? <Icon name="check" size={20} color={theme.accent} /> : null}
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
    return { target, open: (value: T) => { hapticIntent("longPress"); setTarget(value); }, close: () => setTarget(undefined) };
}
