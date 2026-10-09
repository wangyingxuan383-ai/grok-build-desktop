import React from "react";
import { ScrollView, Text, View, useWindowDimensions } from "react-native";
import { Interaction } from "./forms";
import { Icon } from "./icons";
import { Button, font, space, ui, type Theme } from "./ui";
import type { ChatEvent, } from "../../../src/shared/types";
import type { RemoteCommand } from "../../../src/shared/remote";

/**
 * The oldest open request (permission, question, plan) shown right above the composer, so it
 * can be answered without opening a sheet. Capped at 35% of the screen so the keyboard never
 * pushes the composer away; further requests stay one tap away in the full list.
 */
export function InlinePending({ pending, theme, disabled, submit, onAll }: {
    pending: ChatEvent[];
    theme: Theme;
    disabled: boolean;
    submit: (action: RemoteCommand["action"], extra: Partial<RemoteCommand>) => void;
    onAll: () => void;
}) {
    const { height } = useWindowDimensions();
    const event = pending[0];
    if (!event) return null;
    const key = event.type === "permission" ? String(event.request.requestId) : "requestId" in event ? String(event.requestId) : event.type;
    return <View accessibilityRole="alert" style={{ maxHeight: Math.round(height * 0.35), borderTopWidth: 2, borderColor: theme.warning, backgroundColor: theme.bg }}>
      <View style={[ui.row, { gap: space.sm, paddingHorizontal: space.md, paddingTop: space.sm }]}>
        <Icon name="warning" size={16} color={theme.warning} />
        <Text style={{ flex: 1, color: theme.text, fontSize: font.small, fontWeight: "700" }}>需要你确认{pending.length > 1 ? ` · 共 ${pending.length} 项` : ""}</Text>
        {pending.length > 1 ? <Button compact ghost title="查看全部" theme={theme} onPress={onAll} /> : null}
      </View>
      <ScrollView contentContainerStyle={{ paddingHorizontal: space.md, paddingTop: space.xs }} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
        <Interaction key={key} event={event} theme={theme} disabled={disabled} submit={submit} />
      </ScrollView>
    </View>;
}
