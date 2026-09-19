import { createHash, randomBytes } from "node:crypto";
import { createServer, request, type Server } from "node:http";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import type { AutomationRunRecord } from "../../shared/types";
import { JsonStore, withCrossProcessFileLock } from "./json-store";

interface Endpoint { pid: number; port: number; token: string }

/** Routes scheduled continuations to the process that already owns the CLI session. */
export class SessionRelayService {
  private readonly sessions = new Set<string>();
  private readonly token = randomBytes(32).toString("hex");
  private server?: Server;
  private starting?: Promise<number>;
  constructor(private readonly root: string, private readonly execute: (sessionId: string, taskId: string, runId?: string) => Promise<AutomationRunRecord>) {}

  async own(sessionId: string): Promise<void> {
    this.sessions.add(sessionId);
    const port = await (this.starting ??= this.listen());
    if (this.sessions.has(sessionId)) await new JsonStore(this.path(sessionId), {} as Endpoint).set({ pid: process.pid, port, token: this.token });
  }
  async release(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
    await withCrossProcessFileLock(`${this.path(sessionId)}.lock`, async () => {
      const saved = await this.read(sessionId);
      if (!this.sessions.has(sessionId) && saved?.token === this.token) await rm(this.path(sessionId), { force: true });
    });
  }
  async forward(sessionId: string, taskId: string, runId?: string): Promise<AutomationRunRecord | undefined> {
    if (this.sessions.has(sessionId)) return undefined;
    const endpoint = await this.read(sessionId);
    if (!endpoint) return undefined;
    try { process.kill(endpoint.pid, 0); } catch { return undefined; }
    // Once dispatched, errors must surface; retrying locally could duplicate a turn.
    const result = await new Promise<{ run?: AutomationRunRecord; error?: string }>((resolve, reject) => {
      const body = JSON.stringify({ sessionId, taskId, runId });
      const outgoing = request({ hostname: "127.0.0.1", port: endpoint.port, path: "/continue", method: "POST", headers: { Authorization: `Bearer ${endpoint.token}`, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } }, response => {
        let raw = "";
        response.on("data", chunk => { raw += chunk; if (raw.length > 1_000_000) outgoing.destroy(new Error("会话转交响应过大")); });
        response.on("error", reject);
        response.on("end", () => { try { resolve(JSON.parse(raw)); } catch (error) { reject(error); } });
      });
      outgoing.on("error", reject); outgoing.end(body);
    });
    if (!result.run) throw new Error(result.error || "会话执行进程不可用，请稍后重试");
    return result.run;
  }
  async dispose(): Promise<void> {
    await Promise.all([...this.sessions].map(id => this.release(id)));
    this.server?.closeAllConnections();
    await new Promise<void>(done => this.server?.close(() => done()) ?? done());
  }
  private path(id: string): string { return join(this.root, "session-relays", `${createHash("sha256").update(id).digest("hex")}.json`); }
  private async read(id: string): Promise<Endpoint | undefined> { return readFile(this.path(id), "utf8").then(raw => JSON.parse(raw) as Endpoint).catch(() => undefined); }
  private async listen(): Promise<number> {
    this.server = createServer(async (request, response) => {
      if (request.method !== "POST" || request.url !== "/continue" || request.headers.authorization !== `Bearer ${this.token}`) { response.writeHead(401).end(); return; }
      try {
        let body = "";
        for await (const chunk of request) { body += chunk; if (body.length > 4096) throw new Error("请求过大"); }
        const { sessionId, taskId, runId } = JSON.parse(body) as Record<string, unknown>;
        if (typeof sessionId !== "string" || typeof taskId !== "string" || (runId !== undefined && typeof runId !== "string") || !this.sessions.has(sessionId)) throw new Error("会话不属于当前进程");
        const run = await this.execute(sessionId, taskId, runId);
        response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ run }));
      } catch (error) { response.writeHead(409, { "Content-Type": "application/json" }).end(JSON.stringify({ error: error instanceof Error ? error.message : "会话转交失败" })); }
    });
    this.server.requestTimeout = 0;
    await new Promise<void>((done, reject) => { this.server!.once("error", reject); this.server!.listen(0, "127.0.0.1", done); });
    return (this.server.address() as { port: number }).port;
  }
}
