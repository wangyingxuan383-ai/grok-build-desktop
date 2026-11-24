import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import {
  ArrowRightLeft,
  Check,
  ChevronDown,
  CloudDownload,
  Folder,
  FolderGit2,
  GitBranch,
  GitFork,
  LoaderCircle,
  Search,
} from "lucide-react";
import type {
  GitBranchSummary,
  NewTaskDraft,
  SessionExecutionAssignment,
  SessionExecutionProfile,
  SessionForkResult,
  SessionSummary,
} from "../../../shared/types";
import { useGitStore } from "../git-store";
import { useWorktreeStore } from "../worktree-store";

export type CarryDirtyChangesMode = "move" | "copy" | "none";
export type ProjectDefaultExecMode = "local" | "worktree";

const DEFAULT_MODE_STORAGE_KEY = "grok.project-worktree-default.v1";

export function readProjectDefaultExecMode(workspacePath: string): ProjectDefaultExecMode {
  if (!workspacePath) return "local";
  try {
    const map = JSON.parse(localStorage.getItem(DEFAULT_MODE_STORAGE_KEY) || "{}") as Record<string, string>;
    const key = workspacePath.replace(/[\\/]+$/, "").toLocaleLowerCase();
    return map[key] === "worktree" ? "worktree" : "local";
  } catch {
    return "local";
  }
}

