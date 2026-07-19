import { useEffect, useState } from "react";
import type { CodexPluginCompatibility, ComputerCapability, ComputerUseSettings, HookSummary, MarketplaceSource, McpDiagnostic, McpServerSummary, PluginDetails, PluginSummary, SkillSummary } from "../../../shared/types";

type Tab = "plugins" | "marketplace" | "skills" | "mcp" | "hooks" | "computer" | "codex";

export function ExtensionsPanel({ onClose, onUseSkill, confirmAction, setError }: {
  onClose(): void;
  onUseSkill(command: string): void;
  confirmAction(message: string, options?: { title?: string; confirmLabel?: string; danger?: boolean }): Promise<boolean>;
  setError(message: string): void;
}): React.JSX.Element {
  const [tab, setTab] = useState<Tab>("plugins");
  const [busy, setBusy] = useState(false);
  return <div className="modal-backdrop" role="presentation" onMouseDown={() => !busy && onClose()}>
    <section className="control-panel extensions-panel" role="dialog" aria-modal="true" aria-labelledby="extensions-title" onMouseDown={(event) => event.stopPropagation()}>
      <header><div><h2 id="extensions-title">Grok 扩展中心</h2><small>插件、Skills、MCP 与实验性 Computer Use</small></div><button disabled={busy} onClick={onClose}>×</button></header>
      <div className="extensions-layout">
        <nav>{([['plugins','插件'],['marketplace','市场'],['skills','Skills'],['mcp','MCP'],['hooks','Hooks'],['computer','Computer Use'],['codex','Codex 兼容']] as Array<[Tab,string]>).map(([id, label]) => <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>{label}</button>)}</nav>
        <div className="extensions-content">
          {tab === "plugins" && <PluginsTab busy={busy} setBusy={setBusy} confirmAction={confirmAction} setError={setError} />}
          {tab === "marketplace" && <MarketplaceTab busy={busy} setBusy={setBusy} confirmAction={confirmAction} setError={setError} />}
          {tab === "skills" && <SkillsTab onUse={(command) => { onUseSkill(command); onClose(); }} setError={setError} />}
          {tab === "mcp" && <McpTab busy={busy} setBusy={setBusy} confirmAction={confirmAction} setError={setError} />}
          {tab === "hooks" && <HooksTab busy={busy} setBusy={setBusy} setError={setError} />}
          {tab === "computer" && <ComputerTab setError={setError} />}
          {tab === "codex" && <CodexTab busy={busy} setBusy={setBusy} confirmAction={confirmAction} setError={setError} />}
        </div>
      </div>
    </section>
  </div>;
}

