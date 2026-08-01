/** Reuse the active Grok task even while it is working or waiting for input. */
export function resolveMediaSessionTarget(activeGrokSessionId: string, foreignConversationOpen: boolean): string {
  return foreignConversationOpen ? "" : activeGrokSessionId;
}
