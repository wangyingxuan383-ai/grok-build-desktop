import React, { Component, type ReactNode } from "react";
import { Platform, Pressable, ScrollView, Share, Text, View } from "react-native";
import { MOBILE_VERSION } from "./version";

type State = { failed: boolean; errorName: string; attempt: number };

export class StartupBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { failed: false, errorName: "", attempt: 0 };

  static getDerivedStateFromError(error: unknown): Partial<State> {
    const name = error instanceof Error ? error.name : "Error";
    return { failed: true, errorName: ["Error", "TypeError", "RangeError", "ReferenceError", "SyntaxError"].includes(name) ? name : "Error" };
  }

  render() {
    if (!this.state.failed) return <React.Fragment key={this.state.attempt}>{this.props.children}</React.Fragment>;
    const diagnostic = `Grok Remote ${MOBILE_VERSION}\nPlatform: ${Platform.OS}\nStage: application-load-or-render\nError: ${this.state.errorName}`;
    return <View style={{ flex: 1, backgroundColor: "#121418", padding: 24, paddingTop: 64 }}>
      <ScrollView contentContainerStyle={{ gap: 20 }}>
        <Text accessibilityRole="header" style={{ color: "#f1f3f7", fontSize: 22 }}>应用界面遇到问题</Text>
        <Text style={{ color: "#a2aab8", fontSize: 16, lineHeight: 25 }}>可以重试加载。不会清除已配对电脑、草稿或历史，也不会重新发送任务。</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="重试加载" onPress={() => this.setState(state => ({ failed: false, errorName: "", attempt: state.attempt + 1 }))} style={{ padding: 16, backgroundColor: "#4776d8", borderRadius: 12 }}>
          <Text style={{ color: "#fff", textAlign: "center" }}>重试加载</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="分享启动诊断" onPress={() => { void Share.share({ message: diagnostic }).catch(() => undefined); }} style={{ padding: 16, backgroundColor: "#252a32", borderRadius: 12 }}>
          <Text style={{ color: "#f1f3f7", textAlign: "center" }}>分享启动诊断</Text>
        </Pressable>
        <Text selectable style={{ color: "#a2aab8", lineHeight: 22 }}>{diagnostic}</Text>
      </ScrollView>
    </View>;
  }
}

function LoadApplication() {
  // Keep application module initialization inside the boundary as well as rendering.
  const App = require("../App").default as React.ComponentType;
  return <App />;
}

export function StartupRoot() {
  return <StartupBoundary><LoadApplication /></StartupBoundary>;
}
