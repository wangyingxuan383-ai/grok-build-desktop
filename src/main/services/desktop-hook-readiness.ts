export const DESKTOP_HOOK_MATCHER = "^(grok_desktop|grok_desktop_computer)__";

/** Some CLI builds discover session plugins before merging their hooks. */
export async function ensureDesktopHookReady(sessionId: string, request: (method: string, params: Record<string, unknown>) => Promise<unknown>): Promise<boolean> {
  const loaded = async () => {
    const response = await request("x.ai/hooks/list", { sessionId }) as any;
    const hooks = (response?.result ?? response)?.hooks;
    return Array.isArray(hooks) && hooks.some(hook => typeof hook.name === "string" && hook.name.startsWith("plugin/grok-desktop/") && ["pre_tool_use", "PreToolUse"].includes(hook.event) && hook.matcher === DESKTOP_HOOK_MATCHER && hook.disabled !== true && hook.enabled !== false);
  };
  if (await loaded()) return true;
  await request("x.ai/hooks/action", { sessionId, action: { type: "reload" } });
  return loaded();
}
