import { create } from "zustand";
import type { EditorDocument, EditorSaveConflict, WorkspaceTreeNode } from "../../shared/types";

export type WorkbenchView = "subagent" | "terminal" | "browser" | "artifacts" | "chat" | "files" | "source-control" | "worktrees" | "memory" | "agents" | "profiles" | "dashboard" | "tasks" | "extensions";

export interface EditorTabState {
  key: string;
  document: EditorDocument;
  buffer: string;
  dirty: boolean;
  cursor: { lineNumber: number; column: number };
  conflict?: EditorSaveConflict;
}

interface WorkbenchState {
  activeView: WorkbenchView;
  tabs: EditorTabState[];
  activeTabKey: string;
  activeTerminalId: string;
  activeTerminalWorkspace: string;
  activeBrowserId: string;
  activeSubagentNodeId: string;
  setActiveSubagent(nodeId: string): void;
  selectedPath: string;
  treeByDirectory: Record<string, WorkspaceTreeNode[]>;
  expandedDirectories: string[];
  showIgnored: boolean;
  showHidden: boolean;
  setActiveView(view: WorkbenchView): void;
  openDocument(document: EditorDocument): void;
  closeTab(key: string): void;
  setActiveTab(key: string): void;
  setActiveTerminal(id: string, workspace?: string): void;
  focusTerminal(id: string, workspace?: string): void;
  setActiveBrowser(id: string): void;
  updateBuffer(key: string, value: string): void;
  updateCursor(key: string, cursor: { lineNumber: number; column: number }): void;
  replaceDocument(document: EditorDocument): void;
  acceptSave(document: EditorDocument, submitted: string): void;
  setConflict(key: string, conflict?: EditorSaveConflict): void;
  renamePath(workspacePath: string, oldPath: string, newRelativePath: string): void;
  closeDeletedPath(workspacePath: string, deletedPath: string): void;
  setSelectedPath(path: string): void;
  setTree(directory: string, nodes: WorkspaceTreeNode[]): void;
  toggleExpanded(directory: string, expanded?: boolean): void;
  resetTree(): void;
  setShowIgnored(value: boolean): void;
  setShowHidden(value: boolean): void;
}

function documentKey(document: Pick<EditorDocument, "workspacePath" | "path">): string {
  const value = `${document.workspacePath}\0${document.path}`;
  return processPlatformInsensitive(value);
}

