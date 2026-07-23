import { describe, expect, it } from "vitest";
import { buildGitReviewSnapshot, parseUnifiedPatch } from "./git-review";

describe("git review patch parser", () => {
  it("normalizes CRLF and tracks old/new line numbers including no-final-newline metadata", () => {
    const patch = [
      "diff --git a/src/a.ts b/src/a.ts",
      "index 1111111..2222222 100644",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -2,2 +2,3 @@",
      " keep",
      "-old",
      "+new",
      "+tail",
      "\\ No newline at end of file",
      "",
    ].join("\r\n");
    const [file] = parseUnifiedPatch(patch, [{ path: "src/a.ts", kind: "modified", staged: false, workingTree: true }], true);
    expect(file).toBeDefined();
    expect(file).toMatchObject({ path: "src/a.ts", additions: 2, deletions: 1, binary: false });
    expect(file!.hunks[0]?.lines).toEqual([
      { kind: "context", text: "keep", oldLine: 2, newLine: 2 },
      { kind: "deletion", text: "old", oldLine: 3 },
      { kind: "addition", text: "new", newLine: 3 },
      { kind: "addition", text: "tail", newLine: 4 },
      { kind: "meta", text: "\\ No newline at end of file" },
    ]);
  });

  it("recognizes rename, delete and binary sections", () => {
    const patch = [
      "diff --git a/old.txt b/new.txt",
      "similarity index 100%",
      "rename from old.txt",
      "rename to new.txt",
      "diff --git a/gone.txt b/gone.txt",
      "deleted file mode 100644",
      "--- a/gone.txt",
      "+++ /dev/null",
      "@@ -1 +0,0 @@",
      "-gone",
      "diff --git a/picture.png b/picture.png",
      "index 1111111..2222222 100644",
      "Binary files a/picture.png and b/picture.png differ",
      "",
    ].join("\n");
    const files = parseUnifiedPatch(patch, [], true);
    expect(files).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "new.txt", oldPath: "old.txt", kind: "renamed", hunks: [] }),
      expect.objectContaining({ path: "gone.txt", kind: "deleted", deletions: 1 }),
      expect.objectContaining({ path: "picture.png", kind: "modified", binary: true, hunks: [] }),
    ]));
  });

  it("uses a stable snapshot id and makes commit/branch scopes read-only", () => {
    const input = { repositoryRoot: "C:/repo", scope: { kind: "commit" as const, revision: "HEAD" }, patch: "", changes: [] };
    const first = buildGitReviewSnapshot(input);
    const second = buildGitReviewSnapshot({ ...input, createdAt: "2099-01-01T00:00:00.000Z" });
    expect(first.id).toBe(second.id);
    expect(first.readOnly).toBe(true);
  });

  it("keeps quoted paths with spaces and exposes a conflict even when Git emits no normal hunk", () => {
    const files = parseUnifiedPatch([
      "diff --git \"a/src/a file.ts\" \"b/src/a file.ts\"",
      "--- \"a/src/a file.ts\"",
      "+++ \"b/src/a file.ts\"",
      "@@ -1 +1 @@",
      "-old",
      "+new",
      "",
    ].join("\n"), [], true);
    expect(files[0]).toMatchObject({ path: "src/a file.ts" });
    expect(files[0]?.oldPath).toBeUndefined();
    const snapshot = buildGitReviewSnapshot({ repositoryRoot: "C:/repo", scope: { kind: "unstaged" }, patch: "", changes: [{ path: "conflict.txt", kind: "conflicted", conflict: "both-modified", staged: true, workingTree: true }] });
    expect(snapshot.files).toContainEqual(expect.objectContaining({ path: "conflict.txt", kind: "conflicted", hunks: [] }));
  });
});
