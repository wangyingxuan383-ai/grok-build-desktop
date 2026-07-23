const endpoint = process.argv[2];
const workspace = process.argv[3];
if (!endpoint || !workspace) throw new Error("Usage: node scripts/probe-v060-git-ui.mjs <cdp-endpoint> <workspace>");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(action, message, timeout = 25_000) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    try { const value = await action(); if (value) return value; } catch (error) { last = error; }
    await sleep(150);
  }
  throw new Error(`${message}${last ? `: ${last.message}` : ""}`);
}

const target = await waitFor(async () => (await fetch(`${endpoint}/json/list`).then((value) => value.json())).find((value) => value.type === "page"), "Renderer target unavailable");
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let id = 0;
const pending = new Map();
socket.onmessage = ({ data }) => {
  const message = JSON.parse(data);
  const entry = pending.get(message.id);
  if (!entry) return;
  pending.delete(message.id);
  message.error ? entry.reject(new Error(message.error.message)) : entry.resolve(message.result);
};
const request = (method, params = {}) => new Promise((resolve, reject) => {
  const requestId = ++id;
  const timer = setTimeout(() => { pending.delete(requestId); reject(new Error(`${method} timed out`)); }, 15_000);
  pending.set(requestId, { resolve: (value) => { clearTimeout(timer); resolve(value); }, reject: (error) => { clearTimeout(timer); reject(error); } });
  socket.send(JSON.stringify({ id: requestId, method, params }));
});
const evaluate = async (expression) => {
  const result = await request("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result?.value;
};
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
  await callFunction("async function (workspace) { await window.grokDesktop.setWorkspace(workspace); return true; }", workspace);
  await request("Page.reload", { ignoreCache: true });
  await waitFor(() => evaluate("Boolean(document.querySelector('.sidebar-primary-nav'))"), "Workbench navigation did not render");
  await chooseWorkbench("源代码管理");
  await waitFor(() => evaluate("Boolean(document.querySelector('.git-explorer') && document.querySelector('.git-workbench'))"), "Git workbench did not open");
  const summary = await waitFor(() => evaluate(`(() => { const branch = document.querySelector('.git-branch-summary')?.innerText || ''; const rows = Array.from(document.querySelectorAll('.git-change-row')).map((value) => value.innerText); return branch && rows.length ? { branch, rows, toolbar: document.querySelector('.git-workbench-toolbar')?.innerText || '' } : null; })()`), "Git status stayed empty");
  if (!summary.branch.includes("codex/v0.6.0-workbench")) throw new Error(`Unexpected branch summary: ${summary.branch}`);
  if (!summary.toolbar.includes("Pull") || !summary.toolbar.includes("Push") || !summary.toolbar.includes("新建分支")) throw new Error(`Git toolbar actions missing: ${summary.toolbar}`);
  await evaluate(`(() => { const row = document.querySelector('.git-change-row'); row?.click(); return Boolean(row); })()`);
  await waitFor(() => evaluate("Boolean(document.querySelector('.git-diff-pane .monaco-diff-editor'))"), "Git Diff editor did not mount", 40_000);
  const diffTitle = await evaluate("document.querySelector('.git-diff-pane > header strong')?.innerText || ''");
  if (!diffTitle.includes("·")) throw new Error(`Git Diff selection missing: ${diffTitle}`);
  console.log(JSON.stringify({ ok: true, branch: summary.branch, changeCount: summary.rows.length, firstChanges: summary.rows.slice(0, 6), toolbar: summary.toolbar, diffTitle }, null, 2));
} finally {
  socket.close();
}
