const endpoint = process.argv[2];
if (!endpoint) throw new Error("CDP endpoint is required");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(action, message, timeout = 30_000) {
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
let id = 0;
const pending = new Map();
socket.onmessage = ({ data }) => {
  const message = JSON.parse(data);
  const entry = pending.get(message.id);
  if (!entry) return;
  pending.delete(message.id);
  message.error ? entry.reject(new Error(message.error.message)) : entry.resolve(message.result);
};
const request = (method, params = {}) => new Promise((resolve, reject) => {
  const requestId = ++id;
  const timer = setTimeout(() => { pending.delete(requestId); reject(new Error(`${method} timed out`)); }, 20_000);
  pending.set(requestId, {
    resolve: (value) => { clearTimeout(timer); resolve(value); },
    reject: (error) => { clearTimeout(timer); reject(error); },
  });
  socket.send(JSON.stringify({ id: requestId, method, params }));
});
const evaluate = async (expression) => {
  const result = await request("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result?.value;
};

try {
  await request("Page.bringToFront");
  await waitFor(() => evaluate("Boolean(window.grokDesktop && document.querySelector('.app-shell'))"), "Application shell did not render");
  const bootstrap = await evaluate("window.grokDesktop.bootstrap().then(value => ({ appVersion: value.appVersion, channel: value.buildInfo?.channel }))");
  if (bootstrap.appVersion !== "0.6.4") throw new Error(`Main process reported ${bootstrap.appVersion}`);
  await evaluate("document.querySelector('.sidebar-footer button[title=\"版本与更新\"]')?.click(); true");
  await waitFor(() => evaluate("document.querySelector('.control-panel .about')?.innerText.includes('Grok Build Desktop 0.6.4')"), "About panel did not report 0.6.4");
  await evaluate(`(() => { [...document.querySelectorAll('.control-panel button')].find(node => node.textContent?.trim() === '兼容诊断中心')?.click(); return true; })()`);
  await waitFor(() => evaluate("Boolean(document.querySelector('.diagnostics-panel'))"), "Diagnostics panel did not open");
  await waitFor(() => evaluate("Boolean(document.querySelector('.diagnostic-overall:not(.checking)'))"), "Diagnostics did not complete", 45_000);
  const diagnostics = await evaluate(`({ heading: document.querySelector('.diagnostics-panel h2')?.textContent || '', overall: document.querySelector('.diagnostic-overall')?.textContent || '', supportPreview: document.querySelector('.support-preview')?.innerText || '' })`);
  if (diagnostics.heading !== "兼容诊断中心" || !diagnostics.overall.trim()) throw new Error(`Diagnostics surface incomplete: ${JSON.stringify(diagnostics)}`);
  if (!diagnostics.supportPreview.includes("会话附件正文") || !diagnostics.supportPreview.includes("完整路径")) throw new Error("Support-bundle exclusions are missing attachment privacy fields");
  console.log(JSON.stringify({
    ok: true,
    mainProcessVersion: bootstrap.appVersion,
    aboutVersion: "0.6.4",
    channel: bootstrap.channel,
    diagnostics: diagnostics.overall.trim(),
    supportBundleAttachmentExclusion: true,
  }, null, 2));
} finally {
  socket.close();
}
