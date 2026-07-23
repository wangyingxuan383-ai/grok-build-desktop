const endpoint = process.argv[2];
const workspace = process.argv[3];
if (!endpoint || !workspace) throw new Error("Usage: node scripts/probe-v060-profiles-dashboard-ui.mjs <cdp-endpoint> <workspace>");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(action, message, timeout = 30_000) { const end = Date.now() + timeout; let last; while (Date.now() < end) { try { const value = await action(); if (value) return value; } catch (error) { last = error; } await sleep(150); } throw new Error(`${message}${last ? `: ${last.message}` : ""}`); }
const target = await waitFor(async () => (await fetch(`${endpoint}/json/list`).then((value) => value.json())).find((value) => value.type === "page"), "Renderer target unavailable");
const socket = new WebSocket(target.webSocketDebuggerUrl); await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
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
  const setup = await callFunction("async function (cwd) { await window.grokDesktop.setWorkspace(cwd); const profiles = await window.grokDesktop.saveExecutionProfile({ workspacePath: cwd, scope: 'project', profile: { id: 'ui-profile', name: 'UI Worktree Profile', description: 'profile probe', effort: 'high', mode: 'auto', allowTools: ['read_file'], denyTools: ['web_fetch'], sandbox: 'workspace', webSearch: 'disabled', subagents: true, memory: true, worktree: true, worktreeRef: 'HEAD', additionalRules: 'Only probe UI.', allowedPersonaIds: ['reviewer'], subagentIsolation: 'worktree' } }); const validation = await window.grokDesktop.validateExecutionProfile(profiles.find((value) => value.id === 'ui-profile')); return { count: profiles.length, valid: validation.valid, maxTurns: validation.fieldSupport.maxTurns.state }; }", workspace);
  if (!setup.valid || setup.maxTurns !== "unsupported" || setup.count < 6) throw new Error(`Profile setup failed: ${JSON.stringify(setup)}`);
  await request("Page.reload", { ignoreCache: true });
  await waitFor(() => evaluate("Boolean(document.querySelector('.sidebar-primary-nav') && document.querySelector('.project-tools'))"), "Workbench navigation unavailable");
  await chooseWorkbench("Profiles");
  const profile = await waitFor(() => evaluate(`(() => { const root = document.querySelector('.profile-workbench'); if (!root || !(root.innerText || '').includes('UI Worktree Profile')) return null; return { text: root.innerText, fields: document.querySelector('.profile-form')?.innerText || '', compat: document.querySelector('.profile-compat')?.innerText || '' }; })()`), "Profile workbench stayed empty");
  if (!profile.text.includes("内置预设") || !profile.text.toLowerCase().includes("项目（appdata）") || !profile.fields.includes("子 Agent 默认隔离") || !profile.fields.includes("最大轮次") || !profile.compat.includes("不会静默忽略")) throw new Error(`Profile UI incomplete: ${JSON.stringify(profile)}`);
  await chooseWorkbench("Dashboard");
  const dashboard = await waitFor(() => evaluate(`(() => { const root = document.querySelector('.agent-dashboard-workbench'); return root ? root.innerText : ''; })()`), "Dashboard did not mount");
  if (!dashboard.includes("不会启动 Grok TUI Dashboard") || !dashboard.includes("状态") || !dashboard.includes("Agent") || !dashboard.includes("时间") || !dashboard.includes("清理 UI 记录")) throw new Error(`Dashboard UI incomplete: ${dashboard}`);
  await evaluate(`(() => { const button = document.querySelector('.new-task-button'); button?.click(); return Boolean(button); })()`);
  const launch = await waitFor(() => evaluate(`(() => { const dialog = document.querySelector('.session-launch-dialog'); const options = Array.from(dialog?.querySelectorAll('select option') || []).map((value) => value.textContent).join(' | '); return dialog && options ? (dialog.innerText + '\\n' + options) : ''; })()`), "New-session profile dialog did not open");
  if (!launch.includes("执行配置档") || !launch.includes("普通开发") || !launch.includes("Worktree 隔离开发")) throw new Error(`Launch profile selector incomplete: ${launch}`);
  await evaluate(`(() => { const close = document.querySelector('.session-launch-dialog > header button'); close?.click(); return Boolean(close); })()`);
  await evaluate(`(() => { const button = Array.from(document.querySelectorAll('.sidebar-primary-nav button')).find((value) => value.textContent.trim() === '任务'); button?.click(); return Boolean(button); })()`);
  const taskCenter = await waitFor(() => evaluate("document.querySelector('.task-center')?.innerText || ''"), "Task center did not open");
  if (!taskCenter.includes("健康检查") || !taskCenter.includes("自动修复安全项")) throw new Error(`Automation health UI incomplete: ${taskCenter}`);
  console.log(JSON.stringify({ ok: true, setup, profileFields: profile.fields, dashboard, launch, taskCenter: taskCenter.slice(0, 500) }, null, 2));
} finally { socket.close(); }
