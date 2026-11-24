/** Versioned UI placement only: no prompts, credentials or duplicate runtime state. */
export type PaneSurfaceMode = "chat" | "pty";
export type GridPreset = "1x1" | "1x2" | "2x1" | "2x2";

export type ContentTarget = {
  kind: "workspace" | "session" | "file" | "review" | "terminal" | "browser" | "artifact" | "subagent";
  workspace: string;
  id: string;
  title: string;
};

export type LeafPaneNode = {
  kind: "leaf";
  id: string;
  tabs: ContentTarget[];
  activeTab?: string;
  surfaceMode?: PaneSurfaceMode;
};

export type SplitPaneNode = {
  kind: "split";
  id: string;
  axis: "horizontal" | "vertical";
  ratio: number;
  first: PaneNode;
  second: PaneNode;
};

export type PaneNode = LeafPaneNode | SplitPaneNode;

export interface CompareVariantMeta {
  paneId: string;
  sessionId: string;
  workspace: string;
  label: string;
  modelId?: string;
  effort?: string;
  mode?: "agent" | "plan" | "auto";
  worktreeId?: string;
  branch?: string;
}

export interface CompareRunMeta {
  id: string;
  prompt: string;
  createdAt: string;
  sourceWorkspace: string;
  isolatedWorktrees: boolean;
  variants: CompareVariantMeta[];
  winnerSessionId?: string;
  settledAt?: string;
}

export interface WorkspaceLayout {
  version: 1;
  root: PaneNode;
  focusedPane: string;
  zoomedPaneId?: string;
  compareMeta?: CompareRunMeta;
}

export interface LayoutGroup {
  id: string;
  name: string;
  root: PaneNode;
  focusedPane: string;
  zoomedPaneId?: string;
  compareMeta?: CompareRunMeta;
}

export interface WorkspaceLayoutStateV2 {
  version: 2;
  activeGroupId: string;
  groups: LayoutGroup[];
}

export const MAX_LAYOUT_GROUPS = 8;
export const MAX_PANES_PER_GROUP = 4;

const TARGET_KINDS = new Set([
  "workspace",
  "session",
  "file",
  "review",
  "terminal",
  "browser",
  "artifact",
  "subagent",
]);

export const workspaceKey = (path: string): string => path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
const legacyTargetKey = (target: ContentTarget): string => `${target.kind}:${target.workspace.toLowerCase()}:${target.id}`;
export const targetKey = (target: ContentTarget): string => `${target.kind}:${workspaceKey(target.workspace)}:${target.id}`;

export function leaves(node: PaneNode): LeafPaneNode[] {
  return node.kind === "leaf" ? [node] : [...leaves(node.first), ...leaves(node.second)];
}

export function mapPane(node: PaneNode, id: string, update: (node: PaneNode) => PaneNode): PaneNode {
  if (node.id === id) return update(node);
  return node.kind === "leaf"
    ? node
    : { ...node, first: mapPane(node.first, id, update), second: mapPane(node.second, id, update) };
}

export function openTarget(layout: WorkspaceLayout, paneId: string, target: ContentTarget): WorkspaceLayout {
  if (!leaves(layout.root).some((p) => p.id === paneId)) return layout;
  return {
    ...layout,
    focusedPane: paneId,
    root: mapPane(layout.root, paneId, (node) =>
      node.kind !== "leaf"
        ? node
        : {
            ...node,
            tabs: node.tabs.some((tab) => targetKey(tab) === targetKey(target))
              ? node.tabs.map((tab) => (targetKey(tab) === targetKey(target) ? target : tab))
              : [...node.tabs, target],
            activeTab: targetKey(target),
          },
    ),
  };
}

