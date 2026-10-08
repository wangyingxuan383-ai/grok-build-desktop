import React, { useState } from "react";
import { Platform, Text, View } from "react-native";
import { requireNativeViewManager } from "expo-modules-core";
import type { HostConnection } from "./transport";

type Props = { source: Pick<HostConnection, "host" | "fingerprint" | "token"> & { ticket: string }; style?: object };
let cached: React.ComponentType<Props> | undefined;

export function NativeHtmlPreview(props: Props) {
  const [preview] = useState(() => {
    if (Platform.OS !== "android") return undefined;
    try {
      return cached ??= requireNativeViewManager<Props>("GrokRemote");
    } catch {
      return undefined;
    }
  });
  const Preview = preview;
  return Preview ? <Preview {...props} /> : <View style={props.style}>
    <Text style={{ color: "#ae3636", lineHeight: 24 }}>HTML 预览组件不可用。可以返回继续使用，或保存文件后用其他应用打开。</Text>
  </View>;
}
