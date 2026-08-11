import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { hasIpcRuntimeSchema, validateIpcInvocation } from "./ipc-schema";

describe("IPC runtime schemas", () => {
  it("has an explicit runtime schema for every registered invoke channel", async () => {
    const source = await readFile(new URL("./ipc.ts", import.meta.url), "utf8");
    const channels = [...source.matchAll(/handle\("([^"]+)"/g)].map((match) => match[1]!);
    expect(channels.length).toBeGreaterThan(200);
    expect(channels.filter((channel) => !hasIpcRuntimeSchema(channel))).toEqual([]);
  });

  it("applies a bounded generic schema to every channel", () => {
    expect(() => validateIpcInvocation("workspace:search-files", ["D:\\repo", "query", 20], 3)).not.toThrow();
    expect(() => validateIpcInvocation("workspace:search-files", ["D:\\repo", "query", 20, "extra"], 3)).toThrow("参数数量");
    expect(() => validateIpcInvocation("workspace:search-files", ["D:\\repo\0escape", "query"], 3)).toThrow("NUL");
    expect(() => validateIpcInvocation("draft:set", ["key", "x".repeat(33 * 1024 * 1024)], 4)).toThrow("超过限制");
  });

  it("accepts explicit undefined placeholders and the workspace-tree root sentinel", () => {
    expect(() => validateIpcInvocation("workspace:tree:list", ["D:\\repo", "", { showHidden: false }], 3)).not.toThrow();
    expect(() => validateIpcInvocation("workspace:tree:list", ["D:\\repo", undefined, undefined], 3)).not.toThrow();
    expect(() => validateIpcInvocation("session:list", [undefined, undefined], 2)).not.toThrow();
    expect(() => validateIpcInvocation("workspace:tree:list", ["D:\\repo", null, undefined], 3)).toThrow("有效字符串");
  });

  it("rejects invalid destructive confirmations before the controller", () => {
    expect(() => validateIpcInvocation("editor:delete", ["D:\\repo", "file.txt", false], 3)).not.toThrow();
    expect(() => validateIpcInvocation("editor:delete", ["D:\\repo", "file.txt", "yes"], 3)).toThrow("布尔值");
    expect(() => validateIpcInvocation("worktree:apply", ["D:\\repo", "tree", "", true], 5)).toThrow("有效字符串");
    expect(() => validateIpcInvocation("worktree:apply", ["D:\\repo", "tree", "confirm", true, "cleanup"], 5)).toThrow("布尔值");
    expect(() => validateIpcInvocation("plan:respond", ["session", "request", "execute"], 4)).toThrow("允许范围");
    expect(() => validateIpcInvocation("plan:respond", ["session", "request", "approved", ""], 4)).not.toThrow();
  });

  it("rejects unsafe URLs and prototype-shaped fields", () => {
    expect(() => validateIpcInvocation("system:open-external", ["file:///C:/Windows/win.ini"], 1)).toThrow("HTTP/HTTPS");
    const unsafe = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(unsafe, "__proto__", { value: { polluted: true }, enumerable: true });
    expect(() => validateIpcInvocation("providers:upsert", [unsafe], 1)).toThrow("危险字段");
  });

  it("rejects forged media paths, malformed interaction ids and oversized queues", () => {
    expect(() => validateIpcInvocation("system:open-media", ["C:\\Users\\someone\\private.mp4"], 1)).toThrow("受控媒体句柄");
    expect(() => validateIpcInvocation("system:open-media", ["grok-media://access/2f0c2e69-5f7b-455a-8f04-e8eaa60acfae"], 1)).not.toThrow();
    expect(() => validateIpcInvocation("system:copy-image", ["grok-media://local/?path=C%3A%5Cprivate.png"], 1)).toThrow("受控媒体句柄");
    expect(() => validateIpcInvocation("permission:respond", ["session", { forged: true }, "allow"], 3)).toThrow("有效字符串");
    expect(() => validateIpcInvocation("session:queue:reorder", ["session", "entry", -1], 3)).toThrow("整数");
    expect(() => validateIpcInvocation("session:send", ["session", "hello", Array.from({ length: 129 }, () => ({}))], 4)).toThrow("附件列表");
    expect(() => validateIpcInvocation("session:send", ["session", "hello", [{ id: "a", name: "x", kind: "executable" }]], 4)).toThrow("类型无效");
  });

  it("allows the pre-settings empty workspace sentinel for session listing", () => {
    expect(() => validateIpcInvocation("session:list", [""], 2)).not.toThrow();
    expect(() => validateIpcInvocation("session:list", [undefined], 2)).not.toThrow();
    expect(() => validateIpcInvocation("session:list", ["C:\\workspace", null], 2)).not.toThrow();
    expect(() => validateIpcInvocation("session:list", ["C:\\workspace", ""], 2)).not.toThrow();
    expect(() => validateIpcInvocation("session:list", ["C:\\workspace", "query"], 2)).not.toThrow();
  });

  it("validates sensitive object payload fields instead of trusting TypeScript casts", () => {
    expect(() => validateIpcInvocation("editor:save", [{ workspacePath: "D:\\repo", path: "a.ts", content: "", encoding: "utf8", lineEnding: "lf", expectedHash: "", expectedModifiedAt: "" }], 1)).not.toThrow();
    expect(() => validateIpcInvocation("editor:save", [{ workspacePath: "D:\\repo", path: "a.ts", content: "", encoding: "utf16", lineEnding: "lf", expectedHash: "", expectedModifiedAt: "" }], 1)).toThrow("encoding");
    expect(() => validateIpcInvocation("system:open-target", [{ target: "D:\\repo", action: "delete" }], 1)).toThrow("action");
    expect(() => validateIpcInvocation("git:review:hunk", ["D:\\repo", { snapshotId: "s", scope: { kind: "commit", revision: "HEAD" }, fileId: "f", hunkId: "h", action: "stage" }], 2)).toThrow("范围");
    expect(() => validateIpcInvocation("providers:scan:start", [{ providerId: "p", protocols: ["responses"], context: { mode: "safe", maxRequests: 3 } }], 1)).not.toThrow();
    expect(() => validateIpcInvocation("providers:scan:start", [{ providerId: "p", protocols: ["unknown"] }], 1)).toThrow("协议");
    expect(() => validateIpcInvocation("media:start", [{ sessionId: "s", kind: "image", prompt: "cat", aspectRatio: "1:1", referencePaths: [], extra: true }], 1)).toThrow("未知字段");
    expect(() => validateIpcInvocation("computer:start", [{ sessionId: "s", appId: "app", windowId: "w", executable: "cmd.exe" }], 1)).toThrow("未知字段");
  });

  it("binds settings and filesystem channels to their declared purpose", () => {
    expect(() => validateIpcInvocation("settings:update", [{
      cliPath: "C:\\Users\\user\\.grok\\bin\\grok.exe",
      httpProxy: "http://127.0.0.1:7890",
      defaultEffort: "xhigh",
      defaultMode: "plan",
      fontScale: 100,
      uiDensity: "compact",
      activeWorkspace: "D:\\repo",
      sessionGroupCollapsed: { normal: false, automation: true },
    }], 1)).not.toThrow();
    expect(() => validateIpcInvocation("settings:update", [{ cliPath: "C:\\Windows\\System32\\cmd.exe" }], 1)).toThrow("Grok CLI");
    expect(() => validateIpcInvocation("settings:update", [{ cliPath: "grok.exe" }], 1)).toThrow("绝对路径");
    expect(() => validateIpcInvocation("settings:update", [{ fontScale: 500 }], 1)).toThrow("85-130");
    expect(() => validateIpcInvocation("settings:update", [{ unexpected: true }], 1)).toThrow("未知字段");

    expect(() => validateIpcInvocation("workspace:set", ["D:\\repo"], 1)).not.toThrow();
    expect(() => validateIpcInvocation("workspace:open-offline", ["E:\\missing-repo"], 1)).not.toThrow();
    expect(() => validateIpcInvocation("workspace:open-offline", ["E:\\missing-repo\0escape"], 1)).toThrow("NUL");
    expect(() => validateIpcInvocation("workspace:set", ["relative\\repo"], 1)).toThrow("绝对路径");
    expect(() => validateIpcInvocation("workspace:set", ["file:///C:/repo"], 1)).toThrow("URL");
    expect(() => validateIpcInvocation("workspace:set", ["\\\\?\\C:\\repo"], 1)).toThrow("设备命名空间");
    expect(() => validateIpcInvocation("system:open-path", ["D:\\repo\\README.md"], 1)).not.toThrow();
    expect(() => validateIpcInvocation("system:open-path", ["D:\\repo\\installer.exe"], 1)).toThrow("可执行扩展名");
    expect(() => validateIpcInvocation("attachments:paths", [["D:\\repo\\source.ts", "D:\\images\\cat.png"]], 1)).not.toThrow();
    expect(() => validateIpcInvocation("attachments:paths", [["D:\\repo\\source.ts"], "session-123"], 2)).not.toThrow();
    expect(() => validateIpcInvocation("attachments:dropped", [["D:\\images\\cat.png"]], 1)).not.toThrow();
    expect(() => validateIpcInvocation("attachments:paths", [["D:\\downloads\\payload.exe"]], 1)).toThrow("二进制扩展名");
    expect(() => validateIpcInvocation("attachments:paths", [["D:\\repo\\safe.txt:private-stream"]], 1)).toThrow("备用数据流");
    expect(() => validateIpcInvocation("attachments:paths", [["https://example.test/private.txt"]], 1)).toThrow("URL");
  });

  it("validates automation patches, cancellation and inactivity policy", () => {
    expect(() => validateIpcInvocation("automations:run:cancel", ["run-id"], 1)).not.toThrow();
    expect(() => validateIpcInvocation("automations:update", ["task-id", { enabled: false, profile: { effort: "xhigh" } }], 2)).not.toThrow();
    expect(() => validateIpcInvocation("automations:update", ["task-id", { enabled: "no" }], 2)).toThrow("布尔值");
    expect(() => validateIpcInvocation("automations:policy:update", [{ inactivityTimeoutMinutes: 0 }], 1)).not.toThrow();
    expect(() => validateIpcInvocation("automations:policy:update", [{ inactivityTimeoutMinutes: -1 }], 1)).toThrow("0-10080");
  });

  it("validates draft-first session launch and persisted new-task fields", () => {
    const launch = { workspacePath: "D:\\repo", profileId: "builtin-normal", modelId: "provider-model", providerId: "provider", effort: "xhigh", mode: "plan" };
    expect(() => validateIpcInvocation("session:create", [launch], 1)).not.toThrow();
    expect(() => validateIpcInvocation("session:create", [{ ...launch, mode: "unsafe" }], 1)).toThrow("mode");
    expect(() => validateIpcInvocation("session:create", [{ ...launch, extra: true }], 1)).toThrow("未知字段");
    expect(() => validateIpcInvocation("session:create", [{ ...launch, workspacePath: "relative\\repo" }], 1)).toThrow("绝对路径");

    const newTask = { projectId: "project-abc", workspacePath: "D:\\repo", modelId: "provider-model", effort: "high", mode: "agent" };
    expect(() => validateIpcInvocation("draft:set", ["new:project-abc", "draft", undefined, [], newTask], 5)).not.toThrow();
    expect(() => validateIpcInvocation("draft:set", ["new:project-abc", "draft", undefined, [], { ...newTask, providerSecret: "forged" }], 5)).toThrow("未知字段");
  });
});
