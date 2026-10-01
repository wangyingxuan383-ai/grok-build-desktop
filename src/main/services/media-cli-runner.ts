import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { MediaArtifact, MediaCreationKind, TurnUsage } from "../../shared/types";
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
  onProgress?(progress?: { stage: "starting" | "generating" | "waiting" | "result"; message: string }): void;
  /** Invocation-final ledger only; per-message usage is not accumulated again. */
  onUsage?(usage: TurnUsage): void;
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
  const idleTimeoutMs = input.idleTimeoutMs === undefined ? 180_000 : input.idleTimeoutMs;
  let lastOutputAt = Date.now();
  let stage: "starting" | "generating" | "result" = "starting";
  const waitingTimer=setInterval(()=>{const seconds=Math.floor((Date.now()-lastOutputAt)/1000);if(seconds>=30)input.onProgress?.({stage:"waiting",message:`已等待 ${seconds} 秒没有新输出。CLI 未报告排队原因；可检查登录、网络或取消任务，不会自动重新提交。`});},10_000);
  waitingTimer.unref?.();
  input.onProgress?.({stage, message:"正在启动 CLI 并验证会话，尚未开始生成"});
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
      if (event?.type === "tool_use" && /^(image_gen|image_edit|video_gen)$/.test(event.name ?? event.tool ?? "")) {
        stage="generating";input.onProgress?.({stage,message:`CLI 已调用 ${event.name ?? event.tool}，等待生成服务返回`});
      }
      const usage = cliMediaTurnUsage(event);
      if (usage) input.onUsage?.(usage);
      if (event?.type === "error" && typeof event.message === "string" && event.message.trim()) {
        terminalError ??= mediaCliFailureMessage(event.message.trim().slice(0, 8_000));
        if (!child.killed) child.kill();
        return;
      }
    } catch { /* Non-JSON progress is not a protocol error. */ }
    for (const artifact of mediaArtifactsFromStreamingLine(line, input.media, input.cwd, { exclude: input.excludeSources, toolIdentities })) {
      if (!artifacts.some((value) => value.source === artifact.source)) { artifacts.push(artifact); stage="result";input.onProgress?.({stage,message:"生成服务已返回媒体路径，正在校验和保存原图"}); }
    }
  };
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    lastOutputAt=Date.now();armIdleTimer();
    pending += chunk;
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() ?? "";
    for (const line of lines) collectLine(line);
    if (pending.length > 1024 * 1024) pending = pending.slice(-1024 * 1024);
    input.onProgress?.({stage,message:stage==="generating"?"媒体工具正在运行，等待图片返回":stage==="result"?"已收到媒体结果，正在完成保存":"CLI 已有响应，等待媒体工具调用"});
  });
  child.stderr.on("data", (chunk: string) => {
    lastOutputAt=Date.now();armIdleTimer();
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
    if (timedOut) throw new Error(`媒体任务连续 ${Math.ceil((idleTimeoutMs ?? 0) / 1000)} 秒没有输出，已停止等待。CLI 未提供排队状态；请检查账号和网络后手动重试，避免重复生成。`);
    if (exitCode !== 0) throw new Error(mediaCliFailureMessage(stderr) || `Grok CLI 媒体任务退出（${String(exitCode)}）`);
    if (!artifacts.length) throw new Error(mediaCliFailureMessage(stderr) || "Grok CLI 已结束，但 streaming-json 中没有可识别的媒体产物");
    return artifacts;
  } finally {
    if (idleTimer) clearTimeout(idleTimer);
    clearInterval(waitingTimer);
    input.signal.removeEventListener("abort", abort);
  }
}

/** The official streaming-json `end` event reports the current invocation's ledger. */
export function cliMediaTurnUsage(event: unknown): TurnUsage | undefined {
  if (!event || typeof event !== "object") return undefined;
  const row=event as Record<string,unknown>;
  if(row.type!=="end"||!row.usage||typeof row.usage!=="object")return undefined;
  const raw=row.usage as Record<string,unknown>,result:TurnUsage={source:"prompt-result",exact:true};
  for(const [key,snake]of [["inputTokens","input_tokens"],["outputTokens","output_tokens"],["totalTokens","total_tokens"],["cachedReadTokens","cached_read_tokens"],["reasoningTokens","reasoning_tokens"]] as const){
    const value=raw[key]??raw[snake];
    if(typeof value==="number"&&Number.isFinite(value)&&value>=0)result[key]=value;
  }
  if(!Object.keys(result).some(key=>key.endsWith("Tokens")))return undefined;
  const models=row.modelUsage&&typeof row.modelUsage==="object"?Object.keys(row.modelUsage):[];
  if(models.length===1)result.modelId=models[0];
  return result;
}

export function mediaCliFailureMessage(stderr: string): string {
  const plain = stderr.replace(/\u001b\[[0-9;]*m/g, "").trim();
  if (!plain) return "";
  if (/Zero Data Retention teams must provide output\.upload_url/i.test(plain)) {
    return "Zero Data Retention teams must provide output.upload_url for video generation.";
  }
  if (/authentication required|unauthorized|token.{0,30}expired|\b401\b|暂时无法验证订阅/i.test(plain)) return `账号认证或订阅验证失败，请先重新登录再生成。${plain.slice(-500)}`;
  if (/rate.?limit|too many requests|\b429\b|quota|usage limit|额度|限流/i.test(plain)) return `生成服务报告限流或额度不足，请检查官方用量并稍后手动重试。${plain.slice(-500)}`;
  if (/ECONN|ENOTFOUND|network|connect.{0,20}timeout|proxy/i.test(plain)) return `生成服务连接失败，请检查代理和网络。${plain.slice(-500)}`;
  const lines = plain.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return lines.at(-1)?.slice(0, 2_000) || "";
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error("媒体任务已取消");
}
