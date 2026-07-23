import { create } from "zustand";
import type { GitDiffResult, GitRepositoryStatus, GitRepositoryTrust } from "../../shared/types";

export interface GitSelection {
  path: string;
  staged: boolean;
}

interface GitWorkbenchState {
  workspace: string;
  status?: GitRepositoryStatus;
  trust?: GitRepositoryTrust;
  selection?: GitSelection;
  diff?: GitDiffResult;
  loading: boolean;
  setRepository(workspace: string, trust?: GitRepositoryTrust, status?: GitRepositoryStatus): void;
  setStatus(status?: GitRepositoryStatus): void;
  setTrust(trust?: GitRepositoryTrust): void;
  setSelection(selection?: GitSelection): void;
  setDiff(diff?: GitDiffResult): void;
  setLoading(loading: boolean): void;
  reset(workspace?: string): void;
}

export const useGitStore = create<GitWorkbenchState>((set) => ({
  workspace: "",
  loading: false,
  setRepository: (workspace, trust, status) => set({ workspace, trust, status, selection: undefined, diff: undefined }),
  setStatus: (status) => set((state) => {
    const selection = state.selection && status?.changes.some((change) => change.path === state.selection?.path && (state.selection.staged ? change.staged : change.workingTree)) ? state.selection : undefined;
    return { status, selection, diff: selection ? state.diff : undefined };
  }),
  setTrust: (trust) => set({ trust }),
  setSelection: (selection) => set({ selection, diff: undefined }),
  setDiff: (diff) => set({ diff }),
  setLoading: (loading) => set({ loading }),
  reset: (workspace = "") => set({ workspace, status: undefined, trust: undefined, selection: undefined, diff: undefined, loading: false }),
}));
