import React from "react";
import { Pressable, Text, View, StyleSheet } from "react-native";
import { Banner, Button, Card, IconButton, font, radius, space, ui, type Theme } from "./ui";
import { pickBanners, type BannerInput, type Tab } from "./app-model";

export interface HeaderAction { label: string; icon: string; onPress: () => void; badge?: number; disabled?: boolean }
/** One header for every screen: back or app mark, title with a status line, up to three icon actions. */
export function AppHeader({ theme, title, subtitle, subtitleTone = "muted", onBack, actions = [] }: { theme: Theme; title: string; subtitle?: string; subtitleTone?: "success" | "muted" | "warning"; onBack?: () => void; actions?: HeaderAction[] }) {
  const color = subtitleTone === "success" ? theme.success : subtitleTone === "warning" ? theme.warning : theme.muted;
  return <View style={[ui.header, { borderBottomColor: theme.border, backgroundColor: theme.bg }]}>
    {onBack ? <IconButton label="返回" icon="‹" theme={theme} onPress={onBack} /> : <View style={[styles.logo, { backgroundColor: theme.raised }]}><Text style={{ color: theme.text, fontSize: 17, fontWeight: "700" }}>G</Text></View>}
    <View style={{ flex: 1, paddingLeft: onBack ? 0 : space.xs }}>
      <Text numberOfLines={1} style={[ui.title, { color: theme.text }]}>{title}</Text>
      {subtitle ? <Text numberOfLines={1} style={{ fontSize: font.caption, color, marginTop: 1 }}>{subtitle}</Text> : null}
    </View>
    {actions.map(action => <IconButton key={action.label} label={action.label} icon={action.icon} badge={action.badge} disabled={action.disabled} theme={theme} onPress={action.onPress} />)}
  </View>;
}

const tabs: ReadonlyArray<readonly [Tab, string, string]> = [["sessions", "会话", "◫"], ["activity", "任务", "◷"], ["gallery", "作品", "▧"], ["settings", "设备", "⚙"]];
export const tabTitles: Record<Tab, string> = { sessions: "会话", activity: "任务", gallery: "作品", settings: "设备" };
export function TabBar({ theme, value, onChange, badges = {} }: { theme: Theme; value: Tab; onChange: (tab: Tab) => void; badges?: Partial<Record<Tab, number>> }) {
  return <View accessibilityRole="tablist" style={[ui.nav, { backgroundColor: theme.surface, borderTopColor: theme.border }]}>
    {tabs.map(([id, label, icon]) => {
      const active = value === id, badge = badges[id];
      return <Pressable key={id} accessibilityRole="tab" accessibilityLabel={label} accessibilityState={{ selected: active }} onPress={() => onChange(id)} style={styles.tab}>
        <View style={[styles.tabIcon, active && { backgroundColor: theme.accentSoft }]}>
          <Text style={{ fontSize: 19, color: active ? theme.accent : theme.muted }}>{icon}</Text>
          {badge ? <View style={[styles.badge, { backgroundColor: theme.primary }]}><Text style={{ color: "#fff", fontSize: 10, fontWeight: "700" }}>{badge > 99 ? "99+" : badge}</Text></View> : null}
        </View>
        <Text style={{ fontSize: 11, fontWeight: active ? "700" : "500", color: active ? theme.accent : theme.muted }}>{label}</Text>
      </Pressable>;
    })}
  </View>;
}

/** Connection health plus the single most actionable message; the uncertain-submission card always wins attention. */
export function StatusBanners({ theme, input, onReconnect, onDismissError, onNotice, onRestoreDraft, onShowShare, unknown }: {
  theme: Theme;
  input: BannerInput;
  onReconnect: () => void;
  onDismissError: () => void;
  onNotice: () => void;
  onRestoreDraft: () => void;
  onShowShare: () => void;
  unknown?: { busy: boolean; check: () => void; retry: () => void; acknowledge: () => void };
}) {
  const banners = pickBanners(input);
  return <>
    {unknown ? <Card theme={theme} style={{ margin: space.md, padding: space.md, borderColor: theme.warning }}>
      <Text style={[ui.hint, { color: theme.text }]}>上次提交结果待确认，草稿已保留。先核对，避免重复执行。</Text>
      <View style={[ui.row, { flexWrap: "wrap" }]}>
        <Button compact primary title="核对回执" theme={theme} disabled={unknown.busy} onPress={unknown.check} />
        <Button compact title="原 ID 重试" theme={theme} disabled={unknown.busy} onPress={unknown.retry} />
        <Button compact ghost title="已查看结果" theme={theme} onPress={unknown.acknowledge} />
      </View>
    </Card> : null}
    {banners.map(banner => {
      switch (banner.kind) {
        case "connection": return <Banner key={banner.kind} theme={theme} tone={banner.tone} text={banner.text} action="重连" onAction={onReconnect} />;
        case "failed-send": return <Banner key={banner.kind} theme={theme} tone="danger" text={banner.text} action="恢复草稿" onAction={onRestoreDraft} onDismiss={onDismissError} />;
        case "error": return <Banner key={banner.kind} theme={theme} tone="danger" text={banner.text} onDismiss={onDismissError} />;
        case "creating": return <Banner key={banner.kind} theme={theme} text={banner.text} busy />;
        case "notice": return <Banner key={banner.kind} theme={theme} text={banner.text} onPress={onNotice} />;
        case "share": return <Banner key={banner.kind} theme={theme} text={banner.text} action="处理" onAction={onShowShare} />;
      }
    })}
  </>;
}
const styles = StyleSheet.create({
  logo: { height: 34, width: 34, borderRadius: 10, alignItems: "center", justifyContent: "center", marginLeft: space.sm, marginRight: 2 },
  tab: { flex: 1, minHeight: 54, alignItems: "center", justifyContent: "center", gap: 2 },
  tabIcon: { minWidth: 52, height: 28, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  badge: { position: "absolute", top: -3, right: 6, minWidth: 16, height: 16, borderRadius: 8, paddingHorizontal: 3, alignItems: "center", justifyContent: "center" },
});