export function splitPane(
  layout: WorkspaceLayout,
  paneId: string,
  axis: "horizontal" | "vertical",
  id: string,
): WorkspaceLayout {
  if (leaves(layout.root).length >= MAX_PANES_PER_GROUP) throw Error("最多同时打开四个窗格");
  const source = leaves(layout.root).find((node) => node.id === paneId);
  if (!source) throw Error("窗格已关闭");
  if (leaves(layout.root).some((node) => node.id === id)) throw Error("窗格 ID 重复");
  const current = source.tabs.find((tab) => targetKey(tab) === source.activeTab);
  const next: WorkspaceLayout = {
    ...layout,
    focusedPane: id,
    root: mapPane(layout.root, paneId, (node) => ({
      kind: "split",
      id: `split-${id}`,
      axis,
      ratio: 0.5,
      first: node,
      second: {
        kind: "leaf",
        id,
        tabs: current ? [current] : [],
        activeTab: current ? targetKey(current) : undefined,
      },
    })),
  };
  delete next.zoomedPaneId;
  return next;
}

export function closePane(layout: WorkspaceLayout, paneId: string): WorkspaceLayout {
  if (layout.root.kind === "leaf") return layout;
  const remove = (node: PaneNode): PaneNode | undefined => {
    if (node.id === paneId) return undefined;
    if (node.kind === "leaf") return node;
    const first = remove(node.first);
    const second = remove(node.second);
    return !first ? second : !second ? first : { ...node, first, second };
  };
  const root = remove(layout.root)!;
  const remainingLeaves = leaves(root);
  const focusedPane = remainingLeaves.some((node) => node.id === layout.focusedPane)
    ? layout.focusedPane
    : remainingLeaves[0]!.id;
  const next: WorkspaceLayout = { ...layout, root, focusedPane };
  if (
    next.zoomedPaneId &&
    (remainingLeaves.length <= 1 || !remainingLeaves.some((node) => node.id === next.zoomedPaneId))
  ) {
    delete next.zoomedPaneId;
  }
  return next;
}

export function moveTab(
  layout: WorkspaceLayout,
  sourceId: string,
  destinationId: string,
  key: string,
  index: number,
): WorkspaceLayout {
  const source = leaves(layout.root).find((node) => node.id === sourceId);
  const destination = leaves(layout.root).find((node) => node.id === destinationId);
  const target = source?.tabs.find((tab) => targetKey(tab) === key);
  if (!source || !destination || !target) return layout;
  let root = mapPane(layout.root, sourceId, (node) => {
    if (node.kind !== "leaf") return node;
    const tabs = node.tabs.filter((tab) => targetKey(tab) !== key);
    return {
      ...node,
      tabs,
      activeTab: node.activeTab === key ? (tabs[0] ? targetKey(tabs[0]) : undefined) : node.activeTab,
    };
  });
  root = mapPane(root, destinationId, (node) => {
    if (node.kind !== "leaf") return node;
    const tabs = node.tabs.filter((tab) => targetKey(tab) !== key);
    tabs.splice(Math.max(0, Math.min(index, tabs.length)), 0, target);
    return { ...node, tabs, activeTab: key };
  });
  return { ...layout, root, focusedPane: destinationId };
}

export function initialLayout(): WorkspaceLayout {
  return { version: 1, root: { kind: "leaf", id: "main", tabs: [] }, focusedPane: "main" };
}

