const endpoint = process.argv[2];
const workspace = process.argv[3];
if (!endpoint || !workspace || process.argv[4] !== "--confirm-live") {
  throw new Error("Usage: node scripts/probe-live-automation.mjs <cdp-endpoint> <workspace> --confirm-live");
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(action, message, timeout = 60_000) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try { const value = await action(); if (value) return value; } catch (error) { lastError = error; }
    await sleep(500);
  }
  throw new Error(`${message}${lastError ? `: ${lastError.message}` : ""}`);
}

const target = await waitFor(async () => (await fetch(`${endpoint}/json/list`).then((response) => response.json())).find((item) => item.type === "page"), "Renderer target unavailable");
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
const request = (method, params = {}, timeout = 30_000) => new Promise((resolve, reject) => {
  const id = ++requestId;
  const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, timeout);
  pending.set(id, { resolve: (value) => { clearTimeout(timer); resolve(value); }, reject: (error) => { clearTimeout(timer); reject(error); } });
  socket.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression, timeout = 30_000) => {
  const result = await request("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, timeout);
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result?.value;
};

let taskId;
let sessionId;
try {
  const bootstrap = await evaluate("window.grokDesktop.bootstrap()", 60_000);
  const account = bootstrap.accounts.find((item) => item.active && item.kind === "oauth") || bootstrap.accounts.find((item) => item.active);
  if (!account) throw new Error("No active Grok account is available for the live automation probe");
  const marker = `Grok Desktop 实际任务验收 ${Date.now()}`;
  const taskInput = {
    name: marker,
    workspace,
    prompt: "使用文件读取工具读取当前工作区 package.json 的 version 字段，然后仅回复 TASK_OK:<version>。不要修改任何文件。",
    schedule: { kind: "once", at: new Date(Date.now() + 24 * 60 * 60_000).toISOString() },
    profile: { accountId: account.id, modelId: "grok-4.5", effort: "low", mode: "auto", permissionPolicy: "agent", computerEnabled: false },
    enabled: true,
    wakeToRun: false,
    notify: false,
    missedRunPolicy: "skip",
    contextPolicy: "reuse",
  };
  const tasks = await evaluate(`window.grokDesktop.createAutomation(${JSON.stringify(taskInput)})`, 60_000);
  const task = tasks.find((item) => item.name === marker);
  if (!task) throw new Error("Live automation task was not created");
  taskId = task.id;
  const runOnce = async () => {
    const queued = await evaluate(`window.grokDesktop.runAutomationNow(${JSON.stringify(taskId)})`, 60_000);
    const terminal = await waitFor(async () => {
      const runs = await evaluate(`window.grokDesktop.listAutomationRuns(${JSON.stringify(taskId)})`, 60_000);
      const run = runs.find((item) => item.id === queued.id);
      return run && ["completed", "failed", "cancelled", "skipped"].includes(run.status) ? run : undefined;
    }, "Live automation did not reach a terminal state", 10 * 60_000);
    if (terminal.status !== "completed" || !terminal.sessionId) throw new Error(`Live automation failed: ${terminal.status}: ${terminal.error || "missing session"}`);
    return terminal;
  };
  const first = await runOnce();
  const second = await runOnce();
  if (first.sessionId !== second.sessionId) throw new Error(`Task did not reuse its session: ${first.sessionId} != ${second.sessionId}`);
  sessionId = second.sessionId;
  const storedTask = (await evaluate("window.grokDesktop.listAutomations()", 60_000)).find((item) => item.id === taskId);
  if (storedTask?.sessionId !== sessionId || storedTask?.contextPolicy !== "reuse") throw new Error("Task did not persist the reusable session mapping");

  // Open the real generated session and probe the installed CLI's optional
  // rewind extension. Unsupported versions must return an empty list, not a
  // rejected IPC call/global error toast.
  await evaluate(`window.grokDesktop.openSession(${JSON.stringify(workspace)}, ${JSON.stringify(sessionId)})`, 120_000);
  const rewindPoints = await evaluate(`window.grokDesktop.listRewindPoints(${JSON.stringify(sessionId)})`, 60_000);
  if (!Array.isArray(rewindPoints)) throw new Error("Rewind capability probe did not return an array");
  const visibleGlobalError = await evaluate("Boolean(document.querySelector('.error-toast'))");
  if (visibleGlobalError) throw new Error("Optional rewind probe surfaced a global error toast");

  await evaluate(`window.grokDesktop.clearAutomationContext(${JSON.stringify(taskId)})`, 60_000);
  const clearedTask = (await evaluate("window.grokDesktop.listAutomations()", 60_000)).find((item) => item.id === taskId);
  if (clearedTask?.sessionId) throw new Error("Manual task-context cleanup retained the session mapping");
  sessionId = undefined;
  console.log(JSON.stringify({ ok: true, marker, runsCompleted: 2, sessionReused: true, contextCleared: true, rewindProbe: "no-global-error", rewindPoints: rewindPoints.length }));
} finally {
  try { if (sessionId) await evaluate(`window.grokDesktop.deleteSession(${JSON.stringify(workspace)}, ${JSON.stringify(sessionId)})`, 60_000); } catch {}
  try { if (taskId) await evaluate(`window.grokDesktop.deleteAutomation(${JSON.stringify(taskId)})`, 60_000); } catch {}
  socket.close();
}
