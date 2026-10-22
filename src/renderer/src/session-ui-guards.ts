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

export interface DraftOwner {
  draftKey: string;
  workspace: string;
  foreignSessionOpen: boolean;
}

export interface DraftSubmissionClaim {
  id: number;
  phase: "claiming" | "sent";
  source: DraftOwner;
  targetDraftKey?: string;
  targetWorkspace?: string;
  migrated?: boolean;
  invalidated?: boolean;
  cleared?: boolean;
  clearedEpoch?: number;
  userRevision: number;
  attachmentRevision: number;
}

export function ownsDraftSubmission(claim: DraftSubmissionClaim | undefined, owner: DraftOwner): boolean {
  return Boolean(claim && !claim.invalidated && !owner.foreignSessionOpen && !claim.source.foreignSessionOpen
    && ((!claim.migrated && claim.source.draftKey === owner.draftKey && claim.source.workspace === owner.workspace)
      || (claim.targetDraftKey === owner.draftKey && (claim.targetWorkspace ?? claim.source.workspace) === owner.workspace)));
}

export function shouldSuspendDraftHydrationForSubmission(claim: DraftSubmissionClaim | undefined, owner: DraftOwner): boolean {
  return ownsDraftSubmission(claim, owner) && (claim?.phase === "claiming"
    || Boolean(claim?.targetDraftKey === owner.draftKey && !claim.migrated));
}

export function shouldPauseDraftAutosaveForSubmission(claim: DraftSubmissionClaim | undefined, owner: DraftOwner): boolean {
  // Once the submitted snapshot has been consumed, the composer belongs to a
  // possible follow-up even if the original prompt RPC remains open for a long
  // turn. Only the short claim/migration window blocks autosave.
  return claim?.phase === "claiming" && ownsDraftSubmission(claim, owner);
}

export function canRestoreClaimedDraft(input: {
  claimId: number;
  activeClaimId?: number;
  claimedUserRevision: number;
  currentUserRevision: number;
  claimedAttachmentRevision: number;
  currentAttachmentRevision: number;
  ownsClaim: boolean;
}): boolean {
  return input.ownsClaim && input.activeClaimId === input.claimId
    && input.claimedUserRevision === input.currentUserRevision
    && input.claimedAttachmentRevision === input.currentAttachmentRevision;
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
