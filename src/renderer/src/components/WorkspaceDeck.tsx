import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { AlertTriangle, Maximize2, Minimize2, Radio, Send, SquareTerminal, X } from "lucide-react";
import {
  activeGroup,
  applyGridPreset,
  closeLayoutGroup,
  closePane,
  createLayoutGroup,
  detectGridPreset,
  focusPaneByIndex,
  groupToLayout,
  initialLayoutV2,
  leaves,
  mapPane,
  moveTab,
  openTarget,
  removeTabs,
  renameLayoutGroup,
  restoreLayoutStateV2,
  setCompareMeta,
  setPaneSurfaceMode,
  setSplitRatio,
  splitPane,
  switchLayoutGroup,
  targetKey,
  togglePaneZoom,
  updateActiveGroup,
  updateAllGroups,
  workspaceKey,
  type CompareVariantMeta,
  type ContentTarget,
  type GridPreset,
  type LeafPaneNode,
  type PaneNode,
  type WorkspaceLayout,
  type WorkspaceLayoutStateV2,
} from "../workspace-layout";
import { useAppStore } from "../store";
import { useWorkbenchStore, type EditorTabState } from "../workbench-store";
import { decodeMediaArtifact } from "../media-artifact-target";
import type { CompareLaunchResult } from "./CompareLaunchPopover";
import { StageLayoutPicker } from "./StageLayoutPicker";
import { ActionMenu, ActionContextMenu, type UiAction } from "./ui/ActionMenu";
import "../styles/thread-stage.css";

const LazyCompareLaunchPopover = lazy(() =>
  import("./CompareLaunchPopover").then((m) => ({ default: m.CompareLaunchPopover })),
);
const LazyCompareScoreBar = lazy(() =>
  import("./CompareScoreBar").then((m) => ({ default: m.CompareScoreBar })),
);
const LazyPaneReader = lazy(() =>
  import("./PaneReader").then((m) => ({ default: m.PaneReader })),
);

const LazySessionStagePane = lazy(() =>
  import("./SessionStagePane").then((m) => ({ default: m.SessionStagePane })),
);
const LazyInPanePtySurface = lazy(() =>
  import("./SessionStagePane").then((m) => ({ default: m.InPanePtySurface })),
);

const KEY = "grok.workbench-layout.v1";
const MIME = "application/x-grok-workbench-tab";
const SESSION_MIME = "application/x-grok-session";

function restore(): WorkspaceLayoutStateV2 {
  try {
    return restoreLayoutStateV2(JSON.parse(localStorage.getItem(KEY) || "null"));
  } catch {
    return initialLayoutV2();
  }
}

type CloseChoice = "save" | "discard";

