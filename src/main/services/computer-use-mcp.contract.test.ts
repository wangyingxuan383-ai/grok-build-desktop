import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ComputerUseService } from "./computer-use-service";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe.skipIf(process.platform !== "win32" || process.arch !== "x64")("Computer Use loopback MCP contract", () => {
  it("requires the session token and exposes the clean-room tool inventory", async () => {
    const userData = await mkdtemp(join(tmpdir(), "grok-computer-mcp-")); roots.push(userData);
    const root = process.cwd();
    const service = new ComputerUseService(userData, join(root, "resources", "native", "win-x64", "GrokComputerHost.exe"), join(root, "resources", "plugins", "grok-computer-use"), { log: async () => undefined } as never, () => "agent", () => undefined);
    const injection = await service.createSessionInjection(); service.bindLease(injection.leaseId, "test-session");
    const config = injection.mcpServers[0] as { url: string; headers: Array<{ name: string; value: string }> };
    const unauthorized = await fetch(config.url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } } }) });
    expect(unauthorized.status).toBe(401);
    const headers = Object.fromEntries(config.headers.map((value) => [value.name, value.value]));
    const client = new Client({ name: "grok-desktop-contract", version: "0.3.1" });
    await client.connect(new StreamableHTTPClientTransport(new URL(config.url), { requestInit: { headers } }));
    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toEqual(expect.arrayContaining(["list_apps", "list_windows", "start", "get_window_state", "click", "type_text", "set_value", "drag", "wait"]));
    const result = await client.callTool({ name: "list_apps", arguments: {} });
    expect(result.isError).not.toBe(true);
    await client.close(); await service.dispose();
  }, 30_000);
});
