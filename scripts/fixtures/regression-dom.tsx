import { TaskCenterPanel } from "../../src/renderer/src/components/TaskCenterPanel";
import React, { useCallback, useState } from "react";
import { createRoot } from "react-dom/client";
import { SessionListRow } from "../../src/renderer/src/components/SessionListRow";
import { GlobalErrorToast } from "../../src/renderer/src/components/GlobalErrorToast";
import { CliUpdateControls } from "../../src/renderer/src/components/CliUpdateControls";
import { McpElicitationCard } from "../../src/renderer/src/components/McpElicitationCard";
import { useSessionDraft } from "../../src/renderer/src/hooks/use-session-draft";
import type { Attachment, ComposerDraftState, SessionSummary } from "../../src/shared/types";

const root = createRoot(document.getElementById("root")!);
const noop = () => undefined;
const waiting: Array<{ key: string; resolve(value: ComposerDraftState | null): void }> = [];
let updateState: any = { phase: "idle", recovery: { previousVersion: "1.0.3", targetVersion: "2.0.0", retained: true } };
const updateCalls: any[] = [];
let mcpCalls = 0;
let mcpResolve: (() => void) | undefined;
let savedAutomation: any;
const automation: any = { id: "task", name: "Fixture schedule", workspace: "fixture", schedule: { kind: "once", at: "2030-01-01T01:30:00.000Z" }, profile: { modelId: "fixture-model", effort: "low", mode: "agent", permissionPolicy: "agent", computerEnabled: false }, enabled: true, wakeToRun: false, notify: false, missedRunPolicy: "run-once", contextPolicy: "fresh", timeZone: "Asia/Shanghai", revision: 3, sessionRevision: 2, frozenExecutionProfile: { id: "private-runtime-profile" }, scheduleAnchor: "2026-09-18T00:00:00Z", registrationStatus: "registered", promptPresent: true, createdAt: "now", updatedAt: "now" };
const api = {
  listAutomations: async () => [automation], listAutomationRuns: async () => [],
  getAutomationGlobalPolicy: async () => ({ defaultProfile: automation.profile, maxConcurrentRuns: 2, confirmationTimeoutMinutes: 30, inactivityTimeoutMinutes: 0, notifyOnSuccess: true, notifyOnFailure: true }),
  listBackgroundTasks: async () => [], listInbox: async () => [], listProviders: async () => [], listExecutionProfiles: async () => [],
  onAutomationEvent: () => noop,
  updateAutomation: async (_id: string, input: unknown) => { savedAutomation = input; return [automation]; },
  getDraft: (key: string) => new Promise<ComposerDraftState | null>((resolve) => waiting.push({ key, resolve })),
  setDraft: async () => undefined,
  getCliUpdateState: async () => updateState,
  previewCliUpdate: async (policy: string, action: string) => ({ fromVersion: "1.0.3", targetVersion: action === "verify" ? "1.0.3" : "2.0.0", policy, confirmationToken: "fixture-token", majorUpgrade: true }),
  applyCliUpdate: async (input: unknown) => { updateCalls.push(input); throw Error("fixture update failed"); },
  // Deliberately unresolved network metadata request: controls must unlock anyway.
  checkCliUpdate: () => new Promise(() => undefined),
  getCliUpdateHistory: async () => [],
  respondMcpElicitation: async (_s: string, _r: string, _outcome: string, values: any) => {
    mcpCalls++;
    if (values.count < 2) throw Error("MCP 表单字段超出数值范围：count");
    await new Promise<void>((resolve) => { mcpResolve = resolve; });
  },
};
Object.assign(window, { grokDesktop: api });
function Menus() {
  const [open, setOpen] = useState("");
  return <>{["a", "b"].map((id) => <SessionListRow key={id} session={{ id, cwd: "fixture", title: id, messageCount: 0, status: "cold", updatedAt: new Date().toISOString() } as SessionSummary}
    active={false} menuOpen={open === id} onOpen={noop} onMenu={(value) => setOpen((current) => value ? id : current === id ? "" : current)} onPin={noop} onArchive={noop} onExport={noop} onRename={noop} onDelete={noop} />)}</>;
}
let edit: (value: string) => void = noop;
let reload: () => void = noop;
function Draft({ sessionId }: { sessionId: string }) {
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const clear = useCallback(() => setAttachments([]), []);
  const add = useCallback((values: Attachment[]) => setAttachments((old) => [...old, ...values]), []);
  const draft = useSessionDraft({ activeSessionId: sessionId, workspace: "fixture", foreignSessionOpen: false, sendingSessionIds: new Set(), attachments, clearAttachments: clear, addAttachments: add, onSessionChange: noop, onError: noop });
  edit = draft.setComposer; reload = draft.reloadDraft;
  return <input id="draft" value={draft.composer} onChange={(event) => draft.setComposer(event.target.value)} />;
}
Object.assign(window, { fixture: {
  taskCenter: (bound = false) => { automation.destination = bound ? "current-session" : "standalone"; automation.targetSessionId = bound ? "parent" : undefined; automation.contextPolicy = bound ? "reuse" : "fresh"; root.render(<TaskCenterPanel key={String(bound)} workspace="fixture" accounts={[]} onClose={noop} onOpenSession={noop} setError={message => { throw Error(message); }} confirmAction={async () => true} />); },
  automationPayload: () => savedAutomation,
  menus: () => root.render(<Menus />),
  toast: (message: string) => root.render(<GlobalErrorToast message={message} onReload={noop} onDiagnostics={noop} onDismiss={noop} />),
  controls: () => root.render(<CliUpdateControls />),
  updateCalls: () => updateCalls,
  phase: (phase: string) => { updateState = { ...updateState, phase }; },
  mcp: () => root.render(<McpElicitationCard sessionId="s" message={{ id: "m", kind: "mcp-elicitation", request: { requestId: "r", sessionId: "s", serverName: "fixture", message: "Fixture constraints", mode: "form", schemaSupported: true, requestedSchema: { type: "object", required: ["count"], properties: { count: { type: "integer", minimum: 2, maximum: 4 } } } } }} onResolved={() => root.render(<div>mcp resolved</div>)} />),
  mcpCalls: () => mcpCalls, mcpResolve: () => mcpResolve?.(),
  draft: (sessionId: string) => root.render(<Draft sessionId={sessionId} />),
  edit: (value: string) => edit(value), reload: () => reload(),
  pending: () => waiting.map((item) => item.key),
  resolve: (key: string, text: string) => { const index = waiting.findIndex((item) => item.key === key); if (index < 0) throw new Error(`No draft request ${key}`); waiting.splice(index, 1)[0].resolve({ key, text, updatedAt: new Date().toISOString() }); },
} });