export function WorkspaceDeck({
  target,
  hidden,
  children,
  onActivate,
  onError,
  renderBackground,
  onSplitStateChange,
}: {
  target?: ContentTarget;
  hidden?: boolean;
  children: ReactNode;
  renderBackground?(target: ContentTarget): ReactNode;
  onActivate(target: ContentTarget): Promise<void>;
  onError(message: string): void;
  onSplitStateChange?(splitActive: boolean, splitSessionIds: string[]): void;
}): React.JSX.Element {
  const [state, setState] = useState<WorkspaceLayoutStateV2>(restore);
  const stateRef = useRef(state);
  stateRef.current = state;

  const currentGroup = useMemo(() => activeGroup(state), [state]);
  const layout = useMemo(() => groupToLayout(currentGroup), [currentGroup]);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  const [switching, setSwitching] = useState(false);
  const switchingRef = useRef(false);
  const [dragOver, setDragOver] = useState("");
  const [recent, setRecent] = useState<ContentTarget[]>([]);
  const [workspaceOrder, setWorkspaceOrder] = useState<string[]>(() => {
    try {
      const value = JSON.parse(localStorage.getItem("grok.workspace-tabs.v1") || "[]");
      return Array.isArray(value) ? value.filter((v: unknown): v is string => typeof v === "string") : [];
    } catch {
      return [];
    }
  });

  const [broadcastOpen, setBroadcastOpen] = useState(false);
  const [broadcastText, setBroadcastText] = useState("");
  const [broadcastAckConflict, setBroadcastAckConflict] = useState(false);
  const [broadcastSending, setBroadcastSending] = useState(false);
  const broadcastInputRef = useRef<HTMLInputElement>(null);

  const ignoredTargets = useRef(new Set<string>());
  const [closeRequest, setCloseRequest] = useState<{
    files: EditorTabState[];
    resolve(value: Record<string, CloseChoice> | null): void;
  }>();
  const closeRequestRef = useRef(closeRequest);
  closeRequestRef.current = closeRequest;
  useEffect(() => () => closeRequestRef.current?.resolve(null), []);
  const [choices, setChoices] = useState<Record<string, CloseChoice>>({});

  const key = target ? targetKey(target) : "";
  const keyRef = useRef(key);
  keyRef.current = key;
  const targetRef = useRef(target);
  targetRef.current = target;
  const onActivateRef = useRef(onActivate);
  onActivateRef.current = onActivate;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const sessions = useAppStore((s) => s.sessions);
  const views = useAppStore((s) => s.views);
  const activeWorkspace = useAppStore((s) => s.settings?.activeWorkspace || "");

  const attentionGroupIds = useMemo(() => {
    const ids = new Set<string>();
    for (const group of state.groups) {
      const hasAttention = leaves(group.root).some((pane) =>
        pane.tabs.some((tab) => {
          if (tab.kind !== "session") return false;
          const status = views[tab.id]?.status || sessions.find((s) => s.id === tab.id)?.status;
          return status === "needs-user" || status === "error";
        }),
      );
      if (hasAttention) ids.add(group.id);
    }
    return ids;
  }, [sessions, state.groups, views]);

  const updateActive = useCallback((updater: (value: WorkspaceLayout) => WorkspaceLayout) => {
    setState((prev) => updateActiveGroup(prev, updater));
  }, []);

  useEffect(() => {
    const reveal = (event: Event): void => {
      if (switchingRef.current) return;
      const id = (event as CustomEvent<{ nodeId: string }>).detail.nodeId;
      const next: ContentTarget = {
        kind: "subagent",
        workspace: useAppStore.getState().settings?.activeWorkspace || targetRef.current?.workspace || "",
        id,
        title: "子会话",
      };
      ignoredTargets.current.delete(targetKey(next));
      updateActive((v) => openTarget(v, v.focusedPane, next));
    };
    window.addEventListener("grok:reveal-subagent", reveal);
    return () => window.removeEventListener("grok:reveal-subagent", reveal);
  }, [updateActive]);

  useEffect(() => {
    const currentTarget = targetRef.current;
    if (currentTarget && !switchingRef.current && !ignoredTargets.current.has(key)) {
      updateActive((v) => openTarget(v, v.focusedPane, currentTarget));
    }
  }, [key, updateActive]);

  useEffect(() => {
    if (!target) return;
    setState((prev) =>
      updateAllGroups(prev, (v) => ({
        ...v,
        root: leaves(v.root).reduce(
          (root, pane) =>
            mapPane(root, pane.id, (n) =>
              n.kind === "leaf"
                ? { ...n, tabs: n.tabs.map((tab) => (targetKey(tab) === key ? { ...tab, title: target.title } : tab)) }
                : n,
            ),
          v.root,
        ),
      })),
    );
  }, [key, target?.title]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        localStorage.setItem(KEY, JSON.stringify(state));
      } catch {
        // Ignore storage quota errors
      }
    }, 200);
    return () => window.clearTimeout(timer);
  }, [state]);

  useEffect(() => {
    const open = (): void => {
      const currentTarget = targetRef.current;
      if (currentTarget && !switchingRef.current) {
        ignoredTargets.current.delete(targetKey(currentTarget));
        updateActive((v) => openTarget(v, v.focusedPane, currentTarget));
      }
    };
    window.addEventListener("grok:reveal-current", open);
    return () => window.removeEventListener("grok:reveal-current", open);
  }, [updateActive]);

  useEffect(() => {
    const invalid = (event: Event): void => {
      const id = (event as CustomEvent<{ sessionId: string }>).detail.sessionId;
      const matches = (tab: ContentTarget): boolean =>
        (tab.kind === "session" && tab.id === id) ||
        (tab.kind === "artifact" && decodeMediaArtifact(tab.id)?.sessionId === id) ||
        (tab.kind === "subagent" && tab.id.startsWith(`session:${id}:subagent:`));
      setState((prev) => updateAllGroups(prev, (v) => removeTabs(v, undefined, matches)));
      setRecent((rows) => rows.filter((tab) => !matches(tab)));
    };
    window.addEventListener("grok:session-deleted", invalid);
    return () => window.removeEventListener("grok:session-deleted", invalid);
  }, []);

  useEffect(() => {
    const invalid = (event: Event): void => {
      const cwd = (event as CustomEvent<{ cwd: string }>).detail.cwd;
      const matches = (tab: ContentTarget): boolean => workspaceKey(tab.workspace) === workspaceKey(cwd);
      setState((prev) => updateAllGroups(prev, (v) => removeTabs(v, undefined, matches)));
      setRecent((rows) => rows.filter((tab) => !matches(tab)));
    };
    window.addEventListener("grok:project-deleted", invalid);
    return () => window.removeEventListener("grok:project-deleted", invalid);
  }, []);

  const activate = useCallback(
    async (paneId: string, next: ContentTarget | undefined): Promise<boolean> => {
      if (switchingRef.current || !next) return false;
      switchingRef.current = true;
      setSwitching(true);
      try {
        await onActivateRef.current(next);
        updateActive((v) => openTarget(v, paneId, next));
        return true;
      } catch (error) {
        onErrorRef.current(
          `${next.title}：${error instanceof Error ? error.message : String(error)}。可以重试或关闭此标签。`,
        );
        return false;
      } finally {
        switchingRef.current = false;
        setSwitching(false);
      }
    },
    [updateActive],
  );

  const requestClose = useCallback(
    async (
      paneId: string | undefined,
      predicate: (tab: ContentTarget) => boolean,
      removePane = false,
      reset = false,
    ): Promise<void> => {
      if (switchingRef.current) return;
      switchingRef.current = true;
      setSwitching(true);
      try {
        const fullSnapshot = stateRef.current;
        const snapshot = groupToLayout(activeGroup(fullSnapshot));
        const selected = reset
          ? fullSnapshot.groups.flatMap((g) => leaves(g.root).flatMap((p) => p.tabs))
          : leaves(snapshot.root)
              .filter((p) => !paneId || p.id === paneId)
              .flatMap((p) => p.tabs.filter(predicate));
        if (!selected.length && !removePane && !reset) return;

        let next = removeTabs(snapshot, paneId, predicate);
        if (removePane && paneId) next = closePane(next, paneId);

        const otherGroupTabs = reset
          ? []
          : fullSnapshot.groups
              .filter((g) => g.id !== activeGroup(fullSnapshot).id)
              .flatMap((g) => leaves(g.root).flatMap((p) => p.tabs));
        const remaining = [...leaves(next.root).flatMap((p) => p.tabs), ...otherGroupTabs];

        const closingFiles = useWorkbenchStore
          .getState()
          .tabs.filter(
            (file) =>
              selected.some((t) => t.kind === "file" && t.id === file.key) &&
              !remaining.some((t) => t.kind === "file" && t.id === file.key),
          );
        const dirty = closingFiles.filter((file) => file.dirty);
        if (dirty.length) {
          setChoices(Object.fromEntries(dirty.map((file) => [file.key, "save"])));
          const decisions = await new Promise<Record<string, CloseChoice> | null>((resolve) =>
            setCloseRequest({ files: dirty, resolve }),
          );
          if (!decisions) return;
          for (const file of dirty) {
            if (decisions[file.key] !== "save") continue;
            const current = useWorkbenchStore.getState().tabs.find((t) => t.key === file.key);
            if (!current) continue;
            const result = await window.grokDesktop.saveEditorDocument({
              workspacePath: current.document.workspacePath,
              path: current.document.path,
              content: current.buffer,
              encoding: current.document.encoding,
              lineEnding: current.document.lineEnding,
              expectedHash: current.document.hash,
              expectedModifiedAt: current.document.modifiedAt,
            });
            if (!result.document) {
              useWorkbenchStore.getState().setConflict(current.key, result.conflict);
              throw Error(`未关闭标签：${current.document.relativePath} 存在保存冲突`);
            }
            useWorkbenchStore.getState().acceptSave(result.document, current.buffer);
            if (useWorkbenchStore.getState().tabs.find((t) => t.key === current.key)?.dirty) {
              throw Error(`保存期间文件继续发生修改，保留标签：${current.document.relativePath}`);
            }
          }
        }

        const focused = leaves(next.root).find((p) => p.id === next.focusedPane)!;
        const nextTarget = focused.tabs.find((t) => targetKey(t) === focused.activeTab);
        if (nextTarget && targetKey(nextTarget) !== keyRef.current) {
          try {
            await onActivateRef.current(nextTarget);
          } catch (error) {
            onErrorRef.current(String(error));
            next = {
              ...next,
              root: mapPane(next.root, focused.id, (n) =>
                n.kind === "leaf" ? { ...n, activeTab: undefined } : n,
              ),
            };
          }
        }

        selected.forEach((tab) => ignoredTargets.current.add(targetKey(tab)));
        if (closingFiles.length && !nextTarget) {
          closingFiles.forEach((file) =>
            ignoredTargets.current.add(
              targetKey({ kind: "workspace", workspace: file.document.workspacePath, id: "files", title: "文件" }),
            ),
          );
        }
        closingFiles.forEach((file) => useWorkbenchStore.getState().closeTab(file.key));
        setRecent((rows) =>
          [...selected, ...rows]
            .filter((tab, index, all) => all.findIndex((t) => targetKey(t) === targetKey(tab)) === index)
            .slice(0, 20),
        );

        if (reset) {
          setState(initialLayoutV2());
          window.dispatchEvent(new Event("grok:layout-reset-complete"));
        } else {
          updateActive(() => next);
        }
      } catch (error) {
        onErrorRef.current(error instanceof Error ? error.message : String(error));
      } finally {
        switchingRef.current = false;
        setSwitching(false);
      }
    },
    [updateActive],
  );

  useEffect(() => {
    const reset = (): void => {
      void requestClose(undefined, () => true, false, true);
    };
    window.addEventListener("grok:reset-layout", reset);
    return () => window.removeEventListener("grok:reset-layout", reset);
  }, [requestClose]);

  useEffect(() => {
    const closeFile = (event: Event): void => {
      const id = (event as CustomEvent<{ key: string }>).detail.key;
      const hasFile = stateRef.current.groups.some((g) =>
        leaves(g.root).some((p) => p.tabs.some((t) => t.kind === "file" && t.id === id)),
      );
      if (!hasFile) return;
      event.preventDefault();
      void requestClose(undefined, (t) => t.kind === "file" && t.id === id);
    };
    window.addEventListener("grok:close-file-view", closeFile);
    return () => window.removeEventListener("grok:close-file-view", closeFile);
  }, [requestClose]);

  useEffect(() => {
    const reveal = (event: Event): void => {
      const next = (event as CustomEvent<ContentTarget>).detail;
      if (switchingRef.current) return;
      ignoredTargets.current.delete(targetKey(next));
      updateActive((v) => openTarget(v, v.focusedPane, next));
    };
    window.addEventListener("grok:reveal-file", reveal);
    return () => window.removeEventListener("grok:reveal-file", reveal);
  }, [updateActive]);

  const paneLeaves = useMemo(() => leaves(layout.root), [layout.root]);

  useEffect(() => {
    if (!onSplitStateChange) return;
    const splitIds = paneLeaves
      .filter((p) => p.id !== layout.focusedPane)
      .flatMap((p) => {
        const active = p.tabs.find((t) => targetKey(t) === p.activeTab);
        return active?.kind === "session" ? [active.id] : [];
      });
    onSplitStateChange(paneLeaves.length > 1, splitIds);
  }, [layout.focusedPane, onSplitStateChange, paneLeaves]);

  const split = useCallback(
    async (paneId: string, axis: "horizontal" | "vertical"): Promise<void> => {
      const snapshot = layoutRef.current;
      const source = leaves(snapshot.root).find((p) => p.id === paneId);
      const tab = source?.tabs.find((t) => targetKey(t) === source.activeTab);
      try {
        if (tab && !(await activate(paneId, tab))) return;
        updateActive((current) => splitPane(current, paneId, axis, crypto.randomUUID()));
      } catch (error) {
        onErrorRef.current(String(error));
      }
    },
    [activate, updateActive],
  );

  useEffect(() => {
    const onSplitToggle = (): void => {
      const snapshot = layoutRef.current;
      const currentLeaves = leaves(snapshot.root);
      if (currentLeaves.length > 1) {
        const secondary = currentLeaves.find((p) => p.id !== snapshot.focusedPane) ?? currentLeaves.at(-1);
        if (secondary) void requestClose(secondary.id, () => true, true);
        return;
      }
      void split(snapshot.focusedPane, "horizontal");
    };

    const onOpenInSplit = (event: Event): void => {
      const nextTarget = (event as CustomEvent<ContentTarget>).detail;
      if (!nextTarget || switchingRef.current) return;
      ignoredTargets.current.delete(targetKey(nextTarget));
      updateActive((current) => {
        const currentLeaves = leaves(current.root);
        if (currentLeaves.length === 1) {
          const newPaneId = crypto.randomUUID();
          const splitted = splitPane(current, current.focusedPane, "horizontal", newPaneId);
          const withTab = openTarget(splitted, newPaneId, nextTarget);
          return { ...withTab, focusedPane: current.focusedPane };
        }
        const targetPane = currentLeaves.find((p) => p.id !== current.focusedPane) ?? currentLeaves[0]!;
        const withTab = openTarget(current, targetPane.id, nextTarget);
        return { ...withTab, focusedPane: current.focusedPane };
      });
    };

    window.addEventListener("grok:split-pane", onSplitToggle);
    window.addEventListener("grok:open-in-split", onOpenInSplit);
    return () => {
      window.removeEventListener("grok:split-pane", onSplitToggle);
      window.removeEventListener("grok:open-in-split", onOpenInSplit);
    };
  }, [requestClose, split, updateActive]);

  const handleSelectGroup = useCallback(
    async (directionOrId: -1 | 1 | string): Promise<void> => {
      const nextState = switchLayoutGroup(stateRef.current, directionOrId);
      if (nextState.activeGroupId === stateRef.current.activeGroupId) return;
      setState(nextState);
      const nextGroup = activeGroup(nextState);
      const focusedLeaf = leaves(nextGroup.root).find((p) => p.id === nextGroup.focusedPane);
      const activeTab = focusedLeaf?.tabs.find((t) => targetKey(t) === focusedLeaf.activeTab);
      if (activeTab) {
        try {
          await onActivateRef.current(activeTab);
        } catch {
          // Keep group switched even if historical tab is offline
        }
      }
    },
    [],
  );

  useEffect(() => {
    if (paneLeaves.length <= 1 && broadcastOpen) {
      setBroadcastOpen(false);
    }
  }, [broadcastOpen, paneLeaves.length]);

  const handleCloseGroup = useCallback((groupId: string): void => {
    const prevActive = stateRef.current.activeGroupId;
    const nextState = closeLayoutGroup(stateRef.current, groupId);
    setState(nextState);
    if (nextState.activeGroupId !== prevActive) {
      const nextGroup = activeGroup(nextState);
      const focusedLeaf = leaves(nextGroup.root).find((p) => p.id === nextGroup.focusedPane);
      const activeTab = focusedLeaf?.tabs.find((t) => targetKey(t) === focusedLeaf.activeTab);
      if (activeTab) {
        void onActivateRef.current(activeTab).catch(() => undefined);
      }
    }
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (hidden || event.defaultPrevented || event.isComposing) return;
      const modalOpen = document.querySelector('[role="dialog"][data-state="open"]:not(.ui-popover), [role="alertdialog"], .add-palette');
      if (modalOpen) return;

      const snap = layoutRef.current;
      const currentLeaves = leaves(snap.root);

      if (event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && /^[1-4]$/.test(event.key)) {
        const idx = Number(event.key) - 1;
        const pane = currentLeaves[idx];
        if (!pane) return;
        event.preventDefault();
        event.stopPropagation();
        updateActive((v) => focusPaneByIndex(v, idx));
        const tab = pane.tabs.find((t) => targetKey(t) === pane.activeTab);
        if (tab && pane.id !== snap.focusedPane) {
          void activate(pane.id, tab);
        }
        return;
      }

      if (event.ctrlKey && event.shiftKey && !event.altKey && !event.metaKey && event.key === "Enter") {
        if ((event.target as HTMLElement | null)?.closest?.(".monaco-editor")) return;
        if (currentLeaves.length > 1 || snap.zoomedPaneId) {
          event.preventDefault();
          event.stopPropagation();
          updateActive((v) => togglePaneZoom(v, v.focusedPane));
        }
        return;
      }

      if (event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey && event.key === "`") {
        const focused = currentLeaves.find((p) => p.id === snap.focusedPane);
        const focusedTab = focused?.tabs.find((t) => targetKey(t) === focused.activeTab);
        const hasWorkspace = Boolean(focusedTab?.workspace || activeWorkspace);
        if (!hasWorkspace) return;
        event.preventDefault();
        event.stopPropagation();
        updateActive((v) => setPaneSurfaceMode(v, v.focusedPane));
        return;
      }

      if (event.ctrlKey && event.altKey && !event.shiftKey && !event.metaKey && (event.key === "[" || event.key === "]")) {
        if (stateRef.current.groups.length > 1) {
          event.preventDefault();
          event.stopPropagation();
          void handleSelectGroup(event.key === "[" ? -1 : 1);
        }
        return;
      }

      if (event.ctrlKey && event.altKey && !event.shiftKey && !event.metaKey && event.key.toLowerCase() === "b") {
        if (currentLeaves.length > 1) {
          event.preventDefault();
          event.stopPropagation();
          setBroadcastOpen((prev) => {
            const next = !prev;
            if (next) window.setTimeout(() => broadcastInputRef.current?.focus(), 20);
            return next;
          });
        }
      }
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [activate, activeWorkspace, handleSelectGroup, hidden, updateActive]);

  const drop = async (data: { pane: string; key: string }, destination: string, index: number): Promise<void> => {
    if (switchingRef.current) return;
    const source = leaves(layoutRef.current.root).find((p) => p.id === data.pane);
    const tab = source?.tabs.find((t) => targetKey(t) === data.key);
    if (!tab || !(await activate(destination, tab))) return;
    updateActive((v) => moveTab(v, data.pane, destination, data.key, index));
  };

  const broadcastTargets = useMemo(() => {
    const seen = new Set<string>();
    const list: Array<{ paneId: string; sessionId: string; title: string; cwd: string; mode: string; status: string }> = [];
    for (const pane of paneLeaves) {
      const tab = pane.tabs.find((t) => targetKey(t) === pane.activeTab);
      if (
        !tab ||
        tab.kind !== "session" ||
        tab.id.startsWith("codex:") ||
        tab.id.startsWith("claude:") ||
        seen.has(tab.id)
      ) {
        continue;
      }
      seen.add(tab.id);
      const summary = sessions.find((s) => s.id === tab.id);
      const view = views[tab.id];
      list.push({
        paneId: pane.id,
        sessionId: tab.id,
        title: summary?.title || tab.title,
        cwd: summary?.cwd || tab.workspace,
        mode: view?.mode || "agent",
        status: view?.status || summary?.status || "idle",
      });
    }
    return list;
  }, [paneLeaves, sessions, views]);

  const duplicateBroadcastCwds = useMemo(() => {
    const writableByCwd = new Map<string, string[]>();
    for (const item of broadcastTargets) {
      if (item.mode === "plan") continue;
      const k = workspaceKey(item.cwd);
      writableByCwd.set(k, [...(writableByCwd.get(k) ?? []), item.cwd]);
    }
    return [...writableByCwd.values()].filter((arr) => arr.length >= 2).map((arr) => arr[0]!);
  }, [broadcastTargets]);

  useEffect(() => {
    setBroadcastAckConflict(false);
  }, [duplicateBroadcastCwds.join("|")]);

  const sendBroadcast = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    const trimmed = broadcastText.trim();
    if (!trimmed || broadcastSending || broadcastTargets.length === 0) return;
    if (duplicateBroadcastCwds.length > 0 && !broadcastAckConflict) return;

    setBroadcastSending(true);
    try {
      setBroadcastText("");
      await Promise.all(
        broadcastTargets.map(async (item) => {
          if (item.status === "needs-user") return;
          const view = useAppStore.getState().views[item.sessionId];
          if (!view || view.hydration !== "ready") {
            await window.grokDesktop.openSession(item.cwd, item.sessionId);
          }
          const clientMessageId = crypto.randomUUID();
          if (item.status === "working") {
            await window.grokDesktop.enqueuePrompt(item.sessionId, trimmed, [], clientMessageId);
          } else {
            void window.grokDesktop
              .sendPrompt({
                sessionId: item.sessionId,
                text: trimmed,
                attachments: [],
                clientMessageId,
              })
              .catch((err) => onError(err instanceof Error ? err.message : String(err)));
          }
        }),
      );
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBroadcastSending(false);
    }
  };

  const handleApplyPreset = useCallback(
    (preset: GridPreset) => {
      const openSessionIds = new Set(
        paneLeaves.flatMap((p) => p.tabs.filter((t) => t.kind === "session").map((t) => t.id)),
      );
      const candidateSessions = sessions
        .filter((s) => !s.archived && !openSessionIds.has(s.id))
        .slice(0, 3)
        .map(
          (s): ContentTarget => ({
            kind: "session",
            workspace: s.cwd,
            id: s.id,
            title: s.title,
          }),
        );
      const focusedLeaf = paneLeaves.find((p) => p.id === layout.focusedPane) ?? paneLeaves[0];
      const primaryTab = focusedLeaf?.tabs.find((t) => targetKey(t) === focusedLeaf.activeTab) ?? target;
      const seeds = primaryTab ? [primaryTab, ...candidateSessions] : candidateSessions;
      updateActive((v) => applyGridPreset(v, preset, seeds));
    },
    [layout.focusedPane, paneLeaves, sessions, target, updateActive],
  );

  const handleCompareLaunched = useCallback(
    (result: CompareLaunchResult) => {
      result.targets.forEach((t) => ignoredTargets.current.delete(targetKey(t)));
      let firstPaneId = "main";
      updateActive((v) => {
        const gridded = applyGridPreset(v, result.preset, result.targets);
        const leavesList = leaves(gridded.root);
        firstPaneId = leavesList[0]?.id ?? "main";
        const mappedVariants = result.compareMeta.variants.map((variant, idx) => ({
          ...variant,
          paneId: leavesList[idx]?.id ?? variant.paneId,
        }));
        return setCompareMeta(gridded, { ...result.compareMeta, variants: mappedVariants });
      });
      if (result.targets[0]) {
        void activate(firstPaneId, result.targets[0]);
      }
    },
    [activate, updateActive],
  );

  const handlePickCompareWinner = useCallback(
    async (winner: CompareVariantMeta) => {
      const meta = layoutRef.current.compareMeta;
      if (!meta) return;
      const losers = meta.variants.filter((v) => v.sessionId !== winner.sessionId);
      for (const loser of losers) {
        ignoredTargets.current.add(
          targetKey({
            kind: "session",
            workspace: loser.workspace,
            id: loser.sessionId,
            title: loser.label,
          }),
        );
      }
      await Promise.all(
        losers.map(async (loser) => {
          await window.grokDesktop.cancelSession(loser.sessionId).catch(() => undefined);
          await window.grokDesktop.settleSession?.(loser.sessionId, true).catch(() => undefined);
          await window.grokDesktop.archiveSession(loser.sessionId, true).catch(() => undefined);
        }),
      );
      const refreshed = await window.grokDesktop.listSessions(meta.sourceWorkspace).catch(() => undefined);
      if (refreshed) useAppStore.getState().setSessions(refreshed);

      const winnerTarget: ContentTarget = {
        kind: "session",
        workspace: winner.workspace,
        id: winner.sessionId,
        title: winner.label,
      };
      await activate(winner.paneId, winnerTarget);
      updateActive((v) => {
        const collapsed = applyGridPreset(v, "1x1", [winnerTarget]);
        return setCompareMeta(collapsed, {
          ...meta,
          winnerSessionId: winner.sessionId,
          settledAt: new Date().toISOString(),
        });
      });
    },
    [activate, updateActive],
  );

  const allTabs = paneLeaves.flatMap((p) => p.tabs);
  const workspaces = [
    ...new Map([...workspaceOrder, ...allTabs.map((t) => t.workspace)].map((path) => [workspaceKey(path), path])).values(),
  ].filter((workspace) => allTabs.some((t) => workspaceKey(t.workspace) === workspaceKey(workspace)));

  const focusedLeaf = paneLeaves.find((p) => p.id === layout.focusedPane) ?? paneLeaves[0];
  const currentPreset = detectGridPreset(layout.root);
  const stageExpanded =
    paneLeaves.length > 1 ||
    state.groups.length > 1 ||
    Boolean(layout.zoomedPaneId) ||
    Boolean(layout.compareMeta) ||
    broadcastOpen ||
    focusedLeaf?.surfaceMode === "pty";

  const actions = (pane: LeafPaneNode, tab?: ContentTarget): UiAction[] => [
    {
      id: "close-tab",
      label: "关闭标签",
      disabled: !tab,
      run: () => requestClose(pane.id, (t) => targetKey(t) === targetKey(tab!)),
    },
    {
      id: "close-others",
      label: "关闭其他标签",
      disabled: !tab || pane.tabs.length < 2,
      run: () => requestClose(pane.id, (t) => targetKey(t) !== targetKey(tab!)),
    },
    {
      id: "close-right",
      label: "关闭右侧标签",
      disabled: !tab || pane.tabs.at(-1) === tab,
      run: () => {
        const index = pane.tabs.indexOf(tab!);
        const keys = new Set(pane.tabs.slice(index + 1).map(targetKey));
        return requestClose(pane.id, (t) => keys.has(targetKey(t)));
      },
    },
    {
      id: "close-all",
      label: "关闭此窗格全部标签",
      disabled: !pane.tabs.length,
      run: () => requestClose(pane.id, () => true),
    },
    {
      id: "reopen",
      label: "重新打开最近关闭的标签",
      disabled: !recent.length,
      run: async () => {
        if (await activate(pane.id, recent[0])) setRecent((rows) => rows.slice(1));
      },
    },
  ];

  const render = (node: PaneNode): ReactNode => {
    if (node.kind === "split") {
      return (
        <div key={node.id} className={`workbench-split ${node.axis}`}>
          <div style={{ flex: `${node.ratio} 1 0` }}>{render(node.first)}</div>
          <div
            className="pane-divider"
            role="separator"
            title="拖动调整窗格比例；双击恢复 50% 均分"
            aria-orientation={node.axis === "horizontal" ? "vertical" : "horizontal"}
            aria-valuenow={Math.round(node.ratio * 100)}
            aria-valuemin={15}
            aria-valuemax={85}
            aria-label="调整窗格尺寸"
            tabIndex={0}
            onDoubleClick={() => updateActive((v) => setSplitRatio(v, node.id, 0.5))}
            onKeyDown={(e) => {
              if (e.key === "Home" || e.key === "0") {
                e.preventDefault();
                updateActive((v) => setSplitRatio(v, node.id, 0.5));
              } else if (["ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown"].includes(e.key)) {
                e.preventDefault();
                updateActive((v) =>
                  setSplitRatio(v, node.id, node.ratio + (["ArrowRight", "ArrowDown"].includes(e.key) ? 0.05 : -0.05)),
                );
              }
            }}
            onPointerDown={(e) => e.currentTarget.setPointerCapture(e.pointerId)}
            onPointerMove={(e) => {
              if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
              const r = e.currentTarget.parentElement!.getBoundingClientRect();
              const ratio =
                node.axis === "horizontal" ? (e.clientX - r.left) / r.width : (e.clientY - r.top) / r.height;
              updateActive((v) => setSplitRatio(v, node.id, ratio));
            }}
            onPointerUp={(e) => e.currentTarget.releasePointerCapture(e.pointerId)}
          />
          <div style={{ flex: `${1 - node.ratio} 1 0` }}>{render(node.second)}</div>
        </div>
      );
    }

    const activePaneTab = node.tabs.find((t) => targetKey(t) === node.activeTab);
    const paneIndex = paneLeaves.findIndex((p) => p.id === node.id);
    const sessionStatus =
      activePaneTab?.kind === "session"
        ? views[activePaneTab.id]?.status || sessions.find((s) => s.id === activePaneTab.id)?.status || "idle"
        : "idle";
    const isZoomed = layout.zoomedPaneId === node.id;
    const hideSingleHeader = !stageExpanded && node.tabs.length < 2 && node.surfaceMode !== "pty";
    const paneWorkspace = activePaneTab?.workspace || target?.workspace || activeWorkspace;

    return (
      <section
        className={`workbench-pane cmux-pane-${sessionStatus} ${layout.focusedPane === node.id ? "focused" : ""} ${dragOver === node.id ? "drop-target" : ""}`}
        key={node.id}
        aria-label="内容窗格"
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes(MIME) || e.dataTransfer.types.includes(SESSION_MIME)) {
            e.preventDefault();
            setDragOver(node.id);
          }
        }}
        onDragLeave={() => setDragOver("")}
        onDrop={(e) => {
          if (!e.dataTransfer.types.includes(MIME) && !e.dataTransfer.types.includes(SESSION_MIME)) return;
          e.preventDefault();
          setDragOver("");
          try {
            if (e.dataTransfer.types.includes(SESSION_MIME)) {
              const raw = JSON.parse(e.dataTransfer.getData(SESSION_MIME)) as { id: string; cwd: string; title: string };
              const sessionTab: ContentTarget = { kind: "session", workspace: raw.cwd, id: raw.id, title: raw.title };
              ignoredTargets.current.delete(targetKey(sessionTab));
              if (node.id === layoutRef.current.focusedPane) void activate(node.id, sessionTab);
              else updateActive((v) => ({ ...openTarget(v, node.id, sessionTab), focusedPane: v.focusedPane }));
              return;
            }
            void drop(JSON.parse(e.dataTransfer.getData(MIME)), node.id, node.tabs.length);
          } catch {
            // Ignore malformed drag payload
          }
        }}
      >
        <header className={`pane-tabs${hideSingleHeader ? " single" : ""}`}>
          {paneLeaves.length > 1 && paneIndex >= 0 && (
            <span className="pane-shortcut-badge" title={`Alt+${paneIndex + 1} 聚焦窗格`}>
              {paneIndex + 1}
            </span>
          )}
          <div role="tablist" aria-label="内容标签">
            {node.tabs.map((tab, index) => {
              const tabStatus =
                tab.kind === "session"
                  ? views[tab.id]?.status || sessions.find((s) => s.id === tab.id)?.status || "idle"
                  : undefined;
              return (
                <ActionContextMenu key={targetKey(tab)} actions={actions(node, tab)} onError={onError}>
                  <div className="content-tab">
                    <button
                      role="tab"
                      aria-selected={node.activeTab === targetKey(tab)}
                      draggable
                      title={`${tab.title} · ${tab.workspace}`}
                      onDragStart={(e) =>
                        e.dataTransfer.setData(MIME, JSON.stringify({ pane: node.id, key: targetKey(tab) }))
                      }
                      onDragOver={(e) => {
                        if (e.dataTransfer.types.includes(MIME)) e.preventDefault();
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setDragOver("");
                        try {
                          void drop(JSON.parse(e.dataTransfer.getData(MIME)), node.id, index);
                        } catch {
                          // Ignore malformed drop
                        }
                      }}
                      onClick={() => void activate(node.id, tab)}
                    >
                      {tabStatus && <span className={`status-dot ${tabStatus}`} style={{ display: "inline-block", marginRight: 6 }} />}
                      {tab.title}
                    </button>
                    <button
                      className="content-tab-close"
                      aria-label={`关闭标签 ${tab.title}`}
                      title="关闭视图，不结束后台任务"
                      disabled={switching}
                      onClick={() => void requestClose(node.id, (t) => targetKey(t) === targetKey(tab))}
                    >
                      ×
                    </button>
                  </div>
                </ActionContextMenu>
              );
            })}
          </div>

          <div className="pane-header-tools">
            {paneWorkspace && (
              <button
                type="button"
                className={`pane-tool-btn${node.surfaceMode === "pty" ? " active" : ""}`}
                title="切换此窗格终端 / 会话视图 (Ctrl+`)"
                aria-label="翻转窗格终端"
                aria-pressed={node.surfaceMode === "pty"}
                onClick={() => updateActive((v) => setPaneSurfaceMode(v, node.id))}
              >
                <SquareTerminal size={12} />
              </button>
            )}

            {(paneLeaves.length > 1 || isZoomed) && (
              <button
                type="button"
                className={`pane-tool-btn${isZoomed ? " active" : ""}`}
                title={isZoomed ? "还原分屏 (Ctrl+Shift+Enter)" : "临时最大化此窗格 (Ctrl+Shift+Enter)"}
                aria-label={isZoomed ? "还原分屏" : "最大化窗格"}
                aria-pressed={isZoomed}
                onClick={() => updateActive((v) => togglePaneZoom(v, node.id))}
              >
                {isZoomed ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
              </button>
            )}

            <ActionMenu
              trigger={
                <button aria-label="窗格操作" disabled={switching}>
                  ⋯
                </button>
              }
              onError={onError}
              actions={[
                ...actions(node, activePaneTab),
                {
                  id: "flip-pty",
                  label: node.surfaceMode === "pty" ? "切换回对话视图" : "翻转为窗格内终端",
                  shortcut: "Ctrl+`",
                  disabled: !paneWorkspace,
                  separatorBefore: true,
                  run: () => updateActive((v) => setPaneSurfaceMode(v, node.id)),
                },
                {
                  id: "zoom-pane",
                  label: isZoomed ? "还原分屏布局" : "最大化当前窗格",
                  shortcut: "Ctrl+Shift+Enter",
                  disabled: paneLeaves.length <= 1 && !isZoomed,
                  run: () => updateActive((v) => togglePaneZoom(v, node.id)),
                },
                {
                  id: "horizontal",
                  label: "向右分屏",
                  disabled: paneLeaves.length >= 4 || !node.activeTab,
                  separatorBefore: true,
                  run: () => split(node.id, "horizontal"),
                },
                {
                  id: "vertical",
                  label: "向下分屏",
                  disabled: paneLeaves.length >= 4 || !node.activeTab,
                  run: () => split(node.id, "vertical"),
                },
                {
                  id: "close-pane",
                  label: "关闭窗格",
                  disabled: paneLeaves.length === 1,
                  run: () => requestClose(node.id, () => true, true),
                },
                {
                  id: "close-everywhere",
                  label: "关闭所有窗格的全部标签",
                  disabled: !allTabs.length,
                  run: () => requestClose(undefined, () => true),
                },
              ]}
            />
          </div>
        </header>

        {!node.activeTab && node.surfaceMode !== "pty" ? (
          <div className="empty-copy">
            <h3>暂无打开内容</h3>
            <p>从侧栏选择会话，或拖入会话并排处理。关闭视图不会结束后台任务。</p>
            {target && <button onClick={() => void activate(node.id, target)}>返回当前内容</button>}
          </div>
        ) : layout.focusedPane === node.id ? (
          node.surfaceMode === "pty" && paneWorkspace ? (
            <>
              <div hidden>{children}</div>
              <Suspense fallback={<div className="empty-copy"><p>正在加载窗格终端…</p></div>}>
                <LazyInPanePtySurface
                  paneId={node.id}
                  workspace={paneWorkspace}
                  onFlipToChat={() => updateActive((v) => setPaneSurfaceMode(v, node.id, "chat"))}
                  onError={onError}
                />
              </Suspense>
            </>
          ) : (
            children
          )
        ) : node.surfaceMode === "pty" && paneWorkspace ? (
          <Suspense fallback={<div className="empty-copy"><p>正在加载窗格终端…</p></div>}>
            <LazyInPanePtySurface
              paneId={node.id}
              workspace={paneWorkspace}
              onFlipToChat={() => updateActive((v) => setPaneSurfaceMode(v, node.id, "chat"))}
              onError={onError}
            />
          </Suspense>
        ) : activePaneTab?.kind === "session" ? (
          <Suspense fallback={<div className="empty-copy"><p>正在加载分屏舞台…</p></div>}>
            <LazySessionStagePane
              paneId={node.id}
              paneIndex={paneIndex >= 0 ? paneIndex : undefined}
              target={activePaneTab}
              surfaceMode={node.surfaceMode}
              onToggleSurfaceMode={() => updateActive((v) => setPaneSurfaceMode(v, node.id))}
              onActivate={() => void activate(node.id, activePaneTab)}
              onError={onError}
            />
          </Suspense>
        ) : (
          (activePaneTab ? renderBackground?.(activePaneTab) : undefined) ?? (
            <Suspense fallback={<div className="empty-copy"><p>正在加载窗格内容…</p></div>}>
              <LazyPaneReader paneId={node.id} target={activePaneTab} onActivate={() => void activate(node.id, activePaneTab)} />
            </Suspense>
          )
        )}
      </section>
    );
  };

  const zoomedNode = layout.zoomedPaneId
    ? paneLeaves.find((p) => p.id === layout.zoomedPaneId)
    : undefined;

  const finish = (value: Record<string, CloseChoice> | null): void => {
    closeRequest?.resolve(value);
    setCloseRequest(undefined);
  };

  const showFloatingStagePill =
    !stageExpanded &&
    (target?.kind === "session" || (target?.kind === "workspace" && target.id === "chat"));

  return (
    <div className="workspace-deck" hidden={hidden} aria-busy={switching}>
      {switching && (
        <span role="status" style={{ padding: 8 }}>
          正在切换或处理标签，请稍候…
        </span>
      )}

      <nav className="workspace-tabs" aria-label="打开的工作区" hidden>
        {workspaces.map((workspace) => (
          <button
            key={workspace}
            className={workspaceKey(target?.workspace || "") === workspaceKey(workspace) ? "active" : ""}
            title={workspace}
            draggable
            onDragStart={(e) => e.dataTransfer.setData("application/x-grok-workspace", workspace)}
            onDragOver={(e) => {
              if (e.dataTransfer.types.includes("application/x-grok-workspace")) e.preventDefault();
            }}
            onDrop={(e) => {
              e.preventDefault();
              const source = e.dataTransfer.getData("application/x-grok-workspace");
              if (!workspaces.includes(source)) return;
              const order = workspaces.filter((path) => path !== source);
              order.splice(order.indexOf(workspace), 0, source);
              setWorkspaceOrder(order);
              try {
                localStorage.setItem("grok.workspace-tabs.v1", JSON.stringify(order));
              } catch {
                // Ignore storage failure
              }
            }}
            onClick={() => {
              const tab = allTabs.findLast((t) => workspaceKey(t.workspace) === workspaceKey(workspace));
              void activate(layout.focusedPane, tab);
            }}
          >
            {workspace.split(/[\\/]/).filter(Boolean).at(-1) || "工作区"}
          </button>
        ))}
      </nav>

      {stageExpanded ? (
        <div className="stage-deck-bar" role="toolbar" aria-label="空间多会话舞台工具栏">
          <div className="stage-group-strip" role="tablist" aria-label="舞台工作组">
            {state.groups.map((g, idx) => (
              <button
                key={g.id}
                type="button"
                role="tab"
                aria-selected={g.id === state.activeGroupId}
                className={`stage-group-chip${g.id === state.activeGroupId ? " active" : ""}`}
                onClick={() => void handleSelectGroup(g.id)}
                title={`切换到 ${g.name} (Ctrl+Alt+[ / ])`}
              >
                <span>{idx + 1}</span>
                <strong>{g.name}</strong>
              </button>
            ))}
          </div>

          <div className="stage-deck-actions">
            {paneLeaves.length > 1 && (
              <button
                type="button"
                className={`ui-btn ui-btn-ghost ui-btn-sm${broadcastOpen ? " is-active" : ""}`}
                onClick={() => {
                  setBroadcastOpen((v) => !v);
                  if (!broadcastOpen) window.setTimeout(() => broadcastInputRef.current?.focus(), 20);
                }}
                title="向当前舞台所有分屏会话同时广播指令 (Ctrl+Alt+B)"
              >
                <Radio size={13} />
                <span>广播 ({broadcastTargets.length})</span>
              </button>
            )}

            <Suspense fallback={null}>
              <LazyCompareLaunchPopover
                workspace={target?.workspace || activeWorkspace}
                disabled={switching}
                onLaunched={handleCompareLaunched}
                onError={onError}
              />
            </Suspense>

            <StageLayoutPicker
              currentPreset={currentPreset}
              paneCount={paneLeaves.length}
              zoomed={Boolean(zoomedNode)}
              focusedSurfaceMode={focusedLeaf?.surfaceMode ?? "chat"}
              groups={state.groups}
              activeGroupId={state.activeGroupId}
              broadcastOpen={broadcastOpen}
              attentionGroupIds={attentionGroupIds}
              onApplyPreset={handleApplyPreset}
              onToggleZoom={() => updateActive((v) => togglePaneZoom(v, v.focusedPane))}
              onToggleSurfaceMode={() => updateActive((v) => setPaneSurfaceMode(v, v.focusedPane))}
              onSelectGroup={(id) => void handleSelectGroup(id)}
              onCreateGroup={() => setState((prev) => createLayoutGroup(prev, undefined, target))}
              onCloseGroup={handleCloseGroup}
              onRenameGroup={(id, name) => setState((prev) => renameLayoutGroup(prev, id, name))}
              onToggleBroadcast={() => setBroadcastOpen((v) => !v)}
            />
          </div>
        </div>
      ) : showFloatingStagePill ? (
        <div className="stage-floating-pill">
          <Suspense fallback={null}>
            <LazyCompareLaunchPopover
              workspace={target?.workspace || activeWorkspace}
              disabled={switching}
              onLaunched={handleCompareLaunched}
              onError={onError}
            />
          </Suspense>
          <StageLayoutPicker
            currentPreset={currentPreset}
            paneCount={paneLeaves.length}
            zoomed={false}
            focusedSurfaceMode={focusedLeaf?.surfaceMode ?? "chat"}
            groups={state.groups}
            activeGroupId={state.activeGroupId}
            broadcastOpen={broadcastOpen}
            attentionGroupIds={attentionGroupIds}
            onApplyPreset={handleApplyPreset}
            onToggleZoom={() => updateActive((v) => togglePaneZoom(v, v.focusedPane))}
            onToggleSurfaceMode={() => updateActive((v) => setPaneSurfaceMode(v, v.focusedPane))}
            onSelectGroup={(id) => void handleSelectGroup(id)}
            onCreateGroup={() => setState((prev) => createLayoutGroup(prev, undefined, target))}
            onCloseGroup={handleCloseGroup}
            onRenameGroup={(id, name) => setState((prev) => renameLayoutGroup(prev, id, name))}
            onToggleBroadcast={() => setBroadcastOpen((v) => !v)}
          />
        </div>
      ) : null}

      {layout.compareMeta && (
        <Suspense fallback={null}>
          <LazyCompareScoreBar
            compareMeta={layout.compareMeta}
            onFocusVariant={(variant) => {
              const pane = paneLeaves.find((p) => p.id === variant.paneId) ?? paneLeaves[0];
              if (!pane) return;
              const tab = pane.tabs.find((t) => t.kind === "session" && t.id === variant.sessionId);
              if (tab) void activate(pane.id, tab);
            }}
            onPickWinner={handlePickCompareWinner}
            onDismiss={() => updateActive((v) => setCompareMeta(v, undefined))}
            onError={onError}
          />
        </Suspense>
      )}

      {broadcastOpen && paneLeaves.length > 1 && (
        <form className="stage-broadcast-bar" onSubmit={(e) => void sendBroadcast(e)}>
          <div className="stage-broadcast-row">
            <Radio size={14} style={{ color: "var(--color-accent)", flex: "none" }} />
            <input
              ref={broadcastInputRef}
              className="ui-input"
              style={{ height: 28, fontSize: "var(--text-caption)" }}
              value={broadcastText}
              disabled={broadcastSending}
              onChange={(e) => setBroadcastText(e.target.value)}
              placeholder={`向 ${broadcastTargets.length} 个分屏会话广播同一条指令…`}
            />
            <button
              type="submit"
              className="ui-btn ui-btn-primary ui-btn-sm"
              disabled={
                broadcastSending ||
                !broadcastText.trim() ||
                broadcastTargets.length === 0 ||
                (duplicateBroadcastCwds.length > 0 && !broadcastAckConflict)
              }
            >
              <Send size={12} />
              <span>广播发送</span>
            </button>
            <button
              type="button"
              className="ui-icon-btn ui-icon-btn-sm"
              aria-label="关闭舞台广播栏"
              onClick={() => setBroadcastOpen(false)}
            >
              <X size={13} />
            </button>
          </div>

          {duplicateBroadcastCwds.length > 0 && (
            <div className="stage-broadcast-warning" role="alert">
              <AlertTriangle size={13} style={{ flex: "none" }} />
              <span>
                检测到多个非 Plan 会话共享同一目录（{duplicateBroadcastCwds.map((c) => c.split(/[\\/]/).at(-1)).join("、")}），并发修改文件可能产生写冲突！
              </span>
              <label>
                <input
                  type="checkbox"
                  checked={broadcastAckConflict}
                  onChange={(e) => setBroadcastAckConflict(e.target.checked)}
                />
                <span>确认继续广播</span>
              </label>
            </div>
          )}
        </form>
      )}

      <div className="workspace-pane-tree">{render(zoomedNode ?? layout.root)}</div>

      {switching && !closeRequest && (
        <div className="pane-switching" role="status">
          正在处理…
        </div>
      )}

      <Dialog.Root
        open={Boolean(closeRequest)}
        onOpenChange={(open) => {
          if (!open) finish(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="ui-dialog-overlay" />
          <Dialog.Content className="ui-dialog">
            <Dialog.Title>关闭前处理未保存文件</Dialog.Title>
            <Dialog.Description>先选择每个文件的处理方式；取消会保留所有标签。</Dialog.Description>
            {closeRequest?.files.map((file) => (
              <label className="close-file-choice" key={file.key}>
                <span>{file.document.relativePath}</span>
                <select
                  value={choices[file.key] || "save"}
                  onChange={(e) => setChoices((v) => ({ ...v, [file.key]: e.target.value as CloseChoice }))}
                >
                  <option value="save">保存后关闭</option>
                  <option value="discard">放弃修改</option>
                </select>
              </label>
            ))}
            <div className="button-row">
              <button onClick={() => finish(null)}>取消</button>
              <button onClick={() => finish(choices)}>确认并关闭</button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
