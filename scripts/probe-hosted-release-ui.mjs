const endpoint = process.argv[2];
if (!endpoint) throw new Error("CDP endpoint is required");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const stage = (message) => console.log(`[probe-hosted-release] ${message}`);

async function waitFor(action, message, timeout = 20_000) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    try { const value = await action(); if (value) return value; } catch (error) { last = error; }
    await sleep(150);
  }
  throw new Error(`${message}${last ? `: ${last.message}` : ""}`);
}

const target = await waitFor(async () => (await fetch(`${endpoint}/json/list`).then((value) => value.json())).find((value) => value.type === "page"), "Renderer target unavailable");
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });

let requestId = 0;
const pending = new Map();
socket.onmessage = ({ data }) => {
  const message = JSON.parse(data);
  const entry = pending.get(message.id);
  if (!entry) return;
  pending.delete(message.id);
  message.error ? entry.reject(new Error(message.error.message)) : entry.resolve(message.result);
};
const request = (method, params = {}, timeout = 15_000) => new Promise((resolve, reject) => {
  const id = ++requestId;
  const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP request timed out: ${method}`)); }, timeout);
  pending.set(id, { resolve: (value) => { clearTimeout(timer); resolve(value); }, reject: (error) => { clearTimeout(timer); reject(error); } });
  socket.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => {
  const result = await request("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result?.value;
};
try {
  await request("Page.bringToFront");
  stage("verify packaged application shell");
  const shell = await waitFor(async () => {
    const state = await evaluate(`(() => ({ title: document.title, body: document.body.innerText.length, shell: Boolean(document.querySelector('.app-shell')), sidebar: Boolean(document.querySelector('.sidebar')), main: Boolean(document.querySelector('.main-pane')), composer: Boolean(document.querySelector('.composer, .workspace-empty, .onboarding-panel, .empty-state')) }))()`);
    return state.title === "Grok Build Desktop" && state.body >= 10 && state.shell && state.sidebar && state.main && state.composer ? state : null;
  }, "Application shell did not render");
  if (shell.title !== "Grok Build Desktop" || shell.body < 10 || !shell.shell || !shell.sidebar || !shell.main || !shell.composer) throw new Error(`Packaged shell is incomplete: ${JSON.stringify(shell)}`);
  stage("verify feature entry points and overlay host");
  const entries = await evaluate(`(() => ({
    overlayRoot: Boolean(document.querySelector('#overlay-root')),
    task: Boolean(document.querySelector('.task-entry')),
    extensions: Boolean(document.querySelector('.extensions-entry')),
    media: Boolean(document.querySelector('.media-entry'))
  }))()`);
  if (!entries.overlayRoot || !entries.task || !entries.extensions || !entries.media) throw new Error(`Packaged feature entries are incomplete: ${JSON.stringify(entries)}`);
  stage("complete");
  console.log(JSON.stringify({ ok: true, singleRenderer: true, shell: true, overlayRoot: true, taskEntry: true, extensionsEntry: true, mediaEntry: true }));
} finally {
  socket.close();
}
