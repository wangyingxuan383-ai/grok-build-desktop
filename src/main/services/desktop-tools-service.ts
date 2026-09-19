import { randomBytes, randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import type { AutomationTask, AutomationTaskInput, AutomationRunRecord, SessionMode } from "../../shared/types";

export interface DesktopToolContext { sessionId: string; cwd: string }
export interface DesktopToolBackend {
  mode(sessionId: string): SessionMode | undefined;
  list(): Promise<AutomationTask[]>;
  create(context: DesktopToolContext, input: { name: string; prompt: string; schedule: AutomationTaskInput["schedule"]; destination: "standalone" | "current-session"; timeZone?: string; contextPolicy?: "reuse" | "fresh" }): Promise<AutomationTask>;
  update(id: string, patch: Partial<AutomationTaskInput>): Promise<AutomationTask[]>;
  remove(id: string): Promise<AutomationTask[]>;
  runs(id: string): Promise<AutomationRunRecord[]>;
  cancel(id: string): Promise<AutomationRunRecord>;
  capabilities(sessionId: string): Promise<unknown>;
}
interface Lease { authorize?: (tool: string, input: Record<string, unknown>) => Record<string, unknown>; context: DesktopToolContext; token: string; server: McpServer; transport: StreamableHTTPServerTransport }
const schedule = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("once"), at: z.string().datetime({ offset: true }) }),
  z.object({ kind: z.literal("interval"), minutes: z.number().int().min(1).max(525600) }),
  z.object({ kind: z.literal("daily"), time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/) }),
  z.object({ kind: z.literal("weekly"), time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/), days: z.array(z.number().int().min(0).max(6)).min(1).max(7) }),
]);
const id = z.string().min(1).max(512);

/** Authenticated, session-scoped tools. Renderer IPC and MCP use the same services. */
export class DesktopToolsService {
  private http?: Server;
  private readonly leases = new Map<string, Lease>();
  private starting?: Promise<void>;
  constructor(private readonly backend: DesktopToolBackend, private readonly pluginPath: string) {}

