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
  timeoutMs?: number;
  windowsVerbatimArguments?: boolean;
  onSpawn?(child: ChildProcessWithoutNullStreams): void;
  onProgress?(): void;
}

export function buildCliMediaArgs(prompt: string, transientSessionId: string, toolList: string): string[] {
  return ["--single", prompt, "--session-id", transientSessionId, "--output-format", "streaming-json", "--always-approve", "--tools", toolList];
}

/**
 * Runs the fixed-argument Grok CLI media command and accepts only concrete
 * artifacts found in streaming-json. It is Electron-independent so timeout,
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
  let pending = "";
  let stderr = "";
  let timedOut = false;
  const collectLine = (line: string): void => {
    for (const artifact of mediaArtifactsFromStreamingLine(line, input.media, input.cwd)) {
      if (!artifacts.some((value) => value.source === artifact.source)) artifacts.push(artifact);
    }
  };
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    pending += chunk;
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() ?? "";
    for (const line of lines) collectLine(line);
    if (pending.length > 1024 * 1024) pending = pending.slice(-1024 * 1024);
    input.onProgress?.();
  });
  child.stderr.on("data", (chunk: string) => { stderr = `${stderr}${chunk}`.slice(-100_000); });
  const abort = (): void => { if (!child.killed) child.kill(); };
  input.signal.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(() => {
    timedOut = true;
    if (!child.killed) child.kill();
  }, Math.max(1, input.timeoutMs ?? 600_000));
  timeout.unref?.();
  try {
    const exitCode = await new Promise<number | null>((resolveExit, reject) => {
      child.once("error", reject);
      child.once("exit", resolveExit);
    });
    if (pending.trim()) collectLine(pending);
    if (input.signal.aborted) throw abortReason(input.signal);
    if (timedOut) throw new Error(`媒体任务超过 ${Math.ceil((input.timeoutMs ?? 600_000) / 1000)} 秒`);
    if (exitCode !== 0) throw new Error(mediaCliFailureMessage(stderr) || `Grok CLI 媒体任务退出（${String(exitCode)}）`);
    if (!artifacts.length) throw new Error(mediaCliFailureMessage(stderr) || "Grok CLI 已结束，但 streaming-json 中没有可识别的媒体产物");
    return artifacts;
  } finally {
    clearTimeout(timeout);
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
