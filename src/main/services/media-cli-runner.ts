import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { MediaArtifact, MediaCreationKind } from "../../shared/types";
import { mediaArtifactsFromStreamingLine } from "./media-artifact-parser";

export interface CliMediaProcessInput {
  executable: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  media: MediaCreationKind;
  signal: AbortSignal;
  /** Stops only a silent/stalled process. null disables inactivity recovery. */
  idleTimeoutMs?: number | null;
  windowsVerbatimArguments?: boolean;
  /** Reference images passed to the tool; never accepted as generated results. */
  excludeSources?: readonly string[];
  onSpawn?(child: ChildProcessWithoutNullStreams): void;
  onProgress?(): void;
}

/**
 * `resume` continues an existing CLI session (an image conversation's later turns) instead of
 * starting the one named by `sessionId`, so the model keeps the earlier prompts and results.
 */
export function buildCliMediaArgs(prompt: string, sessionId: string, toolList: string, resume = false): string[] {
  return ["--no-auto-update", "--single", prompt, resume ? "--resume" : "--session-id", sessionId, "--output-format", "streaming-json", "--always-approve", "--tools", toolList];
}

/**
 * Runs the fixed-argument Grok CLI media command and accepts only concrete
 * artifacts found in streaming-json. It is Electron-independent so inactivity,
 * cancellation and parsing can be exercised against a local fake CLI.
 */
export async function runCliMediaProcess(input: CliMediaProcessInput): Promise<MediaArtifact[]> {
  if (input.signal.aborted) throw abortReason(input.signal);
  const child = spawn(input.executable, input.args, {
    cwd: input.cwd,
    windowsHide: true,
    windowsVerbatimArguments: input.windowsVerbatimArguments,
    shell: false,
    env: input.env,
  });
  input.onSpawn?.(child);
  const artifacts: MediaArtifact[] = [];
  const toolIdentities = new Map<string, string>();
  let pending = "";
  let stderr = "";
  let timedOut = false;
  let terminalError: string | undefined;
  let idleTimer: NodeJS.Timeout | undefined;
  const idleTimeoutMs = input.idleTimeoutMs === undefined ? 600_000 : input.idleTimeoutMs;
  // Process startup (especially a packaged Node/Electron child) can take
  // longer than a deliberately small test/inactivity interval. Give a
  // silent child a bounded startup grace period, then apply the configured
  // inactivity timeout after the first byte. This is not a wall-clock
  // ceiling: continuous stdout/stderr keeps extending the idle timer.
  const startupGraceMs = idleTimeoutMs === null ? null : Math.max(idleTimeoutMs, 1_000);
  const armIdleTimer = (): void => {
    if (idleTimer) clearTimeout(idleTimer);
    if (idleTimeoutMs === null) return;
    idleTimer = setTimeout(() => {
      timedOut = true;
      if (!child.killed) child.kill();
    }, Math.max(1, idleTimeoutMs));
    idleTimer.unref?.();
  };
  const collectLine = (line: string): void => {
    // The official headless emitter's top-level error is terminal. Do not
    // infer failure from assistant text or a recoverable tool_result.
    try {
      const event = JSON.parse(line);
      if (event?.type === "error" && typeof event.message === "string" && event.message.trim()) {
        terminalError ??= event.message.trim().slice(0, 8_000);
        if (!child.killed) child.kill();
        return;
      }
    } catch { /* Non-JSON progress is not a protocol error. */ }
    for (const artifact of mediaArtifactsFromStreamingLine(line, input.media, input.cwd, { exclude: input.excludeSources, toolIdentities })) {
      if (!artifacts.some((value) => value.source === artifact.source)) artifacts.push(artifact);
    }
  };
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    armIdleTimer();
    pending += chunk;
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() ?? "";
    for (const line of lines) collectLine(line);
    if (pending.length > 1024 * 1024) pending = pending.slice(-1024 * 1024);
    input.onProgress?.();
  });
  child.stderr.on("data", (chunk: string) => {
    armIdleTimer();
    stderr = `${stderr}${chunk}`.slice(-100_000);
  });
  const abort = (): void => { if (!child.killed) child.kill(); };
  input.signal.addEventListener("abort", abort, { once: true });
  if (startupGraceMs !== null) {
    idleTimer = setTimeout(() => {
      timedOut = true;
      if (!child.killed) child.kill();
    }, Math.max(1, startupGraceMs));
    idleTimer.unref?.();
  }
  try {
    const exitCode = await new Promise<number | null>((resolveExit, reject) => {
      child.once("error", reject);
      child.once("close", resolveExit);
    });
    if (pending.trim()) collectLine(pending);
    if (input.signal.aborted) throw abortReason(input.signal);
    if (terminalError) throw new Error(terminalError);
    if (timedOut) throw new Error(`媒体任务连续 ${Math.ceil((idleTimeoutMs ?? 0) / 1000)} 秒没有输出`);
    if (exitCode !== 0) throw new Error(mediaCliFailureMessage(stderr) || `Grok CLI 媒体任务退出（${String(exitCode)}）`);
    if (!artifacts.length) throw new Error(mediaCliFailureMessage(stderr) || "Grok CLI 已结束，但 streaming-json 中没有可识别的媒体产物");
    return artifacts;
  } finally {
    if (idleTimer) clearTimeout(idleTimer);
    input.signal.removeEventListener("abort", abort);
  }
}

export function mediaCliFailureMessage(stderr: string): string {
  const plain = stderr.replace(/\u001b\[[0-9;]*m/g, "").trim();
  if (!plain) return "";
  if (/Zero Data Retention teams must provide output\.upload_url/i.test(plain)) {
    return "Zero Data Retention teams must provide output.upload_url for video generation.";
  }
  const lines = plain.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return lines.at(-1)?.slice(0, 2_000) || "";
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error("媒体任务已取消");
}
