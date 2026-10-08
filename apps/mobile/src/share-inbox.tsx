import React, { useRef, useState } from "react";
import { Modal, ScrollView, Text, View } from "react-native";
import { Button, ui, type Theme } from "./ui";
import { uploadPicked } from "./workbench";
import type { useRemote } from "./use-remote";
import type { IncomingShare } from "./transport";
export function ShareInbox({ client, theme, value, close }: {
    client: ReturnType<typeof useRemote>;
    theme: Theme;
    value: IncomingShare;
    close: (consumed?: boolean) => void;
}) { const [busy, setBusy] = useState(false), [progress, setProgress] = useState(""), [error, setError] = useState(""); const current = useRef({ host: client.host?.fingerprint, session: client.sessionId }); current.current = { host: client.host?.fingerprint, session: client.sessionId }; const add = async () => { if (!client.host || !client.sessionId)
    return; const binding = { fingerprint: client.host.fingerprint, sessionId: client.sessionId }; setBusy(true); try {
    let composer = client.composer;
    for (const file of value.files) {
        if (composer.attachmentIds.length >= 12)
            throw Error("每条消息最多 12 个附件");
        const uploaded = await uploadPicked(client, file, binding.sessionId, setProgress);
        composer = { ...composer, attachmentIds: [...composer.attachmentIds, uploaded.id], attachments: [...composer.attachments, uploaded] };
        client.setComposer(composer, binding);
    }
    if (current.current.host !== binding.fingerprint || current.current.session !== binding.sessionId)
        throw Error("目标已切换，已上传材料留在原会话草稿，请重新选择目标");
    client.setDraft(client.draft + (value.text ? "\n" + value.text : ""));
    close(true);
}
catch (e) {
    setError(String(e));
}
finally {
    setBusy(false);
} }; return <Modal animationType="slide" transparent onRequestClose={() => { if (!busy)
    close(); }}><View style={ui.modal}><View style={[ui.sheet, { backgroundColor: theme.surface }]}><Text style={[ui.title, { color: theme.text }]}>分享至 Grok Remote</Text><Text style={[ui.hint, { color: theme.muted }]}>选择目标会话，材料先加入草稿；不会自动发送。</Text><ScrollView keyboardShouldPersistTaps="handled"><Text selectable style={{ color: theme.text, lineHeight: 23 }}>{value.text}</Text>{value.files.map(file => <Text key={file.uri} style={[ui.hint, { color: theme.muted }]}>{file.name} · {Math.ceil(file.size / 1024)} KB</Text>)}{client.sessions.filter(s => s.canSend && !s.archived).slice(0, 30).map(session => <Button compact key={session.id} title={(session.id === client.sessionId ? "● " : "") + session.title + " · " + session.projectName} theme={theme} disabled={busy} onPress={() => client.selectSession(session.id)}/>)}</ScrollView>{error ? <Text style={{ color: theme.danger }}>{error}</Text> : null}{progress ? <Text style={{ color: theme.accent }}>{progress}</Text> : null}<Button title={busy ? "上传材料…" : "加入所选会话草稿"} primary theme={theme} disabled={busy || !client.sessionId || client.connection.phase !== "online"} onPress={() => void add()}/><Button compact title="稍后处理" theme={theme} disabled={busy} onPress={close}/></View></View></Modal>; }
