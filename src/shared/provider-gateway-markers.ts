/**
 * Internal markers used only between the loopback provider gateway and the
 * desktop ACP adapter. A malformed unsigned Anthropic thinking block cannot be
 * forwarded as Anthropic thinking, but it must not become visible assistant
 * prose either. The gateway carries it as text with these markers and the
 * adapter restores the semantic `thought` channel before the renderer sees it.
 */
export const PROVIDER_THINKING_START = "\uE000GROK_DESKTOP_THINKING_START\uE001";
export const PROVIDER_THINKING_END = "\uE000GROK_DESKTOP_THINKING_END\uE001";
