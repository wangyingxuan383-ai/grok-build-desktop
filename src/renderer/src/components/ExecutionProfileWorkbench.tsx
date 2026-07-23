import { useEffect, useMemo, useState } from "react";
import type { ExecutionProfileLaunchInput, ExecutionProfileValidation, SessionExecutionProfile } from "../../../shared/types";

interface Dialogs {
  askConfirm(message: string, options?: { title?: string; confirmLabel?: string; danger?: boolean }): Promise<boolean>;
  setError(message: string): void;
}

export function ExecutionProfileWorkbench({ workspace, dialogs }: { workspace: string; dialogs: Dialogs }): React.JSX.Element {
  const [profiles, setProfiles] = useState<SessionExecutionProfile[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [draft, setDraft] = useState<SessionExecutionProfile>();
  const [validation, setValidation] = useState<ExecutionProfileValidation>();
  const [busy, setBusy] = useState(false);

  const reload = async (preferred?: string): Promise<void> => {
    if (!workspace) return;
    const values = await window.grokDesktop.listExecutionProfiles(workspace);
    setProfiles(values);
    const next = values.find((value) => value.id === (preferred ?? selectedId)) ?? values.find((value) => value.effective) ?? values[0];
    if (next) { setSelectedId(next.id); setDraft(structuredClone(next)); setValidation(await window.grokDesktop.validateExecutionProfile(next)); }
  };
  useEffect(() => { setProfiles([]); setSelectedId(""); setDraft(undefined); setValidation(undefined); void reload().catch((error) => dialogs.setError(message(error))); }, [workspace]);

  const select = async (profile: SessionExecutionProfile): Promise<void> => {
    setSelectedId(profile.id); setDraft(structuredClone(profile)); setValidation(await window.grokDesktop.validateExecutionProfile(profile));
  };
  const patch = (value: Partial<SessionExecutionProfile>): void => {
    if (!draft) return;
    const next = { ...draft, ...value };
    setDraft(next);
    void window.grokDesktop.validateExecutionProfile(next).then(setValidation).catch((error) => dialogs.setError(message(error)));
  };
  const create = (scope: "global" | "project"): void => {
    const next = emptyProfile(scope);
    setSelectedId(""); setDraft(next); setValidation(undefined);
    void window.grokDesktop.validateExecutionProfile(next).then(setValidation);
  };
  const copy = (scope: "global" | "project"): void => {
    if (!draft) return;
    const next = { ...structuredClone(draft), id: crypto.randomUUID(), name: `${draft.name} 副本`, scope, workspaceIdentity: undefined, readOnly: false, effective: true, shadowedBy: undefined };
    setSelectedId(""); setDraft(next); void window.grokDesktop.validateExecutionProfile(next).then(setValidation);
  };
  const save = async (): Promise<void> => {
    if (!draft || draft.readOnly || !workspace) return;
    setBusy(true);
    try {
      const values = await window.grokDesktop.saveExecutionProfile({
        workspacePath: workspace,
        scope: draft.scope === "project" ? "project" : "global",
        profile: stripStoredFields(draft),
      });
      setProfiles(values);
      const saved = values.find((value) => value.id === draft.id) ?? values.find((value) => value.name === draft.name && value.scope === draft.scope);
      if (saved) await select(saved);
    } catch (error) { dialogs.setError(message(error)); }
    finally { setBusy(false); }
  };
  const remove = async (): Promise<void> => {
    if (!draft || draft.readOnly || !await dialogs.askConfirm(`删除执行配置档“${draft.name}”？已创建的会话仍保留其配置快照。`, { title: "删除执行配置档", confirmLabel: "删除", danger: true })) return;
    setBusy(true);
    try { await window.grokDesktop.deleteExecutionProfile(workspace, draft.id, true); await reload(); }
    catch (error) { dialogs.setError(message(error)); }
    finally { setBusy(false); }
  };
  const grouped = useMemo(() => ["project", "global", "builtin"].map((scope) => ({ scope, rows: profiles.filter((value) => value.scope === scope) })), [profiles]);

  if (!workspace) return <div className="workbench-empty">请先选择工作区。</div>;
  return <div className="profile-workbench">
    <aside className="profile-sidebar"><header><strong>执行配置档</strong><div><button onClick={() => create("global")}>＋全局</button><button onClick={() => create("project")}>＋项目</button></div></header><div className="profile-list">{grouped.map((group) => group.rows.length ? <section key={group.scope}><h3>{group.scope === "project" ? "项目（AppData）" : group.scope === "global" ? "全局（AppData）" : "内置预设"}</h3>{group.rows.map((profile) => <button key={profile.id} className={`${selectedId === profile.id ? "active" : ""} ${profile.effective ? "" : "shadowed"}`} onClick={() => void select(profile)}><strong>{profile.name}</strong><span>{profile.mode} · {profile.worktree ? "Worktree" : "当前工作区"}</span>{!profile.effective && <small>被 {profile.shadowedBy} 同名配置覆盖</small>}</button>)}</section> : null)}</div></aside>
    {!draft ? <div className="workbench-empty">选择或创建执行配置档。</div> : <main className="profile-editor"><header><div><h2>{draft.name || "新配置档"}</h2><span>{scopeLabel(draft.scope)} · {draft.readOnly ? "只读" : "可编辑"}</span></div><div className="profile-actions">{draft.readOnly && <><button onClick={() => copy("global")}>复制到全局</button><button onClick={() => copy("project")}>复制到项目</button></>}{!draft.readOnly && <><button disabled={busy || validation?.valid === false} className="primary" onClick={() => void save()}>保存</button><button disabled={busy} className="danger-link" onClick={() => void remove()}>删除</button></>}</div></header>
      <div className="profile-form">
        <label>名称<input disabled={draft.readOnly} value={draft.name} onChange={(event) => patch({ name: event.target.value })}/></label>
        <label className="wide">说明<input disabled={draft.readOnly} value={draft.description ?? ""} onChange={(event) => patch({ description: event.target.value || undefined })}/></label>
        <label>Agent<input disabled={draft.readOnly} value={draft.agentId ?? ""} placeholder="继承默认 Agent" onChange={(event) => patch({ agentId: event.target.value || undefined })}/></label>
        <label>模型<input disabled={draft.readOnly} value={draft.modelId ?? ""} placeholder="桌面/CLI 默认" onChange={(event) => patch({ modelId: event.target.value || undefined })}/></label>
        <label>推理强度<select disabled={draft.readOnly} value={draft.effort} onChange={(event) => patch({ effort: event.target.value as SessionExecutionProfile["effort"] })}><option value="">桌面/CLI 默认</option>{["none", "minimal", "low", "medium", "high", "xhigh"].map((value) => <option key={value}>{value}</option>)}</select></label>
        <label>模式<select disabled={draft.readOnly} value={draft.mode} onChange={(event) => patch({ mode: event.target.value as SessionExecutionProfile["mode"] })}><option value="agent">Agent</option><option value="plan">Plan</option><option value="auto">自动批准</option></select></label>
        <label>Sandbox<input disabled={draft.readOnly} value={draft.sandbox ?? ""} placeholder="workspace / read-only / strict" onChange={(event) => patch({ sandbox: event.target.value || undefined })}/></label>
        <label>联网搜索<select disabled={draft.readOnly} value={draft.webSearch} onChange={(event) => patch({ webSearch: event.target.value as SessionExecutionProfile["webSearch"] })}><option value="default">继承 CLI</option><option value="enabled">启用</option><option value="disabled">禁用</option></select></label>
        <label className="wide">允许工具<input disabled={draft.readOnly} value={draft.allowTools.join(", ")} placeholder="留空表示 Agent 默认工具" onChange={(event) => patch({ allowTools: csv(event.target.value) })}/></label>
        <label className="wide">禁止工具<input disabled={draft.readOnly} value={draft.denyTools.join(", ")} onChange={(event) => patch({ denyTools: csv(event.target.value) })}/></label>
        <label className="check"><input type="checkbox" disabled={draft.readOnly} checked={draft.subagents} onChange={(event) => patch({ subagents: event.target.checked })}/>允许子 Agent</label>
        <label className="check"><input type="checkbox" disabled={draft.readOnly} checked={draft.memory} onChange={(event) => patch({ memory: event.target.checked })}/>启用 Memory</label>
        <label className="check"><input type="checkbox" disabled={draft.readOnly} checked={draft.worktree} onChange={(event) => patch({ worktree: event.target.checked })}/>使用 Worktree</label>
        <label>基础 Ref<input disabled={draft.readOnly || !draft.worktree} value={draft.worktreeRef ?? ""} placeholder="HEAD" onChange={(event) => patch({ worktreeRef: event.target.value || undefined })}/></label>
        <label>子 Agent 默认隔离<select disabled={draft.readOnly} value={draft.subagentIsolation} onChange={(event) => patch({ subagentIsolation: event.target.value as SessionExecutionProfile["subagentIsolation"] })}><option value="workspace">当前工作区</option><option value="worktree">Worktree</option></select></label>
        <label>可用 Persona<input disabled={draft.readOnly} value={draft.allowedPersonaIds.join(", ")} placeholder="留空表示不限制" onChange={(event) => patch({ allowedPersonaIds: csv(event.target.value) })}/></label>
        <label>最大轮次<input disabled title={validation?.fieldSupport.maxTurns.reason} value={draft.maxTurns ?? ""} placeholder="当前 ACP 不支持" readOnly/></label>
        <label className="wide">追加规则<textarea disabled={draft.readOnly} value={draft.additionalRules ?? ""} onChange={(event) => patch({ additionalRules: event.target.value || undefined })}/></label>
      </div>
      <div className="profile-compat"><strong>{validation?.valid === false ? validation.message : "原生映射"}</strong>{validation && Object.entries(validation.fieldSupport).map(([field, support]) => <span key={field} className={support.state}><b>{field}</b>{support.mapping || support.reason || support.state}</span>)}</div>
    </main>}
  </div>;
}

export function SessionLaunchDialog({ workspace, title = "新建会话", initialProfileId, onClose, onLaunch }: { workspace: string; title?: string; initialProfileId?: string; onClose(): void; onLaunch(input: ExecutionProfileLaunchInput): Promise<void> }): React.JSX.Element {
  const [profiles, setProfiles] = useState<SessionExecutionProfile[]>([]);
  const [profileId, setProfileId] = useState(initialProfileId ?? "");
  const [worktreeName, setWorktreeName] = useState("");
  const [worktreeRef, setWorktreeRef] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { void window.grokDesktop.listExecutionProfiles(workspace).then((values) => { const effective = values.filter((value) => value.effective); setProfiles(effective); setProfileId((current) => current && effective.some((value) => value.id === current) ? current : effective.find((value) => value.id === "builtin-normal")?.id ?? effective[0]?.id ?? ""); }).catch((value) => setError(message(value))); }, [workspace]);
  const selected = profiles.find((value) => value.id === profileId);
  const submit = async (): Promise<void> => { if (!selected || busy) return; setBusy(true); setError(""); try { await onLaunch({ workspacePath: workspace, profileId: selected.id, ...(selected.worktree ? { worktreeName: worktreeName.trim() || undefined, worktreeRef: worktreeRef.trim() || undefined } : {}) }); } catch (value) { setError(message(value)); } finally { setBusy(false); } };
  return <div className="modal-backdrop" onMouseDown={() => !busy && onClose()}><section className="control-panel session-launch-dialog" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}><header><div><h2>{title}</h2><small>选择执行配置档；项目配置只保存在 AppData。</small></div><button disabled={busy} onClick={onClose}>×</button></header><div className="panel-body"><label>执行配置档<select value={profileId} onChange={(event) => setProfileId(event.target.value)}>{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name} · {scopeLabel(profile.scope)}</option>)}</select></label>{selected && <article className="launch-profile-summary"><strong>{selected.description || selected.name}</strong><span>{selected.mode} · {selected.sandbox || "默认 Sandbox"} · {selected.memory ? "Memory 开" : "Memory 关"} · {selected.subagents ? "子 Agent 开" : "子 Agent 关"}</span><small>{selected.worktree ? "将在独立 Worktree 中启动" : "将在当前工作区启动"}</small></article>}{selected?.worktree && <><label>Worktree 名称<input value={worktreeName} onChange={(event) => setWorktreeName(event.target.value)} placeholder="留空自动生成"/></label><label>基础分支/提交<input value={worktreeRef} onChange={(event) => setWorktreeRef(event.target.value)} placeholder={selected.worktreeRef || "当前 HEAD"}/></label></>}{error && <p className="inline-error">{error}</p>}<div className="button-row"><button disabled={busy} onClick={onClose}>取消</button><button className="primary" disabled={busy || !selected} onClick={() => void submit()}>{busy ? "正在启动…" : "启动会话"}</button></div></div></section></div>;
}

export function emptyProfile(scope: "global" | "project"): SessionExecutionProfile {
  return { id: crypto.randomUUID(), name: "新执行配置档", scope, readOnly: false, effort: "", mode: "agent", allowTools: [], denyTools: [], webSearch: "default", subagents: true, memory: false, worktree: false, allowedPersonaIds: [], subagentIsolation: "workspace", effective: true };
}

function stripStoredFields(profile: SessionExecutionProfile) {
  const { scope: _scope, workspaceIdentity: _identity, readOnly: _readOnly, createdAt: _createdAt, updatedAt: _updatedAt, effective: _effective, shadowedBy: _shadowedBy, ...value } = profile;
  return value;
}
function csv(value: string): string[] { return [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))]; }
function scopeLabel(scope: SessionExecutionProfile["scope"]): string { return scope === "project" ? "项目" : scope === "global" ? "全局" : "内置"; }
function message(value: unknown): string { return value instanceof Error ? value.message : String(value); }
