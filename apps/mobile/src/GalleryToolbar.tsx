import React from "react";
import { Text, View } from "react-native";
import { Segmented, space, ui, type Theme } from "./ui";

export function GalleryToolbar({ count, layout, onChange, theme }: {
  count: number; layout: "grid" | "cards"; onChange: (value: "grid" | "cards") => void; theme: Theme;
}) {
  return <View style={{ gap: space.xs }}>
    <View style={[ui.row, { justifyContent: "space-between", minWidth: 0 }]}>
      <Text numberOfLines={1} style={[ui.hint, { flex: 1, minWidth: 0, color: theme.muted }]}>{count} 张</Text>
      <View style={{ width: 148, flexShrink: 0 }}>
        <Segmented theme={theme} value={layout} onChange={onChange} items={[["grid", "网格"], ["cards", "卡片"]] as const} />
      </View>
    </View>
    {layout === "grid" ? <Text style={[ui.hint, { color: theme.muted }]}>点开后左右滑动浏览</Text> : null}
  </View>;
}
