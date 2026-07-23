import { describe, expect, it } from "vitest";
import { vi } from "vitest";
import { navigateToolLocation, toolLocationCandidates } from "./MessageCard";

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
