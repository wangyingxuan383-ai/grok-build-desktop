import { mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { buildGrokAgentArgs, buildPromptText, demuxProviderThinkingText, extractAcpToolDiff, GrokAcpAdapter, INTERACTIVE_PROMPT_TIMEOUT_MS, normalizePromptQueue, resolveModelId, resolveSessionPlanFile } from "./grok-acp-adapter";
import { PROVIDER_THINKING_END, PROVIDER_THINKING_START } from "../../shared/provider-gateway-markers";

describe("Grok ACP process arguments", () => {
  it("does not impose a Desktop wall-clock ceiling on interactive turns", () => {
    expect(INTERACTIVE_PROMPT_TIMEOUT_MS).toBeNull();
  });

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

describe("Plan permission handling", () => {
  function permissionFixture() {
    const adapter = Object.create(GrokAcpAdapter.prototype) as any;
    const writes: any[] = [];
    const events: any[] = [];
    Object.assign(adapter, {
      sessionId: "plan-session",
      planActive: true,
      autoApprove: false,
      working: true,
      needsUser: false,
      pendingPermissionRequests: new Set<string>(),
      options: {},
      write: vi.fn((value: unknown) => { writes.push(value); return true; }),
      emitEvent: vi.fn((event: unknown) => events.push(event)),
    });
    return { adapter, writes, events };
  }

  it("auto-allows read-only Plan tools without rendering a permission card", async () => {
    const { adapter, writes, events } = permissionFixture();
    await adapter.handleServerRequest("session/request_permission", "safe-read", {
      toolCall: { kind: "read_file", title: "Read package.json" },
      options: [{ optionId: "allow", kind: "allow_once" }, { optionId: "deny", kind: "reject_once" }],
    });
    expect(writes).toContainEqual({ jsonrpc: "2.0", id: "safe-read", result: { outcome: { outcome: "selected", optionId: "allow" } } });
    expect(events.some((event) => event.type === "permission")).toBe(false);
  });

  it("auto-rejects mutating Plan tools without rendering a permission card", async () => {
    const { adapter, writes, events } = permissionFixture();
    await adapter.handleServerRequest("session/request_permission", "unsafe-write", {
      toolCall: { kind: "write_file", title: "Write package.json" },
      options: [{ optionId: "allow", kind: "allow_once" }, { optionId: "deny", kind: "reject_once" }],
    });
    expect(writes).toContainEqual({ jsonrpc: "2.0", id: "unsafe-write", result: { outcome: { outcome: "selected", optionId: "deny" } } });
    expect(events.some((event) => event.type === "permission")).toBe(false);
  });

  it("returns the ACP cancelled outcome when a rejected Plan tool has no reject option", async () => {
    const { adapter, writes, events } = permissionFixture();
    await adapter.handleServerRequest("session/request_permission", "unsafe-no-reject", {
      toolCall: { kind: "other", title: "Search-looking unknown integration" },
      options: [{ optionId: "allow", kind: "allow_once" }],
    });
    expect(writes).toContainEqual({ jsonrpc: "2.0", id: "unsafe-no-reject", result: { outcome: { outcome: "cancelled" } } });
    expect(writes.some((value) => value.id === "unsafe-no-reject" && value.error)).toBe(false);
    expect(events.some((event) => event.type === "permission")).toBe(false);
  });

  it("enforces the exact session plan.md as the only Plan write target", async () => {
    const root = await mkdtemp(join(tmpdir(), "grok-plan-write-gate-"));
    const cwd = join(root, "workspace");
    const grokHome = join(root, ".grok");
    await mkdir(cwd, { recursive: true });
    const adapter = Object.create(GrokAcpAdapter.prototype) as any;
    const writes: any[] = [];
    const events: any[] = [];
    Object.assign(adapter, {
      sessionId: "plan-session",
      planActive: true,
      options: { cwd, env: { GROK_HOME: grokHome } },
      write: vi.fn((value: unknown) => { writes.push(value); return true; }),
      emitEvent: vi.fn((event: unknown) => events.push(event)),
    });
    try {
      const external = join(root, "outside.txt");
      await adapter.handleServerRequest("fs/write_text_file", "external-write", { path: external, content: "blocked" });
      expect(writes).toContainEqual(expect.objectContaining({ id: "external-write", error: expect.objectContaining({ code: -32010 }) }));
      expect(await stat(external).then(() => true).catch(() => false)).toBe(false);

      const planPath = await resolveSessionPlanFile(cwd, "plan-session", grokHome);
      await adapter.handleServerRequest("fs/write_text_file", "plan-write", { path: planPath, content: "# Safe plan" });
      expect(await readFile(planPath, "utf8")).toBe("# Safe plan");
      expect(writes).toContainEqual({ jsonrpc: "2.0", id: "plan-write", result: {} });
      expect(events).toContainEqual({ type: "plan", sessionId: "plan-session", text: "# Safe plan" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not claim Plan mode when session/set_mode fails", async () => {
    const adapter = Object.create(GrokAcpAdapter.prototype) as any;
    const events: any[] = [];
    Object.assign(adapter, {
      sessionId: "plan-session",
      mode: "agent",
      planActive: false,
      autoApprove: false,
      request: vi.fn().mockRejectedValue(new Error("set_mode rejected")),
      emitEvent: vi.fn((event: unknown) => events.push(event)),
    });

    await expect(adapter.applyMode("plan")).rejects.toThrow("set_mode rejected");
    expect(adapter.mode).toBe("agent");
    expect(adapter.planActive).toBe(false);
    expect(events.some((event) => event.type === "mode")).toBe(false);
  });

  it("synchronizes the adapter mode from replayed current_mode_update", () => {
    const adapter = Object.create(GrokAcpAdapter.prototype) as any;
    const events: any[] = [];
    Object.assign(adapter, {
      sessionId: "plan-session",
      mode: "agent",
      planActive: false,
      autoApprove: false,
      lastTouched: 0,
      emitEvent: vi.fn((event: unknown) => events.push(event)),
    });

    adapter.handleSessionUpdate({ sessionUpdate: "current_mode_update", currentModeId: "plan" });
    expect(adapter.mode).toBe("plan");
    expect(adapter.planActive).toBe(true);
    expect(events).toContainEqual({ type: "mode", sessionId: "plan-session", mode: "plan" });
  });
});

describe("Grok internal queue isolation", () => {
  it("does not turn an ordinary direct prompt into a phantom queued turn", async () => {
    const adapter = Object.create(GrokAcpAdapter.prototype) as any;
    const writes: any[] = [];
    const events: any[] = [];
    Object.assign(adapter, {
      sessionId: "direct-session",
      promptQueue: [],
      ownedQueuedPromptIds: new Set<string>(),
      activeQueuedPromptId: undefined,
      pendingQueuedTurn: undefined,
      activeTurn: { turnId: "direct-turn" },
      write: vi.fn((value: unknown) => { writes.push(value); return true; }),
      emitEvent: vi.fn((event: unknown) => events.push(event)),
    });

    await adapter.handleServerRequest("_x.ai/queue/changed", "queue-snapshot", {
      queue: [{ id: "cli-internal-id", text: "ordinary prompt", state: "queued", position: 0 }],
    });
    await adapter.handleServerRequest("_x.ai/queue/changed", "queue-running", {
      runningPromptId: "cli-internal-id",
      queue: [{ id: "cli-internal-id", text: "ordinary prompt", state: "sending", position: 0 }],
    });

    expect(adapter.promptQueue).toEqual([]);
    expect(adapter.pendingQueuedTurn).toBeUndefined();
    expect(adapter.activeQueuedPromptId).toBeUndefined();
    expect(adapter.activeTurn.turnId).toBe("direct-turn");
    expect(events.filter((event) => event.type === "prompt-queue")).toEqual([
      expect.objectContaining({ entries: [] }),
      expect.objectContaining({ entries: [] }),
    ]);
    expect(writes).toContainEqual({ jsonrpc: "2.0", id: "queue-snapshot", result: {} });
    expect(writes).toContainEqual({ jsonrpc: "2.0", id: "queue-running", result: {} });
  });
});
