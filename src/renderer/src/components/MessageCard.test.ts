import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { vi } from "vitest";
import { isResolvedInteraction, MessageCard, navigateToolLocation, protectedActionScript, redactErrorText, summarizeError, toolLocationCandidates } from "./MessageCard";

describe("tool card editor locations", () => {
  it("normalizes ACP locations and file-tool raw inputs without duplicating targets", () => {
    expect(toolLocationCandidates({
      toolCallId: "tool-1",
      title: "Edit file",
      status: "completed",
      locations: [{ path: " src/main.ts ", line: 42 }, { path: "src/main.ts", line: 42 }, { path: "README.md", line: 0 }],
      rawInput: { file_path: "src/other.ts", line: 7 },
    })).toEqual([
      { path: "src/main.ts", line: 42 },
      { path: "README.md", line: undefined },
      { path: "src/other.ts", line: 7 },
    ]);
  });

  it("opens an editable result in the workbench at the requested line", async () => {
    const document = { path: "C:\\repo\\src\\main.ts", workspacePath: "C:\\repo", relativePath: "src/main.ts" } as never;
    const actions = { resolveWorkspace: vi.fn().mockResolvedValue("C:\\repo"), open: vi.fn().mockResolvedValue({ kind: "document", document }), openExternal: vi.fn(), openDocument: vi.fn() };
    await expect(navigateToolLocation("src/main.ts", 42, actions)).resolves.toBe("document");
    expect(actions.open).toHaveBeenCalledWith("C:\\repo", "src/main.ts");
    expect(actions.openDocument).toHaveBeenCalledWith(document, 42);
    expect(actions.openExternal).not.toHaveBeenCalled();
  });

  it("routes oversized external results without creating an editor tab", async () => {
    const actions = { resolveWorkspace: vi.fn().mockResolvedValue("C:\\repo"), open: vi.fn().mockResolvedValue({ kind: "external", path: "C:\\repo\\large.log", relativePath: "large.log", byteLength: 30_000_000, reason: "too large" }), openExternal: vi.fn().mockResolvedValue(undefined), openDocument: vi.fn() };
    await expect(navigateToolLocation("large.log", undefined, actions)).resolves.toBe("external");
    expect(actions.openExternal).toHaveBeenCalledWith("C:\\repo\\large.log");
    expect(actions.openDocument).not.toHaveBeenCalled();
  });
});

describe("structured provider errors", () => {
  it("keeps status/provider/trace diagnostics while redacting credentials and the local user path", () => {
    const safe = redactErrorText('HTTP 400\nProvider: antigravity\nTrace: trace-123\n{"Authorization":["Bearer super-secret"],"x-api-key":"key-secret"}\nC:\\Users\\wang\\private');
    expect(safe).toContain("HTTP 400");
    expect(safe).toContain("Provider: antigravity");
    expect(safe).toContain("Trace: trace-123");
    expect(safe).toContain("C:\\Users\\[USER]\\private");
    expect(safe).not.toContain("super-secret");
    expect(safe).not.toContain("key-secret");
    expect(summarizeError(safe)).toContain("HTTP 400 · Provider antigravity");
  });
});

describe("resolved interaction cards", () => {
  it("shows the complete protected script instead of truncating it into the title", () => {
    const script = "Get-ChildItem -Recurse | Select-String -Pattern '测试'";
    expect(protectedActionScript({ title: "运行命令", rawInput: { command: script } })).toBe(script);
    expect(renderToStaticMarkup(createElement(MessageCard, {
      message: { id: "permission-script", kind: "permission", request: { requestId: 1, sessionId: "session", toolCall: { title: "运行命令", rawInput: { command: script } }, options: [] } } as never,
      sessionId: "session",
      showThinking: true,
      expandTools: false,
    }))).toContain("查看完整命令");
  });

  it.each([
    { id: "permission-1", kind: "permission", resolved: true, request: { requestId: 1, sessionId: "session", toolCall: {}, options: [] } },
    { id: "question-1", kind: "question", resolved: true, requestId: 1, questions: [] },
    { id: "plan-1", kind: "plan", resolved: true, requestId: 1, text: "Plan", interactive: true },
  ] as const)("removes a resolved $kind decision surface immediately", (message) => {
    expect(isResolvedInteraction(message as never)).toBe(true);
    expect(renderToStaticMarkup(createElement(MessageCard, {
      message: message as never,
      sessionId: "session",
      showThinking: true,
      expandTools: false,
    }))).toBe("");
  });

  it("keeps an unresolved decision visible", () => {
    const message = { id: "permission-1", kind: "permission", request: { requestId: 1, sessionId: "session", toolCall: {}, options: [] } } as const;
    expect(isResolvedInteraction(message as never)).toBe(false);
    expect(renderToStaticMarkup(createElement(MessageCard, {
      message: message as never,
      sessionId: "session",
      showThinking: true,
      expandTools: false,
    }))).toContain("需要批准");
  });
});
