const endpoint = process.argv[2];
if (!endpoint) throw new Error("Usage: node scripts/probe-v063-ui.mjs <cdp-endpoint>");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(action, message, timeout = 30_000) { const end = Date.now() + timeout; let last; while (Date.now() < end) { try { const value = await action(); if (value) return value; } catch (error) { last = error; } await sleep(120); } throw new Error(`${message}${last ? `: ${last.message}` : ""}`); }
const target = await waitFor(async () => (await fetch(`${endpoint}/json/list`).then((value) => value.json())).find((value) => value.type === "page"), "Renderer unavailable");
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let id = 0; const pending = new Map();
socket.onmessage = ({ data }) => { const message = JSON.parse(data); const entry = pending.get(message.id); if (!entry) return; pending.delete(message.id); message.error ? entry.reject(new Error(message.error.message)) : entry.resolve(message.result); };
const request = (method, params = {}) => new Promise((resolve, reject) => { const requestId = ++id; const timer = setTimeout(() => reject(new Error(`${method} timed out`)), 20_000); pending.set(requestId, { resolve: (value) => { clearTimeout(timer); resolve(value); }, reject }); socket.send(JSON.stringify({ id: requestId, method, params })); });
const evaluate = async (expression) => { const result = await request("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.text); return result.result?.value; };
try {
  await request("Page.bringToFront");
  await waitFor(() => evaluate("Boolean(document.querySelector('.app-shell'))"), "Application shell did not render");
  await sleep(800);
  const fixtureState = await evaluate(`(() => { const surface = document.querySelector('.conversation-surface')?.getBoundingClientRect(); const content = document.querySelector('.conversation-content')?.getBoundingClientRect(); const wrap = document.querySelector('.conversation-wrap')?.getBoundingClientRect(); return { turns: document.querySelectorAll('.chat-turn').length, composer: Boolean(document.querySelector('.composer')), surface, content, wrap, text: document.body.innerText.slice(0, 400) }; })()`);
  if (fixtureState.turns < 1 || !fixtureState.composer || !fixtureState.wrap || fixtureState.wrap.height < 80) throw new Error(`Offline conversation did not render: ${JSON.stringify(fixtureState)}`);
  const initial = await evaluate(`({ version: document.querySelector('.sidebar-footer button[title="版本与更新"] span')?.textContent?.trim(), environmentBars: document.querySelectorAll('.environment-bar').length, surface: Boolean(document.querySelector('.conversation-surface')) })`);
  if (initial.version !== "0.6.3" || initial.environmentBars !== 0 || !initial.surface) throw new Error(`0.6.3 shell mismatch: ${JSON.stringify(initial)}`);

  await evaluate("document.querySelector('.project-tools-heading')?.click()");
  await waitFor(() => evaluate("Boolean(document.querySelector('.project-tools nav'))"), "Developer tools did not open");
  await evaluate(`Array.from(document.querySelectorAll('.project-tools nav button')).find((node) => node.textContent.trim() === 'Dashboard')?.click()`);
  await waitFor(() => evaluate("Boolean(document.querySelector('.return-to-chat'))"), "Workbench return action is missing");
  await evaluate("document.querySelector('.return-to-chat')?.click()");
  await waitFor(() => evaluate("Boolean(document.querySelector('.composer textarea'))"), "Conversation did not return from Dashboard");

  for (const [width, height, scale] of [[1280, 720, 1], [1440, 810, 1.25], [1920, 1080, 2]]) {
    await request("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: scale, mobile: false });
    await evaluate("window.dispatchEvent(new Event('resize'))"); await sleep(180);
    const bounds = await evaluate(`(() => { const box = document.querySelector('.composer')?.getBoundingClientRect(); const surface = document.querySelector('.conversation-surface')?.getBoundingClientRect(); const content = document.querySelector('.conversation-content')?.getBoundingClientRect(); const main = document.querySelector('.main-pane')?.getBoundingClientRect(); return box ? { top: box.top, bottom: box.bottom, height: box.height, viewport: innerHeight, surface, content, main } : null; })()`);
    if (!bounds || bounds.top < 0 || bounds.bottom > bounds.viewport + 1 || bounds.height < 50) throw new Error(`Composer escaped viewport at ${width}x${height}@${scale}: ${JSON.stringify(bounds)}`);
  }

  await request("Emulation.setDeviceMetricsOverride", { width: 1100, height: 720, deviceScaleFactor: 1, mobile: false });
  await evaluate("window.dispatchEvent(new Event('resize')); document.querySelector('.review-toggle')?.click()");
  await waitFor(() => evaluate("Boolean(document.querySelector('.review-pane'))"), "Narrow Review drawer is not visible");
  const review = await evaluate(`(() => { const box = document.querySelector('.review-pane').getBoundingClientRect(); return { display: getComputedStyle(document.querySelector('.review-pane')).display, left: box.left, right: box.right, viewport: innerWidth }; })()`);
  if (review.display === "none" || review.left < -1 || review.right > review.viewport + 1) throw new Error(`Narrow Review overflow: ${JSON.stringify(review)}`);
  console.log(JSON.stringify({ ok: true, version: initial.version, navigation: "dashboard→chat", environmentBarRemoved: true, responsiveComposer: true, narrowReviewVisible: true }, null, 2));
} finally { socket.close(); }