function PluginsTab({ busy, setBusy, confirmAction, setError }: CommonProps): React.JSX.Element {
  const [rows, setRows] = useState<PluginSummary[]>([]); const [loading, setLoading] = useState(true); const [source, setSource] = useState("");
  const [details, setDetails] = useState<PluginDetails | null>(null);
  const load = (force = false): void => { setLoading(true); void window.grokDesktop.listPlugins(force).then(setRows).catch((error) => setError(message(error))).finally(() => setLoading(false)); };
  useEffect(() => load(), []);
  const action = async (plugin: PluginSummary, value: "enable" | "disable" | "update" | "uninstall" | "reload"): Promise<void> => {
    if (value === "uninstall" && !await confirmAction(`卸载插件“${plugin.name}”？`, { title: "卸载插件", confirmLabel: "卸载", danger: true })) return;
    setBusy(true); try { setRows(await window.grokDesktop.pluginAction(plugin.id, value)); } catch (error) { setError(message(error)); } finally { setBusy(false); }
  };
  const install = async (): Promise<void> => {
    if (!source.trim()) return;
    setBusy(true);
    try {
      const preview = await window.grokDesktop.previewPlugin(source.trim());
      const summary = [
        `插件：${preview.name}${preview.version ? ` ${preview.version}` : ""}`,
        `来源：${preview.kind === "git" ? `${preview.source}\n固定提交：${preview.commit}` : preview.source}`,
        `组件：${preview.skills.length} Skills · ${preview.commands.length} Commands · ${preview.hooks.length} Hooks · ${preview.mcpServers.length} MCP`,
        `可执行/脚本文件：${preview.executableFiles.length ? preview.executableFiles.slice(0, 8).join("、") : "无"}`,
        `许可证：${preview.license || "未声明"}`,
        "\n以上内容仅做了静态读取，尚未执行插件代码。确认信任并安装？",
      ].join("\n");
      setBusy(false);
      if (!await confirmAction(summary, { title: "检查插件并授予信任", confirmLabel: "信任并安装" })) return;
      setBusy(true);
      setRows(await window.grokDesktop.installPlugin(preview.installSource, true, preview.fingerprint)); setSource("");
    } catch (error) { setError(message(error)); } finally { setBusy(false); }
  };
  return <TabShell title="已安装插件" action={<button onClick={() => load(true)}>刷新</button>}>
    <div className="extension-install"><input value={source} onChange={(event) => setSource(event.target.value)} placeholder="Git URL、user/repo 或本地目录" /><button className="primary" disabled={busy || !source.trim()} onClick={() => void install()}>检查并安装</button></div>
    {loading ? <Loading /> : !rows.length ? <Empty text="尚未安装额外插件。可从市场安装官方插件。" /> : <div className="extension-list">{rows.map((row) => <article key={row.id}><div><strong>{row.name}</strong><small>{row.version || "未标版本"} · {row.source || row.scope || "本地"}</small><p>{row.description || `${row.skills.length} Skills · ${row.mcpServerCount} MCP · ${row.hookCount} Hooks`}</p>{details?.id === row.id && <div className="plugin-details"><small>Skills：{details.skills.join("、") || "无"}</small><small>Commands：{details.commands.join("、") || "无"}</small><small>Agents：{details.agents.join("、") || "无"}</small><small>Hooks：{details.hooks.length} · MCP：{details.mcpServers.length}</small><small>许可证：{details.license?.slice(0, 240) || "未声明"}</small></div>}</div><span className={`extension-status ${row.enabled ? "enabled" : "disabled"}`}>{row.enabled ? "已启用" : "已禁用"}</span><div className="extension-actions"><button disabled={busy} onClick={() => { if (details?.id === row.id) setDetails(null); else void window.grokDesktop.getPluginDetails(row.id).then(setDetails).catch((error) => setError(message(error))); }}>{details?.id === row.id ? "收起" : "详情"}</button><button disabled={busy} onClick={() => void action(row, row.enabled ? "disable" : "enable")}>{row.enabled ? "禁用" : "启用"}</button><button disabled={busy} onClick={() => void action(row, "update")}>更新</button><button disabled={busy} onClick={() => void action(row, "reload")}>重载</button><button className="danger-link" disabled={busy} onClick={() => void action(row, "uninstall")}>卸载</button></div></article>)}</div>}
  </TabShell>;
}

function MarketplaceTab({ busy, setBusy, confirmAction, setError }: CommonProps): React.JSX.Element {
  const [sources, setSources] = useState<MarketplaceSource[]>([]); const [loading, setLoading] = useState(true);
  const load = (force = false): void => { setLoading(true); void window.grokDesktop.listMarketplace(force).then(setSources).catch((error) => setError(message(error))).finally(() => setLoading(false)); };
  useEffect(() => load(), []);
  const install = async (source: MarketplaceSource, name: string, official: boolean): Promise<void> => {
    const provenance = official ? `xAI 官方市场${source.commit ? ` @ ${source.commit.slice(0, 12)}` : ""}` : `${source.name}（${source.urlOrPath || "自定义来源"}${source.commit ? ` @ ${source.commit.slice(0, 12)}` : ""}）`;
    if (!await confirmAction(`安装“${name}”并信任其 Skills、Hooks 与 MCP？\n来源：${provenance}`, { title: "安装市场插件", confirmLabel: "信任并安装" })) return;
    setBusy(true); try { await window.grokDesktop.installMarketplacePlugin(source.urlOrPath || source.name, name, true); load(true); } catch (error) { setError(message(error)); } finally { setBusy(false); }
  };
  return <TabShell title="扩展市场" action={<button onClick={() => load(true)}>刷新目录</button>}>{loading ? <Loading /> : <div className="market-sources">{sources.map((source) => <section key={source.name}><header><div><strong>{source.name}</strong><small>{source.kind}{source.urlOrPath ? ` · ${source.urlOrPath}` : ""}{source.commit ? ` · ${source.commit.slice(0, 12)}` : ""}</small></div>{source.error && <span className="error-text">{source.error}</span>}</header><div className="extension-list">{source.plugins.map((plugin) => <article key={plugin.id}><div><strong>{plugin.name}</strong>{plugin.official && <span className="official-badge">官方</span>}<p>{plugin.description}</p><small>{plugin.components ? `${plugin.components.skills.length} Skills · ${plugin.components.mcpServers} MCP · ${plugin.components.hooks} Hooks` : "组件信息未公布"}</small></div><button className="primary" disabled={busy || plugin.installed} onClick={() => void install(source, plugin.name, plugin.official)}>{plugin.installed ? "已安装" : "安装"}</button></article>)}</div></section>)}</div>}</TabShell>;
}

