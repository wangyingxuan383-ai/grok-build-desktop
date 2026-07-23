const endpoint = process.argv[2];
const workspace = process.argv[3];
if (!endpoint || !workspace) throw new Error("Usage: node scripts/probe-v060-worktree-ui.mjs <cdp-endpoint> <workspace>");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(action, message, timeout = 25_000) { const end = Date.now() + timeout; let last; while (Date.now() < end) { try { const value = await action(); if (value) return value; } catch (error) { last = error; } await sleep(150); } throw new Error(`${message}${last ? `: ${last.message}` : ""}`); }
const target = await waitFor(async () => (await fetch(`${endpoint}/json/list`).then((value) => value.json())).find((value) => value.type === "page"), "Renderer target unavailable");
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let id = 0; const pending = new Map();
socket.onmessage = ({ data }) => { const message = JSON.parse(data); const entry = pending.get(message.id); if (!entry) return; pending.delete(message.id); message.error ? entry.reject(new Error(message.error.message)) : entry.resolve(message.result); };
const request = (method, params = {}) => new Promise((resolve, reject) => { const requestId = ++id; const timer = setTimeout(() => { pending.delete(requestId); reject(new Error(`${method} timed out`)); }, 15_000); pending.set(requestId, { resolve: (value) => { clearTimeout(timer); resolve(value); }, reject: (error) => { clearTimeout(timer); reject(error); } }); socket.send(JSON.stringify({ id: requestId, method, params })); });
const evaluate = async (expression) => { const result = await request("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.text); return result.result?.value; };
const chooseWorkbench = async (label) => evaluate(`(() => { const button = Array.from(document.querySelectorAll('.sidebar-primary-nav button, .project-tools nav button')).find((value) => value.textContent.includes(${JSON.stringify(label)})); button?.click(); return Boolean(button && !button.disabled); })()`);
try {
  await request("Page.bringToFront");
  await waitFor(() => evaluate("Boolean(window.grokDesktop && document.querySelector('.app-shell'))"), "Application shell did not render");
  await evaluate(`window.grokDesktop.setWorkspace(${JSON.stringify(workspace)}).then(() => true)`);
  await request("Page.reload", { ignoreCache: true });
  await waitFor(() => evaluate("Boolean(document.querySelector('.sidebar-primary-nav'))"), "Workbench navigation did not render");
  await chooseWorkbench("Worktree");
  await waitFor(() => evaluate("Boolean(document.querySelector('.worktree-explorer') && document.querySelector('.worktree-workbench'))"), "Worktree workbench did not open");
  const list = await waitFor(() => evaluate(`(() => { const rows = Array.from(document.querySelectorAll('.worktree-list > button')).map((value) => value.innerText); return rows.length ? rows : null; })()`), "Worktree inventory stayed empty");
  if (!list.some((value) => value.includes("fixture-worktree") && value.includes("fixture-branch"))) throw new Error(`Fixture worktree missing: ${JSON.stringify(list)}`);
  const overview = await evaluate("document.querySelector('.worktree-overview')?.innerText || ''");
  if (!overview.includes("预览安全应用") || !overview.includes("未关联")) throw new Error(`Worktree overview incomplete: ${overview}`);
  await evaluate(`(() => { const button = Array.from(document.querySelectorAll('.worktree-overview button')).find((value) => value.textContent.includes('预览安全应用')); button?.click(); return Boolean(button); })()`);
  const preview = await waitFor(() => evaluate("document.querySelector('.worktree-preview')?.innerText || ''"), "Worktree apply preview did not render");
  if (!preview.includes("fixture feature") || !preview.includes("feature.txt") || !preview.includes("成功后清理 Worktree")) throw new Error(`Worktree preview incomplete: ${preview}`);
  const header = await evaluate("document.querySelector('.worktree-workbench > header')?.innerText || ''");
  if (!header.includes("受控 Git 兼容层") || !header.includes("打开文件") || !header.includes("打开 Git") || !header.includes("删除")) throw new Error(`Worktree actions missing: ${header}`);
  console.log(JSON.stringify({ ok: true, list, overview, preview, header }, null, 2));
} finally { socket.close(); }