  async injection(cwd: string, authorize?: (tool: string, input: Record<string, unknown>) => Record<string, unknown>): Promise<{ leaseId: string; mcpServers: unknown[]; pluginDirs: string[] }> {
    await (this.starting ??= this.listen());
    const leaseId = randomUUID(), token = randomBytes(32).toString("base64url");
    const server = new McpServer({ name: "grok-desktop", version: "1.0.0" });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID(), enableJsonResponse: true });
    const schemas: Record<string, Record<string, z.ZodTypeAny>> = {
      capabilities: {}, automation_list: {},
      automation_create: { name: z.string().min(1).max(512), prompt: z.string().min(1).max(100_000), schedule, destination: z.enum(["standalone", "current-session"]), contextPolicy: z.enum(["reuse", "fresh"]).optional().describe("Standalone: reuse or fresh; current-session requires reuse."), timeZone: z.string().max(100).optional(), futureIntent: z.literal(true) },
      automation_update: { id, name: z.string().min(1).max(512).optional(), prompt: z.string().min(1).max(100_000).optional(), schedule: schedule.optional(), contextPolicy: z.enum(["reuse", "fresh"]).optional(), timeZone: z.string().max(100).optional(), enabled: z.boolean().optional() },
      automation_pause: { id, paused: z.boolean() }, automation_delete: { id }, automation_runs: { id }, automation_cancel_run: { id, runId: id },
    };
    const descriptions: Record<string, string> = {
      capabilities: "Read actual Desktop capability evidence and unavailable reasons before choosing tools.",
      automation_list: "List persistent scheduled tasks in this workspace. These survive CLI process exit; /loop does not.",
      automation_create: "Schedule future work only when requested by the user or an explicitly invoked workflow. Choose current-session to continue here, standalone for independent runs. Report the returned registration status and time zone.",
      automation_update: "Change an existing persistent task in this workspace; preserve unspecified fields.",
      automation_pause: "Pause or resume a persistent task.", automation_delete: "Delete a persistent task and cancel its active runs; retain run history.",
      automation_runs: "Read scheduled run status and result session IDs.", automation_cancel_run: "Cancel an active run belonging to the specified task.",
    };
    for (const [name, inputSchema] of Object.entries(schemas)) server.registerTool(name, { description: descriptions[name]!, inputSchema: { ...inputSchema, _desktopCallerProof: z.string().optional().describe("Internal CLI hook proof; do not supply this argument yourself") } }, input => this.call(leaseId, name, input));
    await server.connect(transport);
    this.leases.set(leaseId, { authorize, context: { sessionId: "", cwd }, token, server, transport });
    const address = this.http!.address() as { port: number };
    return { leaseId, mcpServers: [{ type: "http", name: "grok_desktop", url: `http://127.0.0.1:${address.port}/${leaseId}`, headers: [{ name: "Authorization", value: `Bearer ${token}` }] }], pluginDirs: [this.pluginPath] };
  }
  bind(leaseId: string, sessionId: string): void { const lease = this.leases.get(leaseId); if (lease) lease.context.sessionId = sessionId; }
  async release(leaseId: string): Promise<void> { const lease = this.leases.get(leaseId); this.leases.delete(leaseId); await lease?.server.close(); }
  async dispose(): Promise<void> { await Promise.all([...this.leases.keys()].map(id => this.release(id))); this.http?.closeAllConnections(); await new Promise<void>(done => this.http?.close(() => done()) ?? done()); }

  private async call(leaseId: string, name: string, input: Record<string, unknown>) {
    try {
      const lease = this.leases.get(leaseId);
      const context = lease?.context;
      if (!context?.sessionId) throw new Error("会话尚未绑定或租约已失效");
      if (!lease?.authorize) throw new Error("Desktop 调用身份校验尚未配置");
      input = lease.authorize(`grok_desktop__${name}`, input);
      const readOnly = ["capabilities", "automation_list", "automation_runs"].includes(name);
      if (!readOnly && this.backend.mode(context.sessionId) !== "agent" && this.backend.mode(context.sessionId) !== "auto") throw new Error("当前会话模式不允许修改定时任务");
      const tasks = (await this.backend.list()).filter(task => sameWorkspace(task.workspace, context.cwd) || (task.destination === "current-session" && task.targetSessionId === context.sessionId));
      if (input.id && !tasks.some(task => task.id === input.id)) throw new Error("任务不属于当前工作区或已删除");
      if (input.contextPolicy === "fresh" && (input.destination === "current-session" || tasks.find(task => task.id === input.id)?.destination === "current-session")) throw new Error("继续当前会话必须复用上下文；fresh 仅适用于独立任务");
      let result: unknown;
      switch (name) {
        case "capabilities": result = await this.backend.capabilities(context.sessionId); break;
        case "automation_list": result = tasks; break;
        case "automation_create": result = await this.backend.create(context, input as Parameters<DesktopToolBackend["create"]>[1]); break;
        case "automation_update": { const { id: taskId, ...patch } = input; result = (await this.backend.update(String(taskId), patch)).find(task => task.id === taskId); break; }
        case "automation_pause": result = (await this.backend.update(String(input.id), { enabled: !input.paused })).find(task => task.id === input.id); break;
        case "automation_delete": await this.backend.remove(String(input.id)); result = { deleted: true, id: input.id }; break;
        case "automation_runs": result = await this.backend.runs(String(input.id)); break;
        case "automation_cancel_run": {
          if (!(await this.backend.runs(String(input.id))).some(run => run.id === input.runId)) throw new Error("运行不属于指定任务");
          result = await this.backend.cancel(String(input.runId)); break;
        }
        default: throw new Error("未知 Desktop 工具");
      }
      const registration = result as Partial<AutomationTask> | undefined;
      const isError = Boolean(registration?.registrationStatus && registration.registrationStatus !== "registered");
      return { isError, content: [{ type: "text" as const, text: JSON.stringify({ ok: !isError, result }) }] };
    } catch (error) {
      return { isError: true, content: [{ type: "text" as const, text: JSON.stringify({ ok: false, error: error instanceof Error ? error.message : "Desktop 工具失败" }) }] };
    }
  }
  private async listen(): Promise<void> {
    this.http = createServer(async (request, response) => {
      const lease = this.leases.get((request.url ?? "").slice(1));
      if (!lease || request.headers.authorization !== `Bearer ${lease.token}`) { response.writeHead(401).end(); return; }
      if (request.method !== "POST") { response.writeHead(405).end(); return; }
      try { await lease.transport.handleRequest(request, response); }
      catch { if (!response.headersSent) response.writeHead(500).end(); }
    });
    await new Promise<void>((done, reject) => { this.http!.once("error", reject); this.http!.listen(0, "127.0.0.1", done); });
  }
}
function sameWorkspace(left: string, right: string): boolean { return resolve(left).toLocaleLowerCase() === resolve(right).toLocaleLowerCase(); }
