const endpoint = process.argv[2];
const workspace = process.argv[3];
if (!endpoint || !workspace) throw new Error("Usage: node scripts/probe-v060-editor-ui.mjs <cdp-endpoint> <workspace>");

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
const chooseWorkbench = async (label) => {
  return evaluate(`(() => { const button = Array.from(document.querySelectorAll('.sidebar-primary-nav button, .project-tools nav button')).find((value) => value.textContent.includes(${JSON.stringify(label)})); button?.click(); return Boolean(button && !button.disabled); })()`);
};

try {
  await request("Page.bringToFront");
  await waitFor(() => evaluate("Boolean(window.grokDesktop && document.querySelector('.app-shell'))"), "Application shell did not render");
  await evaluate(`window.grokDesktop.setWorkspace(${JSON.stringify(workspace)}).then(() => true)`);
  await request("Page.reload", { ignoreCache: true });
  await waitFor(() => evaluate("Boolean(document.querySelector('.sidebar-primary-nav'))"), "Workbench navigation did not render");
  await chooseWorkbench("文件");
  await waitFor(() => evaluate("Boolean(document.querySelector('.file-explorer') && document.querySelector('.file-workbench'))"), "File workbench did not open");
  const treeText = await waitFor(() => evaluate("document.querySelector('.file-tree')?.innerText || ''"), "Workspace tree stayed empty");
  if (!treeText.includes("package.json")) throw new Error("Workspace tree did not include package.json");
  if (treeText.includes("node_modules") || treeText.includes(".git\n")) throw new Error("Workspace tree exposed default ignored directories");
  await evaluate(`(() => { const row = Array.from(document.querySelectorAll('.file-tree-row')).find((value) => value.textContent.includes('package.json')); row?.click(); return Boolean(row); })()`);
  await waitFor(() => evaluate("Boolean(document.querySelector('.editor-tabs button.active')?.textContent.includes('package.json'))"), "Editor tab did not open");
  await waitFor(() => evaluate("Boolean(document.querySelector('.monaco-editor'))"), "Bundled Monaco editor did not mount", 40_000);
  const metadata = await evaluate(`({ toolbar: document.querySelector('.editor-toolbar')?.innerText || '', tabs: document.querySelector('.editor-tabs')?.innerText || '', workerScripts: performance.getEntriesByType('resource').map((value) => value.name).filter((value) => value.includes('worker')) })`);
  if (!metadata.toolbar.includes("UTF8") || !metadata.toolbar.includes("添加文件到对话")) throw new Error(`Editor toolbar metadata missing: ${JSON.stringify(metadata)}`);
  await chooseWorkbench("对话");
  await waitFor(() => evaluate("Boolean(document.querySelector('.composer, .workspace-empty'))"), "Chat view did not restore");
  await chooseWorkbench("文件");
  await waitFor(() => evaluate("Boolean(document.querySelector('.editor-tabs button.active')?.textContent.includes('package.json'))"), "Editor tab was not preserved across view switches");
  console.log(JSON.stringify({ ok: true, tree: treeText.split("\n").filter(Boolean).slice(0, 12), metadata }, null, 2));
} finally {
  socket.close();
}