function sanitizeCompareMeta(raw: unknown, validPaneIds: Set<string>): CompareRunMeta | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const candidate = raw as CompareRunMeta;
  if (
    typeof candidate.id !== "string" ||
    typeof candidate.prompt !== "string" ||
    typeof candidate.createdAt !== "string" ||
    typeof candidate.sourceWorkspace !== "string" ||
    typeof candidate.isolatedWorktrees !== "boolean" ||
    !Array.isArray(candidate.variants) ||
    candidate.variants.length < 2 ||
    candidate.variants.length > MAX_PANES_PER_GROUP
  ) {
    return undefined;
  }
  const variants: CompareVariantMeta[] = [];
  for (const item of candidate.variants) {
    if (
      !item ||
      typeof item !== "object" ||
      typeof item.paneId !== "string" ||
      typeof item.sessionId !== "string" ||
      typeof item.workspace !== "string" ||
      typeof item.label !== "string"
    ) {
      return undefined;
    }
    variants.push({
      paneId: validPaneIds.has(item.paneId) ? item.paneId : item.paneId,
      sessionId: item.sessionId,
      workspace: item.workspace,
      label: item.label,
      ...(typeof item.modelId === "string" ? { modelId: item.modelId } : {}),
      ...(typeof item.effort === "string" ? { effort: item.effort } : {}),
      ...(item.mode === "agent" || item.mode === "plan" || item.mode === "auto" ? { mode: item.mode } : {}),
      ...(typeof item.worktreeId === "string" ? { worktreeId: item.worktreeId } : {}),
      ...(typeof item.branch === "string" ? { branch: item.branch } : {}),
    });
  }
  return {
    id: candidate.id,
    prompt: candidate.prompt,
    createdAt: candidate.createdAt,
    sourceWorkspace: candidate.sourceWorkspace,
    isolatedWorktrees: candidate.isolatedWorktrees,
    variants,
    ...(typeof itemString(candidate.winnerSessionId) === "string" ? { winnerSessionId: candidate.winnerSessionId } : {}),
    ...(typeof itemString(candidate.settledAt) === "string" ? { settledAt: candidate.settledAt } : {}),
  };
}

function itemString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function restoreLayout(value: unknown): WorkspaceLayout {
  const fail = (): WorkspaceLayout => initialLayout();
  if (!value || typeof value !== "object") return fail();
  const candidate = value as WorkspaceLayout;
  let count = 0;
  const ids = new Set<string>();
  const valid = (node: PaneNode, depth = 0): boolean => {
    if (!node || depth > 6 || typeof node.id !== "string" || ids.has(node.id)) return false;
    ids.add(node.id);
    if (node.kind === "split") {
      return (
        ["horizontal", "vertical"].includes(node.axis) &&
        Number.isFinite(node.ratio) &&
        node.ratio >= 0.15 &&
        node.ratio <= 0.85 &&
        valid(node.first, depth + 1) &&
        valid(node.second, depth + 1)
      );
    }
    if (node.kind !== "leaf" || ++count > MAX_PANES_PER_GROUP || !Array.isArray(node.tabs) || node.tabs.length > 100) {
      return false;
    }
    if (node.surfaceMode !== undefined && node.surfaceMode !== "chat" && node.surfaceMode !== "pty") {
      return false;
    }
    return (
      node.tabs.every(
        (tab) =>
          tab &&
          TARGET_KINDS.has(tab.kind) &&
          typeof tab.id === "string" &&
          typeof tab.workspace === "string" &&
          typeof tab.title === "string",
      ) &&
      (!node.activeTab ||
        node.tabs.some((tab) => targetKey(tab) === node.activeTab || legacyTargetKey(tab) === node.activeTab))
    );
  };
  if (candidate.version !== 1 || !valid(candidate.root) || !leaves(candidate.root).some((node) => node.id === candidate.focusedPane)) {
    return fail();
  }
  let root = candidate.root;
  const paneLeaves = leaves(root);
  const paneIds = new Set(paneLeaves.map((p) => p.id));
  for (const pane of paneLeaves) {
    const active = pane.tabs.find((tab) => targetKey(tab) === pane.activeTab || legacyTargetKey(tab) === pane.activeTab);
    const unique = new Map(pane.tabs.map((tab) => [targetKey(tab), tab]));
    root = mapPane(root, pane.id, (node) => {
      if (node.kind !== "leaf") return node;
      const cleaned: LeafPaneNode = {
        kind: "leaf",
        id: node.id,
        tabs: [...unique.values()],
        activeTab: active ? targetKey(active) : undefined,
      };
      if (node.surfaceMode === "pty") cleaned.surfaceMode = "pty";
      return cleaned;
    });
  }
  const result: WorkspaceLayout = {
    version: 1,
    root,
    focusedPane: candidate.focusedPane,
  };
  if (typeof candidate.zoomedPaneId === "string" && paneLeaves.length > 1 && paneIds.has(candidate.zoomedPaneId)) {
    result.zoomedPaneId = candidate.zoomedPaneId;
  }
  const compareMeta = sanitizeCompareMeta(candidate.compareMeta, paneIds);
  if (compareMeta) result.compareMeta = compareMeta;
  return result;
}

