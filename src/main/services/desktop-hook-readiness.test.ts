import { expect, it, vi } from "vitest";
import { DESKTOP_HOOK_MATCHER, ensureDesktopHookReady } from "./desktop-hook-readiness";

it("reloads a discovered plugin once and verifies the resulting hook, without changing trust", async () => {
  let loaded = false;
  const request = vi.fn(async (method: string) => {
    if (method === "x.ai/hooks/action") { loaded = true; return { status: "success" }; }
    return { result: { hooks: loaded ? [{ name: "plugin/grok-desktop/hooks:pre_tool_use[0]", event: "pre_tool_use", matcher: DESKTOP_HOOK_MATCHER }] : [] } };
  });
  expect(await ensureDesktopHookReady("parent", request)).toBe(true);
  expect(request.mock.calls.filter(([method]) => method === "x.ai/hooks/action")).toHaveLength(1);
  await ensureDesktopHookReady("parent", request);
  expect(request.mock.calls.filter(([method]) => method === "x.ai/hooks/action")).toHaveLength(1);
});

it("does not treat reload success or an unrelated hook as caller proof readiness", async () => {
  const request = vi.fn(async () => ({ status: "success", hooks: [{ name: "unrelated", event: "pre_tool_use", matcher: DESKTOP_HOOK_MATCHER }] }));
  expect(await ensureDesktopHookReady("parent", request)).toBe(false);
});
