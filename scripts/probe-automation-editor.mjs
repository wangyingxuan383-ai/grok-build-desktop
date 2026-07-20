const endpoint = process.argv[2];
if (!endpoint) throw new Error("CDP endpoint is required");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(action, message, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const result = await action();
      if (result) return result;
    } catch (error) {
      lastError = error;
    }
    await sleep(120);
  }
  throw new Error(`${message}${lastError ? `: ${lastError.message}` : ""}`);
}

const target = await waitFor(
  async () => (await fetch(`${endpoint}/json/list`).then((response) => response.json())).find((item) => item.type === "page"),
  "Renderer target unavailable",
);
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
const request = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++requestId;
  const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, 10_000);
  pending.set(id, {
    resolve: (value) => { clearTimeout(timer); resolve(value); },
    reject: (error) => { clearTimeout(timer); reject(error); },
  });
  socket.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => {
  const result = await request("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result?.value;
};

try {
  await request("Page.bringToFront");
  await waitFor(() => evaluate("Boolean(document.querySelector('.task-entry'))"), "Task-center entry did not render");
  await evaluate("document.querySelector('.task-entry').click(); true");
  await waitFor(() => evaluate("Boolean(document.querySelector('#overlay-root .task-center'))"), "Task center did not open");
  await evaluate(`(() => { const button = [...document.querySelectorAll('.task-center-actions button')].find((item) => item.textContent.includes('新建持久任务')); button?.click(); return Boolean(button); })()`);
  await waitFor(() => evaluate("document.querySelectorAll('.automation-option').length === 3"), "Automation option cards did not render");
  await evaluate("document.querySelector('.automation-options').scrollIntoView({ block: 'center' }); true");
  await sleep(150);
  const result = await evaluate(`(() => {
    const panel = document.querySelector('.task-center');
    const group = document.querySelector('.automation-options');
    const cards = [...document.querySelectorAll('.automation-option')];
    const panelRect = panel.getBoundingClientRect();
    return {
      count: cards.length,
      groupDisplay: getComputedStyle(group).display,
      labels: cards.map((card) => ({
        title: card.querySelector('strong')?.textContent,
        description: card.querySelector('small')?.textContent,
        inputType: card.querySelector('input')?.type,
        display: getComputedStyle(card).display,
        alignItems: getComputedStyle(card).alignItems,
        rect: (() => { const value = card.getBoundingClientRect(); return { left: value.left, top: value.top, right: value.right, bottom: value.bottom }; })(),
      })),
      panel: { left: panelRect.left, top: panelRect.top, right: panelRect.right, bottom: panelRect.bottom },
      viewport: { width: innerWidth, height: innerHeight },
    };
  })()`);
  const expected = ["允许 Computer Use", "允许唤醒设备", "显示完成通知"];
  if (result.count !== 3 || result.groupDisplay !== "grid") throw new Error(`Invalid option group: ${JSON.stringify(result)}`);
  result.labels.forEach((item, index) => {
    if (item.title !== expected[index] || !item.description || item.inputType !== "checkbox" || item.display !== "flex") {
      throw new Error(`Malformed option card: ${JSON.stringify(item)}`);
    }
    if (item.rect.left < result.panel.left || item.rect.right > result.panel.right || item.rect.top < result.panel.top || item.rect.bottom > result.panel.bottom) {
      throw new Error(`Option card escaped task panel: ${JSON.stringify(item.rect)}`);
    }
  });
  console.log(JSON.stringify({ ok: true, taskEditorOptions: expected, layout: "three aligned cards" }));
} finally {
  socket.close();
}