/** Remove view references only; runtime and persisted conversation ownership stay elsewhere. */
export function removeTabs(
  layout: WorkspaceLayout,
  paneId: string | undefined,
  predicate: (target: ContentTarget) => boolean,
): WorkspaceLayout {
  let root = layout.root;
  for (const pane of leaves(root)) {
    if (paneId && pane.id !== paneId) continue;
    const activeIndex = pane.tabs.findIndex((t) => targetKey(t) === pane.activeTab);
    const tabs = pane.tabs.filter((t) => !predicate(t));
    const activeTab = tabs.some((t) => targetKey(t) === pane.activeTab)
      ? pane.activeTab
      : tabs.length
        ? targetKey(tabs[Math.max(0, Math.min(activeIndex, tabs.length - 1))]!)
        : undefined;
    root = mapPane(root, pane.id, (n) => (n.kind === "leaf" ? { ...n, tabs, activeTab } : n));
  }
  return { ...layout, root };
}

export function setSplitRatio(layout: WorkspaceLayout, splitId: string, ratio: number): WorkspaceLayout {
  const clamped = Math.max(0.15, Math.min(0.85, Number.isFinite(ratio) ? ratio : 0.5));
  return {
    ...layout,
    root: mapPane(layout.root, splitId, (node) => (node.kind === "split" ? { ...node, ratio: clamped } : node)),
  };
}

export function togglePaneZoom(layout: WorkspaceLayout, paneId?: string): WorkspaceLayout {
  const paneLeaves = leaves(layout.root);
  if (paneLeaves.length <= 1) {
    if (!layout.zoomedPaneId) return layout;
    const next = { ...layout };
    delete next.zoomedPaneId;
    return next;
  }
  const targetId = paneId && paneLeaves.some((p) => p.id === paneId) ? paneId : layout.focusedPane;
  const next: WorkspaceLayout = { ...layout, focusedPane: targetId };
  if (layout.zoomedPaneId === targetId) {
    delete next.zoomedPaneId;
  } else {
    next.zoomedPaneId = targetId;
  }
  return next;
}

export function setPaneSurfaceMode(
  layout: WorkspaceLayout,
  paneId: string,
  mode?: PaneSurfaceMode,
): WorkspaceLayout {
  if (!leaves(layout.root).some((p) => p.id === paneId)) return layout;
  return {
    ...layout,
    root: mapPane(layout.root, paneId, (node) => {
      if (node.kind !== "leaf") return node;
      const nextMode: PaneSurfaceMode = mode ?? (node.surfaceMode === "pty" ? "chat" : "pty");
      const updated: LeafPaneNode = {
        kind: "leaf",
        id: node.id,
        tabs: node.tabs,
        activeTab: node.activeTab,
      };
      if (nextMode === "pty") updated.surfaceMode = "pty";
      return updated;
    }),
  };
}

export function focusPaneByIndex(layout: WorkspaceLayout, indexZeroBased: number): WorkspaceLayout {
  const paneLeaves = leaves(layout.root);
  const target = paneLeaves[indexZeroBased];
  if (!target) return layout;
  const next: WorkspaceLayout = { ...layout, focusedPane: target.id };
  if (next.zoomedPaneId && next.zoomedPaneId !== target.id) {
    next.zoomedPaneId = target.id;
  }
  return next;
}

