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
const escape = () => evaluate(`(() => { const target = document.activeElement || window; target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true })); target.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true })); return true; })()`);

async function verifyOverlay(entrySelector, panelSelector) {
  stage(`open ${entrySelector}`);
  await waitFor(() => evaluate(`Boolean(document.querySelector(${JSON.stringify(entrySelector)}))`), `${entrySelector} entry did not render`);
  await evaluate(`document.querySelector(${JSON.stringify(entrySelector)})?.click(); true`);
  await waitFor(() => evaluate(`Boolean(document.querySelector('#overlay-root ${panelSelector}'))`), `${entrySelector} panel did not open`);
  const state = await waitFor(() => evaluate(`(() => {
    const root = document.querySelector('#overlay-root');
    const panel = root?.querySelector(${JSON.stringify(panelSelector)});
    const backdrop = root?.querySelector('.modal-backdrop');
    if (!panel || !backdrop || !document.activeElement?.closest?.('#overlay-root .control-panel')) return null;
    const rect = panel.getBoundingClientRect();
    return { parent: panel.closest('#overlay-root') === root, position: getComputedStyle(backdrop).position, left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: innerWidth, height: innerHeight };
  })()`), `${entrySelector} panel did not establish layout and focus`);
  if (!state.parent || state.position !== "fixed" || state.left < 0 || state.top < 0 || state.right > state.width || state.bottom > state.height) throw new Error(`${entrySelector} overlay is invalid: ${JSON.stringify(state)}`);
  await escape();
  await waitFor(() => evaluate("!document.querySelector('#overlay-root .control-panel')"), `${entrySelector} panel did not close with Escape`);
}

try {
  await request("Page.bringToFront");
  stage("verify packaged application shell");
  const shell = await waitFor(async () => {
    const state = await evaluate(`(() => ({ title: document.title, body: document.body.innerText.length, shell: Boolean(document.querySelector('.app-shell')), sidebar: Boolean(document.querySelector('.sidebar')), main: Boolean(document.querySelector('.main-pane')), composer: Boolean(document.querySelector('.composer, .workspace-empty, .onboarding-panel, .empty-state')) }))()`);
    return state.title === "Grok Build Desktop" && state.body >= 10 && state.shell && state.sidebar && state.main && state.composer ? state : null;
  }, "Application shell did not render");
  if (shell.title !== "Grok Build Desktop" || shell.body < 10 || !shell.shell || !shell.sidebar || !shell.main || !shell.composer) throw new Error(`Packaged shell is incomplete: ${JSON.stringify(shell)}`);
  await verifyOverlay(".task-entry", ".task-center");
  await verifyOverlay(".extensions-entry", ".extensions-panel");
  await verifyOverlay(".media-entry", ".media-studio");
  stage("complete");
  console.log(JSON.stringify({ ok: true, singleRenderer: true, shell: true, taskCenter: true, extensions: true, media: true, fixed: true, focused: true, escape: true }));
} finally {
  socket.close();
}
