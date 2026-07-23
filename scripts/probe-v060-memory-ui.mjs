const endpoint = process.argv[2];
const workspace = process.argv[3];
if (!endpoint || !workspace) throw new Error("Usage: node scripts/probe-v060-memory-ui.mjs <cdp-endpoint> <workspace>");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(action, message, timeout = 30_000) { const end = Date.now() + timeout; let last; while (Date.now() < end) { try { const value = await action(); if (value) return value; } catch (error) { last = error; } await sleep(150); } throw new Error(`${message}${last ? `: ${last.message}` : ""}`); }
const target = await waitFor(async () => (await fetch(`${endpoint}/json/list`).then((value) => value.json())).find((value) => value.type === "page"), "Renderer target unavailable");
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let id = 0; const pending = new Map();
socket.onmessage = ({ data }) => { const message = JSON.parse(data); const entry = pending.get(message.id); if (!entry) return; pending.delete(message.id); message.error ? entry.reject(new Error(message.error.message)) : entry.resolve(message.result); };
const request = (method, params = {}) => new Promise((resolve, reject) => { const requestId = ++id; const timer = setTimeout(() => { pending.delete(requestId); reject(new Error(`${method} timed out`)); }, 15_000); pending.set(requestId, { resolve: (value) => { clearTimeout(timer); resolve(value); }, reject: (error) => { clearTimeout(timer); reject(error); } }); socket.send(JSON.stringify({ id: requestId, method, params })); });
const evaluate = async (expression) => { const result = await request("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.text); return result.result?.value; };
try {
  await request("Page.bringToFront");
  await waitFor(() => evaluate("Boolean(window.grokDesktop && document.querySelector('.app-shell'))"), "Application shell did not render");
  await evaluate(`(async () => {
    await window.grokDesktop.setWorkspace(${JSON.stringify(workspace)});
    const entries = await window.grokDesktop.listMemory(${JSON.stringify(workspace)});
    const current = entries.find((value) => value.id === 'workspace');
    await window.grokDesktop.saveMemory({ workspacePath: ${JSON.stringify(workspace)}, scope: 'workspace', content: '# UI Probe Memory\\n\\n## Notes\\n\\n- Renderer remains sandboxed.\\n', expectedHash: current.hash || '', expectedModifiedAt: current.modifiedAt || '' });
    await window.grokDesktop.updateMemorySettings(${JSON.stringify(workspace)}, { enabled: true, saveOnSessionEnd: true, autoDream: false });
    return true;
  })()`);
  await request("Page.reload", { ignoreCache: true });
  await waitFor(() => evaluate("Boolean(document.querySelector('.project-tools'))"), "Project tools did not render");
  await evaluate(`(() => { const button = Array.from(document.querySelectorAll('.project-tools nav button')).find((value) => value.textContent.includes('Memory')); button?.click(); return Boolean(button); })()`);
  await waitFor(() => evaluate("Boolean(document.querySelector('.memory-workbench') && document.querySelector('.memory-editor .monaco-editor'))"), "Memory workbench or Monaco did not mount", 45_000);
  const snapshot = await waitFor(() => evaluate(`(() => {
    const nav = document.querySelector('.memory-navigator')?.innerText || '';
    const status = document.querySelector('.memory-status')?.innerText || '';
    const toolbar = document.querySelector('.memory-toolbar')?.innerText || '';
    const editor = document.querySelector('.memory-editor .view-lines')?.innerText || '';
    return nav && status && toolbar ? { nav, status, toolbar, editor } : null;
  })()`), "Memory UI stayed empty");
  if (!snapshot.nav.includes("已启用") || !snapshot.nav.includes("全局") || !snapshot.nav.includes("当前仓库") || !snapshot.nav.includes("会话摘要") || !snapshot.nav.includes("会话结束保存") || !snapshot.nav.includes("自动 Dream")) throw new Error(`Memory navigation incomplete: ${snapshot.nav}`);
  if (!snapshot.status.includes("UI Probe Memory") || !snapshot.status.includes("索引")) throw new Error(`Memory status incomplete: ${snapshot.status}`);
  if (!snapshot.toolbar.includes("记住") || !snapshot.toolbar.includes("删除条目") || !snapshot.toolbar.includes("Flush") || !snapshot.toolbar.includes("Dream") || !snapshot.toolbar.includes("清空当前范围") || !snapshot.toolbar.includes("清空全部")) throw new Error(`Memory toolbar incomplete: ${snapshot.toolbar}`);
  const api = await evaluate(`window.grokDesktop.listMemory(${JSON.stringify(workspace)}).then((values) => values.find((value) => value.id === 'workspace')?.content)`);
  if (!api.includes("Renderer remains sandboxed")) throw new Error("Memory content was not persisted through typed IPC");
  console.log(JSON.stringify({ ok: true, navigation: snapshot.nav, status: snapshot.status, toolbar: snapshot.toolbar, editor: snapshot.editor }, null, 2));
} finally { socket.close(); }
