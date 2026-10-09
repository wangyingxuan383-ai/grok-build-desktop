import React from "react";
import { Pressable, Text, View } from "react-native";
import { Segmented, font, radius, space, ui, type Theme } from "./ui";
import { Icon } from "./icons";
import type { GalleryView } from "./gallery-model";

/**
 * Count + sort (one tappable label) and the grid/cards switch on the first row, kept at a fixed
 * width so the switch is never squeezed; grid-only columns and multi-select on a second row.
 */
export function GalleryToolbar({ count, view, onChange, selecting, onSelect, theme }: {
  count: number; view: GalleryView; onChange: (patch: Partial<GalleryView>) => void;
  selecting: boolean; onSelect: () => void; theme: Theme;
}) {
  const pill = (label: string, active: boolean, onPress: () => void, accessibilityLabel?: string) =>
    <Pressable key={label} accessibilityRole="button" accessibilityLabel={accessibilityLabel || label} accessibilityState={{ selected: active }} onPress={onPress} hitSlop={6}
      style={{ paddingHorizontal: space.md, minHeight: 32, justifyContent: "center", borderRadius: radius.pill, backgroundColor: active ? theme.accentSoft : theme.raised }}>
      <Text style={{ color: active ? theme.accent : theme.muted, fontSize: font.small, fontWeight: "600" }}>{label}</Text>
    </Pressable>;
  return <View style={{ gap: space.sm }}>
    <View style={[ui.row, { justifyContent: "space-between", minWidth: 0 }]}>
      <Pressable accessibilityRole="button" accessibilityLabel="切换排序" accessibilityHint={view.sort === "newest" ? "当前最新在前" : "当前最早在前"} onPress={() => onChange({ sort: view.sort === "newest" ? "oldest" : "newest" })} hitSlop={8}
        style={({ pressed }) => [ui.row, { flex: 1, minWidth: 0, gap: 4, opacity: pressed ? .6 : 1 }]}>
        <Text numberOfLines={1} style={[ui.hint, { flexShrink: 1, color: theme.muted }]}>{count} 张 · {view.sort === "newest" ? "最新在前" : "最早在前"}</Text>
        <Icon name="swapVertical" size={14} color={theme.muted} />
      </Pressable>
      <View style={{ width: 148, flexShrink: 0 }}>
        <Segmented theme={theme} value={view.layout} onChange={layout => onChange({ layout })} items={[["grid", "网格"], ["cards", "卡片"]] as const} />
      </View>
    </View>
    {view.layout === "grid" ? <View style={[ui.row, { gap: space.sm }]}>
      {([3, 4, 5] as const).map(columns => pill(`${columns} 列`, view.columns === columns, () => onChange({ columns })))}
      <View style={{ flex: 1 }} />
      <Pressable accessibilityRole="button" accessibilityLabel={selecting ? "退出多选" : "多选"} onPress={onSelect} hitSlop={6}
        style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: space.md, minHeight: 32, borderRadius: radius.pill, backgroundColor: selecting ? theme.accentSoft : theme.raised }}>
        <Icon name={selecting ? "checkCircle" : "selectCircle"} size={15} color={selecting ? theme.accent : theme.muted} />
        <Text style={{ color: selecting ? theme.accent : theme.muted, fontSize: font.small, fontWeight: "600" }}>{selecting ? "完成" : "多选"}</Text>
      </Pressable>
    </View> : null}
  </View>;
}
