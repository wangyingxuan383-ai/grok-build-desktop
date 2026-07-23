import { create } from "zustand";
import type { GrokWorktreeSummary, WorktreeApplyPreview } from "../../shared/types";

interface WorktreeState {
  workspace: string;
  items: GrokWorktreeSummary[];
  selectedId: string;
  preview?: WorktreeApplyPreview;
  loading: boolean;
  setItems(workspace: string, items: GrokWorktreeSummary[]): void;
  setSelected(id: string): void;
  setPreview(preview?: WorktreeApplyPreview): void;
  setLoading(loading: boolean): void;
  reset(workspace?: string): void;
}

export const useWorktreeStore = create<WorktreeState>((set) => ({
  workspace: "",
  items: [],
  selectedId: "",
  loading: false,
  setItems: (workspace, items) => set((state) => ({ workspace, items, selectedId: items.some((item) => item.id === state.selectedId) ? state.selectedId : items[0]?.id ?? "", preview: items.some((item) => item.id === state.selectedId) ? state.preview : undefined })),
  setSelected: (selectedId) => set({ selectedId, preview: undefined }),
  setPreview: (preview) => set({ preview }),
  setLoading: (loading) => set({ loading }),
  reset: (workspace = "") => set({ workspace, items: [], selectedId: "", preview: undefined, loading: false }),
}));
