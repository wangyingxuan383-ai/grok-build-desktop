import { describe, expect, it, vi } from "vitest";
import { findStaleReviewComment, formatReviewComments, type ReviewCommentDraft } from "./review-comments";

const comments: ReviewCommentDraft[] = [
  { id: "a", path: "src/a.ts", line: 12, side: "new", body: "请补充边界测试", snapshotId: "snap-1", scope: { kind: "unstaged" } },
  { id: "b", path: "src/b.ts", line: 7, side: "old", body: "这里不应删除", snapshotId: "snap-1", scope: { kind: "unstaged" } },
];

describe("review comment drafts", () => {
  it("formats visible file and line references for the prompt", () => {
    expect(formatReviewComments(comments)).toContain("@src/a.ts#L12 (新文件): 请补充边界测试");
    expect(formatReviewComments(comments)).toContain("@src/b.ts#L7 (旧文件): 这里不应删除");
  });

  it("accepts a current snapshot and only fetches a shared scope once", async () => {
    const getSnapshotId = vi.fn(async () => "snap-1");
    await expect(findStaleReviewComment(comments, getSnapshotId)).resolves.toBeUndefined();
    expect(getSnapshotId).toHaveBeenCalledTimes(1);
  });

  it("returns the first draft whose review snapshot is stale", async () => {
    await expect(findStaleReviewComment(comments, async () => "snap-2")).resolves.toBe(comments[0]);
  });
});
