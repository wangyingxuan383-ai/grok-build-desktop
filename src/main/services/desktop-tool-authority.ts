import { createHash, randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import { cp, mkdir, writeFile, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const PROOF = "_desktopCallerProof";
interface Permit { tool: string; hash: string; expires: number }

/** Fail closed unless the CLI's PreToolUse hook identifies the bound parent session.
 * The hook rewrites the actual MCP input with a one-use proof; an inherited MCP
 * transport alone never grants child agents Desktop authority.
 */
export class DesktopToolAuthority {
  private sessionId = "";
  private readonly token = randomBytes(32).toString("hex");
  private readonly permits = new Map<string, Permit>();
  private server?: Server;
  private runtimePath?: string;
  private runtimeRoot?: string;
  observed = false;
  private verified = false;
  bind(sessionId: string): void { this.sessionId = sessionId; this.permits.clear(); this.observed = false; this.verified = false; }
  evidence(): { state: "unknown" | "hook-observed" | "verified-call"; reason: string } {
    return { state: this.verified ? "verified-call" : this.observed ? "hook-observed" : "unknown", reason: this.verified ? "当前连接已完成主会话证明校验；不代表模型端到端验收" : "当前连接尚未完成 CLI hook 与 MCP 联合校验，不能认定工具可执行" };
  }

  async plugin(source: string, runtimeRoot: string): Promise<string> {
    this.server = createServer(async (request, response) => {
      if (request.method !== "POST" || request.url !== `/${this.token}`) { response.writeHead(401).end(); return; }
      try {
        let body = "";
        for await (const chunk of request) { body += chunk; if (body.length > 512_000) throw new Error("hook input too large"); }
        const result = this.authorize(JSON.parse(body));
        response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(result));
      } catch { response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ decision: "deny", reason: "Desktop 调用身份校验失败" })); }
    });
    await new Promise<void>((done, reject) => { this.server!.once("error", reject); this.server!.listen(0, "127.0.0.1", done); });
    const port = (this.server.address() as { port: number }).port;
    this.runtimeRoot = resolve(runtimeRoot);
    this.runtimePath = join(this.runtimeRoot, this.token);
    await cp(source, this.runtimePath, { recursive: true });
    await mkdir(join(this.runtimePath, "hooks"), { recursive: true });
    await writeFile(join(this.runtimePath, "hooks", "hooks.json"), JSON.stringify({ hooks: { PreToolUse: [{ matcher: "^(grok_desktop|grok_desktop_computer)__", hooks: [{ type: "http", url: `http://127.0.0.1:${port}/${this.token}`, timeout: 5 }] }] } }), "utf8");
    return this.runtimePath;
  }

  authorize(event: Record<string, unknown>): Record<string, unknown> {
    const deny = { decision: "deny", reason: "Desktop 工具只允许绑定的主会话调用，子智能体不能继承其权限" };
    if (!this.sessionId || event.sessionId !== this.sessionId || (event.subagentType !== undefined && event.subagentType !== null && event.subagentType !== "") || typeof event.toolName !== "string" || !/^(grok_desktop|grok_desktop_computer)__/.test(event.toolName) || event.toolInputTruncated === true || !event.toolInput || typeof event.toolInput !== "object" || Array.isArray(event.toolInput)) return deny;
    const input = { ...event.toolInput as Record<string, unknown> }; delete input[PROOF];
    const proof = randomBytes(32).toString("hex");
    for (const [id, permit] of this.permits) if (permit.expires < Date.now()) this.permits.delete(id);
    if (this.permits.size >= 256) return { decision: "deny", reason: "Desktop 待执行调用过多" };
    this.permits.set(proof, { tool: event.toolName, hash: digest(input), expires: Date.now() + 125 * 60_000 });
    this.observed = true;
    return { hookSpecificOutput: { hookEventName: "PreToolUse", updatedInput: { ...input, [PROOF]: proof } } };
  }

  consume(tool: string, input: Record<string, unknown>): Record<string, unknown> {
    const proof = input[PROOF];
    const clean = { ...input }; delete clean[PROOF];
    const permit = typeof proof === "string" ? this.permits.get(proof) : undefined;
    if (typeof proof === "string") this.permits.delete(proof);
    if (!permit || permit.expires < Date.now() || permit.tool !== tool || permit.hash !== digest(clean)) throw new Error("当前 CLI 未提供有效的主会话调用证明；Desktop 工具已拒绝执行。请验证 CLI 的 PreToolUse updatedInput 合同，不能通过重试或子智能体绕过。");
    this.verified = true;
    return clean;
  }
  async dispose(): Promise<void> {
    this.sessionId = ""; this.permits.clear();
    this.server?.closeAllConnections();
    await new Promise<void>(done => this.server?.close(() => done()) ?? done());
    // This path is created solely from a generated hex token under runtimeRoot.
    if (this.runtimePath && dirname(resolve(this.runtimePath)) === this.runtimeRoot && this.runtimePath.endsWith(this.token)) await rm(this.runtimePath, { recursive: true, force: true });
  }
}
function digest(value: unknown): string {
  const canonical = (item: unknown): unknown => Array.isArray(item) ? item.map(canonical) : item && typeof item === "object" ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)).map(([key, val]) => [key, canonical(val)])) : item;
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}
