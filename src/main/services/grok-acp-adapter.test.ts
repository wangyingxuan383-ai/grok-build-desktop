import { describe, expect, it } from "vitest";
import { buildGrokAgentArgs, buildPromptText, demuxProviderThinkingText, extractAcpToolDiff, normalizePromptQueue, resolveModelId } from "./grok-acp-adapter";
import { PROVIDER_THINKING_END, PROVIDER_THINKING_START } from "../../shared/provider-gateway-markers";

describe("Grok ACP process arguments", () => {
  it.each(["none", "minimal", "low", "medium", "high", "xhigh"] as const)(
    "places reasoning effort before stdio for %s",
    (effort) => expect(buildGrokAgentArgs(effort)).toEqual(["agent", "--reasoning-effort", effort, "stdio"]),
  );

  it("places repeatable process plugin fallbacks before stdio", () => {
    expect(buildGrokAgentArgs("low", ["C:\\plugins\\computer", "C:\\plugins\\extra"])).toEqual(["agent", "--reasoning-effort", "low", "--plugin-dir", "C:\\plugins\\computer", "--plugin-dir", "C:\\plugins\\extra", "stdio"]);
  });

  it("supports the current --effort spelling when advertised by the CLI", () => {
    expect(buildGrokAgentArgs("high", [], "--effort")).toEqual(["agent", "--effort", "high", "stdio"]);
  });

  it("maps an execution profile to one model, approval and Agent argument set", () => {
    expect(buildGrokAgentArgs("medium", [], "--reasoning-effort", { modelId: "grok-4.5", alwaysApprove: true, agentProfilePath: "C:\\AppData\\profile.md" })).toEqual(["agent", "--model", "grok-4.5", "--reasoning-effort", "medium", "--always-approve", "--agent-profile", "C:\\AppData\\profile.md", "stdio"]);
  });

  it("passes folder attachments as one path reference without recursive contents", () => {
    const text = buildPromptText("分析此目录", [{ id: "folder", name: "项目", path: "D:\\Workspace\\项目", kind: "folder" }]);
    expect(text).toContain("@D:\\Workspace\\项目");
    expect(text).not.toContain("node_modules");
  });

  it("does not duplicate cached image paths into prompt text", () => {
    const text = buildPromptText("看图", [{ id: "image", name: "paste.png", path: "C:\\private-cache\\paste.png", kind: "image", mimeType: "image/png" }]);
    expect(text).toBe("看图");
    expect(text).not.toContain("private-cache");
  });

  it("keeps the requested custom model when ACP reports only its upstream model id", () => {
    const models = [
      { modelId: "grok-4.5", name: "Grok 4.5" },
      { modelId: "openai-compatible-grok-4.5", name: "CPA 兼容 · grok-4.5" },
    ];
    expect(resolveModelId("grok-4.5", models, "openai-compatible-grok-4.5")).toBe("openai-compatible-grok-4.5");
    expect(resolveModelId("grok-4.5", models, "grok-4.5")).toBe("grok-4.5");
    expect(resolveModelId("another-model", models, "openai-compatible-grok-4.5")).toBe("another-model");
  });

  it("restores gateway-carried thinking across arbitrary ACP chunk boundaries", () => {
    let state = { pending: "", thought: false };
    const chunks: Array<{ role: "assistant" | "thought"; text: string }> = [];
    const wire = `before${PROVIDER_THINKING_START}private reasoning${PROVIDER_THINKING_END}after`;
    for (let index = 0; index < wire.length; index += 3) {
      const result = demuxProviderThinkingText(state, wire.slice(index, index + 3));
      state = result.state;
      chunks.push(...result.chunks);
    }
    const flushed = demuxProviderThinkingText(state, "", true);
    chunks.push(...flushed.chunks);
    expect(chunks.filter((chunk) => chunk.role === "assistant").map((chunk) => chunk.text).join("")).toBe("beforeafter");
    expect(chunks.filter((chunk) => chunk.role === "thought").map((chunk) => chunk.text).join("")).toBe("private reasoning");
    expect(flushed.state).toEqual({ pending: "", thought: false });
  });

  it("flushes an incomplete marker as ordinary visible text instead of dropping it", () => {
    const partial = PROVIDER_THINKING_START.slice(0, 7);
    const pending = demuxProviderThinkingText({ pending: "", thought: false }, partial);
    expect(pending.chunks).toEqual([]);
    expect(demuxProviderThinkingText(pending.state, "", true).chunks).toEqual([{ role: "assistant", text: partial }]);
  });

  it("normalizes the nested ACP diff block used by current Grok Build", () => {
    expect(extractAcpToolDiff({
      kind: "edit",
      content: [{ type: "diff", path: "C:\\work\\app.ts", oldText: "a\nb", newText: "a\nc\nd" }],
    })).toEqual({ path: "C:\\work\\app.ts", oldText: "a\nb", newText: "a\nc\nd", additions: 2, deletions: 1 });
  });

  it("does not downgrade an accepted interjection to a removable queued item when the CLI omits state", () => {
    const previous = [{
      id: "interjection-1",
      sessionId: "session-1",
      clientMessageId: "message-1",
      text: "安装 Docker",
      position: 0,
      createdAt: "2026-08-01T00:00:00.000Z",
      state: "interjected" as const,
    }];
    expect(normalizePromptQueue([{ id: "interjection-1", text: "安装 Docker", position: 0 }], "session-1", previous)[0]?.state).toBe("interjected");
  });
});