export function detectGridPreset(node: PaneNode): GridPreset | "custom" {
  if (node.kind === "leaf") return "1x1";
  if (node.first.kind === "leaf" && node.second.kind === "leaf") {
    return node.axis === "horizontal" ? "1x2" : "2x1";
  }
  if (
    node.axis === "vertical" &&
    node.first.kind === "split" &&
    node.first.axis === "horizontal" &&
    node.first.first.kind === "leaf" &&
    node.first.second.kind === "leaf" &&
    node.second.kind === "split" &&
    node.second.axis === "horizontal" &&
    node.second.first.kind === "leaf" &&
    node.second.second.kind === "leaf"
  ) {
    return "2x2";
  }
  return "custom";
}

function mergeLeafTabs(primary: LeafPaneNode, extras: LeafPaneNode[]): LeafPaneNode {
  const map = new Map<string, ContentTarget>();
  for (const tab of primary.tabs) map.set(targetKey(tab), tab);
  for (const extra of extras) {
    for (const tab of extra.tabs) {
      if (!map.has(targetKey(tab))) map.set(targetKey(tab), tab);
    }
  }
  const tabs = [...map.values()];
  const activeTab =
    primary.activeTab && tabs.some((t) => targetKey(t) === primary.activeTab)
      ? primary.activeTab
      : tabs[0]
        ? targetKey(tabs[0])
        : undefined;
  const merged: LeafPaneNode = { kind: "leaf", id: primary.id, tabs, activeTab };
  if (primary.surfaceMode === "pty") merged.surfaceMode = "pty";
  return merged;
}

export function applyGridPreset(
  layout: WorkspaceLayout,
  preset: GridPreset,
  seedTargets: ContentTarget[] = [],
): WorkspaceLayout {
  const currentLeaves = leaves(layout.root);
  const focusedLeaf = currentLeaves.find((p) => p.id === layout.focusedPane) ?? currentLeaves[0]!;
  const fallbackTab =
    seedTargets[0] ??
    focusedLeaf.tabs.find((t) => targetKey(t) === focusedLeaf.activeTab) ??
    focusedLeaf.tabs[0];

  const usedIds = new Set(currentLeaves.map((p) => p.id));
  const nextPaneId = (slot: number): string => {
    const base = slot === 0 ? "main" : `pane-${slot + 1}`;
    if (!usedIds.has(base)) {
      usedIds.add(base);
      return base;
    }
    let suffix = 1;
    while (usedIds.has(`${base}-${suffix}`)) suffix += 1;
    const generated = `${base}-${suffix}`;
    usedIds.add(generated);
    return generated;
  };

  const makeSlotLeaf = (slot: number): LeafPaneNode => {
    const existing = currentLeaves[slot];
    const seeded = seedTargets[slot];
    if (existing) {
      if (seeded) {
        const hasSeed = existing.tabs.some((t) => targetKey(t) === targetKey(seeded));
        const tabs = hasSeed
          ? existing.tabs.map((t) => (targetKey(t) === targetKey(seeded) ? seeded : t))
          : [...existing.tabs, seeded];
        return {
          ...existing,
          tabs,
          activeTab: targetKey(seeded),
        };
      }
      return existing;
    }
    const initialTab = seeded ?? fallbackTab;
    return {
      kind: "leaf",
      id: nextPaneId(slot),
      tabs: initialTab ? [initialTab] : [],
      activeTab: initialTab ? targetKey(initialTab) : undefined,
    };
  };

  let root: PaneNode;
  if (preset === "1x1") {
    const ordered = [focusedLeaf, ...currentLeaves.filter((p) => p.id !== focusedLeaf.id)];
    let primary = mergeLeafTabs(ordered[0]!, ordered.slice(1));
    if (seedTargets[0]) {
      const seeded = seedTargets[0];
      const tabs = primary.tabs.some((t) => targetKey(t) === targetKey(seeded))
        ? primary.tabs.map((t) => (targetKey(t) === targetKey(seeded) ? seeded : t))
        : [...primary.tabs, seeded];
      primary = { ...primary, tabs, activeTab: targetKey(seeded) };
    }
    root = primary;
  } else if (preset === "1x2" || preset === "2x1") {
    const first = makeSlotLeaf(0);
    const second = mergeLeafTabs(makeSlotLeaf(1), currentLeaves.slice(2));
    root = {
      kind: "split",
      id: `split-${preset}-root`,
      axis: preset === "1x2" ? "horizontal" : "vertical",
      ratio: 0.5,
      first,
      second,
    };
  } else {
    const l0 = makeSlotLeaf(0);
    const l1 = makeSlotLeaf(1);
    const l2 = makeSlotLeaf(2);
    const l3 = makeSlotLeaf(3);
    root = {
      kind: "split",
      id: "split-2x2-root",
      axis: "vertical",
      ratio: 0.5,
      first: {
        kind: "split",
        id: "split-2x2-top",
        axis: "horizontal",
        ratio: 0.5,
        first: l0,
        second: l1,
      },
      second: {
        kind: "split",
        id: "split-2x2-bottom",
        axis: "horizontal",
        ratio: 0.5,
        first: l2,
        second: l3,
      },
    };
  }

  const nextLeaves = leaves(root);
  const focusedPane = nextLeaves.some((p) => p.id === layout.focusedPane)
    ? layout.focusedPane
    : nextLeaves[0]!.id;
  const result: WorkspaceLayout = {
    version: 1,
    root,
    focusedPane,
  };
  if (layout.compareMeta && preset !== "1x1") {
    result.compareMeta = layout.compareMeta;
  }
  return result;
}

