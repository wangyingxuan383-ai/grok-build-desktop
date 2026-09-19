import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { DesktopToolAuthority } from "./desktop-tool-authority";

describe("Desktop caller authority", () => {
  it("rejects inherited connections and unverified CLI calls", () => {
    const authority = new DesktopToolAuthority(); authority.bind("parent");
    expect(authority.authorize({ sessionId: "child", toolName: "grok_desktop__automation_delete", toolInput: { id: "task" } })).toMatchObject({ decision: "deny" });
    expect(() => authority.consume("grok_desktop__automation_delete", { id: "task" })).toThrow("调用证明");
  });
  it("binds a one-use proof to exact tool, input and parent lease", () => {
    const authority = new DesktopToolAuthority(); authority.bind("parent");
    const grant = () => (authority.authorize({ sessionId: "parent", toolName: "grok_desktop__automation_delete", toolInput: { id: "task" } }) as any).hookSpecificOutput.updatedInput;
    const input = grant(); expect(authority.consume("grok_desktop__automation_delete", input)).toEqual({ id: "task" });
    expect(authority.evidence().state).toBe("verified-call");
    expect(() => authority.consume("grok_desktop__automation_delete", input)).toThrow();
    expect(() => authority.consume("grok_desktop__automation_delete", { ...grant(), id: "other" })).toThrow();
    expect(() => authority.consume("grok_desktop_computer__click", grant())).toThrow();
    const stale = grant(); authority.bind("replacement"); expect(() => authority.consume("grok_desktop__automation_delete", stale)).toThrow();
    expect(authority.evidence().state).toBe("unknown");
  });
  it("rejects incomplete or unbound hook input", () => {
    const authority = new DesktopToolAuthority();
    expect(authority.authorize({ sessionId: "", toolName: "grok_desktop__capabilities", toolInput: {} })).toMatchObject({ decision: "deny" });
    authority.bind("parent");
    expect(authority.authorize({ sessionId: "parent", toolName: "grok_desktop__capabilities", toolInput: {}, toolInputTruncated: true })).toMatchObject({ decision: "deny" });
  });
});


it("packages a loopback hook that rejects children and rewrites the parent's MCP input", async () => {
  const root = await mkdtemp(join(tmpdir(), "desktop-authority-")); const authority = new DesktopToolAuthority();
  try {
    const plugin = await authority.plugin(resolve("resources/plugins/grok-desktop"), root); authority.bind("parent");
    const config = JSON.parse(await readFile(join(plugin, "hooks", "hooks.json"), "utf8"));
    const url = config.hooks.PreToolUse[0].hooks[0].url;
    const send = async (subagentType?: string) => (await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId: "parent", subagentType, toolName: "grok_desktop__capabilities", toolInput: {} }) })).json() as Promise<any>;
    expect(await send("explore")).toMatchObject({ decision: "deny" });
    const permit = await send(); expect(authority.consume("grok_desktop__capabilities", permit.hookSpecificOutput.updatedInput)).toEqual({});
    await authority.dispose(); expect(await stat(plugin).catch(() => undefined)).toBeUndefined();
  } finally { await authority.dispose(); await rm(root, { recursive: true, force: true }); }
});
