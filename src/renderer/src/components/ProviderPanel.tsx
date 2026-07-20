import { useEffect, useMemo, useState } from "react";
import type { CustomProviderInput, CustomProviderProfile, ProviderAuthScheme, ProviderModelDefinition, ProviderProtocol } from "../../../shared/types";

const EMPTY_MODEL: ProviderModelDefinition = { id: "", model: "", name: "", contextWindow: 128_000 };

export function ProviderPanel({ setError, confirmAction, onDesktopDefault }: { setError(message: string): void; confirmAction(message: string, options?: { title?: string; confirmLabel?: string; danger?: boolean }): Promise<boolean>; onDesktopDefault(modelId: string): void }): React.JSX.Element {
  const [providers, setProviders] = useState<CustomProviderProfile[]>([]);
  const [editing, setEditing] = useState<CustomProviderInput | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("");
  const refresh = async (): Promise<void> => setProviders(await window.grokDesktop.listProviders());
  useEffect(() => { void refresh().catch((error) => setError(message(error))); }, []);
  const managed = providers.filter((value) => value.owned);
  const external = providers.filter((value) => !value.owned);
  const begin = (preset: "openai" | "responses" | "anthropic" | "local" = "openai"): void => {
    const protocol: ProviderProtocol = preset === "responses" ? "responses" : preset === "anthropic" ? "messages" : "chat_completions";
    const authScheme: ProviderAuthScheme = preset === "anthropic" ? "x_api_key" : "bearer";
    const id = preset === "local" ? "local" : preset;
    setEditing({ id, name: preset === "anthropic" ? "Anthropic" : preset === "local" ? "本地模型" : preset === "responses" ? "Responses 提供商" : "OpenAI 兼容", baseUrl: preset === "anthropic" ? "https://api.anthropic.com/v1" : preset === "local" ? "http://127.0.0.1:11434/v1" : "https://api.example.com/v1", protocol, authScheme, credentialMode: preset === "local" ? "none" : "managed", extraHeaders: {}, models: [{ ...EMPTY_MODEL, id: `${id}-model`, model: "model-id", name: "自定义模型" }] });
  };
  const save = async (): Promise<void> => {
    if (!editing) return;
    let candidate = editing;
    try {
      const url = new URL(editing.baseUrl);
      const local = ["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname.toLowerCase());
      if (url.protocol === "http:" && !local && !editing.allowInsecureHttp) {
        const approved = await confirmAction("该提供商使用非加密 HTTP，密钥和请求内容可能被同一网络中的第三方读取。仍要保存吗？", { title: "确认非加密连接", confirmLabel: "仍然保存", danger: true });
        if (!approved) return;
        candidate = { ...editing, allowInsecureHttp: true };
      }
    } catch { /* 主进程会返回精确的 URL 校验错误。 */ }
    setBusy(true); setResult("");
    try { setProviders(await window.grokDesktop.upsertProvider(candidate)); setEditing(null); }
    catch (error) { setError(message(error)); }
    finally { setBusy(false); }
  };
  return <section className="providers-panel">
    <header><div><h3>自定义提供商</h3><small>模型配置与官方 Grok CLI 共享；密钥只写入 Windows 当前用户环境变量。</small></div><button onClick={() => begin()}>添加提供商</button></header>
    <p className="provider-security-note">同一 Windows 用户下运行的其他进程也可能读取用户环境变量。密钥不会写入 config.toml、日志或界面回读。</p>
    <div className="provider-presets"><button onClick={() => begin("openai")}>OpenAI 兼容</button><button onClick={() => begin("responses")}>Responses</button><button onClick={() => begin("anthropic")}>Anthropic</button><button onClick={() => begin("local")}>本地服务</button></div>
    {editing && <ProviderEditor value={editing} disabled={busy} onChange={setEditing} onCancel={() => setEditing(null)} onSave={() => void save()} />}
    <div className="provider-list">{managed.map((provider) => <ProviderRow key={provider.id} provider={provider} busy={busy} onEdit={() => setEditing(toInput(provider))} onTest={async () => { setBusy(true); try { const value = await window.grokDesktop.testProvider(provider.id); setResult(`${provider.name}：${value.message}（${value.latencyMs} ms）`); } catch (error) { setError(message(error)); } finally { setBusy(false); } }} onPull={async () => { setBusy(true); try { const values = await window.grokDesktop.pullProviderModels(provider.id); setResult(values.length ? `${provider.name} 可用模型：${values.map((value) => value.name ? `${value.name} (${value.id})` : value.id).join("、")}` : `${provider.name} 未返回模型`); } catch (error) { setError(message(error)); } finally { setBusy(false); } }} onDesktopDefault={async (modelId) => { const settings = await window.grokDesktop.setProviderDesktopDefault(modelId); onDesktopDefault(settings.defaultModel); }} onCliDefault={async (modelId) => { setBusy(true); try { setProviders(await window.grokDesktop.setProviderCliDefault(modelId)); setResult(`官方 CLI 默认模型已设为 ${modelId}`); } catch (error) { setError(message(error)); } finally { setBusy(false); } }} onRemove={async () => { if (!await confirmAction(`移除提供商“${provider.name}”及其应用管理的模型配置？`, { title: "移除提供商", confirmLabel: "移除", danger: true })) return; setBusy(true); try { setProviders(await window.grokDesktop.removeProvider(provider.id)); } catch (error) { setError(message(error)); } finally { setBusy(false); } }} />)}{!managed.length && !editing && <p className="empty-copy">尚未添加自定义提供商。</p>}</div>
    {!!external.length && <details className="external-providers"><summary>外部 config.toml 模型（{external.length}，只读）</summary>{external.map((provider) => <div key={provider.id}><strong>{provider.name}</strong><span>{provider.models.map((model) => model.id).join("、")}</span></div>)}</details>}
    {result && <p className="provider-result">{result}</p>}
  </section>;
}

function ProviderEditor({ value, disabled, onChange, onCancel, onSave }: { value: CustomProviderInput; disabled: boolean; onChange(value: CustomProviderInput): void; onCancel(): void; onSave(): void }): React.JSX.Element {
  const headers = useMemo(() => Object.entries(value.extraHeaders).map(([key, env]) => `${key}=${env}`).join("\n"), [value.extraHeaders]);
  const changeModel = (index: number, patch: Partial<ProviderModelDefinition>): void => onChange({ ...value, models: value.models.map((model, position) => position === index ? { ...model, ...patch } : model) });
  return <div className="provider-editor">
    <div className="provider-grid"><label>配置 ID<input value={value.id} disabled={disabled || value.id.startsWith("external-")} onChange={(event) => onChange({ ...value, id: event.target.value })} /></label><label>显示名称<input value={value.name} disabled={disabled} onChange={(event) => onChange({ ...value, name: event.target.value })} /></label><label className="wide">基础地址<input value={value.baseUrl} disabled={disabled} onChange={(event) => onChange({ ...value, baseUrl: event.target.value })} /></label><label className="wide">模型列表地址（可选）<input value={value.modelListUrl || ""} placeholder="默认：基础地址/models" disabled={disabled} onChange={(event) => onChange({ ...value, modelListUrl: event.target.value || undefined })} /></label><label>协议<select value={value.protocol} disabled={disabled} onChange={(event) => onChange({ ...value, protocol: event.target.value as ProviderProtocol })}><option value="chat_completions">Chat Completions</option><option value="responses">Responses</option><option value="messages">Anthropic Messages</option></select></label><label>认证<select value={value.authScheme} disabled={disabled} onChange={(event) => onChange({ ...value, authScheme: event.target.value as ProviderAuthScheme })}><option value="bearer">Bearer</option><option value="x_api_key">x-api-key</option></select></label><label>凭据来源<select value={value.credentialMode} disabled={disabled} onChange={(event) => onChange({ ...value, credentialMode: event.target.value as CustomProviderInput["credentialMode"] })}><option value="managed">写入用户环境变量</option><option value="existing">引用已有环境变量</option><option value="none">无需认证</option></select></label>{value.credentialMode === "managed" && <label>密钥<input type="password" value={value.credentialValue || ""} placeholder="留空表示保留已有密钥" disabled={disabled} onChange={(event) => onChange({ ...value, credentialValue: event.target.value })} /></label>}{value.credentialMode === "existing" && <label>环境变量名<input value={value.credentialEnv || ""} disabled={disabled} onChange={(event) => onChange({ ...value, credentialEnv: event.target.value })} /></label>}<label className="wide">额外请求头环境变量<textarea value={headers} placeholder={'anthropic-version=ANTHROPIC_VERSION\nX-Organization=MY_ORG_HEADER'} disabled={disabled} onChange={(event) => onChange({ ...value, extraHeaders: parseHeaders(event.target.value) })} /></label></div>
    <h4>模型</h4>{value.models.map((model, index) => <div className="provider-model" key={index}><input aria-label="配置模型 ID" value={model.id} placeholder="配置 ID" onChange={(event) => changeModel(index, { id: event.target.value })} /><input aria-label="路由模型 ID" value={model.model} placeholder="发送给 API 的模型 ID" onChange={(event) => changeModel(index, { model: event.target.value })} /><input aria-label="模型名称" value={model.name} placeholder="显示名称" onChange={(event) => changeModel(index, { name: event.target.value })} /><input aria-label="上下文窗口" title="上下文窗口" type="number" min="1024" value={model.contextWindow} onChange={(event) => changeModel(index, { contextWindow: Number(event.target.value) })} /><input aria-label="最大输出" title="最大输出 Token（可选）" type="number" min="1" value={model.maxCompletionTokens ?? ""} placeholder="最大输出" onChange={(event) => changeModel(index, { maxCompletionTokens: event.target.value ? Number(event.target.value) : undefined })} /><input aria-label="推理强度" title="支持的推理强度，逗号分隔" value={model.reasoningEfforts?.join(",") || ""} placeholder="low,medium,high" onChange={(event) => changeModel(index, { reasoningEfforts: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) as ProviderModelDefinition["reasoningEfforts"] })} /><button disabled={value.models.length === 1} onClick={() => onChange({ ...value, models: value.models.filter((_item, position) => position !== index) })}>删除</button></div>)}
    <div className="button-row"><button onClick={() => onChange({ ...value, models: [...value.models, { ...EMPTY_MODEL }] })}>添加模型</button><label className="check inline"><input type="checkbox" checked={value.allowInsecureHttp || false} onChange={(event) => onChange({ ...value, allowInsecureHttp: event.target.checked })} />允许非本机 HTTP</label><span className="spacer"/><button onClick={onCancel}>取消</button><button className="primary" disabled={disabled} onClick={onSave}>保存并验证</button></div>
  </div>;
}

