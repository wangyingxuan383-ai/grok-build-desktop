import { describe, expect, it } from "vitest";
import { canOpenRecentFileDiff, preferredOpenLocation, sessionScopedPaneKey, shouldApplyDraftHydration } from "./session-ui-guards";

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
