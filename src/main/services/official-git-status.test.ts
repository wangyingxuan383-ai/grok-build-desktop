import { describe, expect, it } from "vitest";
import { normalizeOfficialGitStatus } from "./official-git-status";

describe("normalizeOfficialGitStatus", () => {
  it("preserves untracked files and merges staged plus working changes", () => {
    const status = normalizeOfficialGitStatus({
      root: "C:\\repo",
      branch: "main",
      commit: "abc123",
      upstream: "origin/main",
      remoteUrl: "https://oauth2:secret@[::1]/org/repo.git?secret=yes",
      ahead: 2,
      behind: 1,
      staged: [{ path: "both.ts", type: "edit", staged: true, additions: 2, deletions: 0 }],
      unstaged: [
        { path: "both.ts", type: "edit", staged: false, additions: 1, deletions: 1 },
        { path: "new.txt", type: "untracked", staged: false, additions: 3, deletions: 0 },
      ],
    }, "C:\\repo");

    expect(status).toMatchObject({
      repositoryRoot: "C:\\repo",
      clean: false,
      branch: { name: "main", upstream: "origin/main", ahead: 2, behind: 1 },
      remote: { name: "origin", displayUrl: "https://[::1]/org/repo.git" },
    });
    expect(status?.changes).toEqual([
      expect.objectContaining({ path: "both.ts", kind: "modified", staged: true, workingTree: true }),
      expect.objectContaining({ path: "new.txt", kind: "untracked", staged: false, workingTree: true }),
    ]);
  });

  it("rejects incomplete payloads so system Git remains the safe fallback", () => {
    expect(normalizeOfficialGitStatus({ format: "prompt", prompt: "M file" }, "C:\\repo")).toBeUndefined();
    expect(normalizeOfficialGitStatus({ root: "C:\\repo", staged: [] }, "C:\\repo")).toBeUndefined();
  });
});