function ProviderRow({ provider, busy, onEdit, onTest, onPull, onDesktopDefault, onCliDefault, onRemove }: { provider: CustomProviderProfile; busy: boolean; onEdit(): void; onTest(): void; onPull(): void; onDesktopDefault(modelId: string): void; onCliDefault(modelId: string): void; onRemove(): void }): React.JSX.Element {
  return <article className="provider-row"><div><strong>{provider.name}</strong><span>{provider.protocol} · {provider.baseUrl}</span><small>{provider.hasCredential ? "凭据已配置" : provider.credentialMode === "none" ? "无需凭据" : "缺少凭据"}{provider.insecureHttp ? " · 非加密 HTTP" : ""}</small></div><div className="provider-actions"><button disabled={busy} onClick={onTest}>测试</button><button disabled={busy} onClick={onPull}>拉取模型</button><button disabled={busy} onClick={onEdit}>编辑</button><button disabled={busy} onClick={onRemove}>移除</button></div><div className="provider-model-list">{provider.models.map((model) => <div key={model.id}><span>{model.name}<small>{model.id} · {Math.round(model.contextWindow / 1000)}K{model.maxCompletionTokens ? ` · 输出 ${model.maxCompletionTokens}` : ""}</small></span><button onClick={() => onDesktopDefault(model.id)}>桌面默认</button><button onClick={() => onCliDefault(model.id)}>CLI 默认</button></div>)}</div></article>;
}

function toInput(value: CustomProviderProfile): CustomProviderInput { const { owned: _owned, hasCredential: _has, insecureHttp, createdAt: _created, updatedAt: _updated, diagnostic: _diagnostic, ...input } = value; return { ...input, allowInsecureHttp: insecureHttp }; }
function parseHeaders(value: string): Record<string, string> { return Object.fromEntries(value.split(/\r?\n/).map((line) => line.split("=")).filter((parts) => parts.length >= 2 && parts[0]?.trim() && parts.slice(1).join("=").trim()).map((parts) => [parts[0]!.trim(), parts.slice(1).join("=").trim()])); }
function message(value: unknown): string { return value instanceof Error ? value.message : String(value); }
