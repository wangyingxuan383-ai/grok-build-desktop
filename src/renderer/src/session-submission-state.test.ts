import { describe, expect, it } from "vitest";
import { hasSessionSubmission, sessionSubmissionKeys, updateSessionSubmissions } from "./session-submission-state";

describe("per-session prompt submission state", () => {
  it("does not block a second conversation while the first one is submitting", () => {
    const pending = updateSessionSubmissions(new Set<string>(), sessionSubmissionKeys("session-a", "session-a"), true);
    expect(hasSessionSubmission(pending, "session-a", "session-a")).toBe(true);
    expect(hasSessionSubmission(pending, "session-b", "session-b")).toBe(false);
  });

  it("moves a new-conversation draft through its assigned session without becoming a global lock", () => {
    let pending = updateSessionSubmissions(new Set<string>(), sessionSubmissionKeys("", "new:C:\\workspace"), true);
    pending = updateSessionSubmissions(pending, sessionSubmissionKeys("session-new", "new:C:\\workspace"), true);
    expect(hasSessionSubmission(pending, "session-new", "session-new")).toBe(true);
    expect(hasSessionSubmission(pending, "session-other", "session-other")).toBe(false);
    pending = updateSessionSubmissions(pending, ["session-new", "new:C:\\workspace"], false);
    expect(pending.size).toBe(0);
  });

  it("deduplicates a session key and ignores empty keys", () => {
    expect(sessionSubmissionKeys("session", "session")).toEqual(["session"]);
    expect(sessionSubmissionKeys("", "")).toEqual([]);
  });
});