function SkillsTab({ onUse, setError }: { onUse(command: string): void; setError(message: string): void }): React.JSX.Element {
  const [rows, setRows] = useState<SkillSummary[]>([]); useEffect(() => { void window.grokDesktop.listSkills().then(setRows).catch((error) => setError(message(error))); }, []);
  return <TabShell title="可用 Skills">{!rows.length ? <Empty text="当前已安装插件没有公布 Skill。" /> : <div className="extension-list">{rows.map((row) => <article key={`${row.source}:${row.name}`}><div><strong>{row.name}</strong><small>{row.source}</small><p>{row.description}</p></div><button onClick={() => onUse(`${row.command} `)}>在聊天中使用</button></article>)}</div>}</TabShell>;
}

function McpTab({ busy, setBusy, confirmAction, setError }: CommonProps): React.JSX.Element {
  const [rows, setRows] = useState<McpServerSummary[]>([]); const [diagnostics, setDiagnostics] = useState<McpDiagnostic[]>([]);
  const [auth, setAuth] = useState<{ url?: string; code?: string; message?: string } | null>(null);
  const [showAdd, setShowAdd] = useState(false); const [name, setName] = useState(""); const [transport, setTransport] = useState<"stdio" | "http" | "sse">("stdio"); const [target, setTarget] = useState(""); const [args, setArgs] = useState(""); const [secretName, setSecretName] = useState(""); const [secretValue, setSecretValue] = useState("");
  const load = (force = false): void => { void window.grokDesktop.listMcpServers(force).then(setRows).catch((error) => setError(message(error))); };
  useEffect(() => load(), []);
  return <TabShell title="MCP 服务" action={<><button onClick={() => setShowAdd(!showAdd)}>添加</button><button onClick={() => load(true)}>刷新</button><button onClick={async () => { setBusy(true); try { setDiagnostics(await window.grokDesktop.diagnoseMcp()); } finally { setBusy(false); } }}>全部诊断</button></>}>
    {showAdd && <div className="mcp-add-form"><label>名称<input value={name} onChange={(event) => setName(event.target.value)} placeholder="my-server" /></label><label>传输<select value={transport} onChange={(event) => setTransport(event.target.value as typeof transport)}><option value="stdio">stdio</option><option value="http">HTTP</option><option value="sse">SSE</option></select></label><label className="wide">{transport === "stdio" ? "命令" : "URL"}<input value={target} onChange={(event) => setTarget(event.target.value)} placeholder={transport === "stdio" ? "npx" : "https://example.com/mcp"} /></label>{transport === "stdio" && <label className="wide">参数<input value={args} onChange={(event) => setArgs(event.target.value)} placeholder="-y @example/mcp（以空格分隔）" /></label>}<label>密钥变量名<input value={secretName} onChange={(event) => setSecretName(event.target.value)} placeholder="API_KEY" /></label><label>密钥值<input type="password" value={secretValue} onChange={(event) => setSecretValue(event.target.value)} placeholder="由 Windows DPAPI 加密" /></label><div className="wide button-row"><button onClick={() => setShowAdd(false)}>取消</button><button className="primary" disabled={busy || !name.trim() || !target.trim()} onClick={async () => { setBusy(true); try { setRows(await window.grokDesktop.upsertMcp({ name, transport, commandOrUrl: target, args: args.split(/\s+/).filter(Boolean), env: {}, secretEnv: secretName && secretValue ? { [secretName]: secretValue } : {}, headers: {} })); setName(""); setTarget(""); setArgs(""); setSecretName(""); setSecretValue(""); setShowAdd(false); } catch (error) { setError(message(error)); } finally { setBusy(false); } }}>加密保存并添加</button></div></div>}
    {!rows.length ? <Empty text="没有配置 MCP。插件安装的 MCP 会在这里显示。" /> : <div className="extension-list">{rows.map((row) => <article key={row.name}><div><strong>{row.name}</strong><small>{row.source} · {row.status || "未连接"} · {row.toolCount} tools</small><p>{row.tools.slice(0, 8).map((tool) => tool.name).join("、")}</p></div><div className="extension-actions"><button disabled={busy} onClick={async () => { setBusy(true); try { setRows(await window.grokDesktop.toggleMcp(row.name, !row.enabled)); } catch (error) { setError(message(error)); } finally { setBusy(false); } }}>{row.enabled ? "禁用" : "启用"}</button>{row.oauth && <button onClick={async () => { try { const result = await window.grokDesktop.triggerMcpAuth(row.name); setAuth(result); if (result.url) await window.grokDesktop.openExternal(result.url); } catch (error) { setError(message(error)); } }}>OAuth</button>}<button onClick={async () => setDiagnostics(await window.grokDesktop.diagnoseMcp(row.name))}>诊断</button>{row.source === "local" && <button className="danger-link" onClick={async () => { if (await confirmAction(`删除本地 MCP“${row.name}”？`, { title: "删除 MCP", confirmLabel: "删除", danger: true })) setRows(await window.grokDesktop.removeMcp(row.name)); }}>删除</button>}</div></article>)}</div>}
    {auth && <div className="capability-card"><strong>MCP OAuth</strong>{auth.url && <p>{auth.url}</p>}{auth.code && <p>验证码：<code>{auth.code}</code></p>}{auth.message && <p>{auth.message}</p>}<div className="button-row">{auth.url && <button onClick={() => void window.grokDesktop.openExternal(auth.url!)}>重新打开浏览器</button>}<button onClick={() => void navigator.clipboard.writeText([auth.url, auth.code].filter(Boolean).join("\n"))}>复制链接和验证码</button><button onClick={() => setAuth(null)}>关闭</button></div></div>}
    {diagnostics.length > 0 && <div className="diagnostic-list">{diagnostics.map((item, index) => <p key={`${item.name}:${index}`} className={item.ok ? "ok" : "error-text"}><strong>{item.name}</strong> {item.message}</p>)}</div>}
  </TabShell>;
}

