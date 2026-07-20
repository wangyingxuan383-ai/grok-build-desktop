const endpoint = process.argv[2];
const requiredSelector = process.argv[3] || "";
if (!endpoint) throw new Error("CDP endpoint is required");

let target;
for (let attempt = 0; attempt < 30; attempt += 1) {
  try {
    const targets = await fetch(`${endpoint}/json/list`).then((response) => response.json());
    target = (Array.isArray(targets) ? targets : [targets]).find((item) => item.type === "page");
    if (target?.webSocketDebuggerUrl) break;
  } catch {
    // The debugging endpoint starts after the browser process.
  }
  await new Promise((resolve) => setTimeout(resolve, 250));
}
if (!target?.webSocketDebuggerUrl) throw new Error("Renderer debugging target did not become available");

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.onopen = resolve;
  socket.onerror = () => reject(new Error("Unable to connect to renderer debugging target"));
});

let nextId = 0;
const pending = new Map();
socket.onmessage = ({ data }) => {
  const message = JSON.parse(data);
  const resolve = pending.get(message.id);
  if (resolve) {
    pending.delete(message.id);
    resolve(message);
  }
};
const send = (method, params = {}) => new Promise((resolve) => {
  const id = ++nextId;
  pending.set(id, resolve);
  socket.send(JSON.stringify({ id, method, params }));
});

let response;
let state;
for (let attempt = 0; attempt < 80; attempt += 1) {
  response = await send("Runtime.evaluate", {
    expression: `JSON.stringify({
      location: location.href,
      title: document.title,
      readyState: document.readyState,
      hasRootContent: Boolean(document.querySelector('#root')?.children.length),
      hasAppShell: Boolean(document.querySelector('.app-shell')),
      hasSidebar: Boolean(document.querySelector('.sidebar')),
      hasMainPane: Boolean(document.querySelector('.main-pane')),
      hasComposerOrSetup: Boolean(document.querySelector('.composer, .workspace-empty, .onboarding-panel, .empty-state')),
      hasRequiredSelector: ${JSON.stringify(requiredSelector)} ? Boolean(document.querySelector(${JSON.stringify(requiredSelector)})) : true,
      bodyTextLength: document.body.innerText.length
    })`,
    returnByValue: true,
  });
  const value = response.result?.result?.value;
  state = value ? JSON.parse(value) : undefined;
  if (state?.hasAppShell && state?.hasSidebar && state?.hasMainPane && state?.hasComposerOrSetup && state?.hasRequiredSelector && state.bodyTextLength >= 10) break;
  await new Promise((resolve) => setTimeout(resolve, 250));
}
socket.close();

if (!state
  || state.location.startsWith("chrome-error:")
  || state.title !== "Grok Build Desktop"
  || !state.hasRootContent
  || !state.hasAppShell
  || !state.hasSidebar
  || !state.hasMainPane
  || !state.hasComposerOrSetup
  || !state.hasRequiredSelector
  || state.bodyTextLength < 10) {
  throw new Error(`Renderer did not render the application shell: ${JSON.stringify(state)}`);
}
console.log(`Renderer content verified: ${state.title}, ${state.bodyTextLength} visible characters`);
