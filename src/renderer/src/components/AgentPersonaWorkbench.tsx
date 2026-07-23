import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import type { AgentDefinition, DefinitionMutationResult, DefinitionReloadResult, DefinitionSaveConflict, DefinitionSource, PersonaDefinition, ReasoningEffort } from "../../../shared/types";

const MonacoEditor = lazy(async () => {
  (await import("../monaco")).configureMonaco();
  const module = await import("@monaco-editor/react");
  return { default: module.default };
});

interface Dialogs {
  askConfirm(message: string, options?: { title?: string; confirmLabel?: string; danger?: boolean }): Promise<boolean>;
  askText(message: string, initialValue: string, options?: { title?: string; confirmLabel?: string }): Promise<string | null>;
  setError(message: string): void;
}

type DefinitionKind = "agent" | "persona";
type Definition = AgentDefinition | PersonaDefinition;

export function AgentPersonaWorkbench({ workspace, dialogs }: { workspace: string; dialogs: Dialogs }): React.JSX.Element {
  const [kind, setKind] = useState<DefinitionKind>("agent");
  const [agents, setAgents] = useState<AgentDefinition[]>([]);
  const [personas, setPersonas] = useState<PersonaDefinition[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [buffer, setBuffer] = useState("");
  const [baseline, setBaseline] = useState("");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [conflict, setConflict] = useState<DefinitionSaveConflict>();
  const definitions: Definition[] = kind === "agent" ? agents : personas;
  const selected = definitions.find((value) => value.id === selectedId) ?? definitions[0];
  const dirty = Boolean(selected && buffer !== baseline);
  const light = document.documentElement.dataset.themeResolved === "light";

  const load = useCallback(async (preferredKind: DefinitionKind = kind, preferredPath?: string): Promise<void> => {
    if (!workspace) { setAgents([]); setPersonas([]); setSelectedId(""); return; }
    setBusy(true);
    try {
      const [nextAgents, nextPersonas] = await Promise.all([window.grokDesktop.listAgentDefinitions(workspace), window.grokDesktop.listPersonaDefinitions(workspace)]);
      setAgents(nextAgents); setPersonas(nextPersonas);
      const nextList: Definition[] = preferredKind === "agent" ? nextAgents : nextPersonas;
      const next = nextList.find((value) => value.path === preferredPath) ?? nextList.find((value) => value.id === selectedId) ?? nextList[0];
      setKind(preferredKind); setSelectedId(next?.id ?? "");
      const raw = next ? rawDefinition(next) : "";
      setBuffer(raw); setBaseline(raw); setConflict(undefined);
    } catch (error) { dialogs.setError(errorMessage(error)); }
    finally { setBusy(false); }
  }, [dialogs, kind, selectedId, workspace]);

  useEffect(() => { void load("agent"); }, [workspace]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (!event.ctrlKey || event.key.toLowerCase() !== "s" || !selected || selected.readOnly) return;
      event.preventDefault(); void save();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [selected, buffer, workspace, kind]);

  const switchKind = async (nextKind: DefinitionKind): Promise<void> => {
    if (nextKind === kind) return;
    if (dirty && !await dialogs.askConfirm("当前定义有未保存修改，仍要切换？", { title: "切换定义类型", confirmLabel: "不保存并切换", danger: true })) return;
    const next = (nextKind === "agent" ? agents : personas)[0];
    setKind(nextKind); setSelectedId(next?.id ?? "");
    const raw = next ? rawDefinition(next) : "";
    setBuffer(raw); setBaseline(raw); setConflict(undefined); setNotice("");
  };

  const choose = async (definition: Definition): Promise<void> => {
    if (definition.id === selected?.id) return;
    if (dirty && !await dialogs.askConfirm(`“${selected?.name}”有未保存修改，仍要切换？`, { title: "切换定义", confirmLabel: "不保存并切换", danger: true })) return;
    setSelectedId(definition.id); setBuffer(rawDefinition(definition)); setBaseline(rawDefinition(definition)); setConflict(undefined); setNotice("");
  };

  const handleMutation = async <T extends Definition>(result: DefinitionMutationResult<T>): Promise<void> => {
    if (result.conflict) { setConflict(result.conflict); setNotice("文件已被外部修改，当前缓冲区未覆盖磁盘"); return; }
    if (!result.saved || !result.definition) { setNotice(result.validation.message ?? "定义未保存"); return; }
    setNotice(`已通过 grok inspect 校验并保存。${reloadLabel(result.reload)}`);
    await load(kind, result.definition.path);
  };

  const save = async (expectedHashOverride?: string): Promise<void> => {
    if (!workspace || !selected || selected.readOnly || !selected.path) return;
    setBusy(true);
    try {
      if (kind === "agent") await handleMutation(await window.grokDesktop.saveAgentDefinition({ workspacePath: workspace, targetSource: selected.source as "user" | "project", name: selected.name, rawMarkdown: buffer, originalPath: selected.path, expectedHash: expectedHashOverride ?? selected.hash }));
      else await handleMutation(await window.grokDesktop.savePersonaDefinition({ workspacePath: workspace, targetSource: selected.source as "user" | "project", name: selected.name, rawToml: buffer, originalPath: selected.path, expectedHash: expectedHashOverride ?? selected.hash }));
    } catch (error) { dialogs.setError(errorMessage(error)); }
    finally { setBusy(false); }
  };

  const create = async (targetSource: "user" | "project"): Promise<void> => {
    const label = kind === "agent" ? "Agent" : "Persona";
    const name = await dialogs.askText(`输入新 ${label} 名称。将创建独立${kind === "agent" ? " Markdown" : " TOML"}文件。`, "", { title: `新建${targetSource === "project" ? "项目" : "用户"}${label}`, confirmLabel: "创建并校验" });
    if (!name?.trim()) return;
    setBusy(true);
    try {
      if (kind === "agent") await handleMutation(await window.grokDesktop.saveAgentDefinition({ workspacePath: workspace, targetSource, name: name.trim(), rawMarkdown: agentTemplate(name.trim()) }));
      else await handleMutation(await window.grokDesktop.savePersonaDefinition({ workspacePath: workspace, targetSource, name: name.trim(), rawToml: personaTemplate(name.trim()) }));
    } catch (error) { dialogs.setError(errorMessage(error)); }
    finally { setBusy(false); }
  };

  const copy = async (targetSource: "user" | "project"): Promise<void> => {
    if (!selected?.path) return;
    const name = await dialogs.askText(`复制“${selected.name}”到${targetSource === "project" ? "项目" : "用户"}范围。`, `${selected.name}-copy`, { title: "复制定义", confirmLabel: "复制并校验" });
    if (!name?.trim()) return;
    setBusy(true);
    try {
      if (kind === "agent") await handleMutation(await window.grokDesktop.copyAgentDefinition(workspace, selected.path, targetSource, name.trim()));
      else await handleMutation(await window.grokDesktop.copyPersonaDefinition(workspace, selected.path, targetSource, name.trim()));
    } catch (error) { dialogs.setError(errorMessage(error)); }
    finally { setBusy(false); }
  };

  const rename = async (): Promise<void> => {
    if (!selected?.path || selected.readOnly) return;
    const name = await dialogs.askText("输入新名称。Agent frontmatter 的 name 会同步更新。", selected.name, { title: "重命名定义", confirmLabel: "重命名并校验" });
    if (!name?.trim() || name.trim() === selected.name) return;
    setBusy(true);
    try {
      if (kind === "agent") await handleMutation(await window.grokDesktop.renameAgentDefinition(workspace, selected.path, name.trim()));
      else await handleMutation(await window.grokDesktop.renamePersonaDefinition(workspace, selected.path, name.trim()));
    } catch (error) { dialogs.setError(errorMessage(error)); }
    finally { setBusy(false); }
  };

  const toggle = async (): Promise<void> => {
    if (!selected?.path || selected.readOnly) return;
    setBusy(true);
    try {
      if (kind === "agent") await handleMutation(await window.grokDesktop.setAgentDefinitionEnabled(workspace, selected.path, !selected.enabled));
      else await handleMutation(await window.grokDesktop.setPersonaDefinitionEnabled(workspace, selected.path, !selected.enabled));
    } catch (error) { dialogs.setError(errorMessage(error)); }
    finally { setBusy(false); }
  };

  const remove = async (): Promise<void> => {
    if (!selected?.path || selected.readOnly) return;
    if (!await dialogs.askConfirm(`永久删除${kind === "agent" ? " Agent" : " Persona"}“${selected.name}”？删除前会保留 .grok-desktop.bak 备份。`, { title: "删除定义", confirmLabel: "删除并校验", danger: true })) return;
    setBusy(true);
    try {
      const result = kind === "agent" ? await window.grokDesktop.deleteAgentDefinition(workspace, selected.path, true) : await window.grokDesktop.deletePersonaDefinition(workspace, selected.path, true);
      setNotice(`定义已删除并通过校验。${reloadLabel(result.reload)}`); await load(kind);
    } catch (error) { dialogs.setError(errorMessage(error)); }
    finally { setBusy(false); }
  };

  const validate = async (): Promise<void> => {
    if (!selected) return;
    const result = kind === "agent" ? await window.grokDesktop.validateAgentDefinition(buffer, selected.name) : await window.grokDesktop.validatePersonaDefinition(buffer);
    setNotice(result.valid ? "本地语法校验通过；保存时还会运行 grok inspect --json。" : `校验失败：${result.message}`);
  };

  const filtered = useMemo(() => definitions.filter((value) => !query.trim() || `${value.name}\n${value.description ?? ""}\n${value.source}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())), [definitions, query]);
  const grouped = groupDefinitions(filtered);
  if (!workspace) return <div className="definition-empty"><h2>Agent 与 Persona</h2><p>请选择工作区。</p></div>;

  return <section className="definition-workbench">
    <aside className="definition-navigator">
      <header><div><strong>Agent 中心</strong><span>原生文件 · inspect 校验</span></div><button disabled={busy} onClick={() => void load(kind, selected?.path)}>↻</button></header>
      <div className="definition-tabs"><button className={kind === "agent" ? "active" : ""} onClick={() => void switchKind("agent")}>Agents</button><button className={kind === "persona" ? "active" : ""} onClick={() => void switchKind("persona")}>Personas</button></div>
      <input className="definition-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索名称或说明" />
      <div className="definition-create"><button onClick={() => void create("project")}>＋ 项目</button><button onClick={() => void create("user")}>＋ 用户</button></div>
      {(["project", "user", "plugin", "builtin"] as DefinitionSource[]).map((source) => grouped[source].length ? <div className="definition-group" key={source}><h4>{sourceLabel(source)} <span>{grouped[source].length}</span></h4>{grouped[source].map((definition) => <button key={definition.id} className={selected?.id === definition.id ? "selected" : ""} onClick={() => void choose(definition)}><span className={`definition-dot ${definition.validation?.valid ? "valid" : "invalid"}`}>{definition.enabled ? "●" : "○"}</span><div><strong>{definition.name}</strong><small>{definition.description || "无说明"}</small><em>{definition.effective ? "当前生效" : definition.shadowedBy ? `被${sourceLabel(definition.shadowedBy)}覆盖` : definition.enabled ? "可用" : "已停用"}</em></div></button>)}</div> : null)}
    </aside>
    <div className="definition-editor">
      <div className="definition-status"><div><strong>{selected?.name ?? (kind === "agent" ? "Agent" : "Persona")}</strong><span>{selected ? `${sourceLabel(selected.source)} · ${selected.readOnly ? "只读" : "可编辑"} · ${selected.enabled ? "启用" : "停用"}` : "暂无定义"}</span></div><small>{selected?.path ?? ""}</small></div>
      <div className="definition-toolbar"><button className="primary" disabled={!dirty || selected?.readOnly || busy} onClick={() => void save()}>{busy ? "处理中…" : "保存并校验"}</button><button disabled={!selected} onClick={() => void validate()}>本地校验</button><button disabled={!selected} onClick={() => void copy("project")}>复制到项目</button><button disabled={!selected} onClick={() => void copy("user")}>复制到用户</button><button disabled={!selected || selected.readOnly} onClick={() => void rename()}>重命名</button><button disabled={!selected || selected.readOnly} onClick={() => void toggle()}>{selected?.enabled ? "停用" : "启用"}</button><span/><button className="danger" disabled={!selected || selected.readOnly} onClick={() => void remove()}>删除</button></div>
      {notice && <div className={`definition-notice ${notice.includes("失败") ? "error" : ""}`}>{notice}</div>}
      {conflict && <div className="editor-conflict"><strong>定义已在外部修改</strong><span>当前缓冲区未被覆盖。</span><button onClick={() => { setBuffer(conflict.diskContent); setBaseline(conflict.diskContent); setConflict(undefined); setNotice("已重新加载磁盘版本"); }}>重新加载磁盘</button><button onClick={() => void save(conflict.actualHash)}>确认覆盖磁盘</button></div>}
      {selected && <DefinitionFields kind={kind} definition={selected} buffer={buffer} disabled={selected.readOnly} onChange={setBuffer}/>}
      <div className="definition-raw-label"><strong>原始 {kind === "agent" ? "Markdown" : "TOML"}</strong><span>注释和未知字段按原文保留</span></div>
      <div className="monaco-host"><Suspense fallback={<div className="editor-loading">正在加载 Monaco 编辑器…</div>}><MonacoEditor path={selected?.path || `definition://${kind}`} language={kind === "agent" ? "markdown" : "toml"} value={buffer} theme={light ? "light" : "vs-dark"} options={{ readOnly: selected?.readOnly ?? true, automaticLayout: true, minimap: { enabled: false }, wordWrap: "on", fontSize: 13, scrollBeyondLastLine: false }} onChange={(value) => setBuffer(value ?? "")}/></Suspense></div>
    </div>
  </section>;
}

function DefinitionFields({ kind, definition, buffer, disabled, onChange }: { kind: DefinitionKind; definition: Definition; buffer: string; disabled: boolean; onChange(value: string): void }): React.JSX.Element {
  if (kind === "agent") {
    const value = definition as AgentDefinition;
    const field = (key: string, next: string | boolean | string[] | undefined): void => onChange(patchAgentFrontmatter(buffer, key, next));
    return <details className="definition-fields" open><summary>结构化字段</summary><div className="definition-field-grid"><label>说明<input disabled={disabled} defaultValue={value.description ?? ""} onBlur={(event) => field("description", event.target.value)}/></label><label>模型<input disabled={disabled} defaultValue={value.modelId ?? ""} placeholder="inherit" onBlur={(event) => field("model", event.target.value || undefined)}/></label><label>推理强度<select disabled={disabled} defaultValue={value.effort ?? ""} onChange={(event) => field("effort", event.target.value || undefined)}><option value="">继承</option>{["none", "minimal", "low", "medium", "high", "xhigh"].map((item) => <option key={item}>{item}</option>)}</select></label><label>提示模式<select disabled={disabled} defaultValue={value.promptMode ?? "extend"} onChange={(event) => field("prompt_mode", event.target.value)}><option value="extend">extend</option><option value="full">full</option></select></label><label>权限模式<input disabled={disabled} defaultValue={value.permissionMode ?? ""} placeholder="default / plan" onBlur={(event) => field("permission_mode", event.target.value || undefined)}/></label><label>工具<input disabled={disabled} defaultValue={value.tools?.join(", ") ?? ""} onBlur={(event) => field("tools", csv(event.target.value))}/></label><label>禁止工具<input disabled={disabled} defaultValue={value.disallowedTools?.join(", ") ?? ""} onBlur={(event) => field("disallowed_tools", csv(event.target.value))}/></label><label>Skills<input disabled={disabled} defaultValue={value.skills?.join(", ") ?? ""} onBlur={(event) => field("skills", csv(event.target.value))}/></label><label className="definition-check"><input type="checkbox" disabled={disabled} defaultChecked={value.agentsMd ?? true} onChange={(event) => field("agents_md", event.target.checked)}/>加载 AGENTS.md</label></div></details>;
  }
  const value = definition as PersonaDefinition;
  const field = (key: string, next: string | boolean | undefined): void => onChange(patchTomlScalar(buffer, key, next));
  return <details className="definition-fields" open><summary>结构化字段</summary><div className="definition-field-grid"><label>说明<input disabled={disabled} defaultValue={value.description ?? ""} onBlur={(event) => field("description", event.target.value || undefined)}/></label><label>指令文件<input disabled={disabled} defaultValue={value.instructionFile ?? ""} onBlur={(event) => field("instructions_file", event.target.value || undefined)}/></label><label>模型<input disabled={disabled} defaultValue={value.modelId ?? ""} onBlur={(event) => field("model", event.target.value || undefined)}/></label><label>推理强度<select disabled={disabled} defaultValue={value.effort ?? ""} onChange={(event) => field("reasoning_effort", event.target.value || undefined)}><option value="">继承</option>{["none", "minimal", "low", "medium", "high", "xhigh"].map((item) => <option key={item}>{item}</option>)}</select></label><label>默认能力<input disabled={disabled} defaultValue={value.defaultCapabilityMode ?? ""} placeholder="all / read-only" onBlur={(event) => field("default_capability_mode", event.target.value || undefined)}/></label><label>默认隔离<select disabled={disabled} defaultValue={value.defaultIsolation ?? "none"} onChange={(event) => field("default_isolation", event.target.value)}><option value="none">none</option><option value="worktree">worktree</option></select></label><label className="definition-check"><input type="checkbox" disabled={disabled} defaultChecked={value.defaultForkContext ?? false} onChange={(event) => field("default_fork_context", event.target.checked)}/>默认继承上下文</label><div className="definition-contracts"><span>Inputs {value.inputContract.length}</span><span>Outputs {value.outputContract.length}</span><small>契约数组请在下方原始 TOML 中编辑</small></div></div></details>;
}

function groupDefinitions(values: Definition[]): Record<DefinitionSource, Definition[]> {
  return { project: values.filter((value) => value.source === "project"), user: values.filter((value) => value.source === "user"), plugin: values.filter((value) => value.source === "plugin"), builtin: values.filter((value) => value.source === "builtin") };
}
function rawDefinition(value: Definition): string { return "rawMarkdown" in value ? value.rawMarkdown : value.rawToml; }
function sourceLabel(value: DefinitionSource): string { return value === "project" ? "项目" : value === "user" ? "用户" : value === "plugin" ? "插件" : "内置"; }
function reloadLabel(value: DefinitionReloadResult): string { return value.strategy === "hot-reload" ? "当前会话已热重载。" : value.strategy === "idle-restart" ? `已恢复 ${value.restartedSessions} 个空闲会话。` : value.strategy === "deferred" ? value.message ?? "运行会话稍后加载。" : "新会话将直接使用。"; }
function csv(value: string): string[] | undefined { const values = value.split(",").map((item) => item.trim()).filter(Boolean); return values.length ? values : undefined; }
function agentTemplate(name: string): string { return `---\nname: ${JSON.stringify(name)}\ndescription: "请填写 Agent 说明"\nprompt_mode: extend\nmodel: inherit\npermission_mode: default\nagents_md: true\n---\n\n请在此填写 Agent 指令。\n`; }
function personaTemplate(name: string): string { return `# ${name} persona\ndescription = "请填写 Persona 说明"\ninstructions = """\n请在此填写 Persona 指令。\n"""\ndefault_isolation = "none"\n`; }
function errorMessage(value: unknown): string { return value instanceof Error ? value.message : String(value); }

export function patchAgentFrontmatter(raw: string, key: string, value: string | boolean | string[] | undefined): string {
  const opening = /^(?:\uFEFF)?---[ \t]*\r?\n/.exec(raw);
  if (!opening) return raw;
  const closing = /\r?\n---[ \t]*(?:\r?\n|$)/g;
  closing.lastIndex = opening[0].length;
  const close = closing.exec(raw);
  if (!close) return raw;
  const newline = raw.includes("\r\n") ? "\r\n" : "\n";
  const header = raw.slice(opening[0].length, close.index).replace(/\r\n/g, "\n");
  const lines = header.split("\n");
  const index = lines.findIndex((line) => new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:`).test(line));
  const serialized = value === undefined ? undefined : `${key}: ${yamlValue(value)}`;
  if (index < 0) { if (serialized) lines.push(serialized); }
  else {
    let end = index + 1;
    while (end < lines.length && (/^[ \t]+/.test(lines[end] ?? "") || !(lines[end] ?? "").trim())) end += 1;
    lines.splice(index, end - index, ...(serialized ? [serialized] : []));
  }
  return `${raw.slice(0, opening[0].length)}${lines.join(newline)}${raw.slice(close.index)}`;
}

export function patchTomlScalar(raw: string, key: string, value: string | boolean | undefined): string {
  const newline = raw.includes("\r\n") ? "\r\n" : "\n";
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  const firstTable = lines.findIndex((line) => /^\s*\[/.test(line));
  const limit = firstTable < 0 ? lines.length : firstTable;
  const index = lines.slice(0, limit).findIndex((line) => new RegExp(`^\s*${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\s*=`).test(line));
  const serialized = value === undefined ? undefined : `${key} = ${typeof value === "boolean" ? value : JSON.stringify(value)}`;
  if (index < 0) { if (serialized) lines.splice(limit, 0, serialized); }
  else {
    let end = index + 1;
    if (/=\s*(?:"""|''')/.test(lines[index] ?? "")) {
      const quote = (lines[index] ?? "").includes('"""') ? '"""' : "'''";
      while (end < lines.length && !(lines[end] ?? "").includes(quote)) end += 1;
      end = Math.min(lines.length, end + 1);
    }
    lines.splice(index, end - index, ...(serialized ? [serialized] : []));
  }
  return lines.join(newline);
}

function yamlValue(value: string | boolean | string[]): string {
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) return `[${value.map((item) => JSON.stringify(item)).join(", ")}]`;
  return /^[A-Za-z0-9_.\/-]+$/.test(value) ? value : JSON.stringify(value);
}