function HooksTab({ busy, setBusy, setError }: { busy: boolean; setBusy(value: boolean): void; setError(message: string): void }): React.JSX.Element {
  const [rows, setRows] = useState<HookSummary[]>([]);
  const load = (): void => { void window.grokDesktop.listHooks().then(setRows).catch((error) => setError(message(error))); };
  useEffect(load, []);
  const toggle = async (row: HookSummary): Promise<void> => { setBusy(true); try { await window.grokDesktop.pluginAction(row.pluginId || row.source || "", row.enabled ? "disable" : "enable"); setRows(await window.grokDesktop.listHooks()); } catch (error) { setError(message(error)); } finally { setBusy(false); } };
  const reload = async (): Promise<void> => { setBusy(true); try { await window.grokDesktop.reloadExtensions(); setRows(await window.grokDesktop.listHooks()); } catch (error) { setError(message(error)); } finally { setBusy(false); } };
  return <TabShell title="Hooks" action={<button disabled={busy} onClick={() => void reload()}>重新加载</button>}><p className="tab-note">Hooks 随所属插件启停；应用不会单独执行未经信任的 Hook。</p>{!rows.length ? <Empty text="当前插件没有公布 Hook。" /> : <div className="extension-list">{rows.map((row) => <article key={row.id}><div><strong>{row.name}</strong><small>{row.source} · {row.event || "事件由插件定义"}</small></div><span className={`extension-status ${row.enabled ? "enabled" : "disabled"}`}>{row.enabled ? "已启用" : "已禁用"}</span><button disabled={busy} onClick={() => void toggle(row)}>{row.enabled ? "禁用所属插件" : "启用所属插件"}</button></article>)}</div>}</TabShell>;
}

