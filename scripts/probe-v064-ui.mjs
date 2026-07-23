const endpoint = process.argv[2];
if (!endpoint) throw new Error("Usage: node scripts/probe-v064-ui.mjs <cdp-endpoint>");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(action, message, timeout = 30_000) { const end = Date.now() + timeout; let last; while (Date.now() < end) { try { const value = await action(); if (value) return value; } catch (error) { last = error; } await sleep(120); } throw new Error(`${message}${last ? `: ${last.message}` : ""}`); }
const target = await waitFor(async () => (await fetch(`${endpoint}/json/list`).then((value) => value.json())).find((value) => value.type === "page"), "Renderer unavailable");
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let id = 0; const pending = new Map();
socket.onmessage = ({ data }) => { const message = JSON.parse(data); const entry = pending.get(message.id); if (!entry) return; pending.delete(message.id); message.error ? entry.reject(new Error(message.error.message)) : entry.resolve(message.result); };
const request = (method, params = {}) => new Promise((resolve, reject) => { const requestId = ++id; const timer = setTimeout(() => reject(new Error(`${method} timed out`)), 20_000); pending.set(requestId, { resolve: (value) => { clearTimeout(timer); resolve(value); }, reject }); socket.send(JSON.stringify({ id: requestId, method, params })); });
const evaluate = async (expression) => { const result = await request("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.text); return result.result?.value; };
const clickText = (selector, text) => evaluate(`Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find((node) => node.textContent.trim().includes(${JSON.stringify(text)}))?.click()`);
try {
  await request("Page.bringToFront");
  await waitFor(() => evaluate("Boolean(document.querySelector('.app-shell'))"), "Application shell did not render");
  await sleep(700);
  const initial = await evaluate(`({ version: document.querySelector('.sidebar-footer button[title="版本与更新"] span')?.textContent?.trim(), composer: Boolean(document.querySelector('.composer')), turns: document.querySelectorAll('.chat-turn').length, environmentBars: document.querySelectorAll('.environment-bar').length })`);
  if (initial.version !== "0.6.4" || !initial.composer || initial.turns < 1 || initial.environmentBars) throw new Error(`0.6.4 shell mismatch: ${JSON.stringify(initial)}`);

  await evaluate("document.querySelector('.project-tools-heading')?.click()");
  await waitFor(() => evaluate("Boolean(document.querySelector('.project-tools nav'))"), "Developer tools did not open");
  const toolLabels = await evaluate(`Array.from(document.querySelectorAll('.project-tools nav button')).map((node) => node.textContent.trim())`);
  if (toolLabels.some((value) => value === "文件" || value.includes("变更审核"))) throw new Error(`File/Review still occupy the left tool list: ${JSON.stringify(toolLabels)}`);
  await clickText('.project-tools nav button', 'Dashboard');
  await waitFor(() => evaluate("Boolean(document.querySelector('.return-to-chat'))"), "Workbench return action is missing");
  await evaluate("document.querySelector('.return-to-chat')?.click()");
  await waitFor(() => evaluate("Boolean(document.querySelector('.composer textarea'))"), "Conversation did not return from Dashboard");

  await evaluate("document.querySelector('.review-toggle')?.click()");
  await waitFor(() => evaluate("Boolean(document.querySelector('.right-tool-launcher'))"), "Right tool launcher did not open");
  const launcher = await evaluate(`Array.from(document.querySelectorAll('.right-tool-launcher > button')).map((node) => node.textContent.trim())`);
  if (launcher.length !== 4 || !launcher.some((value) => value.includes("计划与结果")) || !launcher.some((value) => value.includes("最近文件"))) throw new Error(`Right launcher mismatch: ${JSON.stringify(launcher)}`);
  await clickText('.right-tool-launcher > button', '计划与结果');
  await waitFor(() => evaluate("Boolean(document.querySelector('.document-tool'))"), "Plan/result tool did not open");
  await clickText('.right-utility-tabs button', '工具');
  await waitFor(() => evaluate("Boolean(document.querySelector('.right-tool-launcher'))"), "Launcher did not restore");
  await clickText('.right-tool-launcher > button', '最近文件');
  await waitFor(() => evaluate("Boolean(document.querySelector('.right-files-tool pre'))"), "Recent file preview did not load");
  await clickText('.right-files-tool main header button', '编辑文件');
  await waitFor(() => evaluate("Boolean(document.querySelector('.file-workbench'))"), "Explicit file edit did not open the central workbench");
  await waitFor(() => evaluate("Boolean(document.querySelector('.return-to-chat'))"), "File workbench has no return-to-conversation action");
  await evaluate("document.querySelector('.return-to-chat')?.click()");
  await waitFor(() => evaluate("Boolean(document.querySelector('.composer textarea'))"), "Conversation did not recover after file workbench");
  await clickText('.topbar-menu button', '任务中心');
  await waitFor(() => evaluate("Boolean(document.querySelector('.task-center'))"), "Task center did not open after returning from a file");
  await evaluate("document.querySelector('.task-center > header > button')?.click()");
  await waitFor(() => evaluate("Boolean(document.querySelector('.composer textarea')) && !document.querySelector('.task-center')"), "Conversation did not recover after task center");
  await evaluate("document.querySelector('.right-utility-pane > header .icon-button')?.click()");
  await evaluate("document.querySelector('.review-toggle')?.click()");
  await waitFor(() => evaluate("Boolean(document.querySelector('.right-tool-launcher'))"), "Right launcher did not reopen after navigation cycle");
  await clickText('.right-tool-launcher > button', '审阅');
  await waitFor(() => evaluate("Boolean(document.querySelector('.review-pane'))"), "Review did not open from launcher");
  await waitFor(() => evaluate("Boolean(document.querySelector('.review-capability-empty'))"), "Non-Git Review did not become an ordinary empty state");
  if (await evaluate("Boolean(document.querySelector('.error-toast'))")) throw new Error("Non-Git Review raised a global error");
  await evaluate("document.querySelector('.review-header .icon-button')?.click()");

  for (const [width, height, scale] of [[1280, 720, 1], [1440, 810, 1.25], [1920, 1080, 2]]) {
    await request("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: scale, mobile: false });
    await evaluate("window.dispatchEvent(new Event('resize'))"); await sleep(160);
    const bounds = await evaluate(`(() => { const box = document.querySelector('.composer')?.getBoundingClientRect(); return box ? { top: box.top, bottom: box.bottom, height: box.height, viewport: innerHeight } : null; })()`);
    if (!bounds || bounds.top < 0 || bounds.bottom > bounds.viewport + 1 || bounds.height < 50) throw new Error(`Composer escaped viewport at ${width}x${height}@${scale}: ${JSON.stringify(bounds)}`);
  }

  await request("Emulation.setDeviceMetricsOverride", { width: 1100, height: 720, deviceScaleFactor: 1, mobile: false });
  await evaluate("window.dispatchEvent(new Event('resize')); document.querySelector('.review-toggle')?.click()");
  await waitFor(() => evaluate("Boolean(document.querySelector('.right-utility-pane'))"), "Narrow right drawer is not visible");
  const drawer = await evaluate(`(() => { const node=document.querySelector('.right-utility-pane'); const box=node.getBoundingClientRect(); return { display:getComputedStyle(node).display,left:box.left,right:box.right,viewport:innerWidth }; })()`);
  if (drawer.display === "none" || drawer.left < -1 || drawer.right > drawer.viewport + 1) throw new Error(`Narrow right drawer overflow: ${JSON.stringify(drawer)}`);
  await evaluate("document.querySelector('.right-utility-pane > header .icon-button')?.click()");

  await clickText('.sidebar-footer .icon-button', '');
  if (!await waitFor(() => evaluate("Boolean(document.querySelector('.settings-dialog'))"), "Settings did not open")) throw new Error("Settings did not open");
  await clickText('.settings-layout > nav button', '账号与提供商');
  await clickText('.settings-action-list button', '管理自定义提供商');
  await waitFor(() => evaluate("Boolean(document.querySelector('.provider-manager'))"), "Provider manager did not open from settings");
  const providerUi = await evaluate(`({ presets: document.querySelectorAll('.provider-preset-menu button').length, search: Boolean(document.querySelector('.provider-manager-list input')), close: Boolean(document.querySelector('.provider-manager > header .icon-button')) })`);
  if (providerUi.presets !== 5 || !providerUi.search || !providerUi.close) throw new Error(`Provider manager shell mismatch: ${JSON.stringify(providerUi)}`);
  await clickText('.provider-preset-menu button', 'Ollama');
  await waitFor(() => evaluate("Boolean(document.querySelector('.provider-draft-editor'))"), "Provider draft editor did not open");
  const draftUi = await evaluate(`({ discover: Array.from(document.querySelectorAll('.provider-probe-actions button')).some((node) => node.textContent.includes('获取模型列表')), manual: Array.from(document.querySelectorAll('.provider-model-heading button')).some((node) => node.textContent.includes('手工添加')), address: Array.from(document.querySelectorAll('.provider-form-grid input')).some((node) => node.value.includes('127.0.0.1:11434')) })`);
  if (!draftUi.discover || !draftUi.manual || !draftUi.address) throw new Error(`Provider draft workflow mismatch: ${JSON.stringify(draftUi)}`);

  console.log(JSON.stringify({ ok: true, version: initial.version, navigation: "dashboard→chat→file→chat→tasks→chat", rightTools: launcher.length, recentFilePreview: true, nonGitReview: "empty-state", responsiveComposer: true, narrowDrawerVisible: true, providerManager: true }, null, 2));
} finally { socket.close(); }
