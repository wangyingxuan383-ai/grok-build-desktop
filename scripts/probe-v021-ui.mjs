const argv = process.argv.slice(2);
const valueAfter = (name) => {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
};
const port = Number(valueAfter("--port") || 9331);
const base = `http://127.0.0.1:${port}`;

async function waitFor(fn, message, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`${message}${lastError ? `: ${lastError.message}` : ""}`);
}

const target = await waitFor(async () => {
  const response = await fetch(`${base}/json/list`);
  const values = await response.json();
  return values.find((value) => value.type === "page" && /Grok Build Desktop/i.test(value.title || ""));
}, "Timed out waiting for the Grok Build Desktop debugger target");

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

let nextId = 1;
const pending = new Map();
socket.addEventListener("message", (event) => {
  const message = JSON.parse(String(event.data));
  if (!message.id) return;
  const item = pending.get(message.id);
  if (!item) return;
  pending.delete(message.id);
  if (message.error) item.reject(new Error(message.error.message));
  else item.resolve(message.result);
});

function request(method, params = {}) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const result = await request("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "Renderer evaluation failed");
  return result.result?.value;
}

try {
  await request("Runtime.enable");
  await waitFor(() => evaluate("Boolean(document.querySelector('.app-shell'))"), "Application shell did not render");
  await evaluate("document.querySelector('.media-studio > header > button')?.click(); true");
  if (!await evaluate("Boolean(document.querySelector('.session-row.codex'))")) {
    await evaluate("document.querySelector('.codex-toggle')?.click(); true");
  }
  await waitFor(() => evaluate("Boolean(document.querySelector('.session-row.codex'))"), "No project-scoped Codex mirror was available");
  await evaluate("document.querySelector('.session-row.codex')?.click(); true");
  await waitFor(() => evaluate("Boolean(document.querySelector('.codex-turns .chat-turn'))"), "Codex mirror content did not render", 30_000);
  await new Promise((resolve) => setTimeout(resolve, 1_000));

  const before = await evaluate(`(() => {
    const node = document.querySelector('.codex-turns');
    const rect = node.getBoundingClientRect();
    return { scrollTop: node.scrollTop, scrollHeight: node.scrollHeight, clientHeight: node.clientHeight, overflowY: getComputedStyle(node).overflowY, x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  })()`);
  if (!(before.scrollHeight > before.clientHeight)) throw new Error(`Selected Codex mirror is not long enough for a scroll test (${before.scrollHeight}/${before.clientHeight})`);
  await request("Input.dispatchMouseEvent", { type: "mouseWheel", x: before.x, y: before.y, deltaX: 0, deltaY: 480 });
  await new Promise((resolve) => setTimeout(resolve, 250));
  const wheelTop = await evaluate("document.querySelector('.codex-turns').scrollTop");
  if (!(wheelTop > 0)) throw new Error("Mouse-wheel input did not scroll the Codex mirror");
  await evaluate(`(() => {
    const node = document.querySelector('.codex-turns');
    node.focus();
    node.scrollTop = 0;
    return true;
  })()`);
  await request("Input.dispatchKeyEvent", { type: "keyDown", key: "End", code: "End", windowsVirtualKeyCode: 35, nativeVirtualKeyCode: 35 });
  await request("Input.dispatchKeyEvent", { type: "keyUp", key: "End", code: "End", windowsVirtualKeyCode: 35, nativeVirtualKeyCode: 35 });
  await new Promise((resolve) => setTimeout(resolve, 250));
  const after = await evaluate(`(() => {
    const node = document.querySelector('.codex-turns');
    return { scrollTop: node.scrollTop, maxScrollTop: node.scrollHeight - node.clientHeight, active: document.activeElement === node };
  })()`);
  if (!(after.scrollTop > 0 && Math.abs(after.maxScrollTop - after.scrollTop) < 3)) {
    throw new Error(`Codex mirror did not reach the bottom (${JSON.stringify(after)})`);
  }

  await evaluate("document.querySelector('.media-entry')?.click(); true");
  await waitFor(() => evaluate("Boolean(document.querySelector('#media-studio-title'))"), "Media Studio did not open");
  const media = await evaluate(`(() => ({
    title: document.querySelector('#media-studio-title')?.textContent,
    tabs: [...document.querySelectorAll('.media-kind-tabs button')].map((node) => node.textContent),
    capability: document.querySelector('.media-capability')?.textContent?.trim(),
    promptFocused: document.activeElement === document.querySelector('.media-studio textarea')
  }))()`);
  if (media.title !== "Grok 媒体创作" || media.tabs.join(",") !== "图片,视频" || !media.promptFocused) {
    throw new Error(`Media Studio controls are incomplete: ${JSON.stringify(media)}`);
  }
  await evaluate("document.querySelector('.media-studio > header > button')?.click(); document.querySelector('.session-row:not(.codex)')?.click(); true");
  await waitFor(() => evaluate("Boolean(document.querySelector('.composer textarea'))"), "A Grok session did not open");
  await new Promise((resolve) => setTimeout(resolve, 500));
  await evaluate("document.querySelector('.media-entry')?.click(); true");
  const liveCapability = await waitFor(async () => {
    const text = await evaluate("document.querySelector('.media-capability')?.textContent?.trim() || ''");
    return text && !text.startsWith("提交时") ? text : "";
  }, "Live Grok session did not expose media capabilities");
  if (!/imagine|image_to_video/.test(liveCapability)) throw new Error(`Unexpected media capability: ${liveCapability}`);
  await evaluate(`(() => {
    document.querySelectorAll('.media-kind-tabs button')[1]?.click();
    const textarea = document.querySelector('.media-studio textarea');
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(textarea, '不提交的界面验证提示词');
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await waitFor(() => evaluate("Boolean(document.querySelector('.media-video-options'))"), "Video controls did not render");
  const videoForm = await evaluate(`(() => {
    const submit = [...document.querySelectorAll('.media-actions button')].at(-1);
    return {
      optionCount: document.querySelectorAll('.media-video-options select').length,
      submitText: submit?.textContent,
      submitDisabled: submit?.disabled
    };
  })()`);
  if (videoForm.optionCount !== 2 || videoForm.submitText !== "开始生成视频" || videoForm.submitDisabled) {
    throw new Error(`Video creation form is incomplete: ${JSON.stringify(videoForm)}`);
  }
  process.stdout.write(`${JSON.stringify({ ok: true, codexScroll: { before, wheelTop, after }, media, liveCapability, videoForm })}\n`);
} finally {
  socket.close();
}
