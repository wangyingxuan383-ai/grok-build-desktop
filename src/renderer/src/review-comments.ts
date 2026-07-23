import type { GitReviewScope } from "../../shared/types";

export interface ReviewCommentDraft {
  id: string;
  path: string;
  line: number;
  side: "old" | "new";
  body: string;
  snapshotId: string;
  scope: GitReviewScope;
}

export function formatReviewComments(comments: ReviewCommentDraft[]): string {
  if (!comments.length) return "";
  return `审核意见：\n${comments.map((comment) => `- @${comment.path}#L${comment.line} (${comment.side === "new" ? "新文件" : "旧文件"}): ${comment.body}`).join("\n")}`;
}

export async function findStaleReviewComment(
  comments: ReviewCommentDraft[],
  getSnapshotId: (scope: GitReviewScope) => Promise<string>,
): Promise<ReviewCommentDraft | undefined> {
  const snapshots = new Map<string, string>();
  for (const comment of comments) {
    const key = JSON.stringify(comment.scope);
    let currentId = snapshots.get(key);
    if (!currentId) {
      currentId = await getSnapshotId(comment.scope);
      snapshots.set(key, currentId);
    }
    if (currentId !== comment.snapshotId) return comment;
  }
  return undefined;
}
