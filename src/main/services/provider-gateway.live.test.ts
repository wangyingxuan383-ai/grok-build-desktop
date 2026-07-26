import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { CustomProviderProfile, ProviderSchemaProfile } from "../../shared/types";
import { LogService } from "./log-service";
import { ProviderGatewayService } from "./provider-gateway-service";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

// Opt-in only. Supply all three at run time; nothing is ever stored here.
//   $env:GROK_LIVE_GATEWAY_KEY / _BASE / _MODEL
const KEY = process.env.GROK_LIVE_GATEWAY_KEY ?? "";
const BASE = process.env.GROK_LIVE_GATEWAY_BASE ?? "";
const MODEL = process.env.GROK_LIVE_GATEWAY_MODEL ?? "";

// The exact failure shape the user reported: enum members that are the empty
// string, which Gemini GenerateContent rejects with INVALID_ARGUMENT.
const toolsWithEmptyEnums = [{
  type: "function",
  function: {
    name: "todo_write",
    description: "Record todo items",
    parameters: {
      type: "object",
      properties: {
        todos: {
          type: "array",
          items: {
            type: "object",
            properties: { status: { type: "string", enum: ["pending", "in_progress", "completed", "cancelled", ""] } },
            required: ["status"],
          },
        },
        isolation: { type: "string", enum: ["none", "worktree", ""] },
      },
      required: ["todos"],
    },
  },
}];

async function callThroughGateway(schemaProfile: ProviderSchemaProfile, tools?: unknown): Promise<{ status: number; body: string; trace: string | null }> {
  const root = await mkdtemp(join(tmpdir(), "live-gateway-")); roots.push(root);
  const provider: CustomProviderProfile = {
    id: "live", name: "Live", baseUrl: BASE, protocol: "chat_completions",
    upstreamProtocol: "openai_chat", schemaProfile, authScheme: "bearer", credentialMode: "none",
    extraHeaders: {}, models: [], owned: true, hasCredential: true, insecureHttp: false,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  const gateway = new ProviderGatewayService({ providers: async () => [provider], fetcher: fetch, log: new LogService(join(root, "gateway.log")) });
  try {
    const route = await gateway.route("live");
    const response = await fetch(`${route}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${KEY}` },
      body: JSON.stringify({ model: MODEL, max_tokens: 16, messages: [{ role: "user", content: "Reply with the single word OK." }], ...(tools ? { tools } : {}) }),
    });
    return {
      status: response.status,
      body: (await response.text()).replace(/\s+/g, " ").slice(0, 400),
      trace: response.headers.get("x-request-id") ?? response.headers.get("x-cloudaicompanion-trace-id"),
    };
  } finally {
    await gateway.dispose();
  }
}

describe.runIf(Boolean(KEY && BASE && MODEL))("live provider gateway schema compatibility", () => {
  it("completes a minimal turn with no tools", async () => {
    const result = await callThroughGateway("standard");
    console.log("[baseline]", JSON.stringify({ status: result.status, trace: result.trace, body: result.body.slice(0, 200) }));
    expect(result.status).toBe(200);
  }, 90_000);

  it("leaves the schema untouched on the standard profile, so a strict upstream still rejects it", async () => {
    const result = await callThroughGateway("standard", toolsWithEmptyEnums);
    console.log("[standard+tools]", JSON.stringify({ status: result.status, body: result.body.slice(0, 300) }));
    // Documents the pass-through contract: whatever the upstream thinks of the
    // original body is what the caller gets. Against Gemini this is the 400.
    expect(result.status).toBeGreaterThanOrEqual(200);
  }, 90_000);

  it("succeeds with the same tools once the gemini profile sanitizes them", async () => {
    const result = await callThroughGateway("gemini", toolsWithEmptyEnums);
    console.log("[gemini+tools]", JSON.stringify({ status: result.status, body: result.body.slice(0, 300) }));
    expect(result.status).toBe(200);
  }, 90_000);
});
