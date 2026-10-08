import React, { useEffect, useRef, useState } from "react";
import { Text, TextInput, View } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import { Button, ui, type Theme } from "./ui";
import { uploadPicked } from "./workbench";
import { savedRead, savedWrite } from "./cache";
import type { useRemote } from "./use-remote";
import type { MediaAspectRatio } from "../../../src/shared/types";
export function CodeImage({ client, theme }: {
    client: ReturnType<typeof useRemote>;
    theme: Theme;
}) {
    const [prompt, setPrompt] = useState(""), [ratio, setRatio] = useState<MediaAspectRatio>("1:1"), [references, setReferences] = useState<Array<{
        id: string;
        name: string;
        size: number;
    }>>([]), [uploading, setUploading] = useState(false), [progress, setProgress] = useState("");
    const latest = useRef({ prompt, ratio, references });
    latest.current = { prompt, ratio, references };
    const ready = useRef(false), touched=useRef(false);
    const key = client.host?.fingerprint + ":code-image:" + client.sessionId;
    useEffect(() => { let disposed = false; void savedRead<typeof latest.current>(key).then(value => { if (!disposed && value && !touched.current) {
        setPrompt(value.prompt);
        setRatio(value.ratio);
        setReferences(value.references);
    } ready.current = true; }); return () => { disposed = true; if (ready.current)
        void savedWrite(key, latest.current); }; }, [key]);
    useEffect(() => { if (!ready.current)
        return; const timer = setTimeout(() => void savedWrite(key, latest.current), 250); return () => clearTimeout(timer); }, [prompt, ratio, references]);
    const add = async () => { touched.current=true;setUploading(true); try {
        const result = await DocumentPicker.getDocumentAsync({ type: "image/*", multiple: true, copyToCacheDirectory: true });
        let next = [...references];
        if (!result.canceled)
            for (const file of result.assets) {
                next.push(await uploadPicked(client, file, client.sessionId, setProgress));
                setReferences([...next]);
            }
    }
    catch (error) {
        client.setError(String(error));
    }
    finally {
        setUploading(false);
        setProgress("");
    } };
    return <View style={{ gap: 14 }}><Text style={[ui.hint, { color: theme.muted }]}>图片归属当前代码会话与项目，不创建独立图像会话。使用当前实际模型与 CLI 路由，参考图草稿独立保存。</Text><TextInput accessibilityLabel="项目图片描述" value={prompt} onChangeText={value => { touched.current=true;latest.current = { ...latest.current, prompt: value }; setPrompt(value); }} multiline placeholder="描述项目需要的图片、图标或参考修改" placeholderTextColor={theme.muted} style={[ui.field, { minHeight: 130, color: theme.text, borderColor: theme.border }]}/><View style={[ui.row, { flexWrap: "wrap" }]}>{["1:1", "16:9", "9:16", "4:3", "3:4"].map(value => <Button key={value} compact title={value} primary={ratio === value} theme={theme} onPress={() => {touched.current=true;setRatio(value as MediaAspectRatio);}}/>)}</View><Button compact title={uploading ? "上传参考图…" : "添加参考图"} theme={theme} disabled={uploading} onPress={() => void add()}/>{progress ? <Text style={{ color: theme.accent }}>{progress}</Text> : null}{references.map(reference => <Button key={reference.id} compact title={`移除 ${reference.name}`} theme={theme} onPress={() => setReferences(references.filter(v => v.id !== reference.id))}/>)}<Button title="在当前项目生成图片" primary theme={theme} disabled={!prompt.trim() || uploading || client.busy || !!client.unknown || client.connection.phase !== "online" || client.snapshot?.session.canSend === false || ["working","queued","needs-user"].includes(client.snapshot?.session.status || "")} onPress={() => void savedWrite(key, latest.current).then(() => client.mutate("code.image.submit", client.sessionId, { prompt, aspectRatio: ratio, modelId: client.snapshot?.runtime?.modelId, attachmentIds: references.map(v => v.id) }))}/></View>;
}
