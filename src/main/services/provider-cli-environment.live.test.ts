import { createServer } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { locateGrokCli } from "./cli-locator";
import { GrokAcpAdapter } from "./grok-acp-adapter";
import { LogService } from "./log-service";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, {
  recursive: true,
  force: true,
  maxRetries: 8,
  retryDelay: 75,
}))));

describe.runIf(process.platform === "win32" && process.env.GROK_LIVE_PROVIDER_PROBE === "1")("installed Grok CLI provider environment", () => {
  it("expands base_url from the process environment and reaches a local OpenAI-compatible endpoint over ACP", async () => {
    const root = await mkdtemp(join(tmpdir(), "grok-provider-cli-live-")); roots.push(root);
    const grokHome = join(root, ".grok");
    const workspace = join(root, "workspace");
    await mkdir(grokHome, { recursive: true });
    await mkdir(workspace, { recursive: true });
    let capturedUrl = "";
    let capturedBody = "";
    let capturedAuthorization = "";
    const upstream = createServer(async (request, response) => {
      capturedUrl = request.url ?? "";
      capturedAuthorization = request.headers.authorization ?? "";
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      capturedBody = Buffer.concat(chunks).toString("utf8");
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.write(`data: ${JSON.stringify({
        id: "chatcmpl-local-probe",
        object: "chat.completion.chunk",
        created: Math.floor(Date.now() / 1000),
        model: "upstream-probe",
        choices: [{ index: 0, delta: { role: "assistant", content: "OK" }, finish_reason: null }],
      })}\n\n`);
      response.write(`data: ${JSON.stringify({
        id: "chatcmpl-local-probe",
        object: "chat.completion.chunk",
        created: Math.floor(Date.now() / 1000),
        model: "upstream-probe",
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      })}\n\n`);
      response.end("data: [DONE]\n\n");
    });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    const address = upstream.address();
    if (!address || typeof address === "string") throw new Error("local provider fixture failed to bind");
    await writeFile(join(grokHome, "config.toml"), `
[model."grok-desktop-env-probe"]
model = "upstream-probe"
base_url = "\${GROK_DESKTOP_PROBE_BASE_URL}"
name = "Environment expansion probe"
env_key = "GROK_DESKTOP_PROBE_KEY"
api_backend = "chat_completions"
context_window = 4096
max_completion_tokens = 1024
`, "utf8");
    const cliPath = await locateGrokCli("");
    if (!cliPath) throw new Error("installed Grok CLI was not found");
    const adapter = new GrokAcpAdapter({
      cliPath,
      cwd: workspace,
      env: {
        ...process.env,
        GROK_HOME: grokHome,
        GROK_DESKTOP_PROBE_BASE_URL: `http://127.0.0.1:${address.port}/v1`,
        GROK_DESKTOP_PROBE_KEY: "local-probe-placeholder",
      },
      effort: "",
      mode: "agent",
      modelId: "grok-desktop-env-probe",
      log: new LogService(join(root, "probe.log")),
    });
    try {
      await adapter.start();
      await adapter.prompt("Reply only OK.");
      expect(capturedUrl).toBe("/v1/chat/completions");
      expect(capturedAuthorization).toBe("Bearer local-probe-placeholder");
      expect(JSON.parse(capturedBody)).toMatchObject({ model: "upstream-probe" });
    } finally {
      await adapter.dispose();
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
    }
  }, 30_000);
});
