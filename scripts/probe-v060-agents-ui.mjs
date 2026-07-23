const endpoint = process.argv[2];
const workspace = process.argv[3];
if (!endpoint || !workspace) throw new Error("Usage: node scripts/probe-v060-agents-ui.mjs <cdp-endpoint> <workspace>");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(action, message, timeout = 30_000) { const end = Date.now() + timeout; let last; while (Date.now() < end) { try { const value = await action(); if (value) return value; } catch (error) { last = error; } await sleep(150); } throw new Error(`${message}${last ? `: ${last.message}` : ""}`); }
const target = await waitFor(async () => (await fetch(`${endpoint}/json/list`).then((value) => value.json())).find((value) => value.type === "page"), "Renderer target unavailable");
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let id = 0; const pending = new Map();
socket.onmessage = ({ data }) => { const message = JSON.parse(data); const entry = pending.get(message.id); if (!entry) return; pending.delete(message.id); message.error ? entry.reject(new Error(message.error.message)) : entry.resolve(message.result); };
const request = (method, params = {}) => new Promise((resolve, reject) => { const requestId = ++id; const timer = setTimeout(() => { pending.delete(requestId); reject(new Error(`${method} timed out`)); }, 20_000); pending.set(requestId, { resolve: (value) => { clearTimeout(timer); resolve(value); }, reject: (error) => { clearTimeout(timer); reject(error); } }); socket.send(JSON.stringify({ id: requestId, method, params })); });
const evaluate = async (expression) => { const result = await request("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.text); return result.result?.value; };
const runtimeGlobal = await request("Runtime.evaluate", { expression: "globalThis", returnByValue: false });
const callFunction = async (functionDeclaration, ...values) => {
  const result = await request("Runtime.callFunctionOn", { objectId: runtimeGlobal.result?.objectId, functionDeclaration, arguments: values.map((value) => ({ value })), awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result?.value;
};
const chooseWorkbench = (label) => callFunction("function (label) { const button = Array.from(document.querySelectorAll('.sidebar-primary-nav button, .project-tools nav button')).find((value) => value.textContent.includes(label)); button?.click(); return Boolean(button && !button.disabled); }", label);
try {
  await request("Page.bringToFront");
  await waitFor(() => evaluate("Boolean(window.grokDesktop && document.querySelector('.app-shell'))"), "Application shell did not render");
  const setup = await callFunction(`async function (cwd) {
    await window.grokDesktop.setWorkspace(cwd);
    const agent = await window.grokDesktop.saveAgentDefinition({ workspacePath: cwd, targetSource: 'user', name: 'ui-probe-agent', rawMarkdown: '---\\nname: ui-probe-agent\\ndescription: "UI probe Agent"\\nprompt_mode: extend\\nmodel: inherit\\nagents_md: true\\nfuture_field: keep-me\\n---\\n\\nRenderer sandbox probe.\\n' });
    const persona = await window.grokDesktop.savePersonaDefinition({ workspacePath: cwd, targetSource: 'user', name: 'ui-probe-persona', rawToml: '# keep\\ndescription = "UI probe Persona"\\ninstructions = "Review the UI."\\ndefault_isolation = "none"\\nfuture_key = "keep-me"\\n' });
    return { agent: agent.saved, persona: persona.saved, inspect: agent.validation.inspectPassed && persona.validation.inspectPassed };
  }`, workspace);
  if (!setup.agent || !setup.persona || !setup.inspect) throw new Error(`Typed definition setup failed: ${JSON.stringify(setup)}`);
  await request("Page.reload", { ignoreCache: true });
  await waitFor(() => evaluate("Boolean(document.querySelector('.sidebar-primary-nav') && document.querySelector('.project-tools'))"), "Workbench navigation did not render");
  await chooseWorkbench("Agent 与 Persona");
  await waitFor(() => evaluate("Boolean(document.querySelector('.definition-workbench') && document.querySelector('.definition-editor .monaco-editor'))"), "Agent/Persona workbench or Monaco did not mount", 45_000);
  const agentSnapshot = await waitFor(() => evaluate(`(() => { const nav = document.querySelector('.definition-navigator')?.innerText || ''; const toolbar = document.querySelector('.definition-toolbar')?.innerText || ''; const fields = document.querySelector('.definition-fields')?.innerText || ''; const raw = document.querySelector('.definition-editor .view-lines')?.innerText || ''; return nav.includes('ui-probe-agent') ? { nav, toolbar, fields, raw } : null; })()`), "Agent catalog stayed empty");
  if (!agentSnapshot.nav.includes("Agents") || !agentSnapshot.nav.includes("Personas") || !agentSnapshot.nav.includes("项目") || !agentSnapshot.nav.includes("当前生效")) throw new Error(`Agent navigation incomplete: ${agentSnapshot.nav}`);
  if (!agentSnapshot.toolbar.includes("保存并校验") || !agentSnapshot.toolbar.includes("复制到项目") || !agentSnapshot.toolbar.includes("复制到用户") || !agentSnapshot.toolbar.includes("重命名") || !agentSnapshot.toolbar.includes("停用") || !agentSnapshot.toolbar.includes("删除")) throw new Error(`Agent toolbar incomplete: ${agentSnapshot.toolbar}`);
  if (!agentSnapshot.fields.includes("提示模式") || !agentSnapshot.fields.includes("权限模式") || !agentSnapshot.fields.includes("Skills") || !agentSnapshot.fields.includes("AGENTS.md")) throw new Error(`Agent structured fields incomplete: ${agentSnapshot.fields}`);
  await evaluate(`(() => { const button = Array.from(document.querySelectorAll('.definition-tabs button')).find((value) => value.textContent.includes('Personas')); button?.click(); return Boolean(button); })()`);
  await waitFor(() => evaluate("(document.querySelector('.definition-navigator')?.innerText || '').includes('ui-probe-persona')"), "Persona catalog stayed empty");
  const personaSnapshot = await evaluate(`(() => ({ nav: document.querySelector('.definition-navigator')?.innerText || '', fields: document.querySelector('.definition-fields')?.innerText || '', raw: document.querySelector('.definition-editor .view-lines')?.innerText || '' }))()`);
  if (!personaSnapshot.fields.includes("指令文件") || !personaSnapshot.fields.includes("默认能力") || !personaSnapshot.fields.includes("默认隔离") || !personaSnapshot.fields.includes("Inputs") || !personaSnapshot.fields.includes("Outputs")) throw new Error(`Persona structured fields incomplete: ${personaSnapshot.fields}`);
  const api = await callFunction("async function (workspace) { const [agents, personas] = await Promise.all([window.grokDesktop.listAgentDefinitions(workspace), window.grokDesktop.listPersonaDefinitions(workspace)]); return { agent: agents.find((value) => value.name === 'ui-probe-agent'), persona: personas.find((value) => value.name === 'ui-probe-persona') }; }", workspace);
  if (!api.agent?.rawMarkdown?.includes("future_field: keep-me") || !api.persona?.rawToml?.includes('future_key = "keep-me"')) throw new Error("Unknown fields were not preserved through typed IPC");
  console.log(JSON.stringify({ ok: true, setup, agent: { toolbar: agentSnapshot.toolbar, fields: agentSnapshot.fields }, persona: { fields: personaSnapshot.fields }, typedIpc: { agentSource: api.agent.source, personaSource: api.persona.source } }, null, 2));
} finally { socket.close(); }
