import { mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { buildGrokAgentArgs, buildPromptText, buildSessionAttachMeta, demuxProviderThinkingText, extractAcpToolDiff, FIRST_EVENT_DIAGNOSTIC_MS, FIRST_EVENT_WAIT_MS, GrokAcpAdapter, INTERACTIVE_PROMPT_TIMEOUT_MS, normalizeCliSessionInfo, normalizeCliSessionList, normalizeCliSessionUsage, normalizePromptQueue, normalizeRuntimeEventEnvelope, normalizeSessionCloseReceipt, resolveModelId, resolveSessionPlanFile } from "./grok-acp-adapter";
import { PROVIDER_THINKING_END, PROVIDER_THINKING_START } from "../../shared/provider-gateway-markers";

describe("Grok ACP process arguments", () => {
  it("sends the interactive Desktop attach policy on every session attach", () => {
    expect(buildSessionAttachMeta({ owner: "desktop" }, ["C:\\plugins\\one"])).toEqual({
      owner: "desktop",
      pluginDirs: ["C:\\plugins\\one"],
      startupHints: { nonInteractive: false, deliveryTools: [] },
    });
  });

  it("normalizes direct and wrapped x.ai runtime notifications", () => {
    expect(normalizeRuntimeEventEnvelope("_x.ai/mcp/server_status", { server: "demo", status: "ready" }, "s1")).toMatchObject({
      rawMethod: "_x.ai/mcp/server_status",
      method: "x.ai/mcp/server_status",
      sourceSessionId: "s1",
      payload: { server: "demo", status: "ready" },
    });
    expect(normalizeRuntimeEventEnvelope("_x.ai/notification", { method: "x.ai/mcp/tools_changed", params: { toolCount: 4 } })).toMatchObject({
      method: "x.ai/mcp/tools_changed",
      payload: { toolCount: 4 },
    });
  });

  it("parses Grok Build 1.0 close outcomes without collapsing unknown results", () => {
    expect(normalizeSessionCloseReceipt("s1", { _meta: { "x.ai/closeOutcome": "closed" } })).toMatchObject({
      sessionId: "s1", outcome: "closed", completed: true, rawOutcome: "closed",
    });
    expect(normalizeSessionCloseReceipt("s1", { _meta: { "x.ai/closeOutcome": "notResident" } })).toMatchObject({ outcome: "not-resident", completed: true });
    expect(normalizeSessionCloseReceipt("s1", { _meta: { "x.ai/closeOutcome": "superseded" } })).toMatchObject({ outcome: "superseded", completed: true });
    expect(normalizeSessionCloseReceipt("s1", {})).toMatchObject({ sessionId: "s1", outcome: "unknown", completed: false });
  });
  it("normalizes capability-gated official session surfaces without preserving raw payloads", () => {
    expect(normalizeCliSessionList({ sessions: [{ id: "s1", cwd: "C:\\work", name: "审计", model_id: "grok-4.5", message_count: 3 }], next_cursor: "next" })).toEqual({
      supported: true,
      sessions: [{ sessionId: "s1", cwd: "C:\\work", title: "审计", modelId: "grok-4.5", messageCount: 3 }],
      nextCursor: "next",
      source: "acp",
    });
    expect(normalizeCliSessionInfo("s1", { sessionId: "s1", mode_id: "plan", reasoning_effort: "high", title: "计划", model: "grok-build", resolvedModelId: "grok-4.5", context: { used: 75, total: 100, freeTokens: 25, usagePct: 75, compactionCount: 2, autoCompactThresholdPercent: 85 } })).toMatchObject({ supported: true, sessionId: "s1", title: "计划", mode: "plan", effort: "high", modelId: "grok-build", resolvedModelId: "grok-4.5", contextUsedTokens: 75, contextWindowTokens: 100, contextFreeTokens: 25, contextUsagePercent: 75, compactionCount: 2, autoCompactThresholdPercent: 85, source: "acp" });
    expect(normalizeCliSessionUsage("s1", { usage: { inputTokens: 10, outputTokens: 4, totalTokens: 14, cachedReadTokens: 8, costUsdTicks: 25_000_000, usageIsIncomplete: false, modelUsage: { "grok-build": { inputTokens: 10, outputTokens: 4 } } } })).toMatchObject({ supported: true, sessionId: "s1", inputTokens: 10, outputTokens: 4, totalTokens: 14, cachedReadTokens: 8, costUsdTicks: 25_000_000, costUsd: 0.0025, usageIsIncomplete: false, source: "acp" });
  });

  it("does not infer unsupported official session features", async () => {
    const adapter = Object.create(GrokAcpAdapter.prototype) as any;
    Object.assign(adapter, { sessionId: "s1", runtimeHandshake: { extensions: [], sessionCapabilities: {} } });
    adapter.extension = vi.fn().mockRejectedValue(new Error("Method not found (-32601)"));
    expect(await adapter.btw("hello")).toMatchObject({ accepted: false, source: "unsupported", sessionId: "s1" });
    expect(await adapter.sessionInfo()).toMatchObject({ supported: false, source: "unsupported", sessionId: "s1" });
    expect(await adapter.sessionUsage()).toMatchObject({ supported: false, source: "unsupported", sessionId: "s1" });
    expect(adapter.feedbackCapability()).toMatchObject({ available: false, source: "unavailable", sessionId: "s1" });
  });

  it("exposes and submits official feedback only when the live session advertises /feedback", async () => {
    const adapter = Object.create(GrokAcpAdapter.prototype) as any;
    adapter.sessionId = "s1";
    adapter.commands = [{ name: "feedback", description: "Send feedback" }];
    adapter.extension = vi.fn().mockResolvedValue({ result: { success: true } });
    expect(adapter.feedbackCapability()).toEqual({ available: true, sessionId: "s1", source: "available-command" });
    await expect(adapter.submitOfficialFeedback("  CLI 反馈  ")).resolves.toMatchObject({ submitted: true, sessionId: "s1" });
    expect(adapter.extension).toHaveBeenCalledWith("x.ai/feedback", { session_id: "s1", feedback_text: "CLI 反馈" });
  });

  it("uses standard ACP session/fork only when the runtime advertises it", async () => {
    const adapter = Object.create(GrokAcpAdapter.prototype) as any;
    adapter.launchAndInitialize = vi.fn().mockResolvedValue(undefined);
    adapter.runtimeHandshake = { sessionCapabilities: { fork: true } };
    adapter.options = { sessionMcpServers: [], sessionMeta: {}, pluginDirs: [], sessionAttachPolicy: undefined };
    adapter.request = vi.fn().mockResolvedValue({ sessionId: "child" });
    expect(await adapter.forkExternal("parent", "E:\\old", "C:\\new")).toEqual({ sessionId: "child" });
    expect(adapter.request).toHaveBeenCalledWith("session/fork", {
      sessionId: "parent", cwd: "C:\\new", mcpServers: [], _meta: expect.any(Object),
    }, 120_000);
  });

  it("fails closed before calling an unadvertised fork method", async () => {
    const adapter = Object.create(GrokAcpAdapter.prototype) as any;
    adapter.launchAndInitialize = vi.fn().mockResolvedValue(undefined);
    adapter.runtimeHandshake = { sessionCapabilities: {} };
    adapter.request = vi.fn();
    await expect(adapter.forkExternal("parent", "E:\\old", "C:\\new")).rejects.toThrow("未声明会话分叉能力");
    expect(adapter.request).not.toHaveBeenCalled();
  });

  it("keeps the CLI-reported mode when resuming instead of applying the current global default", async () => {
    const root = await mkdtemp(join(tmpdir(), "grok-resume-mode-"));
    try {
      const events: any[] = [];
      const adapter = Object.assign(Object.create(GrokAcpAdapter.prototype), {
        sessionId: "s1",
        mode: "agent",
        currentEffort: "high",
        currentModelId: "grok-4.5",
        requestedModelId: "grok-4.5",
        options: { cwd: root, modelId: "grok-4.5" },
        runtimeHandshake: { models: [], extensions: [], features: {} },
        promptQueue: [],
        commands: [],
        models: [],
        restoredQueueIds: new Set(),
        restoredQueueSeenIds: new Set(),
        persistRuntimePatch: vi.fn(),
        emitEvent: (event: any) => events.push(event),
        emitStatus: vi.fn(),
        applyMode: vi.fn(),
      }) as any;
      await adapter.completeSessionAttach({
        sessionId: "s1",
        models: { currentModelId: "grok-4.5", availableModels: [{ modelId: "grok-4.5", name: "Grok" }] },
        modes: { currentModeId: "plan", availableModes: [{ id: "agent", name: "Agent" }, { id: "plan", name: "Plan" }] },
      }, "s1");
      expect(adapter.mode).toBe("plan");
      expect(adapter.planActive).toBe(true);
      expect(adapter.applyMode).not.toHaveBeenCalled();
      expect(events).toContainEqual(expect.objectContaining({ type: "mode", sessionId: "s1", mode: "plan" }));
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("calls x.ai/btw and ACP session/list only after runtime evidence", async () => {
    const adapter = Object.create(GrokAcpAdapter.prototype) as any;
    adapter.sessionId = "s1";
    adapter.runtimeHandshake = { extensions: ["x.ai/btw", "x.ai/session/info", "x.ai/session/usage"], sessionCapabilities: { list: true } };
    adapter.extension = vi.fn(async (method: string) => method === "x.ai/btw" ? { result: { answer: "侧边回答", request_id: "btw-1" } } : { result: { title: "T" } });
    adapter.request = vi.fn(async () => ({ sessions: [{ id: "s1", title: "T" }] }));
    expect(await adapter.btw("侧边问题")).toMatchObject({ accepted: true, requestId: "btw-1", message: "侧边回答", source: "acp" });
    expect(adapter.extension).toHaveBeenCalledWith("x.ai/btw", { sessionId: "s1", question: "侧边问题" });
    expect(await adapter.officialSessionList("C:\\work")).toMatchObject({ supported: true, sessions: [{ sessionId: "s1", title: "T" }] });
    expect(adapter.request).toHaveBeenCalledWith("session/list", { cwd: "C:\\work" }, 20_000);
    await adapter.sessionInfo();
    await adapter.sessionUsage();
    expect(adapter.extension).toHaveBeenCalledWith("x.ai/session/info", { sessionId: "s1" });
    expect(adapter.extension).toHaveBeenCalledWith("x.ai/session/usage", { sessionId: "s1" });
    adapter.options = { cwd: "C:\\work" };
    adapter.extension.mockResolvedValueOnce({ result: { success: true } });
    await expect(adapter.renameSession("  Manual\nTitle  ")).resolves.toBe("official");
    expect(adapter.extension).toHaveBeenCalledWith("x.ai/session/rename", {
      title: "Manual Title",
      cwd: "C:\\work",
      kind: "build",
    });
    adapter.extension.mockResolvedValueOnce({ result: { files: [] } });
    await adapter.officialGitStatus("C:\\work");
    expect(adapter.extension).toHaveBeenCalledWith("x.ai/git/status", {
      sessionId: "s1",
      gitRoot: "C:\\work",
      includeUntracked: true,
      includeStats: true,
      includePatches: false,
      ignoreSubmodules: true,
    });
  });
  it("does not impose a Desktop wall-clock ceiling on interactive turns", () => {
    expect(INTERACTIVE_PROMPT_TIMEOUT_MS).toBeNull();
  });

  it("surfaces soft first-event diagnostics without cancelling the turn", () => {
    vi.useFakeTimers();
    try {
      const statuses: string[] = [];
      const runtime: string[] = [];
      const adapter = Object.create(GrokAcpAdapter.prototype) as any;
      Object.assign(adapter, {
        sessionId: "s1",
        activeTurn: { turnId: "t1" },
        emitStatus: (_status: string, text: string) => statuses.push(text),
        emitRuntimeUpdate: (_kind: string, name: string) => runtime.push(name),
      });
      adapter.startFirstEventWatchdog("t1");
      vi.advanceTimersByTime(FIRST_EVENT_WAIT_MS);
      expect(statuses).toContain("仍在等待 Grok 返回首个事件…");
      vi.advanceTimersByTime(FIRST_EVENT_DIAGNOSTIC_MS - FIRST_EVENT_WAIT_MS);
      expect(runtime).toEqual(["first-event-waiting", "first-event-diagnostic"]);
      expect(adapter.cancelRequested).not.toBe(true);
      adapter.markFirstTurnEvent();
      expect(adapter.firstEventTurnId).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(["none", "minimal", "low", "medium", "high", "xhigh"] as const)(
    "places reasoning effort before stdio for %s",
    (effort) => expect(buildGrokAgentArgs(effort)).toEqual(["--no-auto-update", "agent", "--reasoning-effort", effort, "stdio"]),
  );

  it("places repeatable process plugin fallbacks before stdio", () => {
    expect(buildGrokAgentArgs("low", ["C:\\plugins\\computer", "C:\\plugins\\extra"])).toEqual(["--no-auto-update", "agent", "--reasoning-effort", "low", "--plugin-dir", "C:\\plugins\\computer", "--plugin-dir", "C:\\plugins\\extra", "stdio"]);
  });

  it("supports the current --effort spelling when advertised by the CLI", () => {
    expect(buildGrokAgentArgs("high", [], "--effort")).toEqual(["--no-auto-update", "agent", "--effort", "high", "stdio"]);
  });

  it("maps an execution profile to one model, approval and Agent argument set", () => {
    expect(buildGrokAgentArgs("medium", [], "--reasoning-effort", { modelId: "grok-4.5", alwaysApprove: true, agentProfilePath: "C:\\AppData\\profile.md" })).toEqual(["--no-auto-update", "agent", "--model", "grok-4.5", "--reasoning-effort", "medium", "--always-approve", "--agent-profile", "C:\\AppData\\profile.md", "stdio"]);
  });

  it("retains restart-only launch context while deriving approval from the current mode", () => {
    const permissionDecider = vi.fn().mockResolvedValue(true);
    const adapter = new GrokAcpAdapter({
      cliPath: "grok",
      cwd: "C:\\workspace",
      env: process.env,
      effort: "high",
      modelId: "grok-test",
      mode: "plan",
      log: { log: vi.fn().mockResolvedValue(undefined) } as any,
      alwaysApprove: true,
      environmentOverride: { PROFILE_FLAG: "kept" },
      permissionDecider,
    });

    expect(adapter.processOptions).toMatchObject({
      alwaysApprove: false,
      environmentOverride: { PROFILE_FLAG: "kept" },
      permissionDecider,
    });
    adapter.mode = "auto";
    expect(adapter.processOptions.alwaysApprove).toBe(true);
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

  it("keeps managed local identity separate from a model_changed upstream alias", () => {
    const adapter = Object.create(GrokAcpAdapter.prototype) as any;
    Object.assign(adapter, {
      sessionId: "provider-session",
      providerLocalModelId: "cpa-grok-4.5",
      requestedModelId: "cpa-grok-4.5",
      currentModelId: "cpa-grok-4.5",
      upstreamModelId: "",
      currentEffort: "high",
      models: [{ modelId: "cpa-grok-4.5", name: "CPA · Grok 4.5" }],
      persistRuntimePatch: vi.fn(),
      emitEvent: vi.fn(),
    });
    adapter.handleModelChanged({ sessionUpdate: "model_changed", model_id: "grok-4.5" });
    expect(adapter.currentModelId).toBe("cpa-grok-4.5");
    expect(adapter.currentUpstreamModelId).toBe("grok-4.5");
    expect(adapter.persistRuntimePatch).toHaveBeenCalledWith({ modelId: "cpa-grok-4.5" });
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
      pendingInteractionRequestIds: new Map<string, string | number>(),
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

  it("auto-allows mutating Plan tools without rendering a permission card", async () => {
    const { adapter, writes, events } = permissionFixture();
    await adapter.handleServerRequest("session/request_permission", "unsafe-write", {
      toolCall: { kind: "write_file", title: "Write package.json" },
      options: [{ optionId: "allow", kind: "allow_once" }, { optionId: "deny", kind: "reject_once" }],
    });
    expect(writes).toContainEqual({ jsonrpc: "2.0", id: "unsafe-write", result: { outcome: { outcome: "selected", optionId: "allow" } } });
    expect(events.some((event) => event.type === "permission")).toBe(false);
  });

  it("auto-approves Auto mode even when the CLI uses a short allow kind", async () => {
    const { adapter, writes, events } = permissionFixture();
    adapter.planActive = false;
    adapter.mode = "auto";
    adapter.autoApprove = true;
    await adapter.handleServerRequest("session/request_permission", "auto-write", {
      toolCall: { kind: "execute", title: "npm install" },
      options: [{ optionId: "yes", kind: "allow" }, { optionId: "no", kind: "reject_once" }],
    });
    expect(writes).toContainEqual({ jsonrpc: "2.0", id: "auto-write", result: { outcome: { outcome: "selected", optionId: "yes" } } });
    expect(events.some((event) => event.type === "permission")).toBe(false);
  });

  it("does not consult a permission decider once Auto or Plan will approve", async () => {
    const { adapter, writes, events } = permissionFixture();
    adapter.options.permissionDecider = vi.fn().mockResolvedValue(false);
    await adapter.handleServerRequest("session/request_permission", "unsafe-write", {
      toolCall: { kind: "write_file", title: "Write package.json" },
      options: [{ optionId: "allow", kind: "allow_always" }, { optionId: "deny", kind: "reject_once" }],
    });
    expect(adapter.options.permissionDecider).not.toHaveBeenCalled();
    expect(writes).toContainEqual({ jsonrpc: "2.0", id: "unsafe-write", result: { outcome: { outcome: "selected", optionId: "allow" } } });
    expect(events.some((event) => event.type === "permission")).toBe(false);
  });

  it("returns the ACP cancelled outcome when an auto-approved tool has no allow option", async () => {
    const { adapter, writes, events } = permissionFixture();
    await adapter.handleServerRequest("session/request_permission", "no-allow", {
      toolCall: { kind: "other", title: "Unknown integration" },
      options: [{ optionId: "deny", kind: "reject_once" }],
    });
    expect(writes).toContainEqual({ jsonrpc: "2.0", id: "no-allow", result: { outcome: { outcome: "cancelled" } } });
    expect(writes.some((value) => value.id === "no-allow" && value.error)).toBe(false);
    expect(events.some((event) => event.type === "permission")).toBe(false);
  });

  it("allows Plan mode to write ordinary files and still records plan.md", async () => {
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
      const workspaceFile = join(cwd, "README.md");
      await adapter.handleServerRequest("fs/write_text_file", "workspace-write", { path: workspaceFile, content: "edited" });
      expect(await readFile(workspaceFile, "utf8")).toBe("edited");
      expect(writes).toContainEqual({ jsonrpc: "2.0", id: "workspace-write", result: {} });

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

  it("returns the Plan receipt immediately without waiting for mode reconciliation", async () => {
    const adapter = Object.create(GrokAcpAdapter.prototype) as any;
    let releaseMode!: () => void;
    const modePending = new Promise<void>((resolve) => { releaseMode = resolve; });
    const events: any[] = [];
    Object.assign(adapter, {
      sessionId: "plan-session",
      pendingPlanRequest: "plan-request",
      resolvedPlanRequests: new Map(),
      working: true,
      needsUser: true,
      mode: "plan",
      planActive: true,
      autoApprove: false,
      options: {},
      write: vi.fn(() => true),
      applyMode: vi.fn(() => modePending),
      emitEvent: vi.fn((event: unknown) => events.push(event)),
      emitStatus: vi.fn(),
      buildFailure: vi.fn(),
    });

    const receipt = await adapter.respondPlan("plan-request", "approved");
    expect(receipt).toMatchObject({ verdict: "approved", state: "accepted" });
    expect(adapter.pendingPlanRequest).toBeUndefined();
    expect(events).toContainEqual({ type: "interaction-resolved", sessionId: "plan-session", interaction: "plan", requestId: "plan-request", outcome: "approved" });
    expect(adapter.applyMode).toHaveBeenCalledWith("agent", false);
    expect(adapter.mode).toBe("agent");
    expect(adapter.planActive).toBe(false);
    releaseMode();
    await Promise.resolve();
  });

  it("persists the asynchronous mode reconciliation after a Plan decision", async () => {
    const runtime = vi.fn().mockResolvedValue(undefined);
    const adapter = Object.create(GrokAcpAdapter.prototype) as any;
    Object.assign(adapter, {
      sessionId: "plan-session",
      pendingPlanRequest: "plan-request",
      resolvedPlanRequests: new Map(),
      working: true,
      needsUser: true,
      mode: "plan",
      planActive: true,
      autoApprove: false,
      write: vi.fn(() => true),
      request: vi.fn().mockResolvedValue({}),
      options: { onRuntimeChanged: runtime, log: { log: vi.fn() } },
      emitEvent: vi.fn(),
      emitStatus: vi.fn(),
      buildFailure: vi.fn(),
    });

    await expect(adapter.respondPlan("plan-request", "approved")).resolves.toMatchObject({ state: "accepted" });
    await vi.waitFor(() => expect(runtime).toHaveBeenCalledWith("plan-session", { mode: "agent" }));
    expect(adapter.mode).toBe("agent");
    expect(adapter.planActive).toBe(false);
  });

  it("releases the old Plan gate immediately and keeps it released when mode reconciliation fails", async () => {
    const events: any[] = [];
    const adapter = Object.create(GrokAcpAdapter.prototype) as any;
    Object.assign(adapter, {
      sessionId: "plan-session",
      pendingPlanRequest: "plan-request",
      resolvedPlanRequests: new Map(),
      working: true,
      needsUser: true,
      mode: "plan",
      planActive: true,
      planGateReleased: false,
      autoApprove: false,
      write: vi.fn(() => true),
      options: { onRuntimeChanged: vi.fn().mockResolvedValue(undefined), log: { log: vi.fn() } },
      applyMode: vi.fn().mockRejectedValue(new Error("set_mode unavailable")),
      emitEvent: vi.fn((event: unknown) => events.push(event)),
      emitStatus: vi.fn(),
      buildFailure: vi.fn((message: string) => ({ failureId: "failure", at: "2026-08-05T00:00:00.000Z", classification: "unknown", message })),
    });

    await expect(adapter.respondPlan("plan-request", "approved")).resolves.toMatchObject({ state: "accepted" });
    expect(adapter.pendingPlanRequest).toBeUndefined();
    expect(adapter.needsUser).toBe(false);
    expect(adapter.planActive).toBe(false);
    await vi.waitFor(() => expect(events.some((event) => event.type === "error")).toBe(true));
    adapter.handleSessionUpdate({ sessionUpdate: "current_mode_update", currentModeId: "plan" });
    expect(adapter.mode).toBe("agent");
    expect(adapter.planActive).toBe(false);
    expect(events.find((event) => event.type === "error")?.failure.nextActions).toContain("计划决定已生效，旧 Plan 权限门控不会重新启用");
  });

  it("resolves every visible interaction before sending Stop", () => {
    const adapter = Object.create(GrokAcpAdapter.prototype) as any;
    const writes: any[] = [];
    const events: any[] = [];
    Object.assign(adapter, {
      sessionId: "plan-session",
      working: true,
      needsUser: true,
      cancelRequested: false,
      pendingPlanRequest: 17,
      pendingPermissionRequests: new Set(["11"]),
      pendingQuestionRequests: new Set(["13"]),
      pendingInteractionRequestIds: new Map([["11", 11], ["13", 13]]),
      write: vi.fn((value: unknown) => { writes.push(value); return true; }),
      emitEvent: vi.fn((event: unknown) => events.push(event)),
      emitStatus: vi.fn(),
    });

    adapter.cancel();
    expect(writes).toContainEqual({ jsonrpc: "2.0", id: 11, result: { outcome: { outcome: "cancelled" } } });
    expect(writes).toContainEqual({ jsonrpc: "2.0", id: 13, result: { outcome: "cancelled" } });
    expect(writes).toContainEqual({ jsonrpc: "2.0", id: 17, result: { outcome: "abandoned" } });
    expect(writes.at(-1)).toMatchObject({ method: "session/cancel", params: { sessionId: "plan-session" } });
    expect(events.filter((event) => event.type === "interaction-resolved")).toHaveLength(3);
    expect(adapter.pendingPlanRequest).toBeUndefined();
    expect(adapter.needsUser).toBe(false);
  });
});

describe("turn terminal ordering", () => {
  it("does not report a stopped prompt as completed when its RPC resolves first", async () => {
    const adapter = Object.create(GrokAcpAdapter.prototype) as any;
    const finishTurn = vi.fn();
    Object.assign(adapter, {
      sessionId: "cancel-session",
      currentModelId: "grok-4.5",
      working: false,
      needsUser: false,
      cancelRequested: false,
      activeTurn: undefined,
      options: {},
      beginTurn: vi.fn(() => ({ turnId: "turn-1" })),
      request: vi.fn(async () => {
        adapter.cancelRequested = true;
        return {};
      }),
      emitEvent: vi.fn(),
      emitStatus: vi.fn(),
      finishTurn,
      activatePendingQueuedTurn: vi.fn(),
    });

    await adapter.prompt("stop me");

    expect(finishTurn).toHaveBeenCalledWith("cancelled", undefined, "turn-1");
    expect(adapter.emitStatus).toHaveBeenLastCalledWith("idle", "已取消");
  });

  it("uses an explicit turn id to correct a settled turn without ending the next turn", () => {
    const events: any[] = [];
    const adapter = Object.create(GrokAcpAdapter.prototype) as any;
    const previous = { turnId: "turn-1", ordinal: 0, startedAt: "2026-08-05T00:00:00.000Z", completedAt: "2026-08-05T00:00:01.000Z", durationMs: 1_000, outcome: "completed" };
    Object.assign(adapter, {
      sessionId: "turn-session",
      currentModelId: "grok-4.5",
      activeTurn: { turnId: "turn-2", ordinal: 1, startedAt: "2026-08-05T00:00:02.000Z", monotonicStartedAt: performance.now() },
      settledTurns: new Map([["turn-1", previous]]),
      turnsAwaitingAuthoritativeTerminal: new Set(["turn-1"]),
      pending: new Map(),
      activeQueuedPromptId: undefined,
      working: true,
      needsUser: false,
      options: { log: { log: vi.fn().mockResolvedValue(undefined) } },
      emitEvent: vi.fn((event: unknown) => events.push(event)),
      emitStatus: vi.fn(),
      activatePendingQueuedTurn: vi.fn(),
    });

    adapter.handlePrivateSessionUpdate({ sessionUpdate: "turn_completed", turnId: "turn-1", status: "failed", usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 } });
    expect(adapter.activeTurn.turnId).toBe("turn-2");
    expect(adapter.working).toBe(true);
    expect(adapter.activatePendingQueuedTurn).not.toHaveBeenCalled();
    expect(events).toContainEqual(expect.objectContaining({
      type: "turn-completed",
      presentation: expect.objectContaining({ turnId: "turn-1", outcome: "failed", usage: expect.objectContaining({ totalTokens: 12, source: "acp-turn" }) }),
    }));
  });

  it("assigns an id-less late terminal to the awaiting settled turn before the active turn", () => {
    const events: any[] = [];
    const adapter = Object.create(GrokAcpAdapter.prototype) as any;
    Object.assign(adapter, {
      sessionId: "turn-session",
      currentModelId: "grok-4.5",
      activeTurn: { turnId: "turn-2", ordinal: 1, startedAt: "2026-08-05T00:00:02.000Z", monotonicStartedAt: performance.now() },
      settledTurns: new Map([["turn-1", { turnId: "turn-1", ordinal: 0, startedAt: "2026-08-05T00:00:00.000Z", completedAt: "2026-08-05T00:00:01.000Z", durationMs: 1_000, outcome: "completed" }]]),
      turnsAwaitingAuthoritativeTerminal: new Set(["turn-1"]),
      pending: new Map(),
      working: true,
      needsUser: false,
      options: { log: { log: vi.fn().mockResolvedValue(undefined) } },
      emitEvent: vi.fn((event: unknown) => events.push(event)),
      emitStatus: vi.fn(),
      activatePendingQueuedTurn: vi.fn(),
    });
    adapter.handlePrivateSessionUpdate({ sessionUpdate: "turn_completed", cancelled: true });
    expect(adapter.activeTurn.turnId).toBe("turn-2");
    expect(events).toContainEqual(expect.objectContaining({ type: "turn-completed", presentation: expect.objectContaining({ turnId: "turn-1", outcome: "cancelled" }) }));
  });
});

describe("Grok internal queue isolation", () => {
  it("registers queue confirmation before the one-way notification can be acknowledged", async () => {
    const adapter = Object.create(GrokAcpAdapter.prototype) as any;
    const entry = { id: "queued-edit", sessionId: "queue-session", text: "old", position: 0, createdAt: "2026-08-04T00:00:00.000Z", state: "queued" as const };
    Object.assign(adapter, {
      sessionId: "queue-session",
      promptQueue: [entry],
      queueRevision: 0,
      pendingQueueOperations: new Map(),
      emitEvent: vi.fn(),
      write: vi.fn(() => {
        expect(adapter.pendingQueueOperations.size).toBe(1);
        adapter.promptQueue = [{ ...entry, text: "new" }];
        adapter.confirmQueueOperations();
        return true;
      }),
    });

    await expect(adapter.editQueuedPrompt(entry.id, "new")).resolves.toMatchObject({ acknowledgement: "transport" });
    expect(adapter.pendingQueueOperations.size).toBe(0);
    expect(adapter.promptQueue).toEqual([expect.objectContaining({ id: entry.id, text: "new" })]);
  });

  it("rolls an unconfirmed interjection back to an editable queued entry", async () => {
    vi.useFakeTimers();
    try {
      const adapter = Object.create(GrokAcpAdapter.prototype) as any;
      const entry = { id: "queued-interject", sessionId: "queue-session", text: "original", position: 0, createdAt: "2026-08-04T00:00:00.000Z", state: "queued" as const };
      const events: any[] = [];
      Object.assign(adapter, {
        sessionId: "queue-session",
        promptQueue: [entry],
        queueRevision: 0,
        pendingQueueOperations: new Map(),
        emitEvent: vi.fn((event: unknown) => events.push(event)),
        buildFailure: vi.fn(() => ({ failureId: "queue-timeout", classification: "unknown", summary: "timeout", stage: "queue" })),
        write: vi.fn(() => true),
      });

      await adapter.interjectQueuedPrompt(entry.id, "edited");
      expect(adapter.promptQueue[0]).toMatchObject({ state: "interjected", text: "edited" });
      await vi.advanceTimersByTimeAsync(5_001);

      expect(adapter.promptQueue[0]).toMatchObject({ state: "queued", text: "original" });
      expect(events).toContainEqual(expect.objectContaining({ type: "error", message: expect.stringContaining("已恢复操作前状态") }));
      expect(events).toContainEqual(expect.objectContaining({ type: "prompt-queue", entries: [expect.objectContaining({ state: "queued" })] }));
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps queue ownership until the CLI confirms a one-way removal", async () => {
    const adapter = Object.create(GrokAcpAdapter.prototype) as any;
    const entry = {
      id: "queued-remove",
      sessionId: "queue-session",
      text: "remove me",
      position: 0,
      createdAt: "2026-08-04T00:00:00.000Z",
      state: "queued" as const,
      version: 3,
    };
    Object.assign(adapter, {
      sessionId: "queue-session",
      promptQueue: [entry],
      ownedQueuedPromptIds: new Set([entry.id]),
      restoredQueueIds: new Set<string>(),
      restoredQueueSeenIds: new Set<string>(),
      pendingQueueOperations: new Map(),
      emitEvent: vi.fn(),
      write: vi.fn(() => true),
    });

    const receipt = await adapter.removeQueuedPrompt(entry.id);
    expect(receipt).toMatchObject({ acknowledgement: "transport", state: "removed" });
    expect(adapter.ownedQueuedPromptIds.has(entry.id)).toBe(true);
    expect(adapter.pendingQueueOperations.size).toBe(1);

    await adapter.handleServerRequest("_x.ai/queue/changed", "remove-ack", { queue: [] });

    expect(adapter.ownedQueuedPromptIds.has(entry.id)).toBe(false);
    expect(adapter.pendingQueueOperations.size).toBe(0);
    expect(adapter.write).toHaveBeenCalledWith({ jsonrpc: "2.0", id: "remove-ack", result: {} });
  });

  it("re-submits only durable queue IDs that the resumed CLI did not replay", async () => {
    const adapter = Object.create(GrokAcpAdapter.prototype) as any;
    const submitQueuedRequest = vi.fn().mockReturnValue(new Promise(() => undefined));
    const queue = [
      { id: "already-restored", sessionId: "queue-session", text: "first", position: 0, createdAt: "2026-08-04T00:00:00.000Z", state: "queued" },
      { id: "missing-after-resume", sessionId: "queue-session", text: "second", position: 1, createdAt: "2026-08-04T00:00:01.000Z", state: "interjected" },
    ];
    Object.assign(adapter, {
      disposed: false,
      sessionId: "queue-session",
      promptQueue: queue,
      restoredQueueTimer: undefined,
      restoredQueueIds: new Set(queue.map((entry) => entry.id)),
      restoredQueueSeenIds: new Set(["already-restored"]),
      ownedQueuedPromptIds: new Set(queue.map((entry) => entry.id)),
      options: { log: { log: vi.fn() } },
      submitQueuedRequest,
    });

    await adapter.reconcileRestoredQueue();

    expect(submitQueuedRequest).toHaveBeenCalledTimes(1);
    expect(submitQueuedRequest).toHaveBeenCalledWith(
      expect.objectContaining({ id: "missing-after-resume" }),
      [{ type: "text", text: "second" }],
      true,
      true,
    );
  });

  it("persists an accepted queued prompt terminal state exactly once", async () => {
    const adapter = Object.create(GrokAcpAdapter.prototype) as any;
    const terminal = vi.fn();
    Object.assign(adapter, {
      sessionId: "queue-session",
      activeQueuedPromptId: "queued-1",
      activeQueuedPrompt: {
        id: "queued-1",
        sessionId: "queue-session",
        clientMessageId: "message-1",
        text: "follow up",
        position: 0,
        createdAt: "2026-08-04T00:00:00.000Z",
        state: "accepted",
      },
      promptQueue: [{
        id: "queued-1",
        sessionId: "queue-session",
        clientMessageId: "message-1",
        text: "follow up",
        position: 0,
        createdAt: "2026-08-04T00:00:00.000Z",
        state: "accepted",
      }],
      queueRevision: 0,
      ownedQueuedPromptIds: new Set(["queued-1"]),
      emit: vi.fn(),
      options: { onPromptQueueTerminal: terminal, log: { log: vi.fn() } },
    });

    adapter.persistActiveQueueTerminal("completed");
    adapter.persistActiveQueueTerminal("failed");
    await Promise.resolve();

    expect(terminal).toHaveBeenCalledTimes(1);
    expect(terminal).toHaveBeenCalledWith("queue-session", expect.objectContaining({ id: "queued-1", state: "completed" }));
    expect(adapter.activeQueuedPrompt).toBeUndefined();
    expect(adapter.activeQueuedPromptId).toBeUndefined();
    expect(adapter.ownedQueuedPromptIds.has("queued-1")).toBe(false);
  });

  it("restores an accepted queued turn after a process crash without duplicating its user message", async () => {
    const persist = vi.fn().mockResolvedValue(undefined);
    const entry = {
      id: "accepted-1",
      sessionId: "queue-session",
      clientMessageId: "message-1",
      text: "continue after restart",
      position: 0,
      createdAt: "2026-08-04T00:00:00.000Z",
      state: "accepted" as const,
    };
    const adapter = new GrokAcpAdapter({
      cliPath: "grok",
      cwd: "C:\\repo",
      env: process.env,
      effort: "high",
      modelId: "grok-test",
      mode: "agent",
      log: { log: vi.fn().mockResolvedValue(undefined) } as any,
      initialPromptQueue: [entry],
      onPromptQueueChanged: persist,
    });
    const events: any[] = [];
    adapter.sessionId = "queue-session";
    (adapter as any).write = vi.fn(() => true);
    adapter.on("event", (event) => events.push(event));

    await (adapter as any).handleServerRequest("_x.ai/queue/changed", "running-after-restart", {
      runningPromptId: entry.id,
      queue: [],
    });

    expect(adapter.queuedPrompts()).toEqual([expect.objectContaining({ id: entry.id, state: "accepted" })]);
    expect(events.filter((event) => event.type === "user-message")).toEqual([]);
    expect(persist).toHaveBeenCalledWith("queue-session", [expect.objectContaining({ id: entry.id, state: "accepted" })]);
    await adapter.dispose(10);
  });

  it("does not turn an ordinary direct prompt into a phantom queued turn", async () => {
    const adapter = Object.create(GrokAcpAdapter.prototype) as any;
    const writes: any[] = [];
    const events: any[] = [];
    Object.assign(adapter, {
      sessionId: "direct-session",
      promptQueue: [],
      ownedQueuedPromptIds: new Set<string>(),
      restoredQueueIds: new Set<string>(),
      restoredQueueSeenIds: new Set<string>(),
      pendingQueueOperations: new Map(),
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

describe("forward lifecycle compatibility", () => {
  function lifecycleAdapter() {
    const events: any[] = [];
    const logs: string[] = [];
    const adapter = Object.assign(Object.create(GrokAcpAdapter.prototype), {
      sessionId: "session-1",
      currentModelId: "grok-4.5",
      requestedModelId: "grok-4.5",
      currentEffort: "high",
      backgroundTasks: new Map(),
      completedBackgroundTasks: new Map(),
      recapHashes: new Set(),
      pendingRecaps: new Map(),
      promptQueue: [],
      ownedQueuedPromptIds: new Set(),
      restoredQueueIds: new Set(),
      restoredQueueSeenIds: new Set(),
      pendingQueueOperations: new Map(),
      queueRevision: 0,
      working: false,
      models: [],
      runtimeHandshake: { protocolVersion: 1, checkedAt: new Date().toISOString(), models: [], commands: [], extensions: [], features: { recap: false, rewind: false, cancelRewind: false, pluginDirectories: false, fsNotifications: false, voiceMode: false } },
      options: { log: { log: async (value: string) => { logs.push(value); } } },
      emitEvent: (event: any) => { events.push(event); },
      write: vi.fn(() => true),
    });
    return { adapter: adapter as any, events, logs };
  }

  async function eventFixture(version: "0.2.118" | "0.2.120" | "1.0.0") {
    return JSON.parse(await readFile(join(process.cwd(), "src", "main", "services", "fixtures", "cli-wire", `events-${version}.json`), "utf8")) as Array<{
      method: string;
      params: Record<string, unknown>;
    }>;
  }

  it("replays the sanitized 0.2.118 lifecycle fixture, including completion-before-background", async () => {
    const { adapter, events } = lifecycleAdapter();
    let requestId = 1;
    for (const item of await eventFixture("0.2.118")) await adapter.handleServerRequest(item.method, requestId++, item.params);
    expect(events).toContainEqual(expect.objectContaining({ type: "compact-status", status: "started" }));
    expect(events).toContainEqual(expect.objectContaining({ type: "compact-status", status: "cancelled", message: "user_cancelled" }));
    expect(events.filter((event) => event.type === "tool-call" && event.tool.rawInput?.taskId === "fixture-fast-task")).toEqual([
      expect.objectContaining({ tool: expect.objectContaining({ status: "completed", output: "fixture-output" }) }),
    ]);
    expect(events).toContainEqual(expect.objectContaining({ type: "session-recap", text: "Sanitized recap fixture." }));
  });

  it("forward-parses sanitized 0.2.120 extension fixtures without changing local Provider identity", async () => {
    const { adapter, events } = lifecycleAdapter();
    adapter.providerLocalModelId = "provider:fixture";
    adapter.currentEffort = "xhigh";
    let requestId = 1;
    for (const item of await eventFixture("0.2.120")) await adapter.handleServerRequest(item.method, requestId++, item.params);
    expect(adapter.currentModelId).toBe("provider:fixture");
    expect(adapter.currentEffort).toBe("xhigh");
    expect(adapter.runtimeHandshake.extensions).toEqual(expect.arrayContaining(["x.ai/follow_ups", "x.ai/models/update", "x.ai/settings/update"]));
    expect(events).toContainEqual(expect.objectContaining({ type: "follow-ups", responseId: "fixture-response" }));
    expect(events).toContainEqual(expect.objectContaining({ type: "runtime-update", update: expect.objectContaining({ kind: "settings", name: "settings/update" }) }));
  });

  it("consumes Grok Build 1.0 slash MCP events and keeps payloads bounded", async () => {
    const { adapter, events } = lifecycleAdapter();
    await adapter.handleServerRequest("x.ai/mcp/init_progress", "m1", { total: 2, connected: 1, sessionId: "s1", screenshot: "do-not-forward" });
    await adapter.handleServerRequest("_x.ai/mcp/server_status", "m2", { sessionId: "s1", name: "alpha", source: "local", status: "ready", reason: "initialized", tools: new Array(7).fill({}) });
    await adapter.handleServerRequest("x.ai/mcp_initialized", "m3", { sessionId: "s1", mcpToolCount: 7, elapsedMs: 250 });
    const updates = events.filter((event) => event.type === "runtime-update" && event.update.kind === "mcp");
    expect(updates).toHaveLength(3);
    expect(updates[0]).toMatchObject({ sessionId: "s1", update: { name: "mcp/init_progress", summary: "MCP 连接 1/2", data: { sessionId: "s1", total: 2, connected: 1 } } });
    expect(updates[1]).toMatchObject({ sessionId: "s1", update: { name: "mcp/server_status", summary: "alpha · ready", data: { sessionId: "s1", server: "alpha", source: "local", status: "ready", reason: "initialized", toolCount: 7 } } });
    expect(updates[2]).toMatchObject({ sessionId: "s1", update: { name: "mcp_initialized", summary: "MCP 初始化完成 · 7 个工具", data: { sessionId: "s1", toolCount: 7, elapsedMs: 250 } } });
    expect(JSON.stringify(updates)).not.toContain("do-not-forward");
  });

  it("replays the sanitized Grok Build 1.0 MCP fixture with the official field shapes", async () => {
    const { adapter, events } = lifecycleAdapter();
    let requestId = 1;
    for (const item of await eventFixture("1.0.0")) await adapter.handleServerRequest(item.method, `v1-${requestId++}`, item.params);
    const updates = events.filter((event) => event.type === "runtime-update" && event.update.kind === "mcp");
    expect(updates.map((event) => event.update.name)).toEqual([
      "mcp/init_progress",
      "mcp/server_status",
      "mcp/tools_changed",
      "mcp/servers_updated",
      "mcp_initialized",
    ]);
    expect(updates).toContainEqual(expect.objectContaining({ sessionId: "session-fixture", update: expect.objectContaining({ data: expect.objectContaining({ toolCount: 3 }) }) }));
    expect(events).toContainEqual(expect.objectContaining({ type: "prompt-queue", sessionId: "session-1", entries: [] }));
    expect(events).toContainEqual(expect.objectContaining({ type: "runtime-update", update: expect.objectContaining({ kind: "settings", name: "settings/update" }) }));
  });

  it("keeps a fast completed task terminal when backgrounded arrives later", () => {
    const { adapter, events } = lifecycleAdapter();
    adapter.handlePrivateSessionUpdate({ sessionUpdate: "task_completed", task_id: "fast", exit_code: 0, output: "done" });
    adapter.handlePrivateSessionUpdate({ sessionUpdate: "task_backgrounded", task_id: "fast", command: "echo done" });
    const updates = events.filter((event) => event.type === "tool-call" && event.tool.rawInput?.taskId === "fast");
    expect(updates).toHaveLength(1);
    expect(updates[0].tool.status).toBe("completed");
  });

  it("deduplicates recaps and exposes compact cancellation", () => {
    const { adapter, events } = lifecycleAdapter();
    adapter.handlePrivateSessionUpdate({ sessionUpdate: "SessionRecap", turn_id: "turn-1", recap: "Summary" });
    adapter.handlePrivateSessionUpdate({ sessionUpdate: "session_recap", turn_id: "turn-1", recap: "Summary" });
    adapter.handlePrivateSessionUpdate({ sessionUpdate: "AutoCompactCancelled", message: "stopped" });
    expect(events.filter((event) => event.type === "session-recap")).toHaveLength(1);
    expect(events).toContainEqual(expect.objectContaining({ type: "compact-status", status: "cancelled", message: "stopped" }));
  });

  it("logs only the method shape for unknown lifecycle events", async () => {
    const { adapter, logs } = lifecycleAdapter();
    adapter.handlePrivateSessionUpdate({ sessionUpdate: "future_secret_event", schemaVersion: 9, prompt: "do-not-log" });
    await Promise.resolve();
    expect(logs.join("\n")).toContain("future_secret_event");
    expect(logs.join("\n")).toContain("schema=9");
    expect(logs.join("\n")).not.toContain("do-not-log");
  });

  it("treats SessionSummaryGenerated as a title signal instead of a visible recap", async () => {
    const { adapter, events } = lifecycleAdapter();
    const fixture = JSON.parse(await readFile(join(process.cwd(), "src", "main", "services", "fixtures", "cli-wire", "session-rename-upstream-main.json"), "utf8"));
    await adapter.handleServerRequest(fixture.manualNotification.method, "rename", fixture.manualNotification.params);
    await adapter.handleServerRequest(fixture.resetNotification.method, "auto", fixture.resetNotification.params);
    expect(events).toContainEqual({ type: "session-title", sessionId: "session-1", title: "Pinned title", manual: true });
    expect(events).toContainEqual({ type: "session-title", sessionId: "session-1", title: "Automatic title", manual: false });
    expect(events.some((event) => event.type === "session-recap" && event.text === "Pinned title")).toBe(false);
  });

  it("preserves outer ACP metadata for 1.x SessionInfoUpdate title ownership", async () => {
    const { adapter, events } = lifecycleAdapter();
    const fixture = JSON.parse(await readFile(join(process.cwd(), "src", "main", "services", "fixtures", "cli-wire", "session-rename-upstream-main.json"), "utf8"));
    await adapter.onLine(JSON.stringify(fixture.standardManualNotification));
    await adapter.onLine(JSON.stringify(fixture.standardResetNotification));
    expect(events).toEqual(expect.arrayContaining([
      { type: "session-title", sessionId: "session-1", title: "Pinned title", manual: true },
      { type: "session-title", sessionId: "session-1", title: "", manual: false },
    ]));
  });

  it("buffers recaps until the session becomes idle", () => {
    const { adapter, events } = lifecycleAdapter();
    adapter.activeTurn = { turnId: "turn-live" };
    adapter.working = true;
    adapter.handlePrivateSessionUpdate({ sessionUpdate: "session_recap", turn_id: "turn-live", recap: "Later" });
    expect(events.filter((event) => event.type === "session-recap")).toEqual([]);
    adapter.activeTurn = undefined;
    adapter.working = false;
    adapter.flushPendingRecapsIfIdle();
    expect(events).toContainEqual(expect.objectContaining({ type: "session-recap", turnId: "turn-live", text: "Later" }));
  });

  it("clears follow-up suggestions on an empty live update and ignores replay", async () => {
    const { adapter, events } = lifecycleAdapter();
    await adapter.handleServerRequest("x.ai/follow_ups", "live", { response_id: "r1", promptId: "p1", suggestions: [{ label: "继续" }] });
    await adapter.handleServerRequest("x.ai/follow_ups", "clear", { response_id: "r1", promptId: "p1", suggestions: [] });
    await adapter.handleServerRequest("x.ai/follow_ups", "replay", { response_id: "old", suggestions: [{ label: "过期" }], _meta: { isReplay: true } });
    expect(events.filter((event) => event.type === "follow-ups")).toEqual([
      expect.objectContaining({ responseId: "r1", promptId: "p1", suggestions: [expect.objectContaining({ text: "继续" })] }),
      expect.objectContaining({ responseId: "r1", promptId: "p1", suggestions: [] }),
    ]);
    expect(adapter.runtimeHandshake.extensions).toContain("x.ai/follow_ups");
  });

  it("applies a models/update without replacing a custom provider identity or effort", async () => {
    const { adapter, events } = lifecycleAdapter();
    adapter.providerLocalModelId = "provider:model";
    adapter.currentEffort = "xhigh";
    await adapter.handleServerRequest("x.ai/models/update", "models", {
      currentModelId: "upstream-model",
      availableModels: [{ modelId: "upstream-model", name: "Upstream", _meta: { supportsReasoningEffort: true, reasoningEfforts: [{ value: "high" }, { value: "xhigh" }] } }],
    });
    expect(adapter.currentModelId).toBe("provider:model");
    expect(adapter.currentEffort).toBe("xhigh");
    expect(events).toContainEqual(expect.objectContaining({ type: "session-ready", currentModelId: "provider:model", effort: "xhigh" }));
    expect(adapter.runtimeHandshake.extensions).toContain("x.ai/models/update");
  });
});
