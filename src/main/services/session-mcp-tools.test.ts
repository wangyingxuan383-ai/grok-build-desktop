import { describe, expect, it, vi } from "vitest";
import { SessionMcpTools } from "./session-mcp-tools";
import { GrokAcpAdapter, normalizePromptQueue } from "./grok-acp-adapter";
import { validateIpcInvocation } from "../ipc-schema";
import { buildComposerCommand } from "../../shared/composer-capability";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionRuntimeStateService } from "./session-runtime-state-service";
import { UiStateService } from "./ui-state-service";

const ready = { sessionId: "parent", serverName: "docs", status: "ready", tools: [{ name: "search", description: "搜索资料" }] };
const method = "_x.ai/mcp/tools_changed";
const listResponse = {sessionMcpResolved:true,servers:[{name:"docs",session:{enabled:true,status:"ready",tools:[{name:"search",enabled:true,description:"搜索资料"}]}}]};
const inventory = () => { const tools = new SessionMcpTools(); tools.observe("parent", method, ready); return tools; };

describe("session MCP selection", () => {
  it("requires explicit live owner, ready server and structured tool identities", () => {
    for (const patch of [{sessionId: undefined}, {sessionId: "child"}, {_meta:{isReplay:true}}, {isReplay:true}, {status:undefined}, {status:"connecting"}, {tools:3}, {tools:["search"]}, {tools:[{name:"search",serverName:"foreign"}]}]) {
      const tools = new SessionMcpTools(); tools.observe("parent", method, {...ready,...patch});
      expect(tools.snapshot("parent").tools).toEqual([]);
    }
    expect(inventory().snapshot("parent").tools[0]).toMatchObject({selection:{sessionId:"parent",serverName:"docs",toolName:"search"},description:"搜索资料"});
    const tools=inventory();tools.observe("parent",method,{...ready,tools:[{name:"disabled",enabled:false}]});
    expect(tools.snapshot("parent").tools).toEqual([]);
  });
  it("keeps selections through identical refresh and unrelated server updates", () => {
    const tools=inventory(), selection=tools.snapshot("parent").tools[0]!.selection;
    tools.observe("parent",method,{...ready,serverName:"other"});
    tools.observe("parent",method,{...ready,tools:[{name:"search",description:"新说明"}]});
    expect(()=>tools.assert("parent",selection)).not.toThrow();
    expect(()=>tools.assert("child",selection)).toThrow("不属于当前会话");
  });
  it("invalidates changes, disconnect, auth, malformed or count-only replacements and restarts", () => {
    for(const patch of [{status:"disconnected"}, {requiresAuth:true}, {tools:undefined,toolCount:1}, {tools:[{name:"new"}]}, {tools:[{name:"search"},{name:""}]}]) {
      const tools=inventory(), selection=tools.snapshot("parent").tools[0]!.selection;
      tools.observe("parent",method,{...ready,...patch});
      expect(()=>tools.assert("parent",selection)).toThrow("已失效");
      tools.observe("parent",method,ready);
      expect(()=>tools.assert("parent",selection)).toThrow("已失效");
    }
    const tools=inventory(), selection=tools.snapshot("parent").tools[0]!.selection;
    tools.reset(); tools.observe("parent",method,ready);
    expect(()=>tools.assert("parent",selection)).toThrow("已失效");
    tools.observe("parent","_x.ai/mcp/servers_updated",{sessionId:"parent"});
    expect(tools.snapshot("parent").tools).toEqual([]);
  });
  it("rejects cross-session and malformed selections at IPC and preserves the ordinary prompt contract", () => {
    const selection=inventory().snapshot("parent").tools[0]!.selection;
    for(const channel of ["session:send","session:enqueue","session:interject"]) {
      expect(()=>validateIpcInvocation(channel,["parent","text",[],undefined,undefined,undefined,selection],7)).not.toThrow();
      for(const invalid of [{...selection,sessionId:"child"},{...selection,toolName:"line\nbreak"},{...selection,generation:undefined},{...selection,extra:true}])
        expect(()=>validateIpcInvocation(channel,["parent","text",[],undefined,undefined,undefined,invalid],7)).toThrow();
      expect(()=>validateIpcInvocation(channel,["parent","text",[]],7)).not.toThrow();
    }
    expect(()=>validateIpcInvocation("session:mcp-tools",["parent"],1)).not.toThrow();
    const text=buildComposerCommand("查找资料",{kind:"mcp",command:"",label:"docs / search",selection});
    expect(text).toContain('MCP 服务 "docs" 的工具 "search"');
    expect(text).not.toMatch(/^\//); expect(text).toContain("仍须遵守当前权限");
    expect(text).toMatch(/查找资料$/);
  });
});

function adapterFixture() {
  const persist=vi.fn().mockResolvedValue(undefined), terminal=vi.fn().mockResolvedValue(undefined);
  const adapter=new GrokAcpAdapter({cliPath:"fixture-never-started",cwd:"C:\\isolated",env:{},mode:"agent",effort:"high",log:{log:vi.fn().mockResolvedValue(undefined)} as any,onPromptQueueChanged:persist,onPromptQueueTerminal:terminal});
  adapter.sessionId="parent";
  const internal=adapter as any;
  internal.sessionMcpTools.observe("parent",method,ready);
  internal.scheduleLocalQueueDrain=vi.fn();
  internal.request=vi.fn().mockResolvedValue({});
  internal.extension=vi.fn().mockImplementation(async (method:string)=>method==="x.ai/mcp/list"?listResponse:{});
  return {adapter,internal,persist,terminal,selection:adapter.mcpTools().tools[0]!.selection};
}
describe("MCP selected prompt handoff", () => {
  it("queries only its own session list, filters disabled tools, and does not expose server secrets", async () => {
    const {adapter,internal}=adapterFixture();
    try {
      // Exercise the real extension wrapper so the outbound request must carry the owner.
      internal.extension=GrokAcpAdapter.prototype.extension;
      internal.request.mockResolvedValue({...listResponse,servers:[{...listResponse.servers[0],env:[{name:"SECRET",value:"never-render"}],session:{enabled:true,status:"ready",tools:[{name:"search",enabled:true},{name:"disabled",enabled:false}]}}]});
      const snapshot=await adapter.discoverMcpTools();
      expect(internal.request).toHaveBeenCalledWith("_x.ai/mcp/list",{sessionId:"parent",cache:true},5000);
      expect(snapshot.tools.map(tool=>tool.selection.toolName)).toEqual(["search"]);
      expect(JSON.stringify(snapshot)).not.toContain("never-render");
      const selected=snapshot.tools[0]!.selection;
      internal.request.mockResolvedValue({sessionMcpResolved:false,servers:listResponse.servers});
      expect((await adapter.discoverMcpTools()).tools).toEqual([]);
      expect(()=>internal.sessionMcpTools.assert("parent",selected)).toThrow("已失效");
    } finally { await adapter.dispose(10); }
  });
  it("coalesces discovery and drops a late response after disconnect instead of restoring old tools", async () => {
    const {adapter,internal}=adapterFixture();
    try {
      let finish!:(value:unknown)=>void;
      internal.extension.mockImplementation(()=>new Promise(resolve=>{finish=resolve}));
      const first=adapter.discoverMcpTools(), second=adapter.discoverMcpTools();
      expect(first).toBe(second); expect(internal.extension).toHaveBeenCalledTimes(1);
      internal.sessionMcpTools.observe("parent",method,{...ready,status:"disconnected"});
      finish(listResponse);
      await expect(first).rejects.toThrow("发生变化");
      expect(adapter.mcpTools().tools).toEqual([]);
    } finally { await adapter.dispose(10); }
  });
  it("rejects ambiguous or unscoped catalog rows and rechecks disabled tools before sending", async () => {
    const {adapter,internal,selection}=adapterFixture();
    try {
      internal.extension.mockResolvedValue({sessionMcpResolved:true,servers:[listResponse.servers[0],listResponse.servers[0]]});
      expect((await adapter.discoverMcpTools()).tools).toEqual([]);
      internal.extension.mockResolvedValue({servers:[{name:"global",tools:[{name:"search",enabled:true}]}]});
      expect((await adapter.discoverMcpTools()).tools).toEqual([]);
      internal.sessionMcpTools.observe("parent",method,ready);
      const current=adapter.mcpTools().tools[0]!.selection;
      internal.extension.mockResolvedValue({sessionMcpResolved:true,servers:[{name:"docs",session:{enabled:true,status:"ready",tools:[{name:"search",enabled:false}]}}]});
      await expect(adapter.prompt("disabled",[],100,{toolSelection:current})).rejects.toThrow("已失效");
      expect(internal.request).not.toHaveBeenCalled();
      expect(()=>internal.sessionMcpTools.assert("parent",selection)).toThrow("已失效");
    } finally { await adapter.dispose(10); }
  });
  it("consumes session-owned live notifications through the adapter without accepting replay or child tools", async () => {
    const {adapter,internal}=adapterFixture();
    try {
      internal.sessionMcpTools.reset();
      for (const params of [{...ready,sessionId:"child"},{...ready,_meta:{isReplay:true}}])
        await internal.onLine(JSON.stringify({method,params}));
      expect(adapter.mcpTools().tools).toEqual([]);
      await internal.onLine(JSON.stringify({method,params:ready}));
      expect(adapter.mcpTools().tools[0]?.selection.toolName).toBe("search");
      await internal.onLine(JSON.stringify({method:"_x.ai/mcp/server_status",params:{...ready,status:"disconnected",tools:undefined}}));
      expect(adapter.mcpTools().tools).toEqual([]);
    } finally { await adapter.dispose(10); }
  });
  it("retains exact selection in disk drafts and queues but never trusts it after a new connection", async () => {
    const root=await mkdtemp(join(tmpdir(),"grok-mcp-selection-"));
    const {adapter,internal,selection}=adapterFixture();
    try {
      await adapter.queuePrompt("queued",[],false,{toolSelection:selection});
      await new SessionRuntimeStateService(root).saveQueue("parent",adapter.queuedPrompts());
      await new UiStateService(root).setDraft("parent","draft",{kind:"mcp",label:"docs / search",command:"",selection});
      const restored=await new SessionRuntimeStateService(root).getQueue("parent");
      expect(restored[0]?.toolSelection).toEqual(selection);
      expect((await new UiStateService(root).getDraft("parent"))?.capability).toMatchObject({selection});
      internal.sessionMcpTools.reset();internal.sessionMcpTools.observe("parent",method,ready);
      await expect(adapter.prompt(restored[0]!.text,[],100,{toolSelection:restored[0]!.toolSelection})).rejects.toThrow("已失效");
      expect(internal.request).not.toHaveBeenCalled();
    } finally { await adapter.dispose(10); await rm(root,{recursive:true,force:true}); }
  });
  it("sends a valid prompt but rejects direct/queued/interjected stale selections before CLI transport", async () => {
    const {adapter,internal,selection}=adapterFixture();
    try {
      await adapter.prompt("valid",[],100,{toolSelection:selection});
      expect(internal.request).toHaveBeenCalledTimes(1); internal.request.mockClear(); internal.extension.mockClear();
      internal.sessionMcpTools.reset();
      await expect(adapter.prompt("stale",[],100,{toolSelection:selection})).rejects.toThrow("已失效");
      await expect(adapter.queuePrompt("stale",[],false,{toolSelection:selection})).rejects.toThrow("已失效");
      internal.working=true;
      await expect(adapter.interjectPrompt("stale",[],{toolSelection:selection})).rejects.toThrow("已失效");
      expect(internal.request).not.toHaveBeenCalled(); expect(internal.extension).not.toHaveBeenCalled();
    } finally { await adapter.dispose(10); }
  });
  it("persists queue identity and blocks a stale handoff after waiting", async () => {
    const {adapter,internal,persist,terminal,selection}=adapterFixture(); const events:any[]=[];adapter.on("event",event=>events.push(event));
    try {
      await adapter.queuePrompt("queued",[],false,{toolSelection:selection});
      const row=adapter.queuedPrompts()[0]!;
      expect(persist).toHaveBeenCalledWith("parent",[expect.objectContaining({toolSelection:selection})]);
      expect(normalizePromptQueue([{id:row.id,text:row.text,toolSelection:{fake:true}}],"parent",[row])[0]!.toolSelection).toEqual(selection);
      internal.sessionMcpTools.reset();
      await internal.drainLocalPromptQueue();
      expect(internal.request).not.toHaveBeenCalled();
      expect(events).toContainEqual(expect.objectContaining({type:"error",message:expect.stringContaining("已失效")}));
      expect(terminal).toHaveBeenCalledWith("parent",expect.objectContaining({id:row.id,state:"failed",toolSelection:selection}));
      expect(adapter.queuedPrompts()).toEqual([]);
    } finally { await adapter.dispose(10); }
  });
  it("keeps an unsent queued row when stale interjection fails and clears discovery on dispose", async () => {
    const {adapter,internal,selection}=adapterFixture();
    await adapter.queuePrompt("queued",[],false,{toolSelection:selection});
    const row=adapter.queuedPrompts()[0]!;
    internal.working=true;internal.activeTurn={turnId:"busy"};
    internal.sessionMcpTools.reset();
    await expect(adapter.interjectQueuedPrompt(row.id)).rejects.toThrow("已失效");
    expect(internal.extension.mock.calls.some((call:any[])=>call[0]==="x.ai/interject")).toBe(false); expect(adapter.queuedPrompts()[0]!.state).toBe("queued");
    internal.activeTurn=undefined; internal.sessionMcpTools.observe("parent",method,ready);
    await adapter.dispose(10);expect(adapter.mcpTools().tools).toEqual([]);
  });
});
