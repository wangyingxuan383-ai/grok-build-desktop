import { useCallback } from "react";
import type { NavigationIntent } from "../../../shared/types";
import { useGitStore } from "../git-store";
import type { RightTool } from "../components/RightUtilityPane";
import { useWorkbenchStore, type WorkbenchView } from "../workbench-store";

export function useNavigationController({
  setWorkbenchView,
  setRightTool,
  setReviewInitialScope,
}: {
  setWorkbenchView(view: WorkbenchView): void;
  setRightTool(tool: RightTool | null): void;
  setReviewInitialScope(scope: "unstaged" | "last-turn"): void;
}): (intent: NavigationIntent) => Promise<void> {
  return useCallback(async (intent: NavigationIntent): Promise<void> => {
    if (intent.surface === "review") {
      setWorkbenchView("chat");
      const capability = await window.grokDesktop.getGitWorkspaceCapability(intent.executionRoot);
      if (capability.available) {
        setReviewInitialScope("last-turn");
        setRightTool("review");
      } else {
        setRightTool("agent-changes");
      }
      return;
    }
    if (intent.surface === "diff") {
      const status = await window.grokDesktop.getGitStatus(intent.executionRoot);
      const change = status.changes.find((value) => value.path === intent.targetPath || value.oldPath === intent.targetPath);
      const staged = Boolean(change?.staged && !change.workingTree);
      useGitStore.getState().setRepository(intent.executionRoot, undefined, status);
      useGitStore.getState().setSelection({ path: change?.path || intent.targetPath, staged });
      useGitStore.getState().setDiff(await window.grokDesktop.getGitDiff(intent.executionRoot, staged, change?.path || intent.targetPath));
      setWorkbenchView("source-control");
      return;
    }
    const result = await window.grokDesktop.openEditorDocument(intent.executionRoot, intent.targetPath);
    if (result.kind === "external") {
      await window.grokDesktop.openPath(result.path);
      return;
    }
    if (!result.document) return;
    const workbench = useWorkbenchStore.getState();
    workbench.openDocument(result.document);
    workbench.setSelectedPath(result.relativePath);
    workbench.updateCursor(useWorkbenchStore.getState().activeTabKey, {
      lineNumber: Math.max(1, intent.line ?? 1),
      column: Math.max(1, intent.column ?? 1),
    });
    setWorkbenchView("files");
  }, [setReviewInitialScope, setRightTool, setWorkbenchView]);
}