export function writeProjectDefaultExecMode(workspacePath: string, mode: ProjectDefaultExecMode): void {
  if (!workspacePath) return;
  try {
    const map = JSON.parse(localStorage.getItem(DEFAULT_MODE_STORAGE_KEY) || "{}") as Record<string, string>;
    const key = workspacePath.replace(/[\\/]+$/, "").toLocaleLowerCase();
    map[key] = mode;
    localStorage.setItem(DEFAULT_MODE_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // ignore
  }
}

export function resolveEffectiveBaseRef(
  baseBranch: string,
  branches: GitBranchSummary[],
  startFromOrigin: boolean,
): string {
  const clean = baseBranch.trim() || "HEAD";
  if (!startFromOrigin || clean === "HEAD") return clean;
  if (clean.startsWith("origin/")) return clean;
  const matched = branches.find((b) => b.name === clean);
  if (matched?.upstream) return matched.upstream;
  return `origin/${clean}`;
}

export async function executeInPlaceWorktreeHandoff(input: {
  sessionId: string;
  workspacePath: string;
  worktreeProfileId: string;
  worktreeName?: string;
  baseRef: string;
  startFromOrigin: boolean;
  carryDirtyChanges: CarryDirtyChangesMode;
}): Promise<SessionForkResult> {
  if (typeof window.grokDesktop.handoffSessionToWorktree === "function") {
    return window.grokDesktop.handoffSessionToWorktree({
      sessionId: input.sessionId,
      workspacePath: input.workspacePath,
      ...(input.worktreeName ? { worktreeName: input.worktreeName } : {}),
      baseRef: input.baseRef,
      cleanSource: input.carryDirtyChanges === "move",
      startFromOrigin: input.startFromOrigin,
      carryDirtyChanges: input.carryDirtyChanges,
    });
  }

  if (input.startFromOrigin) {
    await window.grokDesktop
      .pullGitRepository(input.workspacePath, `fetch-${crypto.randomUUID()}`)
      .catch(() => undefined);
  }

  return window.grokDesktop.forkSession(input.sessionId, undefined, {
    workspacePath: input.workspacePath,
    profileId: input.worktreeProfileId,
    ...(input.worktreeName ? { worktreeName: input.worktreeName } : {}),
    worktreeRef: input.baseRef,
  });
}

export interface WorktreeModePickerProps {
  workspacePath: string;
  sessionId?: string;
  session?: SessionSummary;
  assignment?: SessionExecutionAssignment;
  draft?: NewTaskDraft;
  disabled?: boolean;
  onDraftChange?(patch: Partial<NewTaskDraft>): void;
  onForked?(result: SessionForkResult): void;
  onError?(message: string): void;
}

const BUILTIN_NORMAL_PROFILE_ID = "builtin-normal";
const BUILTIN_WORKTREE_PROFILE_ID = "builtin-worktree";

export function WorktreeModePicker({
  workspacePath,
  sessionId,
  session,
  assignment,
  draft,
  disabled = false,
  onDraftChange,
  onForked,
  onError,
}: WorktreeModePickerProps): React.JSX.Element | null {
  const [branches, setBranches] = useState<GitBranchSummary[]>([]);
  const [profiles, setProfiles] = useState<SessionExecutionProfile[]>([]);
  const [gitAvailable, setGitAvailable] = useState(true);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [branchSearch, setBranchSearch] = useState("");
  const [handoffAction, setHandoffAction] = useState<"handoff" | "fork">("handoff");
  const [carryDirtyChanges, setCarryDirtyChanges] = useState<CarryDirtyChangesMode>("move");
  const [startFromOrigin, setStartFromOrigin] = useState(false);
  const [forkName, setForkName] = useState("");
  const [forkRef, setForkRef] = useState("");
  const [forkBusy, setForkBusy] = useState(false);

  const effectiveWorkspace = assignment?.sourceWorkspacePath || draft?.workspacePath || workspacePath || session?.cwd || "";
  const [projectDefaultMode, setProjectDefaultMode] = useState<ProjectDefaultExecMode>(() =>
    readProjectDefaultExecMode(effectiveWorkspace),
  );
  const appliedDefaultForKeyRef = useRef("");

  const gitStatus = useGitStore((state) => (samePath(state.workspace, effectiveWorkspace) ? state.status : undefined));
  const worktrees = useWorktreeStore((state) => state.items);

  useEffect(() => {
    setProjectDefaultMode(readProjectDefaultExecMode(effectiveWorkspace));
  }, [effectiveWorkspace]);

  const loadMetadata = useCallback(async () => {
    if (!effectiveWorkspace) return;
    try {
      const cap = await window.grokDesktop.getGitWorkspaceCapability(effectiveWorkspace);
      setGitAvailable(cap.available);
      if (!cap.available) {
        setBranches([]);
        return;
      }
      const [branchList, profileList] = await Promise.all([
        window.grokDesktop.listGitBranches(effectiveWorkspace).catch(() => [] as GitBranchSummary[]),
        window.grokDesktop.listExecutionProfiles(effectiveWorkspace).catch(() => [] as SessionExecutionProfile[]),
      ]);
      setBranches(branchList);
      setProfiles(profileList.filter((item) => item.effective !== false));
    } catch {
      setGitAvailable(false);
    }
  }, [effectiveWorkspace]);

  useEffect(() => {
    void loadMetadata();
  }, [loadMetadata]);

  useEffect(() => {
    if (popoverOpen) {
      setBranchSearch("");
      void loadMetadata();
    }
  }, [loadMetadata, popoverOpen]);

  const currentBranchName = useMemo(
    () => branches.find((b) => b.current)?.name || gitStatus?.branch?.name || "HEAD",
    [branches, gitStatus?.branch?.name],
  );

  const filteredBranches = useMemo(() => {
    const q = branchSearch.trim().toLocaleLowerCase();
    if (!q) return branches;
    return branches.filter((b) => b.name.toLocaleLowerCase().includes(q));
  }, [branchSearch, branches]);

  const worktreeProfileId = useMemo(
    () =>
      profiles.find((item) => item.id === BUILTIN_WORKTREE_PROFILE_ID)?.id ??
      profiles.find((item) => item.worktree)?.id ??
      BUILTIN_WORKTREE_PROFILE_ID,
    [profiles],
  );

  const localProfileId = useMemo(
    () =>
      profiles.find((item) => item.id === BUILTIN_NORMAL_PROFILE_ID)?.id ??
      profiles.find((item) => !item.worktree)?.id ??
      BUILTIN_NORMAL_PROFILE_ID,
    [profiles],
  );

  useEffect(() => {
    if (sessionId || !draft || !onDraftChange || !gitAvailable || !effectiveWorkspace) return;
    const draftIdentity = `${draft.projectId}:${effectiveWorkspace}`;
    if (appliedDefaultForKeyRef.current === draftIdentity) return;
    appliedDefaultForKeyRef.current = draftIdentity;
    const preferred = readProjectDefaultExecMode(effectiveWorkspace);
    if (preferred === "worktree" && (!draft.profileId || draft.profileId === localProfileId) && !draft.worktreeName) {
      onDraftChange({
        profileId: worktreeProfileId,
        worktreeRef: draft.worktreeRef || currentBranchName,
      });
    }
  }, [currentBranchName, draft, effectiveWorkspace, gitAvailable, localProfileId, onDraftChange, sessionId, worktreeProfileId]);

  const isDraftWorktreeMode = useMemo(() => {
    if (!draft) return false;
    if (draft.profileId === BUILTIN_WORKTREE_PROFILE_ID) return true;
    const matched = profiles.find((item) => item.id === draft.profileId);
    if (matched) return matched.worktree;
    return Boolean(draft.worktreeName || draft.worktreeRef);
  }, [draft, profiles]);

  const seatedWorktree = useMemo(() => {
    const wtId = assignment?.worktreeId ?? session?.worktreeId;
    if (wtId) return worktrees.find((item) => item.id === wtId);
    const cwd = assignment?.cwd ?? session?.cwd;
    return cwd ? worktrees.find((item) => samePath(item.path, cwd)) : undefined;
  }, [assignment?.cwd, assignment?.worktreeId, session?.cwd, session?.worktreeId, worktrees]);

  if (!effectiveWorkspace || !gitAvailable) return null;

  const dirtyCount = gitStatus?.changes.length ?? 0;

  if (sessionId) {
    const isSeatedInWorktree = Boolean(
      seatedWorktree || assignment?.worktreeId || session?.worktreeId || session?.originKind === "worktree",
    );
    const badgeLabel = isSeatedInWorktree
      ? `Worktree · ${seatedWorktree?.branch || seatedWorktree?.name || currentBranchName}`
      : `本地目录 · ${currentBranchName}`;

    const handleSeatedExecute = async (): Promise<void> => {
      if (forkBusy) return;
      setForkBusy(true);
      try {
        const resolvedRef = resolveEffectiveBaseRef(forkRef || currentBranchName, branches, startFromOrigin);
        const result =
          handoffAction === "handoff" && !isSeatedInWorktree
            ? await executeInPlaceWorktreeHandoff({
                sessionId,
                workspacePath: effectiveWorkspace,
                worktreeProfileId,
                worktreeName: forkName.trim() || undefined,
                baseRef: resolvedRef,
                startFromOrigin,
                carryDirtyChanges: dirtyCount > 0 ? carryDirtyChanges : "none",
              })
            : await window.grokDesktop.forkSession(sessionId, undefined, {
                workspacePath: effectiveWorkspace,
                profileId: worktreeProfileId,
                ...(forkName.trim() ? { worktreeName: forkName.trim() } : {}),
                worktreeRef: resolvedRef,
              });

        const updatedWts = await window.grokDesktop.listWorktrees(effectiveWorkspace).catch(() => undefined);
        if (updatedWts) useWorktreeStore.getState().setItems(effectiveWorkspace, updatedWts);

        setPopoverOpen(false);
        setForkName("");
        setForkRef("");
        onForked?.(result);
      } catch (error) {
        onError?.(error instanceof Error ? error.message : String(error));
      } finally {
        setForkBusy(false);
      }
    };

    return (
      <div className="worktree-mode-picker is-seated" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
        <span
          className="ui-badge"
          title={assignment?.cwd || session?.cwd || effectiveWorkspace}
          style={{
            height: 24,
            padding: "0 8px",
            gap: 5,
            background: isSeatedInWorktree ? "var(--color-accent-soft)" : "var(--color-hover)",
            color: isSeatedInWorktree ? "var(--color-accent)" : "var(--color-fg-subtle)",
            border: "1px solid var(--color-border)",
          }}
        >
          {isSeatedInWorktree ? <FolderGit2 size={12} /> : <GitBranch size={12} />}
          <span style={{ maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis" }}>{badgeLabel}</span>
        </span>

        <Popover.Root open={popoverOpen} onOpenChange={setPopoverOpen}>
          <Popover.Trigger asChild>
            <button
              type="button"
              className="ui-btn ui-btn-ghost ui-btn-sm"
              disabled={disabled || forkBusy}
              title={
                isSeatedInWorktree
                  ? "从当前对话分叉到另一个全新隔离 Worktree"
                  : "热迁移当前会话到新隔离 Worktree（可携带未提交修改）或创建分叉"
              }
              style={{ height: 24, padding: "0 7px", fontSize: "var(--text-xs)" }}
            >
              {isSeatedInWorktree ? <GitFork size={12} /> : <ArrowRightLeft size={12} />}
              <span>{isSeatedInWorktree ? "分叉新 Worktree" : "热迁移到新 Worktree"}</span>
            </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              className="ui-popover"
              align="start"
              side="top"
              sideOffset={8}
              style={{ width: 320, display: "grid", gap: 10 }}
            >
              {!isSeatedInWorktree ? (
                <div className="ui-seg ui-seg-sm" role="group" aria-label="Worktree 迁移方式">
                  <button
                    type="button"
                    aria-pressed={handoffAction === "handoff"}
                    onClick={() => setHandoffAction("handoff")}
                  >
                    热迁移当前会话
                  </button>
                  <button
                    type="button"
                    aria-pressed={handoffAction === "fork"}
                    onClick={() => setHandoffAction("fork")}
                  >
                    分叉为新会话
                  </button>
                </div>
              ) : (
                <strong style={{ fontSize: "var(--text-caption)", color: "var(--color-fg)" }}>
                  分叉会话到新隔离 Worktree
                </strong>
              )}

              <div className="ui-field" style={{ gap: 4 }}>
                <span style={{ fontSize: "var(--text-xs)" }}>基准分支 (Base Ref)</span>
                <BranchSearchSelect
                  branches={filteredBranches}
                  search={branchSearch}
                  onSearch={setBranchSearch}
                  value={forkRef}
                  placeholder={`默认 (${currentBranchName})`}
                  onSelect={setForkRef}
                />
              </div>

              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: "var(--text-xs)",
                  color: "var(--color-fg-subtle)",
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={startFromOrigin}
                  onChange={(e) => setStartFromOrigin(e.target.checked)}
                />
                <CloudDownload size={12} style={{ color: "var(--color-accent)" }} />
                <span>从远端 origin 最新分支起点创建 (startFromOrigin)</span>
              </label>

              {handoffAction === "handoff" && !isSeatedInWorktree && (
                <label className="ui-field" style={{ gap: 4 }}>
                  <span style={{ fontSize: "var(--text-xs)" }}>
                    未提交脏改动处理 ({dirtyCount} 个文件)
                  </span>
                  <select
                    className="ui-select"
                    style={{ height: 28, fontSize: "var(--text-xs)" }}
                    value={carryDirtyChanges}
                    onChange={(e) => setCarryDirtyChanges(e.target.value as CarryDirtyChangesMode)}
                  >
                    <option value="move">迁移到新 Worktree 并清理原目录 (move)</option>
                    <option value="copy">复制到新 Worktree 且原目录保留 (copy)</option>
                    <option value="none">不携带未提交改动，保持干净起点 (none)</option>
                  </select>
                </label>
              )}

              <label className="ui-field" style={{ gap: 4 }}>
                <span style={{ fontSize: "var(--text-xs)" }}>Worktree 名称（可选）</span>
                <input
                  className="ui-input"
                  style={{ height: 28, fontSize: "var(--text-xs)" }}
                  value={forkName}
                  onChange={(event) => setForkName(event.target.value)}
                  placeholder="留空自动生成名称…"
                />
              </label>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 6 }}>
                <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" onClick={() => setPopoverOpen(false)}>
                  取消
                </button>
                <button
                  type="button"
                  className="ui-btn ui-btn-primary ui-btn-sm"
                  disabled={forkBusy}
                  onClick={() => void handleSeatedExecute()}
                >
                  {forkBusy && <LoaderCircle size={12} className="ui-spin" />}
                  {handoffAction === "handoff" && !isSeatedInWorktree ? "立即热迁移" : "立即分叉"}
                </button>
              </div>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      </div>
    );
  }

  const rawSelectedBranch = (draft?.worktreeRef || currentBranchName).replace(/^origin\//, "");
  const isDraftOriginRef = Boolean(draft?.worktreeRef?.startsWith("origin/"));

  const selectMode = (isolated: boolean): void => {
    if (!onDraftChange) return;
    if (isolated) {
      const targetRef = resolveEffectiveBaseRef(rawSelectedBranch, branches, startFromOrigin || isDraftOriginRef);
      onDraftChange({
        profileId: worktreeProfileId,
        worktreeRef: targetRef,
      });
    } else {
      onDraftChange({
        profileId: localProfileId,
        worktreeName: undefined,
        worktreeRef: undefined,
      });
    }
  };

  const toggleDefaultForProject = (checked: boolean): void => {
    const nextMode: ProjectDefaultExecMode = checked ? (isDraftWorktreeMode ? "worktree" : "local") : "local";
    setProjectDefaultMode(nextMode);
    writeProjectDefaultExecMode(effectiveWorkspace, nextMode);
  };

  return (
    <div className="worktree-mode-picker is-draft" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
      <div className="ui-seg ui-seg-sm" role="group" aria-label="新会话执行目录模式">
        <button
          type="button"
          disabled={disabled}
          aria-pressed={!isDraftWorktreeMode}
          onClick={() => selectMode(false)}
          title={`直接在当前本地检出目录 (${currentBranchName}) 中运行`}
        >
          <Folder size={12} />
          <span>本地目录</span>
        </button>
        <button
          type="button"
          disabled={disabled}
          aria-pressed={isDraftWorktreeMode}
          onClick={() => selectMode(true)}
          title="自动创建独立 Git Worktree 隔离修改，互不污染本地分支"
        >
          <FolderGit2 size={12} />
          <span>新建 Worktree</span>
        </button>
      </div>

      {isDraftWorktreeMode && (
        <Popover.Root open={popoverOpen} onOpenChange={setPopoverOpen}>
          <Popover.Trigger asChild>
            <button
              type="button"
              className="ui-btn ui-btn-secondary ui-btn-sm"
              disabled={disabled}
              title="配置新 Worktree 基准分支、远端起点与项目默认模式"
              style={{ height: 24, padding: "0 8px", fontSize: "var(--text-xs)" }}
            >
              <GitBranch size={11} style={{ color: "var(--color-accent)" }} />
              <span style={{ maxWidth: 132, overflow: "hidden", textOverflow: "ellipsis" }}>
                {draft?.worktreeRef || currentBranchName}
                {draft?.worktreeName ? ` → ${draft.worktreeName}` : ""}
              </span>
              <ChevronDown size={11} />
            </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              className="ui-popover"
              align="start"
              side="top"
              sideOffset={8}
              style={{ width: 308, display: "grid", gap: 10 }}
            >
              <strong style={{ fontSize: "var(--text-caption)", color: "var(--color-fg)" }}>
                隔离 Worktree 启动配置
              </strong>

              <div className="ui-field" style={{ gap: 4 }}>
                <span style={{ fontSize: "var(--text-xs)" }}>基准分支 (Base Branch)</span>
                <BranchSearchSelect
                  branches={filteredBranches}
                  search={branchSearch}
                  onSearch={setBranchSearch}
                  value={rawSelectedBranch}
                  placeholder={currentBranchName}
                  onSelect={(branchName) => {
                    const effective = resolveEffectiveBaseRef(
                      branchName || currentBranchName,
                      branches,
                      startFromOrigin || isDraftOriginRef,
                    );
                    onDraftChange?.({ worktreeRef: effective });
                  }}
                />
              </div>

              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: "var(--text-xs)",
                  color: "var(--color-fg-subtle)",
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={startFromOrigin || isDraftOriginRef}
                  onChange={(e) => {
                    const nextOrigin = e.target.checked;
                    setStartFromOrigin(nextOrigin);
                    const effective = resolveEffectiveBaseRef(rawSelectedBranch, branches, nextOrigin);
                    onDraftChange?.({ worktreeRef: effective });
                  }}
                />
                <CloudDownload size={12} style={{ color: "var(--color-accent)" }} />
                <span>从远端最新起点创建 (origin/{rawSelectedBranch})</span>
              </label>

              <label className="ui-field" style={{ gap: 4 }}>
                <span style={{ fontSize: "var(--text-xs)" }}>Worktree 名称（可选）</span>
                <input
                  className="ui-input"
                  style={{ height: 28, fontSize: "var(--text-xs)" }}
                  value={draft?.worktreeName ?? ""}
                  onChange={(event) => onDraftChange?.({ worktreeName: event.target.value || undefined })}
                  placeholder="留空按日期与任务自动命名…"
                />
              </label>

              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  paddingTop: 6,
                  borderTop: "1px solid var(--color-border)",
                  fontSize: "var(--text-xs)",
                  color: "var(--color-fg-subtle)",
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={projectDefaultMode === "worktree"}
                  onChange={(e) => toggleDefaultForProject(e.target.checked)}
                />
                <span>将“新建 Worktree”设为此项目的默认启动模式</span>
              </label>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      )}
    </div>
  );
}

function BranchSearchSelect({
  branches,
  search,
  onSearch,
  value,
  placeholder,
  onSelect,
}: {
  branches: GitBranchSummary[];
  search: string;
  onSearch(value: string): void;
  value: string;
  placeholder: string;
  onSelect(branchName: string): void;
}): React.JSX.Element {
  return (
    <div style={{ display: "grid", gap: 4 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          height: 28,
          padding: "0 8px",
          borderRadius: "var(--radius-md)",
          border: "1px solid var(--color-border-strong)",
          background: "var(--color-input)",
        }}
      >
        <Search size={12} style={{ color: "var(--color-fg-subtlest)", flex: "none" }} />
        <input
          value={search}
          onChange={(event) => onSearch(event.target.value)}
          placeholder={`搜索分支（当前：${placeholder}）`}
          style={{
            width: "100%",
            border: 0,
            outline: 0,
            background: "transparent",
            color: "var(--color-fg)",
            fontSize: "var(--text-xs)",
          }}
        />
      </div>
      <div
        role="listbox"
        style={{
          maxHeight: 140,
          overflowY: "auto",
          display: "grid",
          gap: 1,
          padding: 3,
          borderRadius: "var(--radius-md)",
          border: "1px solid var(--color-border)",
          background: "var(--color-frame)",
        }}
      >
        {branches.map((branch) => {
          const selected = value === branch.name;
          return (
            <button
              key={branch.name}
              type="button"
              role="option"
              aria-selected={selected}
              onClick={() => onSelect(branch.name)}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 6,
                height: 25,
                padding: "0 7px",
                border: 0,
                borderRadius: "var(--radius-sm)",
                background: selected ? "var(--color-selected)" : "transparent",
                color: selected ? "var(--color-fg)" : "var(--color-fg-subtle)",
                fontSize: "var(--text-xs)",
                fontFamily: "var(--font-mono)",
                textAlign: "left",
                cursor: "pointer",
              }}
            >
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {branch.name}
                {branch.current ? " (当前)" : ""}
              </span>
              {selected && <Check size={12} style={{ color: "var(--color-accent)", flex: "none" }} />}
            </button>
          );
        })}
        {branches.length === 0 && (
          <span style={{ padding: "6px 8px", fontSize: "var(--text-xs)", color: "var(--color-fg-subtlest)" }}>
            无匹配分支
          </span>
        )}
      </div>
    </div>
  );
}

function samePath(left: string, right: string): boolean {
  return left.replace(/[\\/]+$/, "").toLocaleLowerCase() === right.replace(/[\\/]+$/, "").toLocaleLowerCase();
}
