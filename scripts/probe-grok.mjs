import { spawn } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";

const argv = process.argv.slice(2);
const valueAfter = (name) => {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
};
const cliPath = valueAfter("--cli") || join(homedir(), ".grok", "bin", process.platform === "win32" ? "grok.exe" : "grok");
const cwd = resolve(valueAfter("--cwd") || join(tmpdir(), `grok-build-desktop-probe-${process.pid}-${Date.now()}`));
const effort = valueAfter("--effort");
const mode = valueAfter("--mode");
const cleanup = !argv.includes("--keep");
const requireMedia = argv.includes("--require-media");
const requireExtensions = argv.includes("--require-extensions");
const pluginDir = valueAfter("--plugin-dir");
await mkdir(cwd, { recursive: true });

// Pass plugin directories in both places: current Grok builds accept the
// session-level metadata, while older/changed builds may only honor the
// process-level flag. Keeping the flag before `stdio` is required by the CLI.
const agentArgs = ["--no-auto-update", "agent", ...(pluginDir ? ["--plugin-dir", resolve(pluginDir)] : []), "stdio"];
const child = spawn(cliPath, agentArgs, {
  cwd,
  env: process.env,
  windowsHide: true,
  stdio: ["pipe", "pipe", "pipe"],
});
const lines = createInterface({ input: child.stdout });
let nextId = 1;
let stderr = "";
const notifications = [];
const pending = new Map();
child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });

function write(message) {
  child.stdin.write(`${JSON.stringify(message)}\n`);
}

function request(method, params, timeoutMs = 120_000) {
  const id = nextId++;
  return new Promise((resolveRequest, rejectRequest) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      rejectRequest(new Error(`ACP request timed out: ${method}`));
    }, timeoutMs);
    pending.set(id, { resolveRequest, rejectRequest, timer });
    write({ jsonrpc: "2.0", id, method, params });
  });
}

async function optionalRequest(method, params) {
  try { return { ok: true, value: await request(method, params) }; }
  catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) }; }
}

lines.on("line", (line) => {
  let message;
  try { message = JSON.parse(line); } catch { return; }
  if (message.id !== undefined && (message.result !== undefined || message.error !== undefined)) {
    const item = pending.get(message.id);
    if (!item) return;
    pending.delete(message.id);
    clearTimeout(item.timer);
    if (message.error) item.rejectRequest(new Error(message.error.message || JSON.stringify(message.error)));
    else item.resolveRequest(message.result);
    return;
  }
  if (message.id !== undefined && message.method) {
    // The compatibility probe must never leave a new private request waiting.
    write({ jsonrpc: "2.0", id: message.id, result: {} });
  } else if (message.method) {
    notifications.push(message);
  }
});

const exited = new Promise((resolveExit) => child.once("exit", (code) => resolveExit(code)));
child.once("error", (error) => {
  for (const item of pending.values()) {
    clearTimeout(item.timer);
    item.rejectRequest(error);
  }
  pending.clear();
});

