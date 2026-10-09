import { Platform } from "react-native";
import * as Haptics from "expo-haptics";

/**
 * Haptics named by intent rather than by vibration length, so every screen gives the same
 * feel for the same meaning. One switch in Settings turns all of them off; failures are
 * swallowed because feedback must never break an action.
 */
export type HapticIntent = "tap" | "selection" | "toggle" | "threshold" | "longPress" | "confirm" | "success" | "error";

let enabled = true;
export function setHapticsEnabled(value: boolean) { enabled = value; }
export function hapticsEnabled() { return enabled; }

const android: Record<HapticIntent, Haptics.AndroidHaptics> = {
    tap: Haptics.AndroidHaptics.Virtual_Key,
    selection: Haptics.AndroidHaptics.Segment_Tick,
    toggle: Haptics.AndroidHaptics.Toggle_On,
    threshold: Haptics.AndroidHaptics.Context_Click,
    longPress: Haptics.AndroidHaptics.Long_Press,
    confirm: Haptics.AndroidHaptics.Confirm,
    success: Haptics.AndroidHaptics.Confirm,
    error: Haptics.AndroidHaptics.Reject,
};

export function haptic(intent: HapticIntent = "tap") {
    if (!enabled || Platform.OS === "web") return;
    const run = Platform.OS === "android"
        ? Haptics.performAndroidHapticsAsync(android[intent])
        : intent === "error" ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
            : intent === "success" ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
                : intent === "selection" ? Haptics.selectionAsync() : Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    void run.catch(() => undefined);
}
