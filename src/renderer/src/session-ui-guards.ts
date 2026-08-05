/**
 * Builds a stable React key for a right-dock surface. The execution root is
 * part of the identity because a session may be reassigned to a Worktree while
 * the same tool remains open.
 */
export function sessionScopedPaneKey(sessionId: string | undefined, executionRoot: string, tool: string): string {
  return `${sessionId || "new"}\u0000${executionRoot}\u0000${tool}`;
}

/**
 * A draft may hydrate only while it still belongs to the latest load and the
 * user has not edited either the text controls or the attachment collection.
 */
export function shouldApplyDraftHydration(input: {
  cancelled: boolean;
  generation: number;
  currentGeneration: number;
  touchedGeneration: number;
  baselineAttachmentRevision: number;
  currentAttachmentRevision: number;
}): boolean {
  return !input.cancelled
    && input.generation === input.currentGeneration
    && input.touchedGeneration !== input.generation
    && input.baselineAttachmentRevision === input.currentAttachmentRevision;
}

export function preferredOpenLocation(input: {
  claudeCwd?: string;
  codexCwd?: string;
  executionRoot?: string;
  sessionCwd?: string;
}): string {
  return input.claudeCwd || input.codexCwd || input.executionRoot || input.sessionCwd || "";
}

export function canOpenRecentFileDiff(gitAvailable: boolean | undefined): boolean {
  return gitAvailable === true;
}