export function setCompareMeta(layout: WorkspaceLayout, compareMeta?: CompareRunMeta): WorkspaceLayout {
  const next: WorkspaceLayout = { ...layout };
  if (compareMeta) next.compareMeta = compareMeta;
  else delete next.compareMeta;
  return next;
}

export function groupToLayout(group: LayoutGroup): WorkspaceLayout {
  const layout: WorkspaceLayout = {
    version: 1,
    root: group.root,
    focusedPane: group.focusedPane,
  };
  if (group.zoomedPaneId) layout.zoomedPaneId = group.zoomedPaneId;
  if (group.compareMeta) layout.compareMeta = group.compareMeta;
  return layout;
}

export function layoutToGroup(id: string, name: string, layout: WorkspaceLayout): LayoutGroup {
  const group: LayoutGroup = {
    id,
    name,
    root: layout.root,
    focusedPane: layout.focusedPane,
  };
  if (layout.zoomedPaneId) group.zoomedPaneId = layout.zoomedPaneId;
  if (layout.compareMeta) group.compareMeta = layout.compareMeta;
  return group;
}

export function initialLayoutV2(): WorkspaceLayoutStateV2 {
  const base = initialLayout();
  return {
    version: 2,
    activeGroupId: "group-1",
    groups: [layoutToGroup("group-1", "舞台 1", base)],
  };
}

export function restoreLayoutStateV2(value: unknown): WorkspaceLayoutStateV2 {
  if (!value || typeof value !== "object") return initialLayoutV2();
  const raw = value as Record<string, unknown>;
  if (raw.version === 1) {
    const migrated = restoreLayout(raw);
    return {
      version: 2,
      activeGroupId: "group-1",
      groups: [layoutToGroup("group-1", "舞台 1", migrated)],
    };
  }
  if (raw.version !== 2 || !Array.isArray(raw.groups) || raw.groups.length === 0) {
    return initialLayoutV2();
  }
  const seenGroupIds = new Set<string>();
  const groups: LayoutGroup[] = [];
  for (const item of raw.groups.slice(0, MAX_LAYOUT_GROUPS)) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const id = typeof record.id === "string" && record.id.trim() && !seenGroupIds.has(record.id)
      ? record.id
      : `group-${groups.length + 1}`;
    seenGroupIds.add(id);
    const name = typeof record.name === "string" && record.name.trim()
      ? record.name.trim().slice(0, 32)
      : `舞台 ${groups.length + 1}`;
    const validated = restoreLayout({
      version: 1,
      root: record.root,
      focusedPane: record.focusedPane,
      zoomedPaneId: record.zoomedPaneId,
      compareMeta: record.compareMeta,
    });
    groups.push(layoutToGroup(id, name, validated));
  }
  if (groups.length === 0) return initialLayoutV2();
  const activeGroupId =
    typeof raw.activeGroupId === "string" && groups.some((g) => g.id === raw.activeGroupId)
      ? raw.activeGroupId
      : groups[0]!.id;
  return { version: 2, activeGroupId, groups };
}

