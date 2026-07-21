const endpoint = process.argv[2];
if (!endpoint) throw new Error("CDP endpoint is required");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(action, message, timeout = 15_000) { const end = Date.now() + timeout; while (Date.now() < end) { try { const value = await action(); if (value) return value; } catch {} await sleep(120); } throw new Error(message); }
const target = await waitFor(async () => (await fetch(`${endpoint}/json/list`).then((value) => value.json())).find((value) => value.type === "page"), "Renderer target unavailable");
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let id = 0; const pending = new Map();
socket.onmessage = ({ data }) => { const value = JSON.parse(data); const entry = pending.get(value.id); if (!entry) return; pending.delete(value.id); value.error ? entry.reject(new Error(value.error.message)) : entry.resolve(value.result); };
const evaluate = (expression) => new Promise((resolve, reject) => { const requestId = ++id; pending.set(requestId, { resolve: (result) => { if (result.exceptionDetails) reject(new Error(result.exceptionDetails.text)); else resolve(result.result?.value); }, reject }); socket.send(JSON.stringify({ id: requestId, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } })); });
try {
  await waitFor(() => evaluate("Boolean(document.querySelector('.session-list'))"), "Sidebar did not render");
  const headings = await evaluate("[...document.querySelectorAll('.session-list .session-group-heading')].map((node) => node.textContent.trim())");
  if (!headings.some((value) => value.includes("任务会话")) || !headings.some((value) => value.includes("Codex 接力"))) throw new Error(`Source groups are missing: ${JSON.stringify(headings)}`);
  await evaluate(`(() => { [...document.querySelectorAll('.session-list .session-group-heading')].find((node) => node.textContent.includes('任务会话'))?.click(); return true; })()`);
  await waitFor(() => evaluate("document.querySelector('.session-source-badge.automation')?.textContent === '任务'"), "Automation source badge did not render");
  await evaluate(`(() => { [...document.querySelectorAll('.session-list .session-group-heading')].find((node) => node.textContent.includes('Codex 接力'))?.click(); return true; })()`);
  const codex = await waitFor(() => evaluate(`(() => { const badge = document.querySelector('.session-source-badge.codex-continuation'); return badge ? { badge: badge.textContent, title: badge.closest('.session-copy')?.querySelector('strong')?.childNodes[0]?.textContent } : null; })()`), "Codex continuation did not render");
  if (codex.badge !== "Codex 接力" || codex.title !== "原 Codex 会话标题") throw new Error(`Codex title/source mismatch: ${JSON.stringify(codex)}`);
  console.log(JSON.stringify({ ok: true, groups: ["任务会话", "Codex 接力"], codexTitlePreserved: true }));
} finally { socket.close(); }
