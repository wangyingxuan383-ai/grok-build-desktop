import { readFileSync } from "node:fs";

const endpoint = process.argv[2];
if (!endpoint) throw new Error("Usage: node scripts/probe-v066-ui.mjs <cdp-endpoint>");
const expectedVersion = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(action, message, timeout = 30_000) { const end = Date.now() + timeout; let last; while (Date.now() < end) { try { const value = await action(); if (value) return value; } catch (error) { last = error; } await sleep(120); } throw new Error(`${message}${last ? `: ${last.message}` : ""}`); }
const target = await waitFor(async () => (await fetch(`${endpoint}/json/list`).then((value) => value.json())).find((value) => value.type === "page"), "Renderer unavailable");
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let id = 0; const pending = new Map();
socket.onmessage = ({ data }) => { const message = JSON.parse(data); const entry = pending.get(message.id); if (!entry) return; pending.delete(message.id); message.error ? entry.reject(new Error(message.error.message)) : entry.resolve(message.result); };
const request = (method, params = {}) => new Promise((resolve, reject) => { const requestId = ++id; const timer = setTimeout(() => reject(new Error(`${method} timed out`)), 20_000); pending.set(requestId, { resolve: (value) => { clearTimeout(timer); resolve(value); }, reject }); socket.send(JSON.stringify({ id: requestId, method, params })); });
const evaluate = async (expression) => { const result = await request("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.text); return result.result?.value; };
const runtimeGlobal = await request("Runtime.evaluate", { expression: "globalThis", returnByValue: false });
const callFunction = async (functionDeclaration, ...values) => {
  const result = await request("Runtime.callFunctionOn", { objectId: runtimeGlobal.result?.objectId, functionDeclaration, arguments: values.map((value) => ({ value })), awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result?.value;
};
const clickText = (selector, text) => callFunction("function (selector, text) { const node = Array.from(document.querySelectorAll(selector)).find((candidate) => candidate.textContent.trim().includes(text)); node?.click(); return Boolean(node); }", selector, text);
/** Scans the virtualized conversation from the top until the selector mounts. */
async function scrollToFind(selector, message, steps = 40) {
  const scroller = "document.querySelector('.conversation')";
  const present = () => evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
  if (await present()) return;
  await evaluate(`(() => { const s=${scroller}; if (s) s.scrollTop = 0; return true; })()`);
  await sleep(400);
  for (let step = 0; step < steps; step += 1) {
    if (await present()) return;
    const atEnd = await evaluate(`(() => { const s=${scroller}; if (!s) return true; const before = s.scrollTop; s.scrollTop = Math.min(s.scrollHeight, s.scrollTop + Math.max(200, s.clientHeight * 0.6)); return s.scrollTop === before; })()`);
    await sleep(300);
    if (atEnd) break;
  }
  if (!(await present())) throw new Error(message);
}
async function collectVirtualizedText(selector, steps = 40) {
  const scroller = "document.querySelector('.conversation')";
  const values = new Set();
  await evaluate(`(() => { const s=${scroller}; if (s) s.scrollTop = 0; return true; })()`);
  await sleep(300);
  for (let step = 0; step < steps; step += 1) {
    const mounted = await evaluate(`Array.from(document.querySelectorAll(${JSON.stringify(selector)})).map((node) => node.textContent || '')`);
    for (const value of mounted || []) values.add(value);
    const atEnd = await evaluate(`(() => { const s=${scroller}; if (!s) return true; const before = s.scrollTop; s.scrollTop = Math.min(s.scrollHeight, s.scrollTop + Math.max(200, s.clientHeight * 0.6)); return s.scrollTop === before; })()`);
    await sleep(220);
    if (atEnd) break;
  }
  return [...values].join('\n');
}
async function scrollToFindText(selector, text, message, steps = 40) {
  const scroller = "document.querySelector('.conversation')";
  const present = () => callFunction("function (selector, text) { return Array.from(document.querySelectorAll(selector)).some((node) => (node.textContent || '').includes(text)); }", selector, text);
  await evaluate(`(() => { const s=${scroller}; if (s) s.scrollTop = 0; return true; })()`);
  await sleep(300);
  for (let step = 0; step < steps; step += 1) {
    if (await present()) return;
    const atEnd = await evaluate(`(() => { const s=${scroller}; if (!s) return true; const before = s.scrollTop; s.scrollTop = Math.min(s.scrollHeight, s.scrollTop + Math.max(200, s.clientHeight * 0.6)); return s.scrollTop === before; })()`);
    await sleep(220);
    if (atEnd) break;
  }
  throw new Error(message);
}
try {
  await request("Page.bringToFront");
  await waitFor(() => evaluate("Boolean(document.querySelector('.app-shell'))"), "Application shell did not render");
  await sleep(700);
  const initial = await evaluate(`({ version: document.querySelector('.sidebar-footer button[title="版本与更新"] span')?.textContent?.trim(), composer: Boolean(document.querySelector('.composer')), turns: document.querySelectorAll('.chat-turn').length, environmentBars: document.querySelectorAll('.environment-bar').length })`);
  if (initial.version !== expectedVersion || !initial.composer || initial.turns < 1 || initial.environmentBars) throw new Error(`Shell mismatch for ${expectedVersion}: ${JSON.stringify(initial)}`);
  const turnMetrics = await collectVirtualizedText('.turn-metrics');
  if (!turnMetrics.includes("1分23秒") || !turnMetrics.includes("输入 120") || !turnMetrics.includes("输出 30")) throw new Error(`Turn metrics mismatch: ${turnMetrics}`);
  // The conversation is a virtualized list, so a card outside the restored
  // viewport is simply not mounted. Walk the scroller instead of asserting on
  // whatever happens to be on screen.
  await scrollToFindText(".structured-error", "fixture-provider", "Structured provider error did not render");
  const errorCard = await evaluate(`(() => { const node=Array.from(document.querySelectorAll('.structured-error')).find((candidate) => (candidate.textContent || '').includes('fixture-provider')); return { open: node?.open, summary: node?.querySelector('summary')?.textContent || '', detail: node?.querySelector('.error-detail')?.textContent || '' }; })()`);
  // The summary is now built from the classified failure, not from parsing
  // prose that only the fixture ever produced.
  if (errorCard.open || !errorCard.summary.includes("工具 Schema 被拒绝") || !errorCard.summary.includes("HTTP 400") || !errorCard.summary.includes("Provider fixture-provider")) throw new Error(`Structured error mismatch: ${JSON.stringify(errorCard)}`);
  if (!errorCard.detail.includes("fixture-trace") || !errorCard.detail.includes("可以这样处理") || !errorCard.detail.includes("Gemini")) throw new Error(`Failure guidance missing: ${JSON.stringify(errorCard)}`);

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
  // Assert the entries by name. An exact count breaks on every addition, which
  // is how the preset count and the version literal rotted.
  const requiredTools = ["审阅", "Agent 改动", "计划与结果", "最近文件", "侧边任务"];
  const missingTools = requiredTools.filter((label) => !launcher.some((value) => value.includes(label)));
  if (missingTools.length) throw new Error(`Right launcher mismatch: ${JSON.stringify({ launcher, missingTools })}`);
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
  await evaluate("document.querySelector('.review-toggle')?.click()");
  await waitFor(() => evaluate("Boolean(document.querySelector('.right-tool-launcher'))"), "Right launcher did not reopen for Agent changes");
  await clickText('.right-tool-launcher > button', 'Agent 改动');
  await waitFor(() => evaluate("Boolean(document.querySelector('.agent-change-pane'))"), "Non-Git Agent change surface did not open");
  const agentChangeUi = await evaluate(`(() => { const node=document.querySelector('.agent-change-pane'); return { text: node?.innerText || '', gitActions: Array.from(node?.querySelectorAll('button') || []).some((button) => /暂存|提交|分支/.test(button.textContent || '')) }; })()`);
  if (!agentChangeUi.text.includes("真实写入") || agentChangeUi.gitActions) throw new Error(`Agent change capability mismatch: ${JSON.stringify(agentChangeUi)}`);
  await evaluate("document.querySelector('.agent-change-pane .review-header .icon-button')?.click()");

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
  await clickText('.settings-layout > nav button', 'Token 活动');
  await waitFor(() => evaluate("document.querySelectorAll('.token-heatmap-grid .token-cell').length === 371"), "Token activity did not render an exact 371-day heatmap");
  const tokenUi = await evaluate(`({ cells: document.querySelectorAll('.token-heatmap-grid .token-cell').length, windows: Array.from(document.querySelectorAll('.token-window-grid article strong')).map((node) => node.textContent.trim()), privacy: document.querySelector('.token-heatmap footer')?.textContent || '' })`);
  if (tokenUi.cells !== 371 || !tokenUi.windows.includes("最近 24 小时") || !tokenUi.windows.includes("本月") || !tokenUi.privacy.includes("不包含任何提示词")) throw new Error(`Token activity mismatch: ${JSON.stringify(tokenUi)}`);
  await clickText('.settings-layout > nav button', '更新与诊断');
  const updateUi = await evaluate(`({ actions: document.querySelectorAll('.settings-action-list button').length, resultRegion: document.querySelector('.settings-action-results')?.getAttribute('aria-live') })`);
  if (updateUi.actions !== 4 || updateUi.resultRegion !== "polite") throw new Error(`Update/diagnostic actions mismatch: ${JSON.stringify(updateUi)}`);
  await clickText('.settings-action-list button', '打开诊断中心');
  await waitFor(() => evaluate("Boolean(document.querySelector('.diagnostics-panel'))"), "Settings did not navigate to diagnostics");
  await evaluate("document.querySelector('.diagnostics-panel > header .icon-button')?.click()");
  await clickText('.sidebar-footer .icon-button', '');
  await waitFor(() => evaluate("Boolean(document.querySelector('.settings-dialog'))"), "Settings did not reopen after diagnostics");
  await clickText('.settings-layout > nav button', '账号与提供商');
  await clickText('.settings-action-list button', '管理自定义提供商');
  await waitFor(() => evaluate("Boolean(document.querySelector('.provider-manager'))"), "Provider manager did not open from settings");
  // Assert the presets that matter by name. An exact count rots every time a
  // preset is added, which is how the version literal in probe-v062 rotted.
  const providerUi = await evaluate(`({ presets: Array.from(document.querySelectorAll('.provider-preset-menu button')).map((node) => node.textContent.trim()), search: Boolean(document.querySelector('.provider-manager-list input')), close: Boolean(document.querySelector('.provider-manager > header .icon-button')) })`);
  const requiredPresets = ["OpenAI 兼容", "Responses", "Anthropic", "Gemini 兼容", "Ollama"];
  const missingPresets = requiredPresets.filter((label) => !providerUi.presets.includes(label));
  if (missingPresets.length || !providerUi.search || !providerUi.close) throw new Error(`Provider manager shell mismatch: ${JSON.stringify({ ...providerUi, missingPresets })}`);
  await clickText('.provider-preset-menu button', 'Ollama');
  await waitFor(() => evaluate("Boolean(document.querySelector('.provider-draft-editor'))"), "Provider draft editor did not open");
  const draftUi = await evaluate(`({ discover: Array.from(document.querySelectorAll('.provider-probe-actions button')).some((node) => node.textContent.includes('获取模型列表')), manual: Array.from(document.querySelectorAll('.provider-model-heading button')).some((node) => node.textContent.includes('手工添加')), address: Array.from(document.querySelectorAll('.provider-form-grid input')).some((node) => node.value.includes('127.0.0.1:11434')) })`);
  if (!draftUi.discover || !draftUi.manual || !draftUi.address) throw new Error(`Provider draft workflow mismatch: ${JSON.stringify(draftUi)}`);

  console.log(JSON.stringify({ ok: true, version: initial.version, navigation: "dashboard→chat→file→chat→tasks→chat", rightTools: launcher.length, recentFilePreview: true, nonGitReview: "empty-state", agentChanges: "real-writes-no-git-actions", structuredError: "collapsed-with-details", turnMetrics: true, tokenActivityDays: tokenUi.cells, updateActions: 4, diagnosticsNavigation: true, responsiveComposer: true, narrowDrawerVisible: true, providerManager: true }, null, 2));
} finally { socket.close(); }
