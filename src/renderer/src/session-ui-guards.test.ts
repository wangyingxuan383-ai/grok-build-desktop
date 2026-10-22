import { describe, expect, it } from "vitest";
import { canOpenRecentFileDiff, canRestoreClaimedDraft, ownsDraftSubmission, preferredOpenLocation, sessionScopedPaneKey, shouldApplyDraftHydration, shouldPauseDraftAutosaveForSubmission, shouldSuspendDraftHydrationForSubmission, type DraftSubmissionClaim } from "./session-ui-guards";

describe("session UI isolation guards", () => {
  it("changes the dock identity for a session, execution root, or tool change", () => {
    const initial = sessionScopedPaneKey("session-a", "C:\\repo", "review");
    expect(sessionScopedPaneKey("session-b", "C:\\repo", "review")).not.toBe(initial);
    expect(sessionScopedPaneKey("session-a", "C:\\repo-worktree", "review")).not.toBe(initial);
    expect(sessionScopedPaneKey("session-a", "C:\\repo", "files")).not.toBe(initial);
  });

  it("rejects a stale or user-touched draft hydration", () => {
    const baseline = {
      cancelled: false,
      generation: 4,
      currentGeneration: 4,
      touchedGeneration: 0,
      baselineAttachmentRevision: 2,
      currentAttachmentRevision: 2,
    };
    expect(shouldApplyDraftHydration(baseline)).toBe(true);
    expect(shouldApplyDraftHydration({ ...baseline, currentGeneration: 5 })).toBe(false);
    expect(shouldApplyDraftHydration({ ...baseline, touchedGeneration: 4 })).toBe(false);
    expect(shouldApplyDraftHydration({ ...baseline, currentAttachmentRevision: 3 })).toBe(false);
    expect(shouldApplyDraftHydration({ ...baseline, cancelled: true })).toBe(false);
  });

  it("gives a first-send claim ownership of migration without overwriting later input", () => {
    const owner = { draftKey: "new:project-a", workspace: "C:/repo", foreignSessionOpen: false };
    const claim: DraftSubmissionClaim = { id: 7, phase: "claiming", source: owner, userRevision: 3, attachmentRevision: 2 };
    expect(shouldSuspendDraftHydrationForSubmission(claim, owner)).toBe(true);
    expect(shouldSuspendDraftHydrationForSubmission({ ...claim, phase: "sent" }, owner)).toBe(false);
    expect(shouldPauseDraftAutosaveForSubmission(claim, owner)).toBe(true);
    expect(shouldPauseDraftAutosaveForSubmission({ ...claim, phase: "sent" }, owner)).toBe(false);
    expect(ownsDraftSubmission(claim, { ...owner, draftKey: "session-a" })).toBe(false);
    const migrated = { ...claim, targetDraftKey: "session-a" };
    expect(shouldSuspendDraftHydrationForSubmission(migrated, { ...owner, draftKey: "session-a" })).toBe(true);
    expect(shouldPauseDraftAutosaveForSubmission(migrated, { ...owner, draftKey: "session-b" })).toBe(false);
    expect(ownsDraftSubmission(migrated, { ...owner, workspace: "C:/other" })).toBe(false);
    expect(ownsDraftSubmission(migrated, { ...owner, foreignSessionOpen: true })).toBe(false);
    expect(ownsDraftSubmission({ ...migrated, invalidated: true }, owner)).toBe(false);
    const target = { ...owner, draftKey: "session-a" };
    expect(shouldSuspendDraftHydrationForSubmission({ ...migrated, phase: "sent" }, target)).toBe(true);
    expect(shouldSuspendDraftHydrationForSubmission({ ...migrated, migrated: true, phase: "sent" }, target)).toBe(false);
    expect(ownsDraftSubmission({ ...migrated, migrated: true }, owner)).toBe(false);
    expect(ownsDraftSubmission({ ...migrated, targetWorkspace: "C:/picked", migrated: true }, { ...target, workspace: "C:/picked" })).toBe(true);
    expect(ownsDraftSubmission({ ...migrated, targetWorkspace: "C:/picked", migrated: true }, target)).toBe(false);
    const baseline = {
      claimId: 7,
      activeClaimId: 7,
      claimedUserRevision: 3,
      currentUserRevision: 3,
      claimedAttachmentRevision: 2,
      currentAttachmentRevision: 2,
      ownsClaim: true,
    };
    expect(canRestoreClaimedDraft(baseline)).toBe(true);
    expect(canRestoreClaimedDraft({ ...baseline, activeClaimId: 8 })).toBe(false);
    expect(canRestoreClaimedDraft({ ...baseline, currentUserRevision: 4 })).toBe(false);
    expect(canRestoreClaimedDraft({ ...baseline, currentAttachmentRevision: 3 })).toBe(false);
    expect(canRestoreClaimedDraft({ ...baseline, ownsClaim: false })).toBe(false);
  });

  it("prefers the real execution root over a stale catalog cwd", () => {
    expect(preferredOpenLocation({ executionRoot: "C:\\repo-worktree", sessionCwd: "C:\\repo" })).toBe("C:\\repo-worktree");
    expect(preferredOpenLocation({ codexCwd: "C:\\codex", executionRoot: "C:\\repo-worktree" })).toBe("C:\\codex");
  });

  it("offers a recent-file Diff only after Git capability is confirmed", () => {
    expect(canOpenRecentFileDiff(undefined)).toBe(false);
    expect(canOpenRecentFileDiff(false)).toBe(false);
    expect(canOpenRecentFileDiff(true)).toBe(true);
  });
});