function ComputerTab({ setError }: { setError(message: string): void }): React.JSX.Element {
  const [capability, setCapability] = useState<ComputerCapability | null>(null); const [settings, setSettings] = useState<ComputerUseSettings | null>(null);
  const load = (): void => { void Promise.all([window.grokDesktop.getComputerCapability(), window.grokDesktop.getComputerSettings()]).then(([c, s]) => { setCapability(c); setSettings(s); }).catch((error) => setError(message(error))); };
  useEffect(load, []);
  const patch = async (value: Partial<ComputerUseSettings>): Promise<void> => { try { setSettings(await window.grokDesktop.updateComputerSettings(value)); } catch (error) { setError(message(error)); } };
  return <TabShell title="Grok Computer Use（实验性）" action={<button onClick={load}>重新诊断</button>}>
    {!capability || !settings ? <Loading /> : <><div className={`capability-card ${capability.available ? "ok" : "failed"}`}><strong>{capability.available ? "Windows Harness 已就绪" : "Computer Use 暂不可用"}</strong><p>{capability.available ? `Helper ${capability.helperVersion} · loopback MCP · PNG 图片结果 · /computer Skill` : capability.diagnostics.join("；")}</p></div>
      {capability.accepted && <div className="tab-note"><strong>本机验收已通过：</strong>{capability.acceptanceSummary}</div>}
      <label className="computer-toggle"><input type="checkbox" checked={settings.enabled} disabled={!capability.available} onChange={(event) => void patch({ enabled: event.target.checked })} /><span><strong>允许 @Computer</strong><small>默认可用但保持休眠，仅在选择应用或明确调用 /computer 时启动。</small></span></label>
      <label className="computer-toggle"><input type="checkbox" checked={settings.confirmNewApps} onChange={(event) => void patch({ confirmNewApps: event.target.checked })} /><span><strong>控制新应用前询问</strong><small>默认关闭：普通应用直接进入 Computer Use；高影响动作仍单独确认。</small></span></label>
      <dl className="computer-facts"><dt>活动提示</dt><dd>蓝色屏幕边框、顶部动作说明、可见鼠标</dd><dt>紧急停止</dt><dd>Esc（活动期间）或 {settings.emergencyShortcut}</dd><dt>截图上限</dt><dd>{settings.maxScreenshotEdge}px</dd><dt>普通应用</dt><dd>{settings.confirmNewApps ? "首次控制时询问" : "默认允许"}</dd><dt>禁止控制</dt><dd>Grok Build Desktop、Codex/ChatGPT、终端、UAC、Windows 安全、高权限窗口</dd></dl>
    </>}
  </TabShell>;
}

function CodexTab({ busy, setBusy, confirmAction, setError }: CommonProps): React.JSX.Element {
  const [rows, setRows] = useState<CodexPluginCompatibility[]>([]); const [loading, setLoading] = useState(true);
  const load = (force = false): void => { setLoading(true); void window.grokDesktop.scanCodexPlugins(force).then(setRows).catch((error) => setError(message(error))).finally(() => setLoading(false)); };
  useEffect(() => load(), []);
  const adapt = async (row: CodexPluginCompatibility): Promise<void> => { setBusy(true); try { setRows(await window.grokDesktop.adaptCodexPlugin(row.id)); } catch (error) { setError(message(error)); } finally { setBusy(false); } };
  const remove = async (row: CodexPluginCompatibility): Promise<void> => { if (!await confirmAction(`删除“${row.name}”的 Grok 适配副本？原 Codex 插件不受影响。`, { title: "删除适配副本", confirmLabel: "删除", danger: true })) return; setBusy(true); try { setRows(await window.grokDesktop.removeCodexPluginAdapter(row.id)); } finally { setBusy(false); } };
  return <TabShell title="Codex 插件只读兼容" action={<button disabled={loading} onClick={() => load(true)}>重新扫描</button>}>
    <p className="tab-note">不会修改 `~/.codex/plugins`。适配副本只复制 Skill、资源和标准 MCP 配置。</p>
    {loading ? <Loading /> : !rows.length ? <Empty text="未发现可识别的 Codex 插件。" /> : <div className="extension-list">{rows.map((row) => <article key={row.id}><div><strong>{row.name}</strong><span className={`compat-badge ${row.level}`}>{row.level === "adaptable" ? "可适配" : row.level === "partial" ? "部分适配" : "不可适配"}</span>{row.adapterStale && <span className="compat-badge partial">源已更新</span>}<small>{row.sourcePath}</small><p>{row.reasons.join("；")}</p></div><div className="extension-actions">{row.adapterStale && <button className="primary" disabled={busy} onClick={() => void adapt(row)}>刷新适配副本</button>}{row.adapterPath ? <button className="danger-link" disabled={busy} onClick={() => void remove(row)}>删除适配副本</button> : row.level !== "incompatible" ? <button className="primary" disabled={busy} onClick={() => void adapt(row)}>创建 Grok 适配副本</button> : /computer/i.test(row.name) && <span>使用内置 Grok Computer Use</span>}</div></article>)}</div>}
  </TabShell>;
}

interface CommonProps { busy: boolean; setBusy(value: boolean): void; confirmAction(message: string, options?: { title?: string; confirmLabel?: string; danger?: boolean }): Promise<boolean>; setError(message: string): void }
function TabShell({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }): React.JSX.Element { return <section className="extension-tab"><header><h3>{title}</h3><div>{action}</div></header>{children}</section>; }
function Loading(): React.JSX.Element { return <div className="extension-loading"><span className="spinner" />正在加载…</div>; }
function Empty({ text }: { text: string }): React.JSX.Element { return <div className="extension-empty">{text}</div>; }
function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
