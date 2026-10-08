import React, { useMemo } from "react";
import { View, Text, ScrollView, Linking } from "react-native";
import MarkdownIt from "markdown-it";
import type Token from "markdown-it/lib/token.mjs";
import * as Clipboard from "expo-clipboard";
import { Button, type Theme, ui } from "./ui";
const parser = new MarkdownIt({ html: false, linkify: true, breaks: true });
function inline(tokens: Token[], theme: Theme, onLink?: (url: string) => void): React.ReactNode[] {
    let bold = false, italic = false, strike = false, href = "";
    return tokens.map((token, index) => {
        if (token.type === "strong_open") {
            bold = true;
            return null;
        }
        if (token.type === "strong_close") {
            bold = false;
            return null;
        }
        if (token.type === "em_open") {
            italic = true;
            return null;
        }
        if (token.type === "em_close") {
            italic = false;
            return null;
        }
        if (token.type === "s_open") {
            strike = true;
            return null;
        }
        if (token.type === "s_close") {
            strike = false;
            return null;
        }
        if (token.type === "link_open") {
            href = token.attrGet("href") || "";
            return null;
        }
        if (token.type === "link_close") {
            href = "";
            return null;
        }
        if (token.type === "softbreak" || token.type === "hardbreak")
            return "\n";
        const url = token.type === "image" ? token.attrGet("src") || "" : href;
        return <Text key={index} style={{ fontWeight: bold ? "700" : undefined, fontStyle: italic ? "italic" : undefined, textDecorationLine: strike ? "line-through" : url ? "underline" : "none", color: url ? theme.accent : theme.text, ...(token.type === "code_inline" ? { fontFamily: "monospace", backgroundColor: theme.raised, fontSize: 14 } : {}) }} onPress={url ? () => { if (onLink && !/^https?:\/\//i.test(url))
            onLink(url);
        else if (/^https?:\/\//i.test(url))
            void Linking.openURL(url).catch(() => undefined); } : undefined}>{token.type === "image" ? `[图片：${token.content || "点击查看"}]` : token.content}</Text>;
    });
}
export const Markdown = React.memo(function Markdown({ value, theme, onLink }: {
    value: string;
    theme: Theme;
    onLink?: (url: string) => void;
}) {
    const tokens = useMemo(() => parser.parse(value, {}), [value]);
    let depth = 0, ordered = 0, item = false, quote = 0, heading = 0;
    const rows: React.ReactNode[] = [];
    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i]!;
        if (token.type === "bullet_list_open" || token.type === "ordered_list_open") {
            depth++;
            ordered = token.type === "ordered_list_open" ? Number(token.attrGet("start") || 1) : 0;
            continue;
        }
        if (token.type.endsWith("list_close")) {
            depth = Math.max(0, depth - 1);
            ordered = 0;
            continue;
        }
        if (token.type === "list_item_open") {
            item = true;
            continue;
        }
        if (token.type === "blockquote_open") {
            quote++;
            continue;
        }
        if (token.type === "blockquote_close") {
            quote--;
            continue;
        }
        if (token.type === "heading_open") {
            heading = Number(token.tag.slice(1));
            continue;
        }
        if (token.type === "heading_close") {
            heading = 0;
            continue;
        }
        if (token.type === "fence" || token.type === "code_block")
            rows.push(<View key={i} style={{ borderRadius: 12, backgroundColor: theme.raised, marginVertical: 8, overflow: "hidden" }}><View style={[ui.row, { paddingHorizontal: 12, paddingTop: 8, justifyContent: "space-between" }]}><Text style={{ color: theme.muted, fontSize: 12 }}>{token.info || "代码"}</Text><Button compact title="复制代码" theme={theme} onPress={() => void Clipboard.setStringAsync(token.content)}/></View><ScrollView horizontal contentContainerStyle={{ padding: 14 }}><Text selectable style={{ fontFamily: "monospace", fontSize: 13, lineHeight: 21, color: theme.text }}>{token.content.trimEnd()}</Text></ScrollView></View>);
        else if (token.type === "inline")
            rows.push(<View key={i} style={{ flexDirection: "row", marginVertical: heading ? 9 : 5, marginLeft: Math.max(0, depth - 1) * 14, paddingLeft: quote ? 12 : 0, borderLeftWidth: quote ? 3 : 0, borderColor: theme.border }}>{item ? <Text style={{ color: theme.muted, marginRight: 8, lineHeight: 25 }}>{ordered ? `${ordered++}.` : "•"}</Text> : null}<Text selectable style={{ flexShrink: 1, fontSize: heading ? Math.max(17, 26 - heading * 2) : 16, fontWeight: heading ? "700" : "400", lineHeight: heading ? 30 : 26, color: theme.text }}>{inline(token.children ?? [], theme, onLink)}</Text></View>);
        else if (token.type === "paragraph_close")
            item = false;
        else if (token.type === "hr")
            rows.push(<View key={i} style={{ height: 1, backgroundColor: theme.border, marginVertical: 12 }}/>);
        else if (token.type === "table_open") {
            const table: string[][] = [];
            let line: string[] = [];
            while (++i < tokens.length && tokens[i]!.type !== "table_close") {
                const cell = tokens[i]!;
                if (cell.type === "tr_open")
                    line = [];
                if (cell.type === "inline")
                    line.push(cell.content);
                if (cell.type === "tr_close")
                    table.push(line);
            }
            rows.push(<ScrollView horizontal key={`table-${i}`} style={{ marginVertical: 10 }}><View>{table.map((cells, index) => <View key={index} style={{ flexDirection: "row", backgroundColor: index === 0 ? theme.raised : "transparent" }}>{cells.map((cell, column) => <View key={column} style={{ width: 160, padding: 10, borderWidth: .5, borderColor: theme.border }}><Text selectable style={{ color: theme.text, fontSize: 14, fontWeight: index === 0 ? "600" : "400" }}>{cell}</Text></View>)}</View>)}</View></ScrollView>);
        }
    }
    return <View>{rows}</View>;
});
