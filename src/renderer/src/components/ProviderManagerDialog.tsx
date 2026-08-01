import { useEffect, useMemo, useState } from "react";
import type { CapabilityApplicationDraft, CapabilityApplicationSelection, CustomProviderInput, CustomProviderProfile, ProviderCapabilityVerification, ProviderCompatibilityFlavor, ProviderConnectionDraft, ProviderDraftProbeResult, ProviderImageTransport, ProviderModelCandidate, ProviderModelDefinition, ProviderProtocol, ProviderProxyMode, ProviderReasoningMode, ProviderScanJob, ProviderScanProgress, ProviderSchemaProfile, ProviderUpstreamProtocol, ReasoningEffort } from "../../../shared/types";
import { DEFAULT_PROVIDER_INFERENCE_IDLE_TIMEOUT_SECONDS, PROVIDER_REASONING_EFFORTS, providerReasoningEfforts } from "../../../shared/provider-model-capabilities";
import { UiIcon } from "../ui-icons";

type Preset = "openai-chat" | "responses" | "anthropic" | "gemini-compatible" | "ollama" | "gateway";

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
  const [scanJob, setScanJob] = useState<ProviderScanJob>();
  const [scanReasoning, setScanReasoning] = useState(true);
  const [scanTools, setScanTools] = useState(true);
  const [scanMedia, setScanMedia] = useState(false);
  const [application, setApplication] = useState<CapabilityApplicationDraft>();
  const [applicationSelection, setApplicationSelection] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState("");
  const selected = providers.find((provider) => provider.id === selectedId);
  const visibleProviders = providers.filter((provider) => `${provider.name} ${provider.id} ${provider.protocol}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const visibleCandidates = candidates.filter((candidate) => `${candidate.name} ${candidate.remoteId} ${candidate.localId} ${candidate.ownedBy ?? ""}`.toLocaleLowerCase().includes(modelSearch.trim().toLocaleLowerCase()));
  const refresh = async (): Promise<void> => {
    const values = await window.grokDesktop.listProviders();
    setProviders(values);
    setSelectedId((current) => values.some((value) => value.id === current) ? current : values[0]?.id ?? "");
  };
  useEffect(() => { void refresh().catch((error) => onError(message(error))); }, []);
  useEffect(() => window.grokDesktop.onProviderScanProgress((progress: ProviderScanProgress) => {
    setScanJob((current) => current?.jobId === progress.jobId || progress.providerId === selectedId
      ? { ...(current ?? progress), ...progress } as ProviderScanJob
      : current);
    if (progress.status === "completed" || progress.status === "cancelled") void refresh();
  }), [selectedId]);
  useEffect(() => {
    if (!selectedId) { setScanJob(undefined); return; }
    void window.grokDesktop.listProviderScanJobs(selectedId).then((jobs) => setScanJob(jobs[0])).catch(() => undefined);
  }, [selectedId]);

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
        const fresh = values.filter((value) => !value.alreadyConfigured);
        // Selecting everything is only helpful for a short list; an aggregator
        // returns dozens across several families and the user wants a few.
        setSelectedCandidates(new Set(fresh.length <= 8 ? fresh.map((value) => value.remoteId) : []));
        // Gemini-family upstreams reject tool schemas that carry empty or null
        // enum members. Left on the pass-through profile the first real turn
        // fails with INVALID_ARGUMENT, so pre-select the compatible profile
        // once discovery shows what this endpoint actually serves.
        if (draft.schemaProfile !== "gemini" && values.some((value) => looksGemini(value.remoteId) || looksGemini(value.name))) {
          setDraft({ ...draft, schemaProfile: "gemini" });
        }
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
    const current = providers.find((provider) => provider.id === draft.id);
    if (current && !await confirmDefaultLoss(current, draft.enabled !== false, draft.models ?? [])) return;
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
    if (!profile.owned) return;
    const settings = await window.grokDesktop.getSettings();
    const clearsDefault = profile.models.some((model) => model.id === settings.defaultModel);
    if (!await confirmAction(`移除提供商“${profile.name}”及其应用管理的模型？${clearsDefault ? "\n\n当前桌面默认模型属于此 Provider；移除成功后会明确清除默认值，不会自动切换到官方 Grok 4.5。" : ""}`, { title: "移除提供商", confirmLabel: clearsDefault ? "移除并清除默认" : "移除", danger: true })) return;
    setBusy("remove"); try { setProviders(await window.grokDesktop.removeProvider(profile.id)); setSelectedId(""); onSettingsChanged(); } catch (error) { onError(message(error)); } finally { setBusy(""); }
  };
  const persistProfile = async (profile: CustomProviderProfile, patch: Partial<Pick<CustomProviderProfile, "enabled" | "models">>): Promise<void> => {
    if (!profile.owned) return;
    const edit = profileDraft({ ...profile, ...patch });
    if (!await confirmDefaultLoss(profile, edit.enabled !== false, edit.models ?? [])) return;
    const { headers, models = [], ...connection } = edit;
    setBusy("lifecycle");
    try {
      setProviders(await window.grokDesktop.upsertProvider({
        ...connection,
        extraHeaders: Object.fromEntries(headers.map((header) => [header.name.trim(), header.value.trim()])),
        models,
      }));
      onSettingsChanged();
    } catch (error) { onError(message(error)); }
    finally { setBusy(""); }
  };
  const confirmDefaultLoss = async (profile: CustomProviderProfile, enabled: boolean, models: ProviderModelDefinition[]): Promise<boolean> => {
    const settings = await window.grokDesktop.getSettings();
    if (!settings.defaultModel || !profile.models.some((model) => model.id === settings.defaultModel)) return true;
    if (enabled && models.some((model) => model.enabled !== false && model.id === settings.defaultModel)) return true;
    return confirmAction(
      `“${settings.defaultModel}”是当前桌面默认模型。此操作会使它不可用；保存成功后将清除默认值，不会自动切换到官方 Grok 4.5。`,
      { title: "清除默认模型", confirmLabel: "继续并清除默认", danger: true },
    );
  };
  const startScan = async (profile: CustomProviderProfile, modelIds?: string[], mediaOnly = false): Promise<void> => {
    const count = modelIds?.length ?? profile.models.length;
    const selectedModel = modelIds?.length === 1 ? profile.models.find((model) => model.id === modelIds[0]) : undefined;
    const protocols: ProviderProtocol[] = mediaOnly
      ? [selectedModel?.protocol ?? profile.protocol]
      : ["chat_completions", "responses", "messages"];
    const protocolCount = protocols.length;
    const includeReasoning = mediaOnly ? false : scanReasoning;
    const includeTools = mediaOnly ? false : scanTools;
    const includeImages = mediaOnly ? true : scanMedia;
    const perProtocol = mediaOnly ? 0 : 3 + (includeTools ? 2 : 0) + (includeReasoning ? 8 : 0);
    const estimatedRequests = count * protocolCount * perProtocol + (includeImages ? count * 2 : 0) + 2;
    if (!await confirmAction(
      mediaOnly
        ? `仅检测当前 Provider“${profile.name}”中的模型“${selectedModel?.name ?? modelIds?.[0]}”，按其当前协议执行图片/视频资产检测，预计最多约 ${estimatedRequests} 个受控子请求。不会扫描其他模型或 Provider。`
        : `范围仅限当前 Provider“${profile.name}”：${count} 个模型 × ${protocolCount} 种协议，预计最多约 ${estimatedRequests} 个受控子请求。将验证基础/SSE${includeTools ? "、工具与续写" : ""}${includeReasoning ? "、思考档位" : ""}${includeImages ? "、媒体" : ""}。上下文窗口不再自动探测，使用模型元数据或手工值。`,
      { title: mediaOnly ? "仅检测媒体" : modelIds?.length === 1 ? "扫描此模型" : "扫描当前 Provider", confirmLabel: "开始扫描" },
    )) return;
    try {
      const job = await window.grokDesktop.startProviderScan({
        providerId: profile.id,
        modelIds,
        protocols,
        includeReasoning,
        includeTools,
        includeImages,
        context: { mode: "off" },
      });
      setScanJob(job);
    } catch (error) { onError(message(error)); }
  };
  const openApplication = async (profile: CustomProviderProfile): Promise<void> => {
    setBusy("application");
    try {
      const value = await window.grokDesktop.getProviderCapabilityApplication(profile.id);
      setApplication(value);
      setApplicationSelection(new Set(value.changes.filter((change) => change.selectedByDefault).map((change) => change.id)));
    } catch (error) { onError(message(error)); }
    finally { setBusy(""); }
  };
  const applyApplication = async (): Promise<void> => {
    if (!selected || !application) return;
    const selection: CapabilityApplicationSelection = {
      reasoning: application.changes.some((change) => change.kind === "reasoning" && applicationSelection.has(change.id)),
      context: application.changes.some((change) => change.kind === "context" && applicationSelection.has(change.id)),
      compatibilityFlavor: application.changes.some((change) => change.kind === "compatibility" && applicationSelection.has(change.id)),
      aliases: application.changes.some((change) => change.kind === "aliases" && applicationSelection.has(change.id)),
      capabilities: application.changes.some((change) => change.kind === "capabilities" && applicationSelection.has(change.id)),
      protocolsByModel: Object.fromEntries(application.changes
        .filter((change) => change.kind === "protocol" && change.modelId && applicationSelection.has(change.id))
        .map((change) => [change.modelId!, change.after as ProviderProtocol])),
    };
    setBusy("apply-capabilities");
    try {
      setProviders(await window.grokDesktop.applyProviderCapabilities(selected.id, selection));
      setApplication(undefined);
      onSettingsChanged();
    } catch (error) { onError(message(error)); }
    finally { setBusy(""); }
  };

  return <div className="modal-backdrop provider-manager-backdrop" onMouseDown={onClose}><section className="provider-manager" role="dialog" aria-modal="true" aria-label="自定义提供商管理" onMouseDown={(event) => event.stopPropagation()}>
    <header><div><h2>自定义提供商</h2><span>连接、模型发现与 CLI 配置</span></div><button className="icon-button" aria-label="关闭提供商管理" onClick={onClose}><UiIcon name="close"/></button></header>
    <div className="provider-manager-layout">
      <aside className="provider-manager-list"><label><UiIcon name="search"/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索提供商"/></label><div className="provider-preset-menu"><strong>添加提供商</strong><div><button onClick={() => startCreate("openai-chat")}>OpenAI 兼容</button><button onClick={() => startCreate("responses")}>Responses</button><button onClick={() => startCreate("anthropic")}>Anthropic</button><button onClick={() => startCreate("gemini-compatible")}>Gemini 兼容</button><button onClick={() => startCreate("ollama")}>Ollama</button><button onClick={() => startCreate("gateway")}>普通网关</button></div></div><nav>{visibleProviders.map((provider) => <button className={provider.id === selectedId && !draft ? "active" : ""} key={provider.id} onClick={() => { setSelectedId(provider.id); setDraft(undefined); }}><span className={`provider-health ${provider.hasCredential ? "ready" : "missing"}`}/><span><strong>{provider.name}</strong><small>{protocolLabel(provider.protocol)} · {provider.models.length} 个模型</small></span>{!provider.owned && <em>外部</em>}</button>)}</nav></aside>
      <main className="provider-manager-detail">{draft ? <ProviderDraftEditor draft={draft} setDraft={setDraft} candidates={candidates} setCandidates={setCandidates} visibleCandidates={visibleCandidates} selectedCandidates={selectedCandidates} setSelectedCandidates={setSelectedCandidates} modelSearch={modelSearch} setModelSearch={setModelSearch} probe={probe} busy={busy} onProbe={() => void runProbe(false)} onDiscover={() => void runProbe(true)} onImport={importSelected} onSave={() => void save()} onCancel={() => setDraft(undefined)}/> : selected ? <ProviderDetails
        provider={selected}
        busy={busy}
        probe={probe}
        scanJob={scanJob}
        scanReasoning={scanReasoning}
        scanTools={scanTools}
        scanMedia={scanMedia}
        onScanReasoning={setScanReasoning}
        onScanTools={setScanTools}
        onScanMedia={setScanMedia}
        onEdit={() => startEdit(selected)}
        onTest={async () => {
          setBusy("test");
          try {
            const result = await window.grokDesktop.testProvider(selected.id);
            setProbe({ ...result, endpoint: selected.modelListUrl || `${selected.baseUrl}/models`, warnings: [], candidates: [] });
          } catch (error) { onError(message(error)); }
          finally { setBusy(""); }
        }}
        onScan={(modelId) => startScan(selected, modelId ? [modelId] : undefined)}
        onMediaScan={(modelId) => startScan(selected, [modelId], true)}
        onCancelScan={async () => { if (scanJob) setScanJob(await window.grokDesktop.cancelProviderScan(scanJob.jobId)); }}
        onApplyCapabilities={() => openApplication(selected)}
        onToggleProvider={(enabled) => persistProfile(selected, { enabled })}
        onToggleModel={(modelId, enabled) => persistProfile(selected, { models: selected.models.map((model) => model.id === modelId ? { ...model, enabled } : model) })}
        onRemove={() => void remove(selected)}
        onDesktopDefault={async (id) => { await window.grokDesktop.setProviderDesktopDefault(id); onSettingsChanged(); }}
        onCliDefault={async (id) => { setProviders(await window.grokDesktop.setProviderCliDefault(id)); }}
      /> : <div className="provider-manager-empty"><UiIcon name="profiles" size={30}/><strong>选择或添加提供商</strong><span>可以在保存前测试连接并获取模型列表。</span></div>}</main>
    </div>
    {application && <div className="provider-application-backdrop" onMouseDown={() => setApplication(undefined)}><section className="provider-application-dialog" onMouseDown={(event) => event.stopPropagation()}>
      <header><div><strong>应用扫描结果</strong><span>{application.expired ? "证据已过期，请重新扫描" : `扫描于 ${new Date(application.checkedAt).toLocaleString()}`}</span></div><button className="icon-button" onClick={() => setApplication(undefined)}><UiIcon name="close"/></button></header>
      <p>只有勾选的差异会写入配置。协议和上下文默认不会自动应用。</p>
      <div className="provider-application-list">{application.changes.map((change) => <label key={change.id}><input type="checkbox" checked={applicationSelection.has(change.id)} onChange={(event) => {
        const next = new Set(applicationSelection); if (event.target.checked) next.add(change.id); else next.delete(change.id); setApplicationSelection(next);
      }}/><span><strong>{change.label}</strong><small>{change.before ? `${change.before} → ` : ""}{change.after}</small><em>{evidenceSourceLabel(change.evidenceSource)}{change.checkedAt ? ` · ${new Date(change.checkedAt).toLocaleString()}` : ""}{change.expired ? " · 已过期" : ""}</em></span></label>)}</div>
      <footer><button onClick={() => setApplication(undefined)}>取消</button><button className="primary" disabled={application.expired || !applicationSelection.size || Boolean(busy)} onClick={() => void applyApplication()}>应用所选 {applicationSelection.size} 项</button></footer>
    </section></div>}
  </section></div>;
}

function ProviderDraftEditor({ draft, setDraft, candidates, setCandidates, visibleCandidates, selectedCandidates, setSelectedCandidates, modelSearch, setModelSearch, probe, busy, onProbe, onDiscover, onImport, onSave, onCancel }: {
  draft: ProviderConnectionDraft; setDraft(value: ProviderConnectionDraft): void; candidates: ProviderModelCandidate[]; setCandidates(value: ProviderModelCandidate[]): void; visibleCandidates: ProviderModelCandidate[]; selectedCandidates: Set<string>; setSelectedCandidates(value: Set<string>): void; modelSearch: string; setModelSearch(value: string): void; probe?: ProviderDraftProbeResult; busy: string; onProbe(): void; onDiscover(): void; onImport(): void; onSave(): void; onCancel(): void;
}): React.JSX.Element {
  const updateModel = (position: number, patch: Partial<ProviderModelDefinition>): void => setDraft({ ...draft, models: (draft.models ?? []).map((model, index) => index === position ? { ...model, ...patch } : model) });
  return <div className="provider-draft-editor"><header><div><strong>{draft.models?.length ? "编辑提供商" : "添加提供商"}</strong><span>模型发现仅访问列表端点，不发送推理请求。</span></div><div><button onClick={onCancel}>取消</button><button className="primary" disabled={Boolean(busy)} onClick={onSave}>{busy === "save" ? "保存中…" : "保存"}</button></div></header><div className="provider-draft-scroll">
    <section><h3>连接</h3><div className="provider-form-grid"><label>配置 ID<input value={draft.id} onChange={(event) => setDraft({ ...draft, id: event.target.value })}/></label><label>显示名称<input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })}/></label><label className="check wide"><input type="checkbox" checked={draft.enabled !== false && Boolean(draft.models?.length)} disabled={!draft.models?.length} onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })}/>启用此 Provider（零模型保存时会自动停用）</label><label className="wide">基础地址<input value={draft.baseUrl} onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })}/></label><label className="wide">模型列表地址<input value={draft.modelListUrl ?? ""} placeholder="默认：基础地址/models" onChange={(event) => setDraft({ ...draft, modelListUrl: event.target.value || undefined })}/></label><label>CLI 请求协议<select value={draft.protocol} onChange={(event) => { const protocol = event.target.value as ProviderProtocol; setDraft({ ...draft, protocol, upstreamProtocol: protocolUpstream(protocol) }); }}><option value="chat_completions">Chat Completions</option><option value="responses">Responses</option><option value="messages">Anthropic Messages</option></select></label><label>上游协议<select value={draft.upstreamProtocol ?? "openai_chat"} onChange={(event) => setDraft({ ...draft, upstreamProtocol: event.target.value as ProviderUpstreamProtocol })}><option value="openai_chat">OpenAI Chat</option><option value="openai_responses">OpenAI Responses</option><option value="anthropic_messages">Anthropic Messages</option><option value="gemini_generate_content">Gemini GenerateContent</option><option value="compatible_passthrough">兼容网关直通</option></select></label><label>兼容档<select value={draft.compatibilityFlavor ?? "auto"} onChange={(event) => setDraft({ ...draft, compatibilityFlavor: event.target.value as ProviderCompatibilityFlavor })}><option value="auto">自动识别</option><option value="cliproxyapi">CLIProxyAPI</option><option value="grok2api">grok2api</option><option value="sub2api">sub2api</option><option value="new-api">new-api</option><option value="generic">通用兼容服务</option></select></label><label>工具 Schema<select value={draft.schemaProfile ?? "standard"} onChange={(event) => setDraft({ ...draft, schemaProfile: event.target.value as ProviderSchemaProfile })}><option value="standard">标准兼容</option><option value="gemini">Gemini / Antigravity</option><option value="strict">严格 JSON Schema</option></select></label><label>网络路由<select value={draft.proxyMode ?? "inherit"} onChange={(event) => setDraft({ ...draft, proxyMode: event.target.value as ProviderProxyMode })}><option value="inherit">继承应用代理</option><option value="direct">直连（跳过应用代理）</option></select></label><label>认证<select value={draft.authScheme} onChange={(event) => setDraft({ ...draft, authScheme: event.target.value as ProviderConnectionDraft["authScheme"] })}><option value="bearer">Bearer</option><option value="x_api_key">x-api-key</option></select></label><label>凭据来源<select value={draft.credentialMode} onChange={(event) => setDraft({ ...draft, credentialMode: event.target.value as ProviderConnectionDraft["credentialMode"] })}><option value="managed">应用管理的用户环境变量</option><option value="existing">已有环境变量</option><option value="none">无需认证</option></select></label>{draft.credentialMode === "managed" && <label>密钥<input type="password" value={draft.credentialValue ?? ""} placeholder="编辑时留空会保留" onChange={(event) => setDraft({ ...draft, credentialValue: event.target.value })}/></label>}{draft.credentialMode === "existing" && <label>环境变量<input value={draft.credentialEnv ?? ""} onChange={(event) => setDraft({ ...draft, credentialEnv: event.target.value })}/></label>}<label className="check wide"><input type="checkbox" checked={draft.allowInsecureHttp ?? false} onChange={(event) => setDraft({ ...draft, allowInsecureHttp: event.target.checked })}/>允许非本机明文 HTTP</label></div>
      {draft.upstreamProtocol && draft.upstreamProtocol !== protocolUpstream(draft.protocol) && draft.upstreamProtocol !== "compatible_passthrough" ? <p className="provider-probe-warning">主进程兼容网关会把 {protocolLabel(draft.protocol)} 转换为 {upstreamProtocolLabel(draft.upstreamProtocol)}；保存后请运行深度扫描确认该部署的流式、工具和思考语义。</p> : null}
      <h4>额外 Header（环境变量来源）</h4><div className="provider-header-rows">{draft.headers.map((header, index) => <div key={index}><input value={header.name} placeholder="Header 名称" onChange={(event) => setDraft({ ...draft, headers: draft.headers.map((value, position) => position === index ? { ...value, name: event.target.value } : value) })}/><input value={header.value} placeholder="环境变量名" onChange={(event) => setDraft({ ...draft, headers: draft.headers.map((value, position) => position === index ? { ...value, value: event.target.value } : value) })}/><button onClick={() => setDraft({ ...draft, headers: draft.headers.filter((_value, position) => position !== index) })}>删除</button></div>)}<button onClick={() => setDraft({ ...draft, headers: [...draft.headers, { name: "", source: "environment", value: "" }] })}>+ 添加 Header</button></div>
      <div className="provider-probe-actions"><button disabled={Boolean(busy)} onClick={onProbe}>{busy === "probe" ? "测试中…" : "测试连接"}</button><button className="primary" disabled={Boolean(busy)} onClick={onDiscover}>{busy === "discover" ? "获取中…" : "获取模型列表"}</button>{probe && <span className={probe.ok ? "success-text" : "error-text"}>{probe.message} · {probe.latencyMs} ms</span>}</div>{probe?.warnings.map((warning) => <p className="provider-probe-warning" key={warning}>{warning}</p>)}</section>
    <section><div className="provider-model-heading"><div><h3>远端模型</h3><span>{candidates.length ? `${candidates.length} 个候选${selectedCandidates.size ? ` · 已选 ${selectedCandidates.size}` : ""}` : "先获取模型列表"}</span></div><label><UiIcon name="search"/><input value={modelSearch} onChange={(event) => setModelSearch(event.target.value)} placeholder="搜索模型或来源"/></label><button onClick={() => setSelectedCandidates(new Set(visibleCandidates.filter((value) => !value.alreadyConfigured).map((value) => value.remoteId)))}>选择可见项</button><button disabled={!selectedCandidates.size} onClick={() => setSelectedCandidates(new Set())}>清空选择</button><button disabled={!selectedCandidates.size} onClick={onImport}>批量导入 {selectedCandidates.size || ""}</button></div><div className="provider-candidates">{visibleCandidates.map((candidate, index) => <label className={candidate.alreadyConfigured ? "configured" : ""} key={candidate.remoteId}><input type="checkbox" disabled={candidate.alreadyConfigured} checked={selectedCandidates.has(candidate.remoteId)} onChange={(event) => { const next = new Set(selectedCandidates); if (event.target.checked) next.add(candidate.remoteId); else next.delete(candidate.remoteId); setSelectedCandidates(next); }}/><span><strong>{candidate.name}</strong><small>{candidate.ownedBy ? <em className="candidate-owner">{candidate.ownedBy}</em> : null}{candidate.remoteId}{candidate.alreadyConfigured ? " · 已配置" : ""}</small></span><input value={candidate.localId} aria-label={`本地模型 ID ${candidate.remoteId}`} onChange={(event) => { setCandidates(candidates.map((value) => value.remoteId === candidate.remoteId ? { ...value, localId: event.target.value } : value)); }}/></label>)}</div></section>
    <section><div className="provider-model-heading"><div><h3>将保存的模型</h3><span>每个模型可独立选择客户端协议、上游协议、超时与思考传输</span></div><button onClick={() => setDraft({ ...draft, models: [...(draft.models ?? []), { id: `${draft.id}-model`, model: "", name: "", contextWindow: undefined, inferenceIdleTimeoutSeconds: DEFAULT_PROVIDER_INFERENCE_IDLE_TIMEOUT_SECONDS }] })}>+ 手工添加</button></div><div className="provider-imported-models">{(draft.models ?? []).map((model, index) => <ProviderModelEditorRow key={`${index}:${model.id}`} draft={draft} model={model} onChange={(patch) => updateModel(index, patch)} onRemove={() => setDraft({ ...draft, models: (draft.models ?? []).filter((_value, position) => position !== index) })}/>)}</div><p className="provider-probe-warning">默认首字节上限 360 秒、推理流空闲 600 秒、整个 ACP 回合 1800 秒。手工勾选仅表示允许选择；深度扫描会另外标记“请求接受、映射、确认或拒绝”，不会把 HTTP 200 伪装成语义确认。</p></section>
  </div></div>;
}

function ProviderModelEditorRow({ draft, model, onChange, onRemove }: {
  draft: ProviderConnectionDraft;
  model: ProviderModelDefinition;
  onChange(patch: Partial<ProviderModelDefinition>): void;
  onRemove(): void;
}): React.JSX.Element {
  const clientProtocol = model.protocol ?? draft.protocol;
  const configuredUpstream = model.upstreamProtocol ?? (model.protocol ? protocolUpstream(model.protocol) : draft.upstreamProtocol) ?? protocolUpstream(clientProtocol);
  const reasoningKey = configuredUpstream === "compatible_passthrough" ? protocolUpstream(clientProtocol) : configuredUpstream;
  const transport = model.reasoning?.[reasoningKey];
  const setTransport = (mode: ProviderReasoningMode | ""): void => {
    const reasoning = { ...(model.reasoning ?? {}) };
    if (!mode) delete reasoning[reasoningKey];
    else reasoning[reasoningKey] = {
      mode,
      efforts: mode === "unsupported" ? [] : model.reasoningEfforts?.filter((value): value is Exclude<ReasoningEffort, ""> => Boolean(value)) ?? [],
      source: "manual",
      ...(mode === "budget_tokens" ? { budgetByEffort: defaultBudgets() } : {}),
      ...(mode === "fixed" ? { fixedEffort: "high" as const } : {}),
    };
    onChange({ reasoning });
  };
  const patchTransport = (patch: Partial<NonNullable<typeof transport>>): void => {
    if (!transport) return;
    onChange({ reasoning: { ...(model.reasoning ?? {}), [reasoningKey]: { ...transport, ...patch, source: "manual" } } });
  };
  return <div>
    <label className="provider-model-enabled"><input type="checkbox" checked={model.enabled !== false} onChange={(event) => onChange({ enabled: event.target.checked })}/>启用模型</label>
    <input value={model.id} placeholder="本地配置 ID" onChange={(event) => onChange({ id: event.target.value })}/>
    <input value={model.model} placeholder="远端模型 ID" onChange={(event) => onChange({ model: event.target.value, reasoningEfforts: providerReasoningEfforts(event.target.value, model.reasoningEfforts) })}/>
    <input value={model.name} placeholder="显示名称" onChange={(event) => onChange({ name: event.target.value })}/>
    <input type="number" min="1024" value={model.contextWindow ?? ""} title="手工上下文窗口；建议依据服务文档或模型元数据填写" placeholder="上下文（手工）" onChange={(event) => onChange({ contextWindow: event.target.value ? Number(event.target.value) : undefined })}/>
    <button onClick={onRemove}>删除</button>
    <div className="provider-model-options">
      <label>客户端协议<select value={model.protocol ?? ""} onChange={(event) => {
        const protocol = event.target.value ? event.target.value as ProviderProtocol : undefined;
        onChange({ protocol, upstreamProtocol: protocol ? protocolUpstream(protocol) : undefined });
      }}><option value="">继承 Provider（{protocolLabel(draft.protocol)}）</option><option value="chat_completions">Chat Completions</option><option value="responses">Responses</option><option value="messages">Anthropic Messages</option></select></label>
      <label>上游协议<select value={model.upstreamProtocol ?? ""} onChange={(event) => onChange({ upstreamProtocol: event.target.value ? event.target.value as ProviderUpstreamProtocol : undefined })}><option value="">继承 Provider（{upstreamProtocolLabel(draft.upstreamProtocol ?? protocolUpstream(draft.protocol))}）</option><option value="openai_chat">OpenAI Chat</option><option value="openai_responses">OpenAI Responses</option><option value="anthropic_messages">Anthropic Messages</option><option value="gemini_generate_content">Gemini GenerateContent</option><option value="compatible_passthrough">兼容网关直通</option></select></label>
      <label>推理空闲超时<input type="number" min="30" max="3600" step="30" value={model.inferenceIdleTimeoutSeconds ?? DEFAULT_PROVIDER_INFERENCE_IDLE_TIMEOUT_SECONDS} onChange={(event) => onChange({ inferenceIdleTimeoutSeconds: Number(event.target.value) })}/><span>秒</span></label>
      <label>思考传输<select value={transport?.mode ?? ""} onChange={(event) => setTransport(event.target.value as ProviderReasoningMode | "")}><option value="">按协议自动</option><option value="effort_enum">等级字段</option><option value="adaptive">Anthropic adaptive</option><option value="budget_tokens">Token 预算</option><option value="model_suffix">模型后缀</option><option value="fixed">固定等级</option><option value="unsupported">不发送思考参数</option></select></label>
      <div className="provider-reasoning-efforts"><span>可选等级</span>{PROVIDER_REASONING_EFFORTS.map((effortValue) => <label key={effortValue}><input type="checkbox" checked={model.reasoningEfforts?.includes(effortValue) ?? false} onChange={(event) => {
        const current = model.reasoningEfforts ?? [];
        const reasoningEfforts = event.target.checked ? [...current, effortValue] : current.filter((value) => value !== effortValue);
        const reasoning = transport ? { ...(model.reasoning ?? {}), [reasoningKey]: { ...transport, efforts: reasoningEfforts.filter((value): value is Exclude<ReasoningEffort, ""> => Boolean(value)), source: "manual" as const } } : model.reasoning;
        onChange({ reasoningEfforts, reasoning });
      }}/>{effortValue}</label>)}</div>
    </div>
    <div className="provider-media-map">
      <strong>媒体端点（未知协议不猜测）</strong>
      <label>图片传输<select value={model.media?.image?.transport ?? ""} onChange={(event) => {
        const transport = event.target.value as ProviderImageTransport | "";
        onChange({ media: { ...model.media, image: transport ? { transport } : undefined } });
      }}><option value="">未配置</option><option value="openai_images">OpenAI Images</option><option value="openai_responses_image">Responses 图片工具</option><option value="gemini_generate_content">Gemini GenerateContent 图片</option></select></label>
      {model.media?.image && <label>图片端点<input value={model.media.image.endpoint ?? ""} placeholder="留空使用该传输档的标准相对路径" onChange={(event) => onChange({ media: { ...model.media, image: { ...model.media!.image!, endpoint: event.target.value || undefined } } })}/></label>}
      <label>视频传输<select value={model.media?.video?.transport ?? ""} onChange={(event) => onChange({ media: {
        ...model.media,
        video: event.target.value ? { transport: "compatible_video", endpoint: model.media?.video?.endpoint ?? "" } : undefined,
      } })}><option value="">未配置</option><option value="compatible_video">显式兼容视频端点</option></select></label>
      {model.media?.video && <label>视频端点<input value={model.media.video.endpoint} placeholder="必填；相对 Provider 基础地址且同源" onChange={(event) => onChange({ media: { ...model.media, video: { ...model.media!.video!, endpoint: event.target.value } } })}/></label>}
      <small>视频扫描只有在端点返回实际 URL/Base64 资产时才记为可用；仅返回异步任务 ID 不算完成能力。</small>
    </div>
    {transport?.mode === "budget_tokens" && <div className="provider-reasoning-map"><strong>预算映射</strong>{(model.reasoningEfforts ?? []).filter(Boolean).map((effortValue) => <label key={effortValue}>{effortValue}<input type="number" min="-1" value={transport.budgetByEffort?.[effortValue as Exclude<ReasoningEffort, "">] ?? ""} onChange={(event) => patchTransport({ budgetByEffort: { ...(transport.budgetByEffort ?? {}), [effortValue]: Number(event.target.value) } })}/></label>)}</div>}
    {transport?.mode === "model_suffix" && <div className="provider-reasoning-map"><strong>模型后缀</strong>{(model.reasoningEfforts ?? []).filter(Boolean).map((effortValue) => <label key={effortValue}>{effortValue}<input value={transport.suffixByEffort?.[effortValue as Exclude<ReasoningEffort, "">] ?? ""} placeholder="-high" onChange={(event) => patchTransport({ suffixByEffort: { ...(transport.suffixByEffort ?? {}), [effortValue]: event.target.value } })}/></label>)}</div>}
    {transport?.mode === "fixed" && <div className="provider-reasoning-map"><strong>固定上游等级</strong><select value={transport.fixedEffort ?? "high"} onChange={(event) => patchTransport({ fixedEffort: event.target.value as Exclude<ReasoningEffort, ""> })}>{PROVIDER_REASONING_EFFORTS.map((effortValue) => <option key={effortValue}>{effortValue}</option>)}</select></div>}
  </div>;
}

function ProviderDetails({ provider, busy, probe, scanJob, scanReasoning, scanTools, scanMedia, onScanReasoning, onScanTools, onScanMedia, onEdit, onTest, onScan, onMediaScan, onCancelScan, onApplyCapabilities, onToggleProvider, onToggleModel, onRemove, onDesktopDefault, onCliDefault }: {
  provider: CustomProviderProfile;
  busy: string;
  probe?: ProviderDraftProbeResult;
  scanJob?: ProviderScanJob;
  scanReasoning: boolean;
  scanTools: boolean;
  scanMedia: boolean;
  onScanReasoning(value: boolean): void;
  onScanTools(value: boolean): void;
  onScanMedia(value: boolean): void;
  onEdit(): void;
  onTest(): void;
  onScan(modelId?: string): Promise<void>;
  onMediaScan(modelId: string): Promise<void>;
  onCancelScan(): Promise<void>;
  onApplyCapabilities(): Promise<void>;
  onToggleProvider(enabled: boolean): Promise<void>;
  onToggleModel(modelId: string, enabled: boolean): Promise<void>;
  onRemove(): void;
  onDesktopDefault(id: string): void;
  onCliDefault(id: string): void;
}): React.JSX.Element {
  const [tab, setTab] = useState<"models" | "capabilities" | "connection">("models");
  const [expandedModel, setExpandedModel] = useState("");
  const scanned = provider.models.filter((model) => model.capabilities?.checkedAt).length;
  return <div className="provider-details">
    <header>
      <div><strong>{provider.name}{provider.enabled === false ? "（已停用）" : ""}</strong><span>{provider.id} · {protocolLabel(provider.protocol)} → {upstreamProtocolLabel(provider.upstreamProtocol ?? protocolUpstream(provider.protocol))}</span></div>
      <div>
        <button disabled={Boolean(busy) && busy !== "scan"} onClick={onTest}>{busy === "test" ? "测试中…" : "浅层测试"}</button>
        {provider.owned && (scanJob && (scanJob.status === "queued" || scanJob.status === "running" || scanJob.status === "cancelling")
          ? <button className="danger-text" onClick={() => void onCancelScan()}>取消扫描</button>
          : <button disabled={Boolean(busy)} onClick={() => void onScan()}>深度兼容扫描</button>)}
        {provider.owned && scanned > 0 && <button disabled={Boolean(busy)} onClick={() => void onApplyCapabilities()}>{busy === "application" ? "读取中…" : "应用扫描结果"}</button>}
        {provider.owned && <button disabled={Boolean(busy)} onClick={() => void onToggleProvider(provider.enabled === false)}>{provider.enabled === false ? "启用" : "停用"}</button>}
        {provider.owned && <button disabled={Boolean(busy)} onClick={onEdit}>编辑</button>}
        {provider.owned && <button className="danger-text" disabled={Boolean(busy)} onClick={onRemove}>删除</button>}
      </div>
    </header>
    <nav className="provider-detail-tabs">
      <button className={tab === "models" ? "active" : ""} onClick={() => setTab("models")}>模型</button>
      <button className={tab === "capabilities" ? "active" : ""} onClick={() => setTab("capabilities")}>协议能力 <span>{scanned}/{provider.models.length}</span></button>
      <button className={tab === "connection" ? "active" : ""} onClick={() => setTab("connection")}>连接</button>
    </nav>
    <div className="provider-scan-options">
      <div className="provider-scan-feature-row">
        <label className="check"><input type="checkbox" checked={scanReasoning} onChange={(event) => onScanReasoning(event.target.checked)}/>思考档位</label>
        <label className="check"><input type="checkbox" checked={scanTools} onChange={(event) => onScanTools(event.target.checked)}/>工具与续写</label>
        <label className="check"><input type="checkbox" checked={scanMedia} onChange={(event) => onScanMedia(event.target.checked)}/>媒体能力</label>
      </div>
      <span>批量扫描范围始终是当前 Provider“{provider.name}”，不会扫描其他 Provider。上下文窗口改为使用模型元数据或手工值，不再发送缓慢且费用不确定的自动探测请求。</span>
    </div>
    {scanJob && <div className={`provider-scan-banner ${scanJob.status}`}><span className={scanJob.status === "running" || scanJob.status === "cancelling" ? "provider-scan-spinner" : ""}/><div><strong>{scanStatusLabel(scanJob.status)}</strong><span>{scanJob.message}</span><small>{scanJob.completed}/{scanJob.total} 子步骤 · 成功 {scanJob.succeeded} · 失败 {scanJob.failed}{scanJob.modelId ? ` · ${scanJob.modelId}` : ""}{scanJob.protocol ? ` · ${protocolLabel(scanJob.protocol)}` : ""}{scanJob.effort ? ` · ${scanJob.effort}` : ""}</small><progress value={scanJob.completed} max={Math.max(1, scanJob.total)}/></div></div>}
    {probe && <p className={probe.ok ? "provider-result success" : "provider-result error"}>{probe.message} · {probe.latencyMs} ms</p>}
    {tab === "connection" && <dl>
      <dt>基础地址</dt><dd>{provider.baseUrl}</dd>
      <dt>模型列表</dt><dd>{provider.modelListUrl || `${provider.baseUrl}/models`}</dd>
      <dt>兼容档</dt><dd>{compatibilityLabel(provider.compatibilityFlavor ?? "auto")}</dd>
      <dt>网络路由</dt><dd>{provider.proxyMode === "direct" ? "直连（跳过应用代理）" : "继承应用代理"}</dd>
      <dt>认证</dt><dd>{provider.credentialMode === "none" ? "无需认证" : provider.hasCredential ? "已配置" : "缺少凭据"}</dd>
      <dt>来源</dt><dd>{provider.owned ? "Grok Build Desktop 管理" : "外部 config.toml（只读）"}</dd>
    </dl>}
    {tab === "models" && <section className="provider-model-section"><h3>模型 <span>{provider.models.length}</span></h3>{!provider.models.length && <div className="provider-manager-empty"><strong>尚未配置模型</strong><span>Provider 已保存为停用状态，可稍后编辑并获取模型。</span></div>}{provider.models.map((model) => <article className={model.enabled === false ? "disabled" : ""} key={model.id}>
      <div><strong>{provider.name} · {model.name}{model.enabled === false ? "（已停用）" : ""}</strong><small>{model.id} → {model.model}</small><span>{protocolLabel(model.protocol ?? provider.protocol)} → {upstreamProtocolLabel(model.upstreamProtocol ?? (model.protocol ? protocolUpstream(model.protocol) : provider.upstreamProtocol) ?? protocolUpstream(model.protocol ?? provider.protocol))} · 空闲 {model.inferenceIdleTimeoutSeconds ?? DEFAULT_PROVIDER_INFERENCE_IDLE_TIMEOUT_SECONDS} 秒 · {model.contextWindow ? `${Math.round(model.contextWindow / 1000)}K` : "上下文未知"} · {model.reasoningEfforts?.length ? `可选：${model.reasoningEfforts.join(" / ")}` : "未配置思考档位"} · 媒体 ${model.media?.image?.transport ?? "未配置图片"} / ${model.media?.video ? "显式视频" : "未配置视频"}</span></div>
      <div className="provider-model-actions"><button disabled={Boolean(scanJob && !isScanTerminal(scanJob.status))} onClick={() => void onScan(model.id)}>完整扫描</button><button disabled={Boolean(scanJob && !isScanTerminal(scanJob.status))} onClick={() => void onMediaScan(model.id)}>仅检测媒体</button><button onClick={() => void onToggleModel(model.id, model.enabled === false)}>{model.enabled === false ? "启用" : "停用"}</button><button disabled={provider.enabled === false || model.enabled === false} onClick={() => onDesktopDefault(model.id)}>桌面默认</button><button disabled={provider.enabled === false || model.enabled === false} onClick={() => onCliDefault(model.id)}>CLI 默认</button></div>
    </article>)}</section>}
    {tab === "capabilities" && <section className="provider-capability-section"><h3>逐模型协议矩阵 <span>真实探测优先于模型名推断</span></h3>{provider.models.map((model) => {
      const capability = model.capabilities;
      const open = expandedModel === model.id;
      return <article className="provider-capability-model" key={model.id}>
        <button className="provider-capability-model-head" onClick={() => setExpandedModel(open ? "" : model.id)}>
          <span><strong>{model.name}</strong><small>{model.model}{capability?.returnedModelIds?.length ? ` → 返回 ${capability.returnedModelIds.join(", ")}` : ""}</small></span>
          <em>{capability?.checkedAt ? new Date(capability.checkedAt).toLocaleString() : "尚未扫描"}</em>
          <UiIcon name={open ? "chevron-down" : "chevron-right"}/>
        </button>
        {open && <div className="provider-protocol-grid">{(["responses", "chat_completions", "messages"] as ProviderProtocol[]).map((protocol) => {
          const value = capability?.protocols[protocol];
          return <div className={`provider-protocol-card ${value?.available ? "available" : "unavailable"}`} key={protocol}>
            <header><strong>{protocolLabel(protocol)}</strong><span>{value ? verificationLabel(value.verification) : "未知"}</span></header>
            <dl><dt>非流式</dt><dd>{yesNo(value?.nonStreaming)}</dd><dt>SSE</dt><dd>{yesNo(value?.streaming)}</dd><dt>工具</dt><dd>{yesNo(value?.tools)}</dd><dt>Usage</dt><dd>{yesNo(value?.usage)}</dd></dl>
            <p>{value?.reasoning?.efforts.length ? `思考：${value.reasoning.efforts.join(" / ")}（${value.reasoning.source === "live_probe" ? "请求接受" : "兼容建议"}）` : "未确认思考档位"}</p><p>{value?.context ? `上下文：${value.context.message || (value.context.exactUsage ? "已有精确 Token 证据" : "仅有字符证据")}` : "上下文：未扫描"}</p><p>{`媒体：图片${value?.imageGeneration ? "已确认" : "未确认"} · 视频${value?.videoGeneration ? "已确认实际资产" : model.media?.video ? "已配置但未确认" : "未配置"}`}</p>
            {value?.message && <small>{value.status ? `HTTP ${value.status} · ` : ""}{value.message}</small>}
          </div>;
        })}</div>}
      </article>;
    })}</section>}
  </div>;
}

function presetDraft(preset: Preset): ProviderConnectionDraft {
  const base: ProviderConnectionDraft = { id: "custom", enabled: true, name: "自定义提供商", baseUrl: "https://api.example.com/v1", protocol: "chat_completions", upstreamProtocol: "openai_chat", schemaProfile: "standard", compatibilityFlavor: "auto", proxyMode: "inherit", authScheme: "bearer", credentialMode: "managed", credentialValue: "", headers: [], models: [] };
  if (preset === "openai-chat") return { ...base, id: "openai-compatible", name: "OpenAI 兼容", baseUrl: "https://api.openai.com/v1" };
  if (preset === "responses") return { ...base, id: "responses-provider", name: "Responses 提供商", baseUrl: "https://api.openai.com/v1", protocol: "responses", upstreamProtocol: "openai_responses" };
  if (preset === "anthropic") return { ...base, id: "anthropic-compatible", name: "Anthropic 兼容", baseUrl: "https://api.anthropic.com/v1", protocol: "messages", upstreamProtocol: "anthropic_messages", authScheme: "x_api_key", headers: [{ name: "anthropic-version", source: "environment", value: "ANTHROPIC_VERSION" }] };
  if (preset === "gemini-compatible") return { ...base, id: "gemini-compatible", name: "Gemini 兼容网关", baseUrl: "https://api.example.com/v1", schemaProfile: "gemini", upstreamProtocol: "gemini_generate_content", compatibilityFlavor: "new-api" };
  if (preset === "ollama") return { ...base, id: "ollama", name: "Ollama", baseUrl: "http://127.0.0.1:11434/api", modelListUrl: "http://127.0.0.1:11434/api/tags", credentialMode: "none", credentialValue: undefined };
  return { ...base, id: "gateway", name: "OpenAI 兼容网关" };
}
function profileDraft(profile: CustomProviderProfile): ProviderConnectionDraft { return { id: profile.id, enabled: profile.enabled !== false, name: profile.name, baseUrl: profile.baseUrl, modelListUrl: profile.modelListUrl, protocol: profile.protocol, upstreamProtocol: profile.upstreamProtocol, schemaProfile: profile.schemaProfile, compatibilityFlavor: profile.compatibilityFlavor ?? "auto", proxyMode: profile.proxyMode ?? "inherit", authScheme: profile.authScheme, credentialMode: profile.credentialMode, credentialEnv: profile.credentialEnv, credentialValue: undefined, allowInsecureHttp: profile.insecureHttp, headers: Object.entries(profile.extraHeaders).map(([name, value]) => ({ name, source: "environment", value })), models: profile.models }; }
function candidateModel(value: ProviderModelCandidate): ProviderModelDefinition { return { id: value.localId, enabled: true, model: value.remoteId, name: value.name, description: value.description, contextWindow: value.contextWindow, inferenceIdleTimeoutSeconds: DEFAULT_PROVIDER_INFERENCE_IDLE_TIMEOUT_SECONDS, reasoningEfforts: providerReasoningEfforts(value.remoteId, value.reasoningEfforts), capabilities: value.capabilities }; }
export function looksGemini(value: string | undefined): boolean { return /gemini|antigravity|bard|palm|vertex/i.test(value ?? ""); }
function protocolLabel(protocol: CustomProviderProfile["protocol"]): string { return ({ chat_completions: "Chat Completions", responses: "Responses", messages: "Anthropic Messages" })[protocol]; }
function protocolUpstream(protocol: ProviderProtocol): ProviderUpstreamProtocol { return protocol === "responses" ? "openai_responses" : protocol === "messages" ? "anthropic_messages" : "openai_chat"; }
function upstreamProtocolLabel(protocol: ProviderUpstreamProtocol): string { return ({ openai_chat: "OpenAI Chat", openai_responses: "OpenAI Responses", anthropic_messages: "Anthropic Messages", gemini_generate_content: "Gemini GenerateContent", compatible_passthrough: "兼容直通" })[protocol]; }
function compatibilityLabel(value: ProviderCompatibilityFlavor): string { return ({ auto: "自动识别", cliproxyapi: "CLIProxyAPI", grok2api: "grok2api", sub2api: "sub2api", "new-api": "new-api", generic: "通用兼容服务" })[value]; }
function verificationLabel(value: ProviderCapabilityVerification): string {
  return ({ unknown: "未知", request_accepted: "请求接受", response_confirmed: "响应确认", mapped: "已映射", capped: "已封顶", rejected: "被拒绝" })[value];
}
function yesNo(value: boolean | undefined): string { return value === undefined ? "未知" : value ? "支持" : "不支持"; }
function defaultBudgets(): Partial<Record<Exclude<ReasoningEffort, "">, number>> { return { auto: -1, none: 0, minimal: 512, low: 1024, medium: 8192, high: 24576, xhigh: 32768, max: 128000 }; }
function isScanTerminal(status: ProviderScanJob["status"]): boolean { return status === "completed" || status === "cancelled" || status === "failed"; }
function scanStatusLabel(status: ProviderScanJob["status"]): string {
  return ({ queued: "等待扫描", running: "正在扫描", cancelling: "正在取消", completed: "扫描完成", cancelled: "扫描已取消", failed: "扫描失败" })[status];
}
function evidenceSourceLabel(source: CapabilityApplicationDraft["changes"][number]["evidenceSource"]): string {
  return ({ live_probe: "真实扫描", model_metadata: "模型元数据", compatibility_profile: "兼容档建议", manual: "手工配置" })[source];
}
function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
