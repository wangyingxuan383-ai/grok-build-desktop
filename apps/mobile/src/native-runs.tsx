import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Badge, Button, Card, font, ui, type Theme, type Tone } from "./ui";
import { Icon } from "./icons";
import { confirm } from "./forms";
import {
  activeNativeRuns, nativeRunActionLabels, nativeRunBudgetRatio, nativeRunBudgetText, nativeRunDismissible, nativeRunDuplicateKeys, nativeRunIsRunning,
  nativeRunKey, nativeRunKindLabels, nativeRunNeedsAttention, nativeRunPhaseLabel, nativeRunShortId, nativeRunStatusLabels, nativeRunStatusText,
  nativeRunStopDescription, nativeRunTone, nativeRunUpdatedLabel, type NativeRunAction, type NativeRunSnapshot, type NativeRunTone,
} from "../../../src/shared/native-runs";
import type { useRemote } from "./use-remote";

type Client = ReturnType<typeof useRemote>;
type Notice = { text: string; tone: Tone };
const badgeTone: Record<NativeRunTone, Tone | undefined> = { running: "info", paused: undefined, attention: "warning", failed: "danger", stale: undefined };
const busyLabels: Record<NativeRunAction | "dismiss", string> = { pause: "正在暂停…", resume: "正在恢复…", stop: "正在结束…", dismiss: "正在移除…" };
const finalStates = ["completed", "failed", "cancelled", "unknown"];

/** Composer chip for this session's live goals/workflows: running first, then attention, then paused. */
export function nativeRunChip(rows: NativeRunSnapshot[] = []): { label: string; tone?: Tone } | undefined {
  const live = activeNativeRuns(rows).filter((row) => !row.stale);
  const pick = (list: NativeRunSnapshot[], status: string, tone?: Tone) => list.length === 1
    ? { label: `${nativeRunKindLabels[list[0]!.kind]}${nativeRunStatusLabels[list[0]!.status]}`, tone }
    : list.length ? { label: `${list.length} 项${status}`, tone } : undefined;
  return pick(live.filter(nativeRunIsRunning), "执行中", "info") ?? pick(live.filter(nativeRunNeedsAttention), "需处理", "warning") ?? pick(live.filter((row) => row.status === "paused"), "已暂停");
}

/**
 * Goals and workflows started with /goal and /workflow. `scoped` lists one conversation's
 * items inside its sheet, so the session name and the open button are omitted there.
 */