export function activeGroup(state: WorkspaceLayoutStateV2): LayoutGroup {
  return state.groups.find((g) => g.id === state.activeGroupId) ?? state.groups[0]!;
}

export function updateActiveGroup(
  state: WorkspaceLayoutStateV2,
  updater: (layout: WorkspaceLayout) => WorkspaceLayout,
): WorkspaceLayoutStateV2 {
  const current = activeGroup(state);
  const updated = updater(groupToLayout(current));
  return {
    ...state,
    groups: state.groups.map((g) => (g.id === current.id ? layoutToGroup(g.id, g.name, updated) : g)),
  };
}

export function updateAllGroups(
  state: WorkspaceLayoutStateV2,
  updater: (layout: WorkspaceLayout) => WorkspaceLayout,
): WorkspaceLayoutStateV2 {
  return {
    ...state,
    groups: state.groups.map((g) => layoutToGroup(g.id, g.name, updater(groupToLayout(g)))),
  };
}

export function createLayoutGroup(
  state: WorkspaceLayoutStateV2,
  name?: string,
  seed?: ContentTarget,
): WorkspaceLayoutStateV2 {
  if (state.groups.length >= MAX_LAYOUT_GROUPS) return state;
  let seq = state.groups.length + 1;
  while (state.groups.some((g) => g.id === `group-${seq}`)) seq += 1;
  const id = `group-${seq}`;
  const label = name?.trim().slice(0, 32) || `舞台 ${seq}`;
  let base = initialLayout();
  if (seed) base = openTarget(base, "main", seed);
  return {
    version: 2,
    activeGroupId: id,
    groups: [...state.groups, layoutToGroup(id, label, base)],
  };
}

export function closeLayoutGroup(state: WorkspaceLayoutStateV2, groupId: string): WorkspaceLayoutStateV2 {
  if (state.groups.length <= 1) {
    const first = state.groups[0]!;
    return {
      version: 2,
      activeGroupId: first.id,
      groups: [layoutToGroup(first.id, first.name, initialLayout())],
    };
  }
  const index = state.groups.findIndex((g) => g.id === groupId);
  if (index < 0) return state;
  const remaining = state.groups.filter((g) => g.id !== groupId);
  const activeGroupId =
    state.activeGroupId === groupId
      ? remaining[Math.max(0, Math.min(index, remaining.length - 1))]!.id
      : state.activeGroupId;
  return { version: 2, activeGroupId, groups: remaining };
}

export function renameLayoutGroup(
  state: WorkspaceLayoutStateV2,
  groupId: string,
  name: string,
): WorkspaceLayoutStateV2 {
  const trimmed = name.trim().slice(0, 32);
  if (!trimmed) return state;
  return {
    ...state,
    groups: state.groups.map((g) => (g.id === groupId ? { ...g, name: trimmed } : g)),
  };
}

export function switchLayoutGroup(
  state: WorkspaceLayoutStateV2,
  directionOrId: -1 | 1 | string,
): WorkspaceLayoutStateV2 {
  if (typeof directionOrId === "string") {
    if (!state.groups.some((g) => g.id === directionOrId)) return state;
    return { ...state, activeGroupId: directionOrId };
  }
  if (state.groups.length <= 1) return state;
  const idx = state.groups.findIndex((g) => g.id === state.activeGroupId);
  const nextIdx = ((idx >= 0 ? idx : 0) + directionOrId + state.groups.length) % state.groups.length;
  return { ...state, activeGroupId: state.groups[nextIdx]!.id };
}
