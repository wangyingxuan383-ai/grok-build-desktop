import type { ExecutionProfileLaunchInput, NewTaskDraft } from "../../shared/types";

/**
 * A draft carries Desktop-only project identity. The session IPC intentionally
 * accepts only execution fields, so never spread a NewTaskDraft across the
 * sandbox boundary.
 */
export function launchInputFromDraft(draft: NewTaskDraft): ExecutionProfileLaunchInput {
  return {
    workspacePath: draft.workspacePath,
    ...(draft.profileId ? { profileId: draft.profileId } : {}),
    ...(draft.worktreeName ? { worktreeName: draft.worktreeName } : {}),
    ...(draft.worktreeRef ? { worktreeRef: draft.worktreeRef } : {}),
    ...(draft.modelId ? { modelId: draft.modelId } : {}),
    ...(draft.providerId ? { providerId: draft.providerId } : {}),
    ...(draft.effort !== undefined ? { effort: draft.effort } : {}),
    ...(draft.mode !== undefined ? { mode: draft.mode } : {}),
  };
}
