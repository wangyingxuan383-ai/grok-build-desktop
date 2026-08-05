import { execFile } from "node:child_process";

const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;

export interface CliSessionDeleteResult {
  sessionId: string;
  deleted: boolean;
  message: string;
}

/**
 * Deletes the CLI-owned session through the public command surface. Desktop
 * state must only be removed after this succeeds; callers may expose an
 * explicit local-only cleanup separately, but must never silently fall back to
 * deleting ~/.grok/session files.
 */
export function deleteCliSession(
  cliPath: string,
  sessionId: string,
  env: NodeJS.ProcessEnv,
  timeoutMs = 60_000,
  run: (cliPath: string, args: string[], env: NodeJS.ProcessEnv, timeoutMs: number) => Promise<{ stdout: string; stderr: string }> = runDeleteCommand,
): Promise<CliSessionDeleteResult> {
  if (!SESSION_ID.test(sessionId)) return Promise.reject(new Error("会话 ID 格式无效，拒绝调用 CLI 删除"));
  return run(cliPath, ["--no-auto-update", "sessions", "delete", sessionId], env, timeoutMs).then(({ stdout, stderr }) => ({
    sessionId,
    deleted: true,
    message: String(stdout || stderr || "会话已由 Grok CLI 删除").trim(),
  }));
}

function runDeleteCommand(cliPath: string, args: string[], env: NodeJS.ProcessEnv, timeoutMs: number): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(cliPath, args, {
      env,
      windowsHide: true,
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024,
    }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`Grok CLI 未能删除会话：${String(stderr || stdout || error.message).trim()}`));
        return;
      }
      resolve({ stdout: String(stdout), stderr: String(stderr) });
    });
  });
}
