import { describe, expect, it } from "vitest";
import { buildGrokAgentArgs, buildPromptText } from "./grok-acp-adapter";

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

  it("passes folder attachments as one path reference without recursive contents", () => {
    const text = buildPromptText("分析此目录", [{ id: "folder", name: "项目", path: "D:\\Workspace\\项目", kind: "folder" }]);
    expect(text).toContain("@D:\\Workspace\\项目");
    expect(text).not.toContain("node_modules");
  });
});
