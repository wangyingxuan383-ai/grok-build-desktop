const endpoint = process.argv[2];
if (!endpoint) throw new Error("Usage: node scripts/probe-v062-ui.mjs <cdp-endpoint>");
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
  await waitFor(() => evaluate("document.querySelectorAll('.chat-turn').length >= 3"), "0.6.2 offline conversation fixture did not render");
  await evaluate("document.querySelector('.conversation')?.scrollTo({ top: 0 })");
  await waitFor(() => evaluate(`Array.from(document.querySelectorAll('.execution-process summary strong')).some((node) => node.textContent?.includes('历史执行记录（30 段）'))`), "Legacy execution segments were not coalesced");
  const initial = await evaluate(`({
    appVersion: document.querySelector('.sidebar-footer button[title="版本与更新"] span')?.textContent?.trim(),
    projectToolsExpanded: Boolean(document.querySelector('.project-tools nav')),
    directNav: document.querySelectorAll('.sidebar-primary-nav').length,
    genericSummary: document.querySelectorAll('.summary-rail').length,
    review: document.querySelectorAll('.review-pane').length,
    historyBlocks: Array.from(document.querySelectorAll('.execution-process summary strong')).filter((node) => node.textContent?.includes('历史执行记录（30 段）')).length,
    elapsed: Array.from(document.querySelectorAll('.execution-process summary strong')).some((node) => node.textContent?.includes('已处理 1分23秒')),
    images: document.querySelectorAll('.user-image-preview img').length,
    generatedResults: document.querySelectorAll('.result-media').length,
    finalAnswers: document.querySelectorAll('.final-answer').length,
    composer: Boolean(document.querySelector('.composer')),
    backgroundClass: document.querySelector('.app-shell')?.className || '',
    backgroundImage: getComputedStyle(document.documentElement).getPropertyValue('--theme-background-image'),
    dim: getComputedStyle(document.documentElement).getPropertyValue('--background-dim'),
    opacity: getComputedStyle(document.documentElement).getPropertyValue('--background-opacity'),
    blur: getComputedStyle(document.documentElement).getPropertyValue('--background-blur'),
    overlayBackground: document.querySelector('.conversation-wrap') ? getComputedStyle(document.querySelector('.conversation-wrap'), '::after').backgroundColor : '',
    overlayFilter: document.querySelector('.conversation-wrap') ? getComputedStyle(document.querySelector('.conversation-wrap'), '::after').backdropFilter : '',
  })`);
  if (initial.appVersion !== "0.6.2") throw new Error(`Renderer version mismatch: ${JSON.stringify(initial)}`);
  if (initial.projectToolsExpanded || initial.directNav || initial.genericSummary || initial.review) throw new Error(`Default shell state is wrong: ${JSON.stringify(initial)}`);
  if (initial.historyBlocks !== 1 || !initial.elapsed || initial.images < 3 || initial.generatedResults < 1 || initial.finalAnswers < 1 || !initial.composer) throw new Error(`Conversation lifecycle fixture incomplete: ${JSON.stringify(initial)}`);
  if (!initial.backgroundClass.includes('background-conversation') || !initial.backgroundImage.includes('grok-theme://') || initial.dim.trim() !== '0' || initial.opacity.trim() !== '1' || initial.blur.trim() !== '0px') throw new Error(`Background settings were not applied exactly: ${JSON.stringify(initial)}`);
  if (!/rgba\([^)]*,\s*0\)|transparent/i.test(initial.overlayBackground) || !/none|blur\(0px\)/i.test(initial.overlayFilter)) throw new Error(`Unexpected fixed conversation overlay: ${JSON.stringify(initial)}`);

  await evaluate("document.querySelector('.project-tools-heading')?.click()");
  const tools = await waitFor(() => evaluate(`(() => { const values = Array.from(document.querySelectorAll('.project-tools nav button')).map((node) => node.textContent.trim()); return values.length ? values : null; })()`), "Development tools did not expand");
  for (const label of ["文件", "变更审核", "Worktree", "Memory", "Agent 与 Persona", "Profiles", "Dashboard", "任务", "扩展"]) if (!tools.includes(label)) throw new Error(`Missing development tool: ${label}`);

  await evaluate("document.querySelector('.workspace-button')?.focus(); document.querySelector('.workspace-button')?.click()");
  await waitFor(() => evaluate("document.activeElement === document.querySelector('.workspace-menu-search input')"), "Workspace picker did not focus search");
  const picker = await evaluate(`({ close: Boolean(document.querySelector('[aria-label="关闭工作区选择器"]')), scrollContained: (() => { const menu = document.querySelector('.workspace-menu'); const scroll = document.querySelector('.workspace-menu-scroll'); return Boolean(menu && scroll && scroll.getBoundingClientRect().bottom <= menu.getBoundingClientRect().bottom + 1); })() })`);
  if (!picker.close || !picker.scrollContained) throw new Error(`Workspace picker incomplete: ${JSON.stringify(picker)}`);
  await evaluate("document.querySelector('[aria-label=\"关闭工作区选择器\"]')?.click()");
  await waitFor(() => evaluate("document.activeElement === document.querySelector('.workspace-button')"), "Workspace picker did not return focus");

  await evaluate("document.querySelector('.review-toggle')?.click()");
  await waitFor(() => evaluate("Boolean(document.querySelector('.review-pane'))"), "Review pane did not open");
  const review = await evaluate(`({ label: document.querySelector('.review-pane')?.getAttribute('aria-label'), scopes: Array.from(document.querySelectorAll('.review-scopes button')).map((node) => node.textContent.trim()), resizer: Boolean(document.querySelector('.review-resizer')), close: Boolean(document.querySelector('[aria-label="关闭审核"]')) })`);
  for (const label of ["Unstaged", "Staged", "Commit", "Branch", "Last turn"]) if (!review.scopes.includes(label)) throw new Error(`Missing Review scope: ${label}`);
  if (review.label !== "变更审核" || !review.resizer || !review.close) throw new Error(`Review shell incomplete: ${JSON.stringify(review)}`);
  await evaluate("document.querySelector('[aria-label=\"关闭审核\"]')?.click()");
  await waitFor(() => evaluate("!document.querySelector('.review-pane')"), "Review pane did not close");

  await evaluate("document.querySelector('.sidebar-footer button[title=\"设置\"]')?.click()");
  await waitFor(() => evaluate("Boolean(document.querySelector('.settings-dialog'))"), "Settings dialog did not open");
  const settings = await evaluate(`({ size: (() => { const box = document.querySelector('.settings-dialog').getBoundingClientRect(); return { width: Math.round(box.width), height: Math.round(box.height) }; })(), categories: Array.from(document.querySelectorAll('.settings-layout > nav button')).map((node) => node.textContent.trim()), close: Boolean(document.querySelector('[aria-label="关闭设置"]')) })`);
  if (settings.categories.length !== 10 || !settings.close || settings.size.width < 850 || settings.size.height < 620) throw new Error(`Settings shell incomplete: ${JSON.stringify(settings)}`);
  await evaluate(`Array.from(document.querySelectorAll('.settings-layout > nav button')).find((node) => node.textContent.trim() === '外观')?.click()`);
  await waitFor(() => evaluate("Boolean(document.querySelector('.background-preview'))"), "Background preview did not render");
  if (!await evaluate(`Array.from(document.querySelectorAll('.theme-background button')).some((node) => node.textContent.trim() === '重置背景参数')`)) throw new Error("Background reset action is missing");
  await evaluate("window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
  await waitFor(() => evaluate("!document.querySelector('.settings-dialog')"), "Escape did not close settings");

  await evaluate("document.querySelector('.user-image-preview:not(.missing)')?.click()");
  await waitFor(() => evaluate("Boolean(document.querySelector('.image-lightbox img'))"), "Message image lightbox did not open");
  await evaluate("document.querySelector('.image-lightbox > button')?.click()");

  await evaluate(`(() => { const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlWQAAAAASUVORK5CYII='), value => value.charCodeAt(0)); const file = new File([bytes], 'clipboard.png', { type: 'image/png' }); const transfer = new DataTransfer(); transfer.items.add(file); document.querySelector('.composer textarea').dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true })); return true; })()`);
  await waitFor(() => evaluate("Boolean(document.querySelector('.composer-image-chip img'))"), "Pasted image preview did not appear");
  await evaluate("document.querySelector('.send-button')?.click()");
  await waitFor(() => evaluate(`Array.from(document.querySelectorAll('.delivery-state.failed')).some((value) => value.closest('.user-bubble')?.querySelector('.user-image-preview img'))`), "Image-only failed message was not preserved after send", 20_000);

  await request("Emulation.setDeviceMetricsOverride", { width: 1100, height: 720, deviceScaleFactor: 1, mobile: false });
  await evaluate("window.dispatchEvent(new Event('resize'))");
  await sleep(300);
  if (await evaluate("Boolean(document.querySelector('.review-pane'))")) throw new Error("Review should default closed below 1200px");
  await request("Emulation.setDeviceMetricsOverride", { width: 900, height: 720, deviceScaleFactor: 1, mobile: false });
  await evaluate("window.dispatchEvent(new Event('resize'))");
  await waitFor(() => evaluate("Boolean(document.querySelector('.app-shell.sidebar-collapsed'))"), "Sidebar did not auto-collapse below 1000px");
  await request("Emulation.setDeviceMetricsOverride", { width: 1440, height: 810, deviceScaleFactor: 1, mobile: false });
  await request("Page.reload", { ignoreCache: true });
  await waitFor(() => evaluate("document.querySelectorAll('.user-image-preview img').length >= 3"), "Attachment previews did not survive renderer reopen");
  console.log(JSON.stringify({ ok: true, version: initial.appVersion, legacySegmentsCoalesced: 30, elapsed: "1分23秒", reviewScopes: review.scopes, settingsCategories: settings.categories.length, backgroundExact: true, pastedImageVisible: true, reopenedImagesVisible: true, responsive: ["900x720", "1100x720", "1440x810"] }, null, 2));
} finally { socket.close(); }