export const useWorkbenchStore = create<WorkbenchState>((set) => ({
  activeView: "chat",
  tabs: [],
  activeTabKey: "",
  activeTerminalId: "",
  activeTerminalWorkspace: "",
  activeBrowserId: "",
  activeSubagentNodeId: "",
  setActiveSubagent: (activeSubagentNodeId) => { set({ activeSubagentNodeId, activeView: "subagent" }); if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("grok:reveal-subagent", { detail: { nodeId: activeSubagentNodeId } })); },
  selectedPath: "",
  treeByDirectory: {},
  expandedDirectories: [],
  showIgnored: false,
  showHidden: false,
  setActiveView: (activeView) => set({ activeView }),
  openDocument: (document) => set((state) => {
    const key = documentKey(document);
    const existing = state.tabs.find((tab) => tab.key === key);
    return {
      activeView: "files",
      activeTabKey: key,
      tabs: existing ? state.tabs : [...state.tabs, { key, document, buffer: document.content, dirty: false, cursor: { lineNumber: 1, column: 1 } }],
    };
  }),
  closeTab: (key) => set((state) => {
    const index = state.tabs.findIndex((tab) => tab.key === key);
    if (index < 0) return state;
    const tabs = state.tabs.filter((tab) => tab.key !== key);
    const activeTabKey = state.activeTabKey === key ? tabs[Math.min(index, tabs.length - 1)]?.key ?? "" : state.activeTabKey;
    return { tabs, activeTabKey };
  }),
  setActiveTab: (activeTabKey) => set({ activeTabKey, activeView: "files" }),
  setActiveTerminal: (activeTerminalId, activeTerminalWorkspace) => set((state) => ({ activeTerminalId, activeTerminalWorkspace: activeTerminalWorkspace ?? state.activeTerminalWorkspace, activeView: "terminal" })),
  focusTerminal: (activeTerminalId, activeTerminalWorkspace) => set((state) => ({ activeTerminalId, activeTerminalWorkspace: activeTerminalWorkspace ?? state.activeTerminalWorkspace })),
  setActiveBrowser: (activeBrowserId) => set({ activeBrowserId, activeView: "browser" }),
  updateBuffer: (key, buffer) => set((state) => ({ tabs: state.tabs.map((tab) => tab.key === key ? { ...tab, buffer, dirty: buffer !== tab.document.content } : tab) })),
  updateCursor: (key, cursor) => set((state) => ({ tabs: state.tabs.map((tab) => tab.key === key ? { ...tab, cursor } : tab) })),
  replaceDocument: (document) => set((state) => {
    const key = documentKey(document);
    return { tabs: state.tabs.map((tab) => tab.key === key ? { ...tab, document, buffer: document.content, dirty: false, conflict: undefined } : tab) };
  }),
  acceptSave: (document, submitted) => set((state) => ({ tabs: state.tabs.map(tab => {
    if (tab.key !== documentKey(document)) return tab;
    const buffer = tab.buffer === submitted ? document.content : tab.buffer;
    return { ...tab, document, buffer, dirty: buffer !== document.content, conflict: undefined };
  }) })),
  setConflict: (key, conflict) => set((state) => ({ tabs: state.tabs.map((tab) => tab.key === key ? { ...tab, conflict } : tab) })),
  renamePath: (workspacePath, oldPath, newRelativePath) => set((state) => {
    const wsNorm = processPlatformInsensitive(normalizeSlashes(workspacePath));
    const oldNorm = processPlatformInsensitive(normalizeSlashes(oldPath));
    const sep = oldPath.includes("\\") || workspacePath.includes("\\") ? "\\" : "/";
    const cleanWs = workspacePath.replace(/[\\/]+$/, "");
    const cleanRel = newRelativePath.replace(/^[\\/]+|[\\/]+$/g, "").replace(/[\\/]+/g, "/");
    let nextActiveKey = state.activeTabKey;
    const tabs = state.tabs.map((tab) => {
      if (processPlatformInsensitive(normalizeSlashes(tab.document.workspacePath)) !== wsNorm) return tab;
      const tabSlash = normalizeSlashes(tab.document.path);
      const tabNorm = processPlatformInsensitive(tabSlash);
      if (tabNorm !== oldNorm && !tabNorm.startsWith(`${oldNorm}/`)) return tab;
      const suffix = tabSlash.slice(normalizeSlashes(oldPath).length);
      const updatedRel = `${cleanRel}${suffix}`;
      const updatedPath = `${cleanWs}${sep}${updatedRel.replace(/\//g, sep)}`;
      const nextDoc: EditorDocument = {
        ...tab.document,
        path: updatedPath,
        relativePath: updatedRel,
      };
      const nextKey = documentKey(nextDoc);
      if (state.activeTabKey === tab.key) nextActiveKey = nextKey;
      return { ...tab, key: nextKey, document: nextDoc };
    });
    return { tabs, activeTabKey: nextActiveKey };
  }),
  closeDeletedPath: (workspacePath, deletedPath) => set((state) => {
    const wsNorm = processPlatformInsensitive(normalizeSlashes(workspacePath));
    const delNorm = processPlatformInsensitive(normalizeSlashes(deletedPath));
    const matches = (tab: EditorTabState): boolean => {
      if (processPlatformInsensitive(normalizeSlashes(tab.document.workspacePath)) !== wsNorm) return false;
      const tabNorm = processPlatformInsensitive(normalizeSlashes(tab.document.path));
      return tabNorm === delNorm || tabNorm.startsWith(`${delNorm}/`);
    };
    const tabs = state.tabs.flatMap((tab) => {
      if (!matches(tab)) return [tab];
      if (!tab.dirty) return [];
      return [{
        ...tab,
        conflict: {
          kind: "deleted" as const,
          path: tab.document.path,
          expectedHash: tab.document.hash,
          expectedModifiedAt: tab.document.modifiedAt,
        },
      }];
    });
    const activeStillPresent = tabs.some((tab) => tab.key === state.activeTabKey);
    return {
      tabs,
      activeTabKey: activeStillPresent ? state.activeTabKey : (tabs[0]?.key ?? ""),
    };
  }),
  setSelectedPath: (selectedPath) => set({ selectedPath }),
  setTree: (directory, nodes) => set((state) => ({ treeByDirectory: { ...state.treeByDirectory, [normalizeDirectory(directory)]: nodes } })),
  toggleExpanded: (directory, expanded) => set((state) => {
    const key = normalizeDirectory(directory);
    const present = state.expandedDirectories.includes(key);
    const next = expanded ?? !present;
    return { expandedDirectories: next ? present ? state.expandedDirectories : [...state.expandedDirectories, key] : state.expandedDirectories.filter((value) => value !== key) };
  }),
  resetTree: () => set({ treeByDirectory: {}, expandedDirectories: [], selectedPath: "" }),
  setShowIgnored: (showIgnored) => set({ showIgnored, treeByDirectory: {}, expandedDirectories: [] }),
  setShowHidden: (showHidden) => set({ showHidden, treeByDirectory: {}, expandedDirectories: [] }),
}));

function normalizeDirectory(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\/?/, "").replace(/\/$/, "");
}

function normalizeSlashes(value: string): string {
  return value.replace(/\\/g, "/").replace(/\/+$/, "");
}

function processPlatformInsensitive(value: string): string {
  return typeof navigator !== "undefined" && navigator.platform.toLowerCase().startsWith("win") ? value.toLocaleLowerCase() : value;
}
