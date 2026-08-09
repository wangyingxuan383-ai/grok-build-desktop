const endpoint = process.argv[2];
if (!endpoint) throw new Error("Usage: node scripts/probe-v070-ui.mjs <cdp-endpoint>");
// This is the v0.7 acceptance gate, not a generic "whatever package.json
// currently says" smoke test. Keeping the expected release explicit prevents
// an older 0.6.x build from silently satisfying the current UI contract.
const expectedVersion = "0.7.3";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(action, message, timeout = 30_000) { const end = Date.now() + timeout; let last; while (Date.now() < end) { try { const value = await action(); if (value) return value; } catch (error) { last = error; } await sleep(120); } throw new Error(`${message}${last ? `: ${last.message}` : ""}`); }
const target = await waitFor(async () => (await fetch(`${endpoint}/json/list`).then((value) => value.json())).find((value) => value.type === "page"), "Renderer unavailable");
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let id = 0; const pending = new Map();
socket.onmessage = ({ data }) => { const message = JSON.parse(data); const entry = pending.get(message.id); if (!entry) return; pending.delete(message.id); message.error ? entry.reject(new Error(message.error.message)) : entry.resolve(message.result); };
const request = (method, params = {}) => new Promise((resolve, reject) => { const requestId = ++id; const timer = setTimeout(() => reject(new Error(`${method} timed out`)), 20_000); pending.set(requestId, { resolve: (value) => { clearTimeout(timer); resolve(value); }, reject }); socket.send(JSON.stringify({ id: requestId, method, params })); });
const evaluate = async (expression) => { const result = await request("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.text); return result.result?.value; };
let runtimeGlobal;
const refreshRuntimeGlobal = async () => { runtimeGlobal = await request("Runtime.evaluate", { expression: "globalThis", returnByValue: false }); };
await refreshRuntimeGlobal();
const callFunction = async (functionDeclaration, ...values) => {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const result = await request("Runtime.callFunctionOn", { objectId: runtimeGlobal.result?.objectId, functionDeclaration, arguments: values.map((value) => ({ value })), awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
      return result.result?.value;
    } catch (error) {
      if (attempt === 0 && /context|object|execution/i.test(error instanceof Error ? error.message : String(error))) {
        await refreshRuntimeGlobal();
        continue;
      }
      throw error;
    }
  }
  return undefined;
};
const clickText = (selector, text) => callFunction("function (selector, text) { const node = Array.from(document.querySelectorAll(selector)).find((candidate) => candidate.textContent.trim().includes(text)); node?.click(); return Boolean(node); }", selector, text);
const clickExactText = (selector, text) => callFunction("function (selector, text) { const node = Array.from(document.querySelectorAll(selector)).find((candidate) => candidate.textContent.trim() === text); node?.click(); return Boolean(node); }", selector, text);
/** Scans the virtualized conversation from the top until the selector mounts. */
async function scrollToFind(selector, message, steps = 70) {
  const scroller = "document.querySelector('.conversation')";
  const present = () => evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
  if (await present()) return;
  await evaluate(`(() => { const s=${scroller}; if (s) s.scrollTop = 0; return true; })()`);
  // Navigation can schedule several late Virtuoso measurements. Wait for the
  // active session commit, then dispatch real scroll events so a packaged
  // Renderer mounts each virtual row instead of sampling a stale viewport.
  await sleep(750);
  await evaluate(`(() => { const s=${scroller}; if (s) { s.scrollTop = 0; s.dispatchEvent(new Event('scroll')); } return true; })()`);
  await sleep(350);
  let stagnant = 0;
  for (let step = 0; step < steps; step += 1) {
    if (await present()) return;
    const atEnd = await evaluate(`(() => { const s=${scroller}; if (!s) return true; const before = s.scrollTop; s.scrollTop = Math.min(s.scrollHeight, s.scrollTop + Math.max(200, s.clientHeight * 0.6)); s.dispatchEvent(new Event('scroll')); return s.scrollTop === before; })()`);
    await sleep(220);
    stagnant = atEnd ? stagnant + 1 : 0;
    if (stagnant >= 3) break;
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
  // Session navigation deliberately performs several late Virtuoso size
  // reconciliations. Wait them out before taking ownership of scrollTop.
  await sleep(750);
  await evaluate(`(() => { const s=${scroller}; if (s) { s.scrollTop = 0; s.dispatchEvent(new Event('scroll')); } return true; })()`);
  await sleep(350);
  let stagnant = 0;
  for (let step = 0; step < steps; step += 1) {
    if (await present()) return;
    const atEnd = await evaluate(`(() => { const s=${scroller}; if (!s) return true; const before = s.scrollTop; s.scrollTop = Math.min(s.scrollHeight, s.scrollTop + Math.max(200, s.clientHeight * 0.6)); return s.scrollTop === before; })()`);
    await sleep(220);
    stagnant = atEnd ? stagnant + 1 : 0;
    if (stagnant >= 3) break;
  }
  throw new Error(message);
}
async function ensureFixtureSessions() {
  if (!(await evaluate("Boolean(document.querySelector('.session-row'))"))) {
    await evaluate("document.querySelector('.session-origin-group.normal .session-group-heading')?.click()");
    await waitFor(() => evaluate("Boolean(document.querySelector('.session-row'))"), "Fixture session group did not expand");
  }
}
async function reloadFixture() {
  await request("Page.reload", { ignoreCache: true });
  // Page.reload destroys the old V8 execution context and invalidates the
  // globalThis objectId used by Runtime.callFunctionOn.
  await waitFor(async () => { try { await refreshRuntimeGlobal(); return true; } catch { return false; } }, "Renderer execution context did not recover after reload");
  await waitFor(() => evaluate("Boolean(document.querySelector('.app-shell'))"), "Fixture did not recover after reload");
  await sleep(700);
  await ensureFixtureSessions();
}
async function openFixtureSession(label) {
  if (!(await clickText('.session-row', label))) throw new Error(`Fixture conversation is missing: ${label}`);
  await waitFor(() => callFunction("function (label) { return Array.from(document.querySelectorAll('.session-row.active')).some((node) => (node.textContent || '').includes(label)); }", label), `Fixture conversation did not become active: ${label}`);
  await sleep(350);
}
async function clickDecision(cardSelector, buttonText, missingMessage) {
  await scrollToFind(cardSelector, `${cardSelector} was not reachable before clicking ${buttonText}`);
  const startedAt = Date.now();
  if (!(await clickExactText(`${cardSelector} button`, buttonText))) throw new Error(`Decision button is missing: ${buttonText}`);
  await waitFor(() => evaluate(`!document.querySelector(${JSON.stringify(cardSelector)})`), missingMessage, 3_000);
  const elapsedMs = Date.now() - startedAt;
  if (elapsedMs > 2_500) throw new Error(`Decision card did not disappear promptly (${buttonText}: ${elapsedMs}ms)`);
  const failure = await evaluate("document.querySelector('.plan-decision-status.failed,.decision-status.failed')?.textContent || ''");
  if (failure) throw new Error(`Decision failed instead of settling (${buttonText}): ${failure}`);
  return elapsedMs;
}
async function exercisePlanAndPermission(planAction, permissionAction) {
  await reloadFixture();
  await openFixtureSession('Plan 与权限交互');
  const userMessagesBefore = await collectVirtualizedText('.bubble.user-bubble');
  const planMs = await clickDecision('.codex-plan-request', planAction, `Plan card remained after ${planAction}`);
  // The second unresolved request intentionally keeps the composer blocked.
  if (!(await evaluate("Boolean(document.querySelector('.composer-operation-notice.waiting'))"))) throw new Error(`Composer escaped needs-user while permission was still pending (${planAction})`);
  const permissionMs = await clickDecision('.codex-request-card[aria-label="权限确认"]', permissionAction, `Permission card remained after ${permissionAction}`);
  await waitFor(() => evaluate("Boolean(document.querySelector('.send-button:not(.stop)')) && !document.querySelector('.composer-operation-notice.waiting') && !document.querySelector('.send-button.stop') && !document.querySelector('.prompt-queue')"), `Composer did not recover after ${planAction}/${permissionAction}`);
  const userMessagesAfter = await collectVirtualizedText('.bubble.user-bubble');
  if (userMessagesAfter !== userMessagesBefore || /\[Plan approved\]/i.test(userMessagesAfter)) throw new Error(`Plan decision created a duplicate user prompt (${planAction}): ${JSON.stringify({ userMessagesBefore, userMessagesAfter })}`);
  return { planAction, permissionAction, planMs, permissionMs, duplicatePrompt: false };
}
async function exerciseStop() {
  await reloadFixture();
  await openFixtureSession('后台并行队列');
  await waitFor(() => evaluate("Boolean(document.querySelector('.send-button.stop')) && Boolean(document.querySelector('.prompt-queue'))"), "Stop fixture did not enter the running state");
  const startedAt = Date.now();
  if (!(await evaluate("(() => { const button=document.querySelector('.send-button.stop'); button?.click(); return Boolean(button); })()"))) throw new Error("Stop button could not be clicked");
  // Production Stop has an eight-second single-session recovery fallback.
  // The packaged probe must allow that documented path to settle on a busy
  // Windows desktop instead of treating a valid recovery as a five-second
  // failure.
  await waitFor(() => evaluate("Boolean(document.querySelector('.send-button:not(.stop)')) && !document.querySelector('.send-button.stop') && !document.querySelector('.prompt-queue')"), "Stop did not terminate the session and recover the composer", 12_000);
  const result = await evaluate(`({
    elapsedMs: ${Date.now()} - ${startedAt},
    notice: document.querySelector('.composer-operation-notice')?.textContent || '',
    error: document.querySelector('.error-toast')?.textContent || '',
    session: document.querySelector('.session-row.active')?.textContent || ''
  })`);
  if (result.error || /失败/.test(result.notice) || /运行中/.test(result.session)) throw new Error(`Stop settled into an invalid state: ${JSON.stringify(result)}`);
  return result;
}
try {
  await request("Page.bringToFront");
  await waitFor(() => evaluate("Boolean(document.querySelector('.app-shell'))"), "Application shell did not render");
  await sleep(700);
  const initial = await evaluate(`({ version: document.querySelector('.sidebar-footer button[title="版本与更新"] span')?.textContent?.trim(), composer: Boolean(document.querySelector('.composer')), turns: document.querySelectorAll('.chat-turn').length, environmentBars: document.querySelectorAll('.environment-bar').length })`);
  if (initial.version !== expectedVersion || !initial.composer || initial.turns < 1 || initial.environmentBars) throw new Error(`Shell mismatch for ${expectedVersion}: ${JSON.stringify(initial)}`);
  await ensureFixtureSessions();
  const fixtureSessions = await evaluate(`Array.from(document.querySelectorAll('.session-row')).map((node) => ({ text: node.textContent || '', active: node.classList.contains('active') }))`);
  if (fixtureSessions.length < 3 || !fixtureSessions.some((row) => row.text.includes('后台并行队列')) || !fixtureSessions.some((row) => row.text.includes('Plan 与权限交互'))) throw new Error(`Current-version multi-session fixture is incomplete: ${JSON.stringify(fixtureSessions)}`);

  // A new task is a persisted local draft. Opening it must not create a CLI
  // session, remove history rows or inherit the previously active lifecycle.
  await waitFor(() => callFunction("function () { return Array.from(document.querySelectorAll('.session-row.draft')).some((node) => (node.textContent || '').includes('未发送草稿')); }"), "Draft-first row did not appear");
  const historyCountBeforeDraft = await evaluate("document.querySelectorAll('.session-origin-group.normal .session-row:not(.draft)').length");
  if (!(await clickExactText('.new-task-button', '新建任务'))) throw new Error('New-task button did not open the local draft');
  await waitFor(() => evaluate("!document.querySelector('.session-row.active:not(.draft)') && document.querySelector('.composer textarea')?.value === '0.7.3 本地草稿（尚未启动 CLI）'"), "New task did not hydrate the persisted local draft");
  const draftState = await evaluate(`({
    historyCount: document.querySelectorAll('.session-origin-group.normal .session-row:not(.draft)').length,
    stop: Boolean(document.querySelector('.send-button.stop')),
    waiting: Boolean(document.querySelector('.composer-operation-notice.waiting')),
    model: document.querySelector('.draft-model-controls select')?.value || ''
  })`);
  if (draftState.historyCount !== historyCountBeforeDraft || draftState.stop || draftState.waiting || draftState.model !== 'fixture-draft-model') throw new Error(`Draft-first state is not isolated from CLI sessions: ${JSON.stringify(draftState)}`);
  await evaluate(`(() => { const input=document.querySelector('.composer textarea'); const setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set; setter.call(input,'0.7.3 重启后仍存在的草稿'); input.dispatchEvent(new Event('input',{bubbles:true})); return input.value; })()`);
  await sleep(700);
  await reloadFixture();
  await waitFor(() => evaluate("Boolean(document.querySelector('.session-row.draft'))"), "Persisted draft row was lost after restart");
  await evaluate("document.querySelector('.session-row.draft')?.click()");
  await waitFor(() => evaluate("document.querySelector('.composer textarea')?.value === '0.7.3 重启后仍存在的草稿'"), "Persisted draft body was not restored after restart");
  if ((await evaluate("document.querySelectorAll('.session-origin-group.normal .session-row:not(.draft)').length")) !== historyCountBeforeDraft) throw new Error('Restoring a local draft created or removed a CLI session');

  // A background running conversation owns its own Stop button, queue and
  // draft. Switching to a waiting foreground conversation must not leak any
  // of those controls or text, then switching back must restore the draft.
  await openFixtureSession('后台并行队列');
  await waitFor(() => evaluate("Boolean(document.querySelector('.send-button.stop')) && Boolean(document.querySelector('.prompt-queue'))"), "Background session did not expose its own running/queue state");
  await evaluate(`(() => { const input=document.querySelector('.composer textarea'); input.focus(); const setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set; setter.call(input,'后台会话独立草稿'); input.dispatchEvent(new Event('input',{bubbles:true})); return input.value; })()`);
  await sleep(500);
  await openFixtureSession('Plan 与权限交互');
  await waitFor(() => evaluate("document.querySelector('.composer textarea')?.value === ''"), "Foreground session inherited the background draft");
  const foregroundControls = await evaluate(`({ stop:Boolean(document.querySelector('.send-button.stop')), queue:Boolean(document.querySelector('.prompt-queue')), waiting:Boolean(document.querySelector('.composer-operation-notice.waiting')) })`);
  if (foregroundControls.stop || foregroundControls.queue || !foregroundControls.waiting) throw new Error(`Background lifecycle leaked into foreground composer: ${JSON.stringify(foregroundControls)}`);
  await scrollToFind('.codex-plan-request', 'Actionable Plan card did not render');
  await scrollToFind('.codex-request-card[aria-label="权限确认"]', 'Permission decision card did not render');
  const requestCards = await evaluate(`({ plan:Array.from(document.querySelectorAll('.codex-plan-request button')).map((node)=>node.textContent.trim()), permission:Array.from(document.querySelectorAll('[aria-label="权限确认"] button')).map((node)=>node.textContent.trim()) })`);
  if (!requestCards.plan.includes('实施计划') || !requestCards.plan.includes('继续规划') || !requestCards.permission.includes('仅本次允许') || !requestCards.permission.includes('拒绝并说明原因')) throw new Error(`Codex-style decision controls mismatch: ${JSON.stringify(requestCards)}`);
  await openFixtureSession('后台并行队列');
  await waitFor(() => evaluate("document.querySelector('.composer textarea')?.value === '后台会话独立草稿'"), "Background draft was not restored after session switch");
  const decisionReceipts = [];
  decisionReceipts.push(await exercisePlanAndPermission('实施计划', '仅本次允许'));
  decisionReceipts.push(await exercisePlanAndPermission('继续规划', '仅本次允许'));
  decisionReceipts.push(await exercisePlanAndPermission('取消', '仅本次允许'));
  decisionReceipts.push(await exercisePlanAndPermission('取消', '拒绝并说明原因'));
  const stopReceipt = await exerciseStop();
  await clickText('.session-row', '会话生命周期与并发验收');
  await waitFor(() => evaluate("!document.querySelector('.send-button.stop') && !document.querySelector('.prompt-queue')"), "Idle session inherited background controls");
  await scrollToFindText('.turn-metrics', '1分23秒', 'Completed turn metrics were not reachable');
  const turnMetrics = await evaluate(`Array.from(document.querySelectorAll('.turn-metrics')).map((node) => node.textContent || '').join(' · ')`);
  if (!turnMetrics.includes("1分23秒") || !turnMetrics.includes("输入 120") || !turnMetrics.includes("输出 30")) throw new Error(`Turn metrics mismatch: ${turnMetrics}`);
  const requestRail = await evaluate(`({ markers: document.querySelectorAll('.turn-navigation-rail button[data-turn-index]').length, collapse: Array.from(document.querySelectorAll('.turn-navigation-rail button')).some((node) => ((node.textContent || '') + ' ' + (node.getAttribute('aria-label') || '')).includes('折叠')) })`);
  if (requestRail.markers < 1 || !requestRail.collapse) throw new Error(`Request navigation rail mismatch: ${JSON.stringify(requestRail)}`);
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
  await waitFor(() => evaluate("!document.querySelector('.right-tool-launcher')?.textContent?.includes('正在确认')"), "Right tool capability detection did not finish");
  const launcher = await evaluate(`Array.from(document.querySelectorAll('.right-tool-launcher > button')).map((node) => node.textContent.trim())`);
  // Assert the entries by name. An exact count breaks on every addition, which
  // is how the preset count and the version literal rotted.
  const requiredTools = ["Agent 改动", "计划与结果", "最近文件", "侧边任务"];
  const missingTools = requiredTools.filter((label) => !launcher.some((value) => value.includes(label)));
  if (missingTools.length || launcher.some((value) => value.includes("Git 变更"))) throw new Error(`Right launcher exposed an unavailable Git surface: ${JSON.stringify({ launcher, missingTools })}`);
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
  await waitFor(() => evaluate("Boolean(document.querySelector('.right-tool-launcher'))"), "Right launcher did not reopen for Agent changes");
  await waitFor(() => evaluate("Array.from(document.querySelectorAll('.right-tool-launcher > button')).some((node) => (node.textContent || '').includes('Agent 改动'))"), "Agent change capability did not resolve after reopening the launcher");
  await clickText('.right-tool-launcher > button', 'Agent 改动');
  await waitFor(() => evaluate("Boolean(document.querySelector('.agent-change-pane'))"), "Non-Git Agent change surface did not open");
  const agentChangeUi = await evaluate(`(() => { const node=document.querySelector('.agent-change-pane'); return { text: node?.innerText || '', gitActions: Array.from(node?.querySelectorAll('button') || []).some((button) => /暂存|提交|分支/.test(button.textContent || '')) }; })()`);
  if (!agentChangeUi.text.includes("真实写入") || agentChangeUi.gitActions) throw new Error(`Agent change capability mismatch: ${JSON.stringify(agentChangeUi)}`);
  await evaluate("document.querySelector('.agent-change-pane .review-header .icon-button')?.click()");

  // Electron's embedded CDP endpoint does not expose the Browser domain on
  // every supported build. Use physical window bounds when available, while
  // retaining the deterministic CSS viewport/DPR check as the portable path.
  let windowTarget;
  try { windowTarget = await request("Browser.getWindowForTarget", { targetId: target.id }); } catch { windowTarget = undefined; }
  const responsiveEvidence = [];
  for (const [physicalWidth, physicalHeight, scale] of [[1280, 720, 1.25], [1440, 810, 1.5], [1920, 1080, 2]]) {
    const cssWidth = Math.floor(physicalWidth / scale);
    const cssHeight = Math.floor(physicalHeight / scale);
    if (windowTarget) await request("Browser.setWindowBounds", { windowId: windowTarget.windowId, bounds: { width: physicalWidth, height: physicalHeight, windowState: "normal" } });
    await request("Emulation.setDeviceMetricsOverride", { width: cssWidth, height: cssHeight, deviceScaleFactor: scale, mobile: false });
    await evaluate("window.dispatchEvent(new Event('resize'))"); await sleep(240);
    const bounds = await evaluate(`(() => { const box = document.querySelector('.composer')?.getBoundingClientRect(); return box ? { top: box.top, bottom: box.bottom, height: box.height, viewportWidth: innerWidth, viewportHeight: innerHeight, scale: devicePixelRatio } : null; })()`);
    if (!bounds || bounds.viewportWidth !== cssWidth || bounds.viewportHeight !== cssHeight || Math.abs(bounds.scale - scale) > 0.01 || bounds.top < 0 || bounds.bottom > bounds.viewportHeight + 1 || bounds.height < 50) throw new Error(`Composer escaped scaled usable viewport at ${physicalWidth}x${physicalHeight}@${scale} (${cssWidth}x${cssHeight} CSS): ${JSON.stringify(bounds)}`);
    responsiveEvidence.push({ physicalWidth, physicalHeight, scale, cssWidth, cssHeight, composerHeight: bounds.height });
  }

  if (windowTarget) await request("Browser.setWindowBounds", { windowId: windowTarget.windowId, bounds: { width: 1100, height: 720, windowState: "normal" } });
  await request("Emulation.setDeviceMetricsOverride", { width: 1100, height: 720, deviceScaleFactor: 1, mobile: false });
  await evaluate("window.dispatchEvent(new Event('resize')); document.querySelector('.review-toggle')?.click()");
  await waitFor(() => evaluate("Boolean(document.querySelector('.right-utility-pane'))"), "Narrow right drawer is not visible");
  const drawer = await evaluate(`(() => { const node=document.querySelector('.right-utility-pane'); const box=node.getBoundingClientRect(); const style=getComputedStyle(node); return { display:style.display,containerType:style.containerType,left:box.left,right:box.right,viewport:innerWidth,loading:Boolean(document.querySelector('.workbench-loading')) }; })()`);
  if (drawer.display === "none" || drawer.containerType !== "inline-size" || drawer.left < -1 || drawer.right > drawer.viewport + 1 || drawer.loading) throw new Error(`Narrow right drawer overflow or lazy-load stall: ${JSON.stringify(drawer)}`);
  await evaluate("document.querySelector('.right-utility-pane > header .icon-button')?.click()");

  await clickText('.sidebar-footer .icon-button', '');
  if (!await waitFor(() => evaluate("Boolean(document.querySelector('.settings-dialog'))"), "Settings did not open")) throw new Error("Settings did not open");
  await clickText('.settings-layout > nav button', '常规');
  await waitFor(() => evaluate("document.querySelectorAll('.conversation-reading-settings input[type=range]').length === 2"), "Conversation-only reading controls are missing");
  const readingUi = await evaluate(`({ width: document.querySelector('.conversation-reading-settings input[type=range]')?.value, scale: document.querySelectorAll('.conversation-reading-settings input[type=range]')[1]?.value })`);
  if (!readingUi.width || !readingUi.scale) throw new Error(`Conversation reading controls mismatch: ${JSON.stringify(readingUi)}`);
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

  console.log(JSON.stringify({ ok: true, version: initial.version, multiSessionIsolation: true, planPermissionActions: decisionReceipts, composerRecoveredAfterDecisions: true, stop: stopReceipt, composerRecoveredAfterStop: true, draftIsolation: true, navigation: "dashboard→chat→file→chat→tasks→chat", rightTools: launcher.length, recentFilePreview: true, unavailableGitReviewHidden: true, agentChanges: "real-writes-no-git-actions", structuredError: "collapsed-with-details", turnMetrics: true, conversationReadingControls: true, tokenActivityDays: tokenUi.cells, updateActions: 4, diagnosticsNavigation: true, responsiveComposer: responsiveEvidence, narrowDrawerVisible: true, rightDockContainerQueries: true, lazyPanelsSettled: true, providerManager: true }, null, 2));
} finally { socket.close(); }
