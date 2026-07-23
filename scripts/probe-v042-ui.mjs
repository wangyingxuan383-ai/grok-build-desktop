const endpoint = process.argv[2];
if (!endpoint) throw new Error("CDP endpoint is required");
const isGitHubHostedRunner = process.env.GITHUB_ACTIONS === "true";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(action, message, timeout = 20_000) { const end = Date.now() + timeout; let last; while (Date.now() < end) { try { const value = await action(); if (value) return value; } catch (error) { last = error; } await sleep(150); } throw new Error(`${message}${last ? `: ${last.message}` : ""}`); }
const target = await waitFor(async () => (await fetch(`${endpoint}/json/list`).then((value) => value.json())).find((value) => value.type === "page"), "Renderer target unavailable");
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let id = 0; const pending = new Map();
let probeStage = "connected";
const stage = (value) => { probeStage = value; console.log(`[probe-v042] ${value}`); };
socket.onmessage = ({ data }) => { const message = JSON.parse(data); const entry = pending.get(message.id); if (!entry) return; pending.delete(message.id); message.error ? entry.reject(new Error(message.error.message)) : entry.resolve(message.result); };
const request = (method, params = {}, timeout = 15_000) => new Promise((resolve, reject) => {
  const requestId = ++id;
  const timer = setTimeout(() => {
    pending.delete(requestId);
    reject(new Error(`CDP request timed out after ${timeout}ms during ${probeStage}: ${method}`));
  }, timeout);
  pending.set(requestId, {
    resolve: (value) => { clearTimeout(timer); resolve(value); },
    reject: (error) => { clearTimeout(timer); reject(error); },
  });
  socket.send(JSON.stringify({ id: requestId, method, params }));
});
const evaluate = async (expression) => { const result = await request("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.text); return result.result?.value; };
// CDP Input.dispatchKeyEvent can wait forever on a headless Windows hosted
// runner even though the renderer remains responsive. Dispatch the same
// bubbling keyboard event from the currently focused element so React and the
// global focus trap receive it without relying on the runner's desktop input
// session. Every CDP request above is also bounded, preventing release jobs
// from consuming their full timeout without a useful failure message.
const pressKey = async (key) => {
  await evaluate(`(() => {
    const target = document.activeElement || window;
    target.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, code: ${JSON.stringify(key)}, bubbles: true, cancelable: true }));
    target.dispatchEvent(new KeyboardEvent('keyup', { key: ${JSON.stringify(key)}, code: ${JSON.stringify(key)}, bubbles: true, cancelable: true }));
    return true;
  })()`);
  await sleep(100);
};
try {
  stage("bring renderer to front");
  await request("Page.bringToFront");
  stage("verify initial content and background protocol");
  await waitFor(() => evaluate("Boolean(document.querySelector('.app-shell .composer, .app-shell .workspace-empty'))"), "Application content did not render");
  await waitFor(() => evaluate("document.querySelector('.app-shell')?.classList.contains('background-conversation')"), "Conversation background scope was not restored");
  const backgroundLoaded = await evaluate(`new Promise((resolve) => { const image = new Image(); image.onload = () => resolve({ ok: true, width: image.naturalWidth, height: image.naturalHeight }); image.onerror = () => resolve({ ok: false }); image.src = 'grok-theme://background/current'; })`);
  if (!backgroundLoaded?.ok || backgroundLoaded.width !== 1 || backgroundLoaded.height !== 1) throw new Error(`Fixed theme protocol did not load the app-owned image: ${JSON.stringify(backgroundLoaded)}`);
  await request("Emulation.setDeviceMetricsOverride", { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
  await sleep(250);
  stage("verify 1280x720 palette and keyboard selection");
  await evaluate("document.querySelector('.add-button')?.click(); true");
  await waitFor(() => evaluate("Boolean(document.querySelector('.add-palette'))"), "Add palette did not open");
  const paletteBounds = await evaluate(`(() => { const rect = document.querySelector('.add-palette').getBoundingClientRect(); return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: innerWidth, height: innerHeight }; })()`);
  if (paletteBounds.left < 0 || paletteBounds.top < 0 || paletteBounds.right > paletteBounds.width || paletteBounds.bottom > paletteBounds.height) throw new Error(`Add palette was clipped at 1280x720: ${JSON.stringify(paletteBounds)}`);
  const palette = await evaluate("document.querySelector('.add-palette')?.innerText || ''");
  for (const value of ["文件和图片", "文件夹", "工作区文件", "控制电脑", "插件 Skills", "管理扩展和 Skills"]) if (!palette.includes(value)) throw new Error(`Add palette is missing ${value}`);
  await evaluate("document.querySelector('.add-palette [data-palette-item]')?.focus(); true");
  await sleep(100);
  for (let index = 0; index < 3; index += 1) await pressKey("ArrowDown");
  const focusedPaletteItem = await evaluate("document.activeElement?.textContent || ''");
  if (!focusedPaletteItem.includes("控制电脑")) throw new Error(`Arrow-key navigation focused the wrong item: ${focusedPaletteItem}`);
  await pressKey("Enter");
  await waitFor(() => evaluate("document.querySelector('.capability-chip.computer')?.textContent.includes('@Computer')"), "One-shot Computer chip did not appear");
  if (await evaluate("Boolean(document.querySelector('.computer-picker, .computer-live-strip'))")) throw new Error("Selecting Computer opened or started the legacy window picker");
  stage("verify palette Escape and composer focus restoration");
  await evaluate("document.querySelector('.add-button')?.click(); true");
  await waitFor(() => evaluate("Boolean(document.querySelector('.add-palette'))"), "Add palette did not reopen");
  await waitFor(() => evaluate("Boolean(document.activeElement?.closest?.('.add-palette'))"), "Reopened palette did not establish focus");
  await pressKey("Escape");
  await waitFor(() => evaluate("!document.querySelector('.add-palette')"), "Escape did not close the palette");
  await sleep(150);
  const restoredFocus = await evaluate("({ tag: document.activeElement?.tagName, cls: document.activeElement?.className || '', composer: document.activeElement === document.querySelector('.composer textarea') })");
  if (!restoredFocus.composer) throw new Error(`Escape closed the palette but did not restore composer focus: ${JSON.stringify(restoredFocus)}`);
  // GitHub's Windows hosted desktop has no physical 4K display and Chromium's
  // virtual GPU can stop servicing Runtime.evaluate after a 3840x2160 device
  // override. Keep the real 4K regression in local/package acceptance, while
  // the hosted release gate still verifies a large 1920x1080 desktop viewport.
  const largeViewport = isGitHubHostedRunner ? { width: 1920, height: 1080 } : { width: 3840, height: 2160 };
  stage(`verify ${largeViewport.width}x${largeViewport.height} palette bounds`);
  await request("Emulation.setDeviceMetricsOverride", { ...largeViewport, deviceScaleFactor: 1, mobile: false });
  await evaluate("document.querySelector('.add-button')?.click(); true");
  await waitFor(() => evaluate("Boolean(document.querySelector('.add-palette'))"), `Add palette did not open in ${largeViewport.width}x${largeViewport.height} viewport`);
  const largeBounds = await evaluate(`(() => { const rect = document.querySelector('.add-palette').getBoundingClientRect(); return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: innerWidth, height: innerHeight }; })()`);
  if (largeBounds.left < 0 || largeBounds.top < 0 || largeBounds.right > largeBounds.width || largeBounds.bottom > largeBounds.height) throw new Error(`Add palette was clipped at ${largeViewport.width}x${largeViewport.height}: ${JSON.stringify(largeBounds)}`);
  await pressKey("Escape");
  await request("Emulation.clearDeviceMetricsOverride");
  stage("verify theme editor and whole-window overlay");
  await evaluate("document.querySelector('.sidebar-footer button[title=\"设置\"]')?.click(); true");
  await waitFor(() => evaluate("Boolean(document.querySelector('.theme-editor'))"), "Theme editor did not open");
  const selectCount = await evaluate("document.querySelectorAll('.theme-editor select').length");
  if (selectCount < 1) throw new Error("Theme mode selector is missing");
  const backgroundEditor = await evaluate("document.querySelector('.theme-background')?.innerText || ''");
  for (const value of ["背景范围", "适配方式", "图片透明度", "模糊", "遮罩"]) if (!backgroundEditor.includes(value)) throw new Error(`Background editor is missing ${value}`);
  await evaluate(`(() => { const select = [...document.querySelectorAll('.theme-background select')].find(node => node.parentElement?.textContent?.includes('背景范围')); const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; setter.call(select, 'window'); select.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  await waitFor(() => evaluate("document.querySelector('.app-shell')?.classList.contains('background-window')"), "Whole-window background scope did not apply immediately");
  const overlayBounds = await evaluate(`(() => {
    const root = document.querySelector('#overlay-root');
    const panel = root?.querySelector('.control-panel');
    const backdrop = root?.querySelector('.modal-backdrop');
    if (!root || !panel || !backdrop) return null;
    const rect = panel.getBoundingClientRect();
    const backdropStyle = getComputedStyle(backdrop);
    return { parent: panel.closest('#overlay-root') === root, left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: innerWidth, height: innerHeight, backdropPosition: backdropStyle.position };
  })()`);
  if (!overlayBounds?.parent || overlayBounds.backdropPosition !== 'fixed' || overlayBounds.left < 0 || overlayBounds.top < 0 || overlayBounds.right > overlayBounds.width || overlayBounds.bottom > overlayBounds.height) {
    throw new Error(`Whole-window background displaced the settings overlay: ${JSON.stringify(overlayBounds)}`);
  }
  await waitFor(() => evaluate("Boolean(document.activeElement?.closest?.('#overlay-root .control-panel'))"), "Settings overlay did not establish keyboard focus");
  stage("verify overlay focus trap and theme switches");
  const focusCycle = await evaluate(`(() => {
    const panel = document.querySelector('#overlay-root .control-panel');
    const visible = (node) => { const style = getComputedStyle(node); return style.display !== 'none' && style.visibility !== 'hidden' && node.getClientRects().length > 0; };
    const items = [...panel.querySelectorAll('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])')].filter(visible);
    items.at(-1)?.focus();
    return { count: items.length, first: items[0]?.textContent || items[0]?.getAttribute('aria-label') || items[0]?.tagName, last: items.at(-1)?.textContent || items.at(-1)?.getAttribute('aria-label') || items.at(-1)?.tagName };
  })()`);
  if (focusCycle.count < 2) throw new Error(`Settings overlay has too few focusable controls: ${JSON.stringify(focusCycle)}`);
  await pressKey("Tab");
  const cycledInside = await evaluate("Boolean(document.activeElement?.closest?.('#overlay-root .control-panel'))");
  if (!cycledInside) throw new Error("Tab escaped the topmost settings overlay");
  await evaluate(`(() => { const select = document.querySelector('.theme-editor select'); const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; setter.call(select, 'light'); select.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  await waitFor(() => evaluate("document.documentElement.dataset.themeResolved === 'light'"), "Light theme did not apply immediately");
  await evaluate(`(() => { const select = document.querySelector('.theme-editor select'); const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; setter.call(select, 'dark'); select.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  await waitFor(() => evaluate("document.documentElement.dataset.themeResolved === 'dark'"), "Dark theme did not restore");
  await evaluate(`(() => { const select = document.querySelector('.theme-editor select'); const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; setter.call(select, 'custom'); select.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  await waitFor(() => evaluate("document.querySelectorAll('.theme-color-grid input[type=color]').length === 6"), "Custom color controls did not render");
  const customText = await evaluate("document.querySelector('.theme-editor')?.innerText || ''");
  for (const value of ["深色预设", "浅色预设", "选择背景图片"]) if (!customText.includes(value)) throw new Error(`Theme editor is missing ${value}`);
  await evaluate("document.querySelector('#overlay-root .control-panel > header button')?.click(); true");
  await waitFor(() => evaluate("!document.querySelector('#overlay-root .control-panel')"), "Settings panel did not close");
  // Keep the physical/local renderer stress regression as one long flow. A
  // hosted Windows virtual desktop becomes unreliable after repeated viewport,
  // theme and modal transitions even with software rendering, so CI verifies
  // these heavier panels in fresh renderer processes below instead.
  if (!isGitHubHostedRunner) {
    const overlayEntries = [
      { label: "任务", open: `(() => { [...document.querySelectorAll('.sidebar-primary-nav button')].find(node => node.textContent?.trim() === '任务')?.click(); return true; })()` },
      { label: "扩展", open: `(() => { [...document.querySelectorAll('.sidebar-primary-nav button')].find(node => node.textContent?.trim() === '扩展')?.click(); return true; })()` },
      { label: "创作", open: `(() => { const menu = document.querySelector('.topbar-more'); if (menu) menu.open = true; [...(menu?.querySelectorAll('button') ?? [])].find(node => node.textContent?.trim() === '创作')?.click(); return true; })()` },
    ];
    for (const entry of overlayEntries) {
      stage(`verify ${entry.label} overlay`);
      await evaluate(entry.open);
      await waitFor(() => evaluate("Boolean(document.querySelector('#overlay-root .control-panel'))"), `${entry.label} panel did not open in overlay root`);
      const bounds = await evaluate(`(() => { const rect = document.querySelector('#overlay-root .control-panel').getBoundingClientRect(); return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: innerWidth, height: innerHeight }; })()`);
      if (bounds.left < 0 || bounds.top < 0 || bounds.right > bounds.width || bounds.bottom > bounds.height) throw new Error(`${entry.label} panel escaped viewport: ${JSON.stringify(bounds)}`);
      await pressKey("Escape");
      await waitFor(() => evaluate("!document.querySelector('#overlay-root .control-panel')"), `${entry.label} panel did not close`);
    }
  }
  stage("complete");
  console.log(JSON.stringify({ ok: true, addPalette: true, oneShotComputer: true, legacyPicker: false, themeEditor: true, lightDarkSwitch: true, customColors: true, backgroundProtocol: true, backgroundScopes: true, overlayRoot: true, overlayPanels: isGitHubHostedRunner ? "fresh-process-probes" : true, largeViewport }));
} finally { socket.close(); }
