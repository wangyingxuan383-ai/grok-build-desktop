import { describe, expect, it } from "vitest";
import type { ToolCallState } from "../../shared/types";
import { AgentChangeService } from "./agent-change-service";

const CWD = process.platform === "win32" ? "C:\\work" : "/work";
const abs = (name: string) => process.platform === "win32" ? `C:\\work\\${name.replace(/\//g, "\\")}` : `/work/${name}`;

function edit(patch: Partial<ToolCallState> & { path?: string }): ToolCallState {
  const { path = "src/app.ts", ...rest } = patch;
  return {
    toolCallId: "t1", title: "编辑文件", kind: "edit_file", status: "completed",
    locations: [{ path: abs(path) }], oldText: "before", newText: "after",
    ...rest,
  } as ToolCallState;
}

describe("agent change recording", () => {
  it("records a real write with its before/after text and a workspace-relative path", () => {
    const service = new AgentChangeService();
    expect(service.record("s", CWD, "turn-1", edit({}))).toBe(true);
    const [file] = service.index("s", "session").files;
    expect(file).toMatchObject({ path: "src/app.ts", before: "before", after: "after", baseline: "captured", status: "applied" });
    expect(file!.absolutePath).toBe(abs("src/app.ts"));
  });

  it("ignores tool calls that are not writes", () => {
    const service = new AgentChangeService();
    expect(service.record("s", CWD, "turn-1", edit({ kind: "read_file", oldText: undefined, newText: undefined }))).toBe(false);
    expect(service.index("s", "session").files).toHaveLength(0);
  });

  it("still records a write whose kind is generic but which carries a diff", () => {
    const service = new AgentChangeService();
    expect(service.record("s", CWD, "turn-1", edit({ kind: "apply_patch" }))).toBe(true);
  });

  it("marks a missing baseline instead of diffing against an empty string", () => {
    const service = new AgentChangeService();
    service.record("s", CWD, "turn-1", edit({ oldText: undefined }));
    expect(service.index("s", "session").files[0]).toMatchObject({ baseline: "missing-before", after: "after" });
  });

  it("scopes to the latest turn, and keeps the earliest baseline when a file is edited repeatedly", () => {
    const service = new AgentChangeService();
    service.record("s", CWD, "turn-1", edit({ toolCallId: "a", oldText: "v1", newText: "v2" }));
    service.record("s", CWD, "turn-2", edit({ toolCallId: "b", oldText: "v2", newText: "v3" }));
    service.record("s", CWD, "turn-2", edit({ toolCallId: "c", path: "docs/readme.md" }));

    const lastTurn = service.index("s", "last-turn");
    expect(lastTurn.files.map((file) => file.path).sort()).toEqual(["docs/readme.md", "src/app.ts"]);

    const session = service.index("s", "session");
    const app = session.files.find((file) => file.path === "src/app.ts");
    // The whole journey: the first baseline against the latest result.
    expect(app).toMatchObject({ before: "v1", after: "v3" });
  });

  it("keeps the earliest baseline truncation flag with the baseline it describes", () => {
    const service = new AgentChangeService();
    const large = "界".repeat(100_000);
    service.record("s", CWD, "turn-1", edit({ toolCallId: "a", oldText: large, newText: "v2" }));
    service.record("s", CWD, "turn-2", edit({ toolCallId: "b", oldText: "v2", newText: "v3" }));

    const file = service.index("s", "session").files[0]!;
    expect(file.beforeTruncated).toBe(true);
    expect(Buffer.byteLength(file.before ?? "", "utf8")).toBeLessThanOrEqual(256 * 1024);
    expect(file.before?.endsWith("�")).toBe(false);
  });

  it("records a failed write as failed rather than dropping it", () => {
    const service = new AgentChangeService();
    service.record("s", CWD, "turn-1", edit({ status: "failed" }));
    expect(service.index("s", "session").files[0]?.status).toBe("failed");
  });

  it("keeps sessions apart and clears on request", () => {
    const service = new AgentChangeService();
    service.record("a", CWD, "t", edit({}));
    expect(service.index("b", "session").files).toHaveLength(0);
    service.clear("a");
    expect(service.index("a", "session").files).toHaveLength(0);
  });
});
