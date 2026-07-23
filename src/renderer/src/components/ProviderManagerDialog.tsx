import { useEffect, useMemo, useState } from "react";
import type { CustomProviderInput, CustomProviderProfile, ProviderConnectionDraft, ProviderDraftProbeResult, ProviderModelCandidate, ProviderModelDefinition, ProviderProtocol } from "../../../shared/types";
import { UiIcon } from "../ui-icons";

type Preset = "openai-chat" | "responses" | "anthropic" | "ollama" | "gateway";

export function ProviderManagerDialog({ onClose, onError, onSettingsChanged, confirmAction }: {
  onClose(): void;
  onError(message: string): void;
  onSettingsChanged(): void;
  confirmAction(message: string, options?: { title?: string; confirmLabel?: string; danger?: boolean }): Promise<boolean>;
}): React.JSX.Element {
  const [providers, setProviders] = useState<CustomProviderProfile[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState<ProviderConnectionDraft>();
  const [candidates, setCandidates] = useState<ProviderModelCandidate[]>([]);
  const [selectedCandidates, setSelectedCandidates] = useState<Set<string>>(new Set());
  const [modelSearch, setModelSearch] = useState("");
  const [probe, setProbe] = useState<ProviderDraftProbeResult>();
  const [busy, setBusy] = useState("");
  const selected = providers.find((provider) => provider.id === selectedId);
  const visibleProviders = providers.filter((provider) => `${provider.name} ${provider.id} ${provider.protocol}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const visibleCandidates = candidates.filter((candidate) => `${candidate.name} ${candidate.remoteId} ${candidate.localId}`.toLocaleLowerCase().includes(modelSearch.trim().toLocaleLowerCase()));
  const refresh = async (): Promise<void> => {
    const values = await window.grokDesktop.listProviders();
    setProviders(values);
    setSelectedId((current) => values.some((value) => value.id === current) ? current : values[0]?.id ?? "");
  };
  useEffect(() => { void refresh().catch((error) => onError(message(error))); }, []);

  const startCreate = (preset: Preset): void => { setDraft(presetDraft(preset)); setCandidates([]); setSelectedCandidates(new Set()); setProbe(undefined); };
  const startEdit = (profile: CustomProviderProfile): void => { if (!profile.owned) return; setDraft(profileDraft(profile)); setCandidates([]); setSelectedCandidates(new Set()); setProbe(undefined); };
  const runProbe = async (discover: boolean): Promise<void> => {
    if (!draft) return;
    setBusy(discover ? "discover" : "probe");
    try {
      const result = await window.grokDesktop.probeProviderDraft(draft);
      setProbe(result);
      if (discover && !result.ok) throw new Error(result.message);
      if (discover) {
        const values = await window.grokDesktop.discoverProviderModels(draft);
        setCandidates(values);
        setSelectedCandidates(new Set(values.filter((value) => !value.alreadyConfigured).map((value) => value.remoteId)));
      }
    } catch (error) { onError(message(error)); }
    finally { setBusy(""); }
  };
  const importSelected = (): void => {
    if (!draft) return;
    const current = draft.models ?? [];
    const ids = new Set(current.map((model) => model.id));
    const additions = candidates.filter((candidate) => selectedCandidates.has(candidate.remoteId) && !candidate.alreadyConfigured && !ids.has(candidate.localId)).map(candidateModel);
    setDraft({ ...draft, models: [...current, ...additions] });
  };
  const save = async (): Promise<void> => {
    if (!draft) return;
    setBusy("save");
    try {
      const { headers, models = [], ...connection } = draft;
      const input: CustomProviderInput = { ...connection, extraHeaders: Object.fromEntries(headers.map((header) => [header.name.trim(), header.value.trim()])), models };
      const values = await window.grokDesktop.upsertProvider(input);
      setProviders(values); setSelectedId(input.id); setDraft(undefined); setCandidates([]); setProbe(undefined); onSettingsChanged();
    } catch (error) { onError(message(error)); }
    finally { setBusy(""); }
  };
  const remove = async (profile: CustomProviderProfile): Promise<void> => {
    if (!profile.owned || !await confirmAction(`移除提供商“${profile.name}”及其应用管理的模型？`, { title: "移除提供商", confirmLabel: "移除", danger: true })) return;
    setBusy("remove"); try { setProviders(await window.grokDesktop.removeProvider(profile.id)); setSelectedId(""); onSettingsChanged(); } catch (error) { onError(message(error)); } finally { setBusy(""); }
  };

  return <div className="modal-backdrop provider-manager-backdrop" onMouseDown={onClose}><section className="provider-manager" role="dialog" aria-modal="true" aria-label="自定义提供商管理" onMouseDown={(event) => event.stopPropagation()}>
    <header><div><h2>自定义提供商</h2><span>连接、模型发现与 CLI 配置</span></div><button className="icon-button" aria-label="关闭提供商管理" onClick={onClose}><UiIcon name="close"/></button></header>
    <div className="provider-manager-layout">
      <aside className="provider-manager-list"><label><UiIcon name="search"/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索提供商"/></label><div className="provider-preset-menu"><strong>添加提供商</strong><div><button onClick={() => startCreate("openai-chat")}>OpenAI 兼容</button><button onClick={() => startCreate("responses")}>Responses</button><button onClick={() => startCreate("anthropic")}>Anthropic</button><button onClick={() => startCreate("ollama")}>Ollama</button><button onClick={() => startCreate("gateway")}>普通网关</button></div></div><nav>{visibleProviders.map((provider) => <button className={provider.id === selectedId && !draft ? "active" : ""} key={provider.id} onClick={() => { setSelectedId(provider.id); setDraft(undefined); }}><span className={`provider-health ${provider.hasCredential ? "ready" : "missing"}`}/><span><strong>{provider.name}</strong><small>{protocolLabel(provider.protocol)} · {provider.models.length} 个模型</small></span>{!provider.owned && <em>外部</em>}</button>)}</nav></aside>
      <main className="provider-manager-detail">{draft ? <ProviderDraftEditor draft={draft} setDraft={setDraft} candidates={candidates} setCandidates={setCandidates} visibleCandidates={visibleCandidates} selectedCandidates={selectedCandidates} setSelectedCandidates={setSelectedCandidates} modelSearch={modelSearch} setModelSearch={setModelSearch} probe={probe} busy={busy} onProbe={() => void runProbe(false)} onDiscover={() => void runProbe(true)} onImport={importSelected} onSave={() => void save()} onCancel={() => setDraft(undefined)}/> : selected ? <ProviderDetails provider={selected} busy={busy} onEdit={() => startEdit(selected)} onTest={async () => { setBusy("test"); try { const result = await window.grokDesktop.testProvider(selected.id); setProbe({ ...result, endpoint: selected.modelListUrl || `${selected.baseUrl}/models`, warnings: [], candidates: [] }); } catch (error) { onError(message(error)); } finally { setBusy(""); } }} onRemove={() => void remove(selected)} onDesktopDefault={async (id) => { await window.grokDesktop.setProviderDesktopDefault(id); onSettingsChanged(); }} onCliDefault={async (id) => { setProviders(await window.grokDesktop.setProviderCliDefault(id)); }} probe={probe}/> : <div className="provider-manager-empty"><UiIcon name="profiles" size={30}/><strong>选择或添加提供商</strong><span>可以在保存前测试连接并获取模型列表。</span></div>}</main>
    </div>
  </section></div>;
}

function ProviderDraftEditor({ draft, setDraft, candidates, setCandidates, visibleCandidates, selectedCandidates, setSelectedCandidates, modelSearch, setModelSearch, probe, busy, onProbe, onDiscover, onImport, onSave, onCancel }: {
  draft: ProviderConnectionDraft; setDraft(value: ProviderConnectionDraft): void; candidates: ProviderModelCandidate[]; setCandidates(value: ProviderModelCandidate[]): void; visibleCandidates: ProviderModelCandidate[]; selectedCandidates: Set<string>; setSelectedCandidates(value: Set<string>): void; modelSearch: string; setModelSearch(value: string): void; probe?: ProviderDraftProbeResult; busy: string; onProbe(): void; onDiscover(): void; onImport(): void; onSave(): void; onCancel(): void;
}): React.JSX.Element {
  const updateModel = (position: number, patch: Partial<ProviderModelDefinition>): void => setDraft({ ...draft, models: (draft.models ?? []).map((model, index) => index === position ? { ...model, ...patch } : model) });
  return <div className="provider-draft-editor"><header><div><strong>{draft.models?.length ? "编辑提供商" : "添加提供商"}</strong><span>模型发现仅访问列表端点，不发送推理请求。</span></div><div><button onClick={onCancel}>取消</button><button className="primary" disabled={Boolean(busy) || !(draft.models?.length)} onClick={onSave}>{busy === "save" ? "保存中…" : "保存"}</button></div></header><div className="provider-draft-scroll">
    <section><h3>连接</h3><div className="provider-form-grid"><label>配置 ID<input value={draft.id} onChange={(event) => setDraft({ ...draft, id: event.target.value })}/></label><label>显示名称<input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })}/></label><label className="wide">基础地址<input value={draft.baseUrl} onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })}/></label><label className="wide">模型列表地址<input value={draft.modelListUrl ?? ""} placeholder="默认：基础地址/models" onChange={(event) => setDraft({ ...draft, modelListUrl: event.target.value || undefined })}/></label><label>协议<select value={draft.protocol} onChange={(event) => setDraft({ ...draft, protocol: event.target.value as ProviderProtocol })}><option value="chat_completions">Chat Completions</option><option value="responses">Responses</option><option value="messages">Anthropic Messages</option></select></label><label>认证<select value={draft.authScheme} onChange={(event) => setDraft({ ...draft, authScheme: event.target.value as ProviderConnectionDraft["authScheme"] })}><option value="bearer">Bearer</option><option value="x_api_key">x-api-key</option></select></label><label>凭据来源<select value={draft.credentialMode} onChange={(event) => setDraft({ ...draft, credentialMode: event.target.value as ProviderConnectionDraft["credentialMode"] })}><option value="managed">应用管理的用户环境变量</option><option value="existing">已有环境变量</option><option value="none">无需认证</option></select></label>{draft.credentialMode === "managed" && <label>密钥<input type="password" value={draft.credentialValue ?? ""} placeholder="编辑时留空会保留" onChange={(event) => setDraft({ ...draft, credentialValue: event.target.value })}/></label>}{draft.credentialMode === "existing" && <label>环境变量<input value={draft.credentialEnv ?? ""} onChange={(event) => setDraft({ ...draft, credentialEnv: event.target.value })}/></label>}<label className="check wide"><input type="checkbox" checked={draft.allowInsecureHttp ?? false} onChange={(event) => setDraft({ ...draft, allowInsecureHttp: event.target.checked })}/>允许非本机明文 HTTP</label></div>
      <h4>额外 Header（环境变量来源）</h4><div className="provider-header-rows">{draft.headers.map((header, index) => <div key={index}><input value={header.name} placeholder="Header 名称" onChange={(event) => setDraft({ ...draft, headers: draft.headers.map((value, position) => position === index ? { ...value, name: event.target.value } : value) })}/><input value={header.value} placeholder="环境变量名" onChange={(event) => setDraft({ ...draft, headers: draft.headers.map((value, position) => position === index ? { ...value, value: event.target.value } : value) })}/><button onClick={() => setDraft({ ...draft, headers: draft.headers.filter((_value, position) => position !== index) })}>删除</button></div>)}<button onClick={() => setDraft({ ...draft, headers: [...draft.headers, { name: "", source: "environment", value: "" }] })}>+ 添加 Header</button></div>
      <div className="provider-probe-actions"><button disabled={Boolean(busy)} onClick={onProbe}>{busy === "probe" ? "测试中…" : "测试连接"}</button><button className="primary" disabled={Boolean(busy)} onClick={onDiscover}>{busy === "discover" ? "获取中…" : "获取模型列表"}</button>{probe && <span className={probe.ok ? "success-text" : "error-text"}>{probe.message} · {probe.latencyMs} ms</span>}</div>{probe?.warnings.map((warning) => <p className="provider-probe-warning" key={warning}>{warning}</p>)}</section>
    <section><div className="provider-model-heading"><div><h3>远端模型</h3><span>{candidates.length ? `${candidates.length} 个候选` : "先获取模型列表"}</span></div><label><UiIcon name="search"/><input value={modelSearch} onChange={(event) => setModelSearch(event.target.value)} placeholder="搜索模型"/></label><button onClick={() => setSelectedCandidates(new Set(visibleCandidates.filter((value) => !value.alreadyConfigured).map((value) => value.remoteId)))}>选择可见项</button><button disabled={!selectedCandidates.size} onClick={onImport}>批量导入</button></div><div className="provider-candidates">{visibleCandidates.map((candidate, index) => <label className={candidate.alreadyConfigured ? "configured" : ""} key={candidate.remoteId}><input type="checkbox" disabled={candidate.alreadyConfigured} checked={selectedCandidates.has(candidate.remoteId)} onChange={(event) => { const next = new Set(selectedCandidates); if (event.target.checked) next.add(candidate.remoteId); else next.delete(candidate.remoteId); setSelectedCandidates(next); }}/><span><strong>{candidate.name}</strong><small>{candidate.remoteId}{candidate.alreadyConfigured ? " · 已配置" : ""}</small></span><input value={candidate.localId} aria-label={`本地模型 ID ${candidate.remoteId}`} onChange={(event) => { setCandidates(candidates.map((value) => value.remoteId === candidate.remoteId ? { ...value, localId: event.target.value } : value)); }}/></label>)}</div></section>
    <section><div className="provider-model-heading"><div><h3>将保存的模型</h3><span>上下文未知时使用服务默认</span></div><button onClick={() => setDraft({ ...draft, models: [...(draft.models ?? []), { id: `${draft.id}-model`, model: "", name: "", contextWindow: undefined }] })}>+ 手工添加</button></div><div className="provider-imported-models">{(draft.models ?? []).map((model, index) => <div key={`${index}:${model.id}`}><input value={model.id} placeholder="本地配置 ID" onChange={(event) => updateModel(index, { id: event.target.value })}/><input value={model.model} placeholder="远端模型 ID" onChange={(event) => updateModel(index, { model: event.target.value })}/><input value={model.name} placeholder="显示名称" onChange={(event) => updateModel(index, { name: event.target.value })}/><input type="number" min="1024" value={model.contextWindow ?? ""} placeholder="上下文未知" onChange={(event) => updateModel(index, { contextWindow: event.target.value ? Number(event.target.value) : undefined })}/><button onClick={() => setDraft({ ...draft, models: (draft.models ?? []).filter((_value, position) => position !== index) })}>删除</button></div>)}</div></section>
  </div></div>;
}

function ProviderDetails({ provider, busy, probe, onEdit, onTest, onRemove, onDesktopDefault, onCliDefault }: { provider: CustomProviderProfile; busy: string; probe?: ProviderDraftProbeResult; onEdit(): void; onTest(): void; onRemove(): void; onDesktopDefault(id: string): void; onCliDefault(id: string): void }): React.JSX.Element {
  return <div className="provider-details"><header><div><strong>{provider.name}</strong><span>{provider.id} · {protocolLabel(provider.protocol)}</span></div><div><button disabled={Boolean(busy)} onClick={onTest}>测试</button>{provider.owned && <button disabled={Boolean(busy)} onClick={onEdit}>编辑</button>}{provider.owned && <button className="danger-text" disabled={Boolean(busy)} onClick={onRemove}>删除</button>}</div></header><dl><dt>基础地址</dt><dd>{provider.baseUrl}</dd><dt>模型列表</dt><dd>{provider.modelListUrl || `${provider.baseUrl}/models`}</dd><dt>认证</dt><dd>{provider.credentialMode === "none" ? "无需认证" : provider.hasCredential ? "已配置" : "缺少凭据"}</dd><dt>来源</dt><dd>{provider.owned ? "Grok Build Desktop 管理" : "外部 config.toml（只读）"}</dd></dl>{probe && <p className={probe.ok ? "provider-result success" : "provider-result error"}>{probe.message} · {probe.latencyMs} ms</p>}<section><h3>模型 <span>{provider.models.length}</span></h3>{provider.models.map((model) => <article key={model.id}><div><strong>{model.name}</strong><small>{model.id} → {model.model}</small><span>{model.contextWindow ? `${Math.round(model.contextWindow / 1000)}K 上下文` : "上下文未知 / 服务默认"}</span></div><button onClick={() => onDesktopDefault(model.id)}>桌面默认</button><button onClick={() => onCliDefault(model.id)}>CLI 默认</button></article>)}</section></div>;
}

function presetDraft(preset: Preset): ProviderConnectionDraft {
  const base: ProviderConnectionDraft = { id: "custom", name: "自定义提供商", baseUrl: "https://api.example.com/v1", protocol: "chat_completions", authScheme: "bearer", credentialMode: "managed", credentialValue: "", headers: [], models: [] };
  if (preset === "openai-chat") return { ...base, id: "openai-compatible", name: "OpenAI 兼容", baseUrl: "https://api.openai.com/v1" };
  if (preset === "responses") return { ...base, id: "responses-provider", name: "Responses 提供商", baseUrl: "https://api.openai.com/v1", protocol: "responses" };
  if (preset === "anthropic") return { ...base, id: "anthropic-compatible", name: "Anthropic 兼容", baseUrl: "https://api.anthropic.com/v1", protocol: "messages", authScheme: "x_api_key", headers: [{ name: "anthropic-version", source: "environment", value: "ANTHROPIC_VERSION" }] };
  if (preset === "ollama") return { ...base, id: "ollama", name: "Ollama", baseUrl: "http://127.0.0.1:11434/api", modelListUrl: "http://127.0.0.1:11434/api/tags", credentialMode: "none", credentialValue: undefined };
  return { ...base, id: "gateway", name: "OpenAI 兼容网关" };
}
function profileDraft(profile: CustomProviderProfile): ProviderConnectionDraft { return { id: profile.id, name: profile.name, baseUrl: profile.baseUrl, modelListUrl: profile.modelListUrl, protocol: profile.protocol, authScheme: profile.authScheme, credentialMode: profile.credentialMode, credentialEnv: profile.credentialEnv, credentialValue: undefined, allowInsecureHttp: profile.insecureHttp, headers: Object.entries(profile.extraHeaders).map(([name, value]) => ({ name, source: "environment", value })), models: profile.models }; }
function candidateModel(value: ProviderModelCandidate): ProviderModelDefinition { return { id: value.localId, model: value.remoteId, name: value.name, description: value.description, contextWindow: value.contextWindow }; }
function protocolLabel(protocol: CustomProviderProfile["protocol"]): string { return ({ chat_completions: "Chat Completions", responses: "Responses", messages: "Anthropic Messages" })[protocol]; }
function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