let sessionId = "";
try {
  await Promise.race([
    request("initialize", {
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: true },
    }),
    exited.then((code) => { throw new Error(`Grok exited during initialize (${code}): ${stderr.trim()}`); }),
  ]);
  const created = await Promise.race([
    request("session/new", { cwd, mcpServers: [], ...(pluginDir ? { _meta: { pluginDirs: [resolve(pluginDir)] } } : {}) }),
    exited.then((code) => { throw new Error(`Grok exited during session/new (${code}): ${stderr.trim()}`); }),
  ]);
  sessionId = typeof created?.sessionId === "string" ? created.sessionId : "";
  if (!sessionId) throw new Error("session/new did not return a sessionId");
  // The probe session is ephemeral, so this is a non-destructive way to
  // detect the official title authority without touching a user conversation.
  const renameProbe = await optionalRequest("x.ai/session/rename", {
    sessionId,
    title: "Desktop compatibility probe",
    cwd,
    kind: "build",
  });
  let modeSwitch;
  if (mode) {
    if (mode !== "plan" && mode !== "default") throw new Error(`Unsupported probe mode: ${mode}`);
    modeSwitch = await request("session/set_mode", { sessionId, modeId: mode });
  }
  await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  const availableCommands = notifications
    .filter((value) => value.params?.update?.sessionUpdate === "available_commands_update")
    .flatMap((value) => value.params.update.availableCommands ?? [])
    .map((value) => String(value.name || "").replace(/^\//, ""));
  const advertisedTools = notifications
    .filter((value) => value.params?.update?.sessionUpdate === "available_commands_update")
    .flatMap((value) => value.params.update?._meta?.tools ?? value.params.update?.meta?.tools ?? [])
    .map((value) => typeof value === "string" ? value : String(value?.name || value?.toolName || value?.tool_name || ""))
    .filter(Boolean);
  const mediaCommands = [...new Set(availableCommands.filter((value) => {
    const leaf = value.split(":").at(-1);
    return leaf === "imagine" || leaf === "imagine-video";
  }))];
  const directVideoCommand = mediaCommands.find((value) => value.split(":").at(-1) === "imagine-video");
  const imageCommand = mediaCommands.find((value) => value.split(":").at(-1) === "imagine");
  const videoTools = [...new Set(advertisedTools.filter((value) => ["video_gen", "image_to_video", "reference_to_video"].includes(value)))];
  const videoStrategy = directVideoCommand
    ? directVideoCommand
    : videoTools.length
      ? videoTools.join(",")
      : imageCommand
      ? `${imageCommand}:image_to_video`
      : undefined;
  if (requireMedia && (!imageCommand && !advertisedTools.includes("image_gen"))) {
    throw new Error(`Grok CLI did not publish a usable Imagine workflow (commands: ${mediaCommands.join(", ") || "none"}; tools: ${advertisedTools.join(", ") || "none"})`);
  }
  let extensionProbe;
  if (requireExtensions) {
    const [pluginsResult, mcpResult, commandsResult] = await Promise.all([
      optionalRequest("x.ai/plugins/list", { sessionId }),
      optionalRequest("x.ai/mcp/list", { sessionId, cache: false }),
      optionalRequest("x.ai/commands/list", { sessionId }),
    ]);
    const plugins = pluginsResult.value; const mcp = mcpResult.value; const commands = commandsResult.value;
    const pluginNames = Array.isArray(plugins?.plugins) ? plugins.plugins.map((value) => value.name) : [];
    if (pluginDir && !pluginNames.includes("grok-desktop-computer-use") && !availableCommands.includes("computer")) throw new Error(`session/new _meta.pluginDirs did not expose /computer (${pluginNames.join(", ")}; commands=${availableCommands.join(", ")})`);
    extensionProbe = { pluginNames, computerCommand: availableCommands.includes("computer"), mcpServers: Array.isArray(mcp?.servers) ? mcp.servers.length : undefined, commands: Array.isArray(commands?.commands) ? commands.commands.length : undefined, privateMethods: { plugins: pluginsResult.ok, mcp: mcpResult.ok, commands: commandsResult.ok }, diagnostics: [pluginsResult.error, mcpResult.error, commandsResult.error].filter(Boolean) };
  }
  let effortSwitch;
  if (effort) {
    const modelId = created?.models?.currentModelId;
    if (!modelId) throw new Error("session/new did not return a current model for effort probing");
    effortSwitch = await request("session/set_model", { sessionId, modelId, _meta: { reasoningEffort: effort } });
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
    const confirmed = notifications.some((value) => value.method === "_x.ai/session_notification"
      && value.params?.update?.sessionUpdate === "model_changed"
      && value.params?.update?.reasoning_effort === effort);
    if (!confirmed) throw new Error(`session/set_model did not confirm reasoning effort ${effort}`);
  }
  process.stdout.write(`${JSON.stringify({ ok: true, cliPath, cwd, sessionId, renameProbe: { supported: renameProbe.ok, ...(renameProbe.error ? { error: renameProbe.error } : {}) }, mode, modeSwitch, effort, effortSwitch, availableCommands, mediaCommands, mediaTools: [...new Set(advertisedTools)], videoStrategy, extensionProbe, notifications: notifications.filter((value) => {
    const update = value.params?.update;
    return value.method === "_x.ai/session_notification" && (update?.sessionUpdate === "model_changed" || update?.sessionUpdate === "current_mode_update");
  }).slice(-5) })}\n`);
} finally {
  lines.close();
  if (!child.killed) {
    if (process.platform === "win32" && child.pid) {
      await new Promise((resolveKill) => {
        const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
        killer.once("exit", resolveKill); killer.once("error", resolveKill);
      });
    } else child.kill();
  }
  await Promise.race([exited, new Promise((resolveWait) => setTimeout(resolveWait, 2_000))]);
  if (cleanup) {
    await rmRetry(join(homedir(), ".grok", "sessions", encodeURIComponent(cwd)));
    await rmRetry(cwd);
  }
}

async function rmRetry(path) {
  let last;
  for (let attempt = 0; attempt < 6; attempt++) {
    try { await rm(path, { recursive: true, force: true, maxRetries: 3, retryDelay: 150 }); return; }
    catch (error) { last = error; await new Promise((resolveWait) => setTimeout(resolveWait, 250 * (attempt + 1))); }
  }
  throw last;
}