export function NativeRunCards({ rows, client, theme, disabled, refresh, open, scoped = false }: {
  rows: NativeRunSnapshot[]; client: Client; theme: Theme; disabled: boolean;
  refresh(): Promise<void>; open?(id: string): void; scoped?: boolean;
}) {
  const [expanded, setExpanded] = useState<string>();
  const [pending, setPending] = useState<{ key: string; action: NativeRunAction | "dismiss"; operationId?: string }>();
  const [notices, setNotices] = useState<Record<string, Notice>>({});
  // A double tap lands before React applies `pending`; this ref blocks the second request synchronously.
  const inFlight = useRef(false);
  const visible = useMemo(() => activeNativeRuns(rows), [rows]);
  const duplicates = useMemo(() => nativeRunDuplicateKeys(visible), [visible]);
  const release = (): void => { inFlight.current = false; setPending(undefined); };
  const settle = (key: string, state: string, message?: string): void => {
    setNotices((current) => ({ ...current, [key]: state === "completed" ? { text: message || "已完成", tone: "success" }
      : state === "unknown" ? { text: "未收到 CLI 确认，结果待确认；收到新状态后会自动更新。", tone: "warning" } : { text: message || "操作未完成", tone: "danger" } }));
    release();
    void refresh();
  };
  // The desktop accepts a request first and reports the CLI's answer later; follow that receipt here.
  useEffect(() => {
    const receipt = client.receipt;
    if (pending?.operationId && receipt?.operationId === pending.operationId && finalStates.includes(receipt.state)) settle(pending.key, receipt.state, receipt.message);
  }, [client.receipt, pending]);
  // Another request can replace the shown receipt; after 20 s the refreshed row state speaks for itself.
  useEffect(() => { if (!pending) return; const timer = setTimeout(() => { release(); void refresh(); }, 20_000); return () => clearTimeout(timer); }, [pending, refresh]);
  if (!visible.length) return null;
  const submit = async (row: NativeRunSnapshot, action: NativeRunAction | "dismiss"): Promise<void> => {
    if (inFlight.current || disabled) return;
    inFlight.current = true;
    const key = nativeRunKey(row);
    setNotices(({ [key]: _old, ...rest }) => rest);
    setPending({ key, action });
    const receipt = action === "dismiss"
      ? await client.mutate("native-run.dismiss", row.id, { sessionId: row.sessionId, kind: row.kind })
      : await client.mutate("native-run.control", row.id, { sessionId: row.sessionId, kind: row.kind, revision: row.revision, action });
    if (!receipt) { release(); return; }
    if (finalStates.includes(receipt.state)) settle(key, receipt.state, receipt.message);
    else setPending({ key, action, operationId: receipt.operationId });
  };
  return <View style={{ gap: 8 }}>{visible.map((row) => {
    const key = nativeRunKey(row), isOpen = expanded === key, tone = nativeRunTone(row), ratio = nativeRunBudgetRatio(row.budget), notice = notices[key];
    const session = client.sessions.find((item) => item.id === row.sessionId)?.title || `会话 ${row.sessionId.slice(0, 8)}`;
    const busyHere = pending?.key === key;
    const detail = [row.phase ? `${nativeRunPhaseLabel(row.phase)}阶段` : "", row.budget ? nativeRunBudgetText(row.budget) : "", nativeRunUpdatedLabel(row.observedAt)].filter(Boolean).join(" · ");
    return <Card key={key} theme={theme}>
      <Pressable accessibilityRole="button" accessibilityLabel={`${row.title}，${nativeRunStatusText(row)}`} accessibilityState={{ expanded: isOpen }} onPress={() => setExpanded(isOpen ? undefined : key)} style={{ gap: 6 }}>
        <View style={[ui.row, { gap: 8 }]}>
          <Badge text={nativeRunStatusText(row)} theme={theme} tone={badgeTone[tone]} />
          <Text numberOfLines={1} style={{ flex: 1, color: theme.muted, fontSize: font.caption }}>{nativeRunKindLabels[row.kind]}{scoped ? "" : ` · ${session}`}{duplicates.has(key) ? ` · ${nativeRunShortId(row.id)}` : ""}</Text>
          <Icon name={isOpen ? "expand" : "forward"} size={16} color={theme.muted} />
        </View>
        <Text numberOfLines={isOpen ? 4 : 2} style={{ color: theme.text, fontSize: 16, lineHeight: 22, fontWeight: "600" }}>{row.title}</Text>
      </Pressable>
      {isOpen ? <>
        {detail ? <Text style={[ui.hint, { color: theme.muted }]}>{detail}</Text> : null}
        {ratio !== undefined ? <View style={{ height: 5, borderRadius: 3, backgroundColor: theme.raised, overflow: "hidden" }}><View style={{ width: `${Math.max(2, ratio * 100)}%`, height: "100%", borderRadius: 3, backgroundColor: ratio >= 1 ? theme.danger : ratio >= 0.9 ? theme.warning : theme.accent }} /></View> : null}
        {row.reason ? <Text style={[ui.hint, { color: tone === "failed" ? theme.danger : tone === "attention" ? theme.warning : theme.muted }]}>{row.reason}</Text> : null}
        {!row.actions.length && row.unavailableReason ? <Text style={[ui.hint, { color: theme.muted }]}>{row.unavailableReason}</Text> : null}
        {notice ? <Text accessibilityRole="alert" style={[ui.hint, { color: notice.tone === "danger" ? theme.danger : notice.tone === "warning" ? theme.warning : theme.success }]}>{notice.text}</Text> : null}
        <View style={[ui.row, { flexWrap: "wrap", gap: 8 }]}>
          {row.actions.map((action) => <Button compact key={action} theme={theme} danger={action === "stop"} title={busyHere && pending?.action === action ? busyLabels[action] : nativeRunActionLabels[action]} disabled={disabled || Boolean(pending)} onPress={() => action === "stop" ? confirm(`结束${nativeRunKindLabels[row.kind]}？`, nativeRunStopDescription(row.kind), () => void submit(row, action)) : void submit(row, action)} />)}
          {!scoped && open ? <Button compact theme={theme} title="打开会话" onPress={() => open(row.sessionId)} /> : null}
          {nativeRunDismissible(row) ? <Button compact ghost theme={theme} title={busyHere && pending?.action === "dismiss" ? busyLabels.dismiss : "移除记录"} disabled={disabled || Boolean(pending)} onPress={() => void submit(row, "dismiss")} /> : null}
        </View>
      </> : null}
    </Card>;
  })}</View>;
}
