const endpoint = process.argv[2];
if (!endpoint) throw new Error("Usage: node scripts/probe-v061-ui.mjs <cdp-endpoint>");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(action, message, timeout = 30_000) { const end = Date.now() + timeout; let last; while (Date.now() < end) { try { const value = await action(); if (value) return value; } catch (error) { last = error; } await sleep(150); } throw new Error(`${message}${last ? `: ${last.message}` : ""}`); }
const target = await waitFor(async () => (await fetch(`${endpoint}/json/list`).then((value) => value.json())).find((value) => value.type === "page"), "Renderer target unavailable");
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let id = 0; const pending = new Map();
socket.onmessage = ({ data }) => { const message = JSON.parse(data); const entry = pending.get(message.id); if (!entry) return; pending.delete(message.id); message.error ? entry.reject(new Error(message.error.message)) : entry.resolve(message.result); };
const request = (method, params = {}) => new Promise((resolve, reject) => { const requestId = ++id; const timer = setTimeout(() => { pending.delete(requestId); reject(new Error(`${method} timed out`)); }, 20_000); pending.set(requestId, { resolve: (value) => { clearTimeout(timer); resolve(value); }, reject: (error) => { clearTimeout(timer); reject(error); } }); socket.send(JSON.stringify({ id: requestId, method, params })); });
const evaluate = async (expression) => { const result = await request("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.text); return result.result?.value; };

try {
  await request("Page.bringToFront");
  await waitFor(() => evaluate("Boolean(window.grokDesktop && document.querySelector('.app-shell'))"), "Application shell did not render");
  await waitFor(() => evaluate("document.querySelectorAll('.chat-turn').length >= 3"), "Offline message fixture did not render");
  await evaluate(`(() => { const scroller = document.querySelector('.conversation'); scroller?.scrollTo({ top: scroller.scrollHeight }); return true; })()`);
  await waitFor(() => evaluate("Boolean(document.querySelector('.user-message-actions .retry-message'))"), "Failed-message restore action did not render");
  const shell = await evaluate(`({
    nav: Array.from(document.querySelectorAll('.sidebar-primary-nav button')).map((value) => value.textContent.trim()),
    projectTools: Array.from(document.querySelectorAll('.project-tools nav button')).map((value) => value.textContent.trim()),
    topButtons: Array.from(document.querySelectorAll('.top-actions button')).map((value) => value.title || value.textContent.trim()),
    images: document.querySelectorAll('.user-image-preview img').length,
    hasSummary: Boolean(document.querySelector('.summary-rail')),
    environment: document.querySelector('.environment-bar')?.innerText || '',
    composer: Boolean(document.querySelector('.composer')),
    copyButtons: document.querySelectorAll('.user-message-actions button[title="复制消息"]').length,
    failedRestore: Boolean(document.querySelector('.user-message-actions .retry-message')),
  })`);
  for (const label of ["对话", "文件", "源代码管理", "Worktree", "任务", "扩展"]) if (!shell.nav.includes(label)) throw new Error(`Missing direct navigation: ${label}`);
  for (const label of ["Memory", "Agent 与 Persona", "Profiles", "Dashboard"]) if (!shell.projectTools.includes(label)) throw new Error(`Missing project tool: ${label}`);
  if (!shell.hasSummary || shell.images < 1 || !shell.composer || !shell.failedRestore || shell.copyButtons < 1) throw new Error(`Fixture surface incomplete: ${JSON.stringify(shell)}`);
  if (!shell.environment.includes("变更") || !shell.environment.includes("Commit") || !shell.environment.includes("Push")) throw new Error(`Environment bar incomplete: ${shell.environment}`);

  await evaluate(`(() => { document.querySelector('.user-image-preview:not(.missing)')?.click(); return true; })()`);
  await waitFor(() => evaluate("Boolean(document.querySelector('.image-lightbox img'))"), "Image lightbox did not open");
  await evaluate("document.querySelector('.image-lightbox > button')?.click()");

  await evaluate(`(() => { const button = Array.from(document.querySelectorAll('.top-actions button')).find((value) => value.title.includes('底部面板')); button?.click(); return Boolean(button); })()`);
  await waitFor(() => evaluate("Boolean(document.querySelector('.bottom-panel'))"), "Bottom panel did not open");

  await evaluate(`(() => { const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlWQAAAAASUVORK5CYII='), value => value.charCodeAt(0)); const file = new File([bytes], 'clipboard.png', { type: 'image/png' }); const transfer = new DataTransfer(); transfer.items.add(file); document.querySelector('.composer textarea').dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true })); return true; })()`);
  await waitFor(() => evaluate("Boolean(document.querySelector('.composer-image-chip img'))"), "Pasted image preview did not appear");
  await evaluate("document.querySelector('.send-button')?.click()");
  try {
    await waitFor(() => evaluate(`Array.from(document.querySelectorAll('.delivery-state.failed')).length >= 2 && Array.from(document.querySelectorAll('.delivery-state.failed')).some((value) => value.closest('.user-bubble')?.querySelector('.user-image-preview img'))`), "Image-only failed message was not preserved after send", 20_000);
  } catch (error) {
    const diagnostics = await evaluate(`({ images: document.querySelectorAll('.user-image-preview img').length, failed: document.querySelectorAll('.delivery-state.failed').length, chips: document.querySelectorAll('.composer-image-chip').length, sendDisabled: document.querySelector('.send-button')?.disabled, toast: document.querySelector('.toast')?.innerText || '', turns: document.querySelectorAll('.chat-turn').length })`);
    throw new Error(`${error.message}: ${JSON.stringify(diagnostics)}`);
  }

  await request("Emulation.setDeviceMetricsOverride", { width: 1100, height: 720, deviceScaleFactor: 1, mobile: false });
  await evaluate("window.dispatchEvent(new Event('resize'))");
  await waitFor(() => evaluate("!document.querySelector('.summary-rail') || getComputedStyle(document.querySelector('.summary-rail')).display === 'none'"), "Narrow layout did not collapse summary");
  await request("Emulation.setDeviceMetricsOverride", { width: 1440, height: 810, deviceScaleFactor: 1, mobile: false });
  await request("Page.reload", { ignoreCache: true });
  await waitFor(() => evaluate("document.querySelectorAll('.user-image-preview img').length >= 1"), "Attachment previews did not survive renderer reopen");
  console.log(JSON.stringify({ ok: true, shell: { directNavigation: shell.nav.length, projectTools: shell.projectTools.length, topControls: shell.topButtons.length, images: shell.images, hasSummary: shell.hasSummary, composer: shell.composer, copyButtons: shell.copyButtons, failedRestore: shell.failedRestore }, sentImageVisible: true, reopenedImageVisible: true, responsive: ["1100x720", "1440x810"] }, null, 2));
} finally { socket.close(); }
