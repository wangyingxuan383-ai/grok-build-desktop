const endpoint = process.argv[2];
const entrySelector = process.argv[3];
if (!endpoint || !entrySelector) throw new Error("CDP endpoint and overlay entry selector are required");
const panelSelector = ({ ".task-entry": ".task-center", ".extensions-entry": ".extensions-panel", ".media-entry": ".media-studio" })[entrySelector] || ".control-panel";
const mappedEntries = {
  ".task-entry": {
    exists: `Boolean([...document.querySelectorAll('.sidebar-primary-nav button')].find(node => node.textContent?.trim() === '任务'))`,
    click: `(() => { [...document.querySelectorAll('.sidebar-primary-nav button')].find(node => node.textContent?.trim() === '任务')?.click(); return true; })()`,
  },
  ".extensions-entry": {
    exists: `Boolean([...document.querySelectorAll('.sidebar-primary-nav button')].find(node => node.textContent?.trim() === '扩展'))`,
    click: `(() => { [...document.querySelectorAll('.sidebar-primary-nav button')].find(node => node.textContent?.trim() === '扩展')?.click(); return true; })()`,
  },
  ".media-entry": {
    exists: `Boolean([...document.querySelectorAll('.topbar-more button')].find(node => node.textContent?.trim() === '创作'))`,
    click: `(() => { const menu = document.querySelector('.topbar-more'); if (menu) menu.open = true; [...(menu?.querySelectorAll('button') ?? [])].find(node => node.textContent?.trim() === '创作')?.click(); return true; })()`,
  },
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
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
  const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP request timed out for ${entrySelector}: ${method}`)); }, timeout);
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
  if (entrySelector === ".history-entry" && !await evaluate("Boolean(document.querySelector('.history-entry'))")) {
    await waitFor(() => evaluate("Boolean(document.querySelector('.session-row:not(.codex)'))"), "No Grok session is available for the history probe");
    await evaluate("document.querySelector('.session-row:not(.codex)')?.click(); true");
  }
  const mapped = mappedEntries[entrySelector];
  await waitFor(() => evaluate(mapped?.exists ?? `Boolean(document.querySelector(${JSON.stringify(entrySelector)}))`), `${entrySelector} entry did not render`);
  await evaluate(mapped?.click ?? `document.querySelector(${JSON.stringify(entrySelector)})?.click(); true`);
  await waitFor(() => evaluate(`Boolean(document.querySelector('#overlay-root ${panelSelector}'))`), `${entrySelector} panel did not open in overlay root`);
  await waitFor(() => evaluate("Boolean(document.activeElement?.closest?.('#overlay-root .control-panel'))"), `${entrySelector} panel did not establish focus`);
  const state = await evaluate(`(() => {
    const root = document.querySelector('#overlay-root');
    const panel = root?.querySelector('.control-panel');
    const backdrop = root?.querySelector('.modal-backdrop');
    if (!panel || !backdrop) return null;
    const rect = panel.getBoundingClientRect();
    return { parent: panel.closest('#overlay-root') === root, position: getComputedStyle(backdrop).position, focused: Boolean(document.activeElement?.closest?.('#overlay-root .control-panel')), left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: innerWidth, height: innerHeight };
  })()`);
  if (!state?.parent || state.position !== "fixed" || !state.focused || state.left < 0 || state.top < 0 || state.right > state.width || state.bottom > state.height) throw new Error(`${entrySelector} overlay is invalid: ${JSON.stringify(state)}`);
  await evaluate(`(() => { const target = document.activeElement || window; target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true })); target.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true })); return true; })()`);
  await waitFor(() => evaluate("!document.querySelector('#overlay-root .control-panel')"), `${entrySelector} panel did not close with Escape`);
  console.log(JSON.stringify({ ok: true, entrySelector, overlayRoot: true, fixed: true, focused: true, inViewport: true, escape: true }));
} finally {
  socket.close();
}
