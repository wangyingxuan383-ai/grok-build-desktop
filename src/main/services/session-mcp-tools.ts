import { randomUUID } from "node:crypto";
import type { McpToolSelection, SessionMcpToolSnapshot } from "../../shared/types";

const name = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 256 && !/[\x00-\x1f\x7f]/.test(value);
type Server = { generation: string; tools: Array<{name:string;description?:string}> };
/** Only explicit, session-addressed live identities can authorize a selection. */
export class SessionMcpTools {
  private readonly servers = new Map<string,Server>();
  revision = 0;
  private notice?: string;
  reset(): void { this.revision++; this.servers.clear(); this.notice = undefined; }
  /** Request ownership comes from the exact ACP adapter, never a global extension session. */
  acceptList(owner: string, value: Record<string, any>, revision: number): boolean {
    if (revision !== this.revision) return false;
    if (value.sessionMcpResolved !== true || !Array.isArray(value.servers) || value.servers.length > 64) {
      this.reset(); this.notice = "当前 CLI 未确认该会话 MCP 已解析，或未返回完整清单；暂不能选择工具。"; return true;
    }
    const counts = new Map<string, number>();
    for (const row of value.servers) if (row && name(row.name)) counts.set(row.name, (counts.get(row.name) ?? 0) + 1);
    for (const server of this.servers.keys()) if (!counts.has(server)) this.servers.delete(server);
    for (const row of value.servers) {
      if (!row || !name(row.name)) continue;
      const state = row.session;
      if (counts.get(row.name) !== 1 || !state || state.enabled !== true || state.status !== "ready" || state.authRequired || state.setupRequired || state.blockedReason || !Array.isArray(state.tools)) {
        this.servers.delete(row.name); continue;
      }
      if (state.tools.some((tool: any) => !tool || !name(tool.name) || typeof tool.enabled !== "boolean")) { this.servers.delete(row.name); continue; }
      this.observe(owner, "session-list", {sessionId: owner, serverName: row.name, status: "ready", tools: state.tools.filter((tool: any) => tool.enabled)});
    }
    this.notice = undefined;
    return true;
  }
  observe(owner: string, method: string, value: Record<string,any>): void {
    if(!owner || value._meta?.isReplay===true || value.isReplay===true)return;
    const target = value.sessionId ?? value.session_id;
    if(target !== undefined && target !== owner)return;
    // Official catalog-change pushes are agent-scoped: invalidate, never infer availability.
    if(/servers_(?:changed|updated)$/.test(method)){this.reset();return;}
    if(target !== owner)return;
    this.revision++;
    const server=value.serverName ?? value.server ?? value.name;
    if(!name(server)){if(/tools_changed$|mcp_initialized$/.test(method))this.reset();return;}
    const status=value.status ?? value.state;
    if(value.requiresAuth===true || value.authRequired===true || value.setupRequired===true || (status!==undefined && !["ready","connected"].includes(status))){
      this.servers.delete(server);return;
    }
    if(!Array.isArray(value.tools)){
      // A count-only replacement cannot preserve the identity of prior tools.
      if(/tools_changed$/.test(method))this.servers.delete(server);
      return;
    }
    if(!["ready","connected"].includes(status) || value.tools.length>500){this.servers.delete(server);return;}
    if(value.tools.some((row:any)=>!row || !name(row.name) || (row.serverName!==undefined && row.serverName!==server) || (row.enabled!==undefined && typeof row.enabled!=="boolean"))){this.servers.delete(server);return;}
    const tools: Server["tools"]=value.tools.filter((row:any)=>row.enabled!==false).map((row:any)=>({
      name:row.name,description:typeof row.description==="string"?row.description.slice(0,2048):undefined,
    }));
    const unique=[...new Map(tools.map(tool=>[tool.name,tool])).values()].sort((a,b)=>a.name.localeCompare(b.name));
    const old=this.servers.get(server);
    const same=old && JSON.stringify(old.tools.map(t=>t.name))===JSON.stringify(unique.map(t=>t.name));
    if(this.servers.size>=64&&!old)return;
    this.servers.set(server,{generation:same?old.generation:randomUUID(),tools:unique});
  }
  snapshot(sessionId:string):SessionMcpToolSnapshot {
    return {sessionId,tools:[...this.servers].flatMap(([serverName,server])=>server.tools.map(tool=>({
      selection:{sessionId,serverName,toolName:tool.name,generation:server.generation},description:tool.description,
    }))),notice:this.notice ?? "仅列出当前会话明确上报为就绪且启用的 MCP 工具。空列表不代表未配置；只上报数量或身份不明的工具不能选择。"};
  }
  assert(sessionId:string,selection?:McpToolSelection):void {
    if(!selection)return;
    const server=this.servers.get(selection.serverName);
    if(selection.sessionId!==sessionId || !server || selection.generation!==server.generation || !server.tools.some(tool=>tool.name===selection.toolName))
      throw Error("所选 MCP 工具已失效或不属于当前会话，请重新选择后发送");
  }
}
