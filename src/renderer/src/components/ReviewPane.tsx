import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  GitDiffSnapshot,
  GitReviewFile,
  GitReviewHunk,
  GitReviewIndex,
  GitReviewScope,
  GitTurnCheckpoint,
  GitWorkspaceCapability,
  NavigationIntent,
} from "../../../shared/types";
import { errorMessage } from "../error-message";
import type { ReviewCommentDraft } from "../review-comments";
import { UiIcon } from "../ui-icons";
import { useDiffAnnotations } from "./DiffAnnotations";
import type { DiffLineRange } from "./feedback-context";
import {
  buildReviewTour,
  REVIEW_TOUR_GROUPS,
  ReviewTourBar,
  viewedFileSignature,
  type AnnotatedTourFile,
} from "./ReviewTourBar";
import type { RightTool } from "./RightUtilityPane";
import { UiDialog } from "./ui/primitives";
import "../styles/review-pane.css";
import "../styles/t3-panels.css";

type ScopeKind = GitReviewScope["kind"];
type PanelScopeKind = ScopeKind | "turn-checkpoint";
type DiffViewMode = "unified" | "split";

function viewedStorageKey(cwd: string): string {
  return `grok.review-viewed.v1:${cwd.replace(/[\\/]+$/, "").toLowerCase()}`;
}

function readViewedKeys(cwd: string): Set<string> {
  if (!cwd) return new Set();
  try {
    const raw = JSON.parse(sessionStorage.getItem(viewedStorageKey(cwd)) || "[]");
    return Array.isArray(raw) ? new Set(raw.filter((x: unknown): x is string => typeof x === "string")) : new Set();
  } catch {
    return new Set();
  }
}

export function ReviewPane({
  cwd,
  sessionId,
  lastTurnPaths,
  initialKind = "unstaged",
  onTool,
  onClose,
  onNavigate,
  onAddComment,
  onError,
  confirmAction,
}: {
  cwd: string;
  sessionId?: string;
  lastTurnPaths: string[];
  initialKind?: ScopeKind;
  onTool?(tool: RightTool): void;
  onClose(): void;
  onNavigate(intent: NavigationIntent): void;
  onAddComment(comment: ReviewCommentDraft): void;
  onError(message: string): void;
  confirmAction?(message: string, options?: { title?: string; confirmLabel?: string; danger?: boolean }): Promise<boolean>;
}): React.JSX.Element {
  const [kind, setKind] = useState<PanelScopeKind>(initialKind);
  const [commit, setCommit] = useState("");
  const [branch, setBranch] = useState("");
  const [turnCheckpoints, setTurnCheckpoints] = useState<GitTurnCheckpoint[]>([]);
  const [selectedTurnOrdinal, setSelectedTurnOrdinal] = useState<number>(-1);
  const [turnSnapshot, setTurnSnapshot] = useState<GitDiffSnapshot>();
  const [commits, setCommits] = useState<Array<{ hash: string; shortHash: string; subject: string }>>([]);
  const [branches, setBranches] = useState<Array<{ name: string; current: boolean }>>([]);
  const [index, setIndex] = useState<GitReviewIndex>();
  const [selectedFileId, setSelectedFileId] = useState("");
  const [selectedFile, setSelectedFile] = useState<GitReviewFile>();
  const [activeHunkIndex, setActiveHunkIndex] = useState(0);
  const [fileFilter, setFileFilter] = useState("");
  const [onlyUnviewed, setOnlyUnviewed] = useState(false);
  const [onlyPriority, setOnlyPriority] = useState(false);
  const [viewedKeys, setViewedKeys] = useState<Set<string>>(() => readViewedKeys(cwd));
  const [capability, setCapability] = useState<GitWorkspaceCapability>();
  const [loading, setLoading] = useState(false);
  const [loadingFile, setLoadingFile] = useState(false);
  const [busy, setBusy] = useState("");
  const [pendingConfirm, setPendingConfirm] = useState<{
    title: string;
    message: string;
    execute(): Promise<void>;
  }>();

  const paneRef = useRef<HTMLElement>(null);
  const mountedRef = useRef(true);
  const refreshGenerationRef = useRef(0);

  const lastTurnKey = kind === "last-turn" ? lastTurnPaths.join("\0") : "";
  const scope = useMemo<GitReviewScope>(() => {
    if (kind === "turn-checkpoint") {
      return { kind: "commit", revision: "HEAD" };
    }
    if (kind === "commit") return { kind, revision: commit || "HEAD" };
    if (kind === "branch") return { kind, base: branch || "HEAD~1" };
    if (kind === "last-turn") return { kind, paths: lastTurnPaths };
    return { kind };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branch, commit, kind, lastTurnKey]);

  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const indexRef = useRef(index);
  indexRef.current = index;
  const kindRef = useRef(kind);
  kindRef.current = kind;
  const turnSnapshotRef = useRef(turnSnapshot);
  turnSnapshotRef.current = turnSnapshot;

  const annotations = useDiffAnnotations(onError, {
    onSavedComment: (saved) => {
      const snapId = indexRef.current?.id;
      if (!snapId) return;
      const lineSpan =
        saved.endLine > saved.startLine ? `[L${saved.startLine}–L${saved.endLine}] ` : "";
      const isCheckpoint = kindRef.current === "turn-checkpoint";
      const effectiveScope: GitReviewScope = isCheckpoint
        ? { kind: "commit", revision: turnSnapshotRef.current?.afterCommit || "HEAD" }
        : scopeRef.current;
      onAddComment({
        id: crypto.randomUUID(),
        path: saved.path,
        line: saved.startLine,
        side: saved.side,
        body: `${lineSpan}${saved.comment}`,
        snapshotId: snapId,
        scope: effectiveScope,
        ...(isCheckpoint ? { immutableCheckpoint: true } : {}),
      });
    },
  });

  const [diffViewMode, setDiffViewMode] = useState<DiffViewMode>(() => {
    try {
      return localStorage.getItem("grok:review-diff-mode") === "split" ? "split" : "unified";
    } catch {
      return "unified";
    }
  });
  const updateDiffViewMode = (next: DiffViewMode): void => {
    setDiffViewMode(next);
    try {
      localStorage.setItem("grok:review-diff-mode", next);
    } catch {
      // ignore
    }
  };
  const [width, setWidth] = useState(() =>
    Math.max(440, Math.min(860, Number(localStorage.getItem("grok:right-width:review")) || 640)),
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      refreshGenerationRef.current += 1;
    };
  }, []);

  useEffect(() => {
    setViewedKeys(readViewedKeys(cwd));
  }, [cwd]);

  const persistViewed = useCallback(
    (updater: (prev: Set<string>) => Set<string>) => {
      setViewedKeys((prev) => {
        const next = updater(prev);
        if (cwd) {
          try {
            sessionStorage.setItem(viewedStorageKey(cwd), JSON.stringify([...next].slice(-500)));
          } catch {
            // ignore
          }
        }
        return next;
      });
    },
    [cwd],
  );

  const tourFiles = useMemo(() => buildReviewTour(index?.files ?? []), [index?.files]);

  const filteredTourFiles = useMemo(() => {
    const query = fileFilter.trim().toLocaleLowerCase();
    return tourFiles.filter((item) => {
      if (
        query &&
        !item.file.path.toLocaleLowerCase().includes(query) &&
        !item.file.oldPath?.toLocaleLowerCase().includes(query)
      ) {
        return false;
      }
      if (onlyPriority && !item.priority) return false;
      if (onlyUnviewed && viewedKeys.has(viewedFileSignature(item.file))) return false;
      return true;
    });
  }, [fileFilter, onlyPriority, onlyUnviewed, tourFiles, viewedKeys]);

  useEffect(() => setKind(initialKind), [initialKind]);

  useEffect(() => {
    if (!cwd || !sessionId || typeof window.grokDesktop.listGitTurnCheckpoints !== "function") {
      setTurnCheckpoints([]);
      return;
    }
    let cancelled = false;
    void window.grokDesktop
      .listGitTurnCheckpoints(cwd, sessionId)
      .then((cps) => {
        if (cancelled) return;
        setTurnCheckpoints(cps);
        const latest = cps.at(-1);
        if (latest) {
          setSelectedTurnOrdinal((cur) => (cps.some((c) => c.turnOrdinal === cur) ? cur : latest.turnOrdinal));
        }
      })
      .catch(() => {
        if (!cancelled) setTurnCheckpoints([]);
      });
    return () => {
      cancelled = true;
    };
  }, [cwd, sessionId]);

  const refresh = useCallback(async (): Promise<void> => {
    const generation = ++refreshGenerationRef.current;
    const isCurrent = (): boolean => mountedRef.current && generation === refreshGenerationRef.current;
    if (!cwd) {
      if (isCurrent()) {
        setCapability({ available: false, cwd: "", reason: "no-workspace", message: "请选择工作区后再查看变更" });
        setIndex(undefined);
        setSelectedFile(undefined);
        setLoading(false);
      }
      return;
    }
    setLoading(true);
    setCapability(undefined);
    setIndex(undefined);
    setTurnSnapshot(undefined);
    setSelectedFile(undefined);
    try {
      const nextCapability = await window.grokDesktop.getGitWorkspaceCapability(cwd);
      if (!isCurrent()) return;
      setCapability(nextCapability);
      if (!nextCapability.available) {
        setIndex(undefined);
        setSelectedFile(undefined);
        return;
      }

      if (kind === "turn-checkpoint") {
        if (!sessionId || typeof window.grokDesktop.getGitTurnDiff !== "function") {
          return;
        }
        const cps = await window.grokDesktop.listGitTurnCheckpoints(cwd, sessionId).catch(() => []);
        if (!isCurrent()) return;
        setTurnCheckpoints(cps);
        const latestCp = cps.at(-1);
        if (!latestCp) {
          setIndex({
            id: `empty-cp:${sessionId}`,
            repositoryRoot: cwd,
            scope: { kind: "commit", revision: "HEAD" },
            readOnly: true,
            files: [],
            additions: 0,
            deletions: 0,
            createdAt: new Date().toISOString(),
          });
          return;
        }
        const targetOrdinal = cps.some((c) => c.turnOrdinal === selectedTurnOrdinal)
          ? selectedTurnOrdinal
          : latestCp.turnOrdinal;
        setSelectedTurnOrdinal(targetOrdinal);
        const snap = await window.grokDesktop.getGitTurnDiff(cwd, sessionId, targetOrdinal);
        if (!isCurrent()) return;
        setTurnSnapshot(snap);
        const synthIndex: GitReviewIndex = {
          id: snap.id,
          repositoryRoot: snap.repositoryRoot,
          scope: { kind: "commit", revision: snap.afterCommit },
          readOnly: true,
          files: snap.files.map(({ hunks, ...summary }) => ({
            ...summary,
            hunkCount: hunks.length,
          })),
          additions: snap.additions,
          deletions: snap.deletions,
          createdAt: snap.createdAt,
        };
        setIndex(synthIndex);
        const ordered = buildReviewTour(synthIndex.files);
        setSelectedFileId((current) =>
          synthIndex.files.some((file) => file.id === current) ? current : ordered[0]?.file.id ?? "",
        );
        return;
      }

      const next = await window.grokDesktop.getGitReviewIndex(cwd, scope);
      if (!isCurrent()) return;
      setIndex(next);
      const ordered = buildReviewTour(next.files);
      setSelectedFileId((current) =>
        next.files.some((file) => file.id === current) ? current : ordered[0]?.file.id ?? "",
      );
    } catch (error) {
      if (!isCurrent()) return;
      setIndex(undefined);
      setSelectedFile(undefined);
      onError(errorMessage(error));
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [cwd, kind, onError, scope, selectedTurnOrdinal, sessionId]);

  useEffect(() => {
    void refresh();
    return () => {
      refreshGenerationRef.current += 1;
    };
  }, [refresh]);

  useEffect(() => {
    setActiveHunkIndex(0);
    if (!index || !selectedFileId) {
      setSelectedFile(undefined);
      return;
    }
    if (kind === "turn-checkpoint") {
      setSelectedFile(turnSnapshot?.files.find((f) => f.id === selectedFileId));
      setLoadingFile(false);
      return;
    }
    if (JSON.stringify(index.scope) !== JSON.stringify(scope)) {
      setSelectedFile(undefined);
      setLoadingFile(false);
      return;
    }
    let cancelled = false;
    setLoadingFile(true);
    setSelectedFile(undefined);
    void window.grokDesktop
      .getGitReviewFileDetail(cwd, scope, index.id, selectedFileId)
      .then((value) => {
        if (!cancelled) setSelectedFile(value.file);
      })
      .catch((error) => {
        if (!cancelled) {
          setSelectedFile(undefined);
          onError(errorMessage(error));
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingFile(false);
      });
    return () => {
      cancelled = true;
    };
  }, [cwd, index, kind, onError, scope, selectedFileId, turnSnapshot]);

  useEffect(() => {
    if (!cwd || capability?.available !== true) return;
    let cancelled = false;
    void Promise.all([window.grokDesktop.listGitHistory(cwd, 30), window.grokDesktop.listGitBranches(cwd)])
      .then(([history, values]) => {
        if (cancelled) return;
        setCommits(history);
        setBranches(values);
        setCommit((current) => current || history[0]?.hash || "HEAD");
        setBranch(
          (current) =>
            current ||
            values.find((v) => v.name === "main" && !v.current)?.name ||
            values.find((v) => v.name === "master" && !v.current)?.name ||
            values.find((v) => !v.current)?.name ||
            values[0]?.name ||
            "HEAD~1",
        );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [capability?.available, cwd]);

  const askRevertConfirm = useCallback(
    async (title: string, message: string, execute: () => Promise<void>): Promise<void> => {
      if (confirmAction) {
        const ok = await confirmAction(message, { title, confirmLabel: "确认恢复", danger: true });
        if (ok) await execute();
        return;
      }
      setPendingConfirm({ title, message, execute });
    },
    [confirmAction],
  );

  const runFileAction = useCallback(
    async (file: GitReviewFile, action: "stage" | "unstage" | "revert"): Promise<void> => {
      if (!cwd) return;
      const performAction = async (): Promise<void> => {
        setBusy(`${action}:${file.id}`);
        try {
          if (action === "stage") await window.grokDesktop.stageGitChanges(cwd, [file.path]);
          else if (action === "unstage") await window.grokDesktop.unstageGitChanges(cwd, [file.path]);
          else {
            await window.grokDesktop.discardGitChanges(cwd, {
              trackedPaths: file.kind === "untracked" ? [] : [file.path],
              untrackedPaths: file.kind === "untracked" ? [file.path] : [],
              confirmedPaths: [file.path],
            });
          }
          if (mountedRef.current) await refresh();
        } catch (error) {
          if (mountedRef.current) onError(errorMessage(error));
        } finally {
          if (mountedRef.current) setBusy("");
        }
      };

      if (action === "revert") {
        await askRevertConfirm(
          "恢复文件未暂存修改",
          `恢复 ${file.path} 的全部未暂存修改？此操作无法撤销。`,
          performAction,
        );
        return;
      }
      await performAction();
    },
    [askRevertConfirm, cwd, onError, refresh],
  );

  const runHunkAction = useCallback(
    async (file: GitReviewFile, hunkId: string, action: "stage" | "unstage" | "revert"): Promise<void> => {
      if (!index || (scope.kind !== "unstaged" && scope.kind !== "staged")) return;
      const performHunk = async (): Promise<void> => {
        setBusy(`${action}:${hunkId}`);
        try {
          await window.grokDesktop.applyGitReviewHunk(cwd, {
            snapshotId: index.id,
            scope,
            fileId: file.id,
            hunkId,
            action,
            confirmed: action === "revert",
          });
          if (mountedRef.current) await refresh();
        } catch (error) {
          if (mountedRef.current) {
            onError(errorMessage(error));
            await refresh();
          }
        } finally {
          if (mountedRef.current) setBusy("");
        }
      };

      if (action === "revert") {
        await askRevertConfirm(
          "恢复 Diff 区块",
          `恢复 ${file.path} 的这个区块修改？此操作无法撤销。`,
          performHunk,
        );
        return;
      }
      await performHunk();
    },
    [askRevertConfirm, cwd, index, onError, refresh, scope],
  );

  const runAllAction = async (): Promise<void> => {
    if (!index || index.readOnly || !index.files.length) return;
    setBusy("all");
    try {
      if (kind === "staged") await window.grokDesktop.unstageGitChanges(cwd);
      else await window.grokDesktop.stageGitChanges(cwd);
      if (mountedRef.current) await refresh();
    } catch (error) {
      if (mountedRef.current) onError(errorMessage(error));
    } finally {
      if (mountedRef.current) setBusy("");
    }
  };

  const beginComment = useCallback(
    (range: DiffLineRange) => {
      if (!index) return;
      const snapshotId = index.id;
      annotations.begin(
        range,
        sessionId,
        cwd,
        async () => {
          if (kind === "turn-checkpoint") return true;
          return (await window.grokDesktop.getGitReviewIndex(cwd, scope)).id === snapshotId;
        },
      );
    },
    [annotations, cwd, index, kind, scope, sessionId],
  );

  const toggleViewedAndAdvance = useCallback(
    (advanceNext: boolean) => {
      const current = tourFiles.find((item) => item.file.id === selectedFileId);
      if (!current) return;
      const sig = viewedFileSignature(current.file);
      const wasViewed = viewedKeys.has(sig);
      persistViewed((prev) => {
        const copy = new Set(prev);
        if (wasViewed) copy.delete(sig);
        else copy.add(sig);
        return copy;
      });
      if (!wasViewed && advanceNext) {
        const list = filteredTourFiles.length ? filteredTourFiles : tourFiles;
        const idx = list.findIndex((item) => item.file.id === selectedFileId);
        const nextCandidate =
          list.slice(idx + 1).find((i) => !viewedKeys.has(viewedFileSignature(i.file)) && i.file.id !== selectedFileId) ??
          list.find((i) => !viewedKeys.has(viewedFileSignature(i.file)) && i.file.id !== selectedFileId);
        if (nextCandidate) setSelectedFileId(nextCandidate.file.id);
      }
    },
    [filteredTourFiles, persistViewed, selectedFileId, tourFiles, viewedKeys],
  );

  const handlePaneKeyDown = (event: React.KeyboardEvent<HTMLElement>): void => {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
    const targetEl = event.target as HTMLElement | null;
    if (
      targetEl &&
      (targetEl.tagName === "INPUT" ||
        targetEl.tagName === "TEXTAREA" ||
        targetEl.tagName === "SELECT" ||
        targetEl.isContentEditable)
    ) {
      return;
    }
    if (document.querySelector('[role="dialog"][data-state="open"]:not(.ui-popover), [role="alertdialog"]')) return;

    const list = filteredTourFiles.length ? filteredTourFiles : tourFiles;
    const keyChar = event.key.toLowerCase();

    if (keyChar === "j" || keyChar === "k") {
      if (!selectedFile?.hunks.length) return;
      event.preventDefault();
      const delta = keyChar === "j" ? 1 : -1;
      const nextIdx = Math.max(0, Math.min(selectedFile.hunks.length - 1, activeHunkIndex + delta));
      setActiveHunkIndex(nextIdx);
      const hunkEl = paneRef.current?.querySelectorAll<HTMLElement>(".review-hunk")[nextIdx];
      hunkEl?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      return;
    }

    if (keyChar === "n" || keyChar === "p") {
      if (!list.length) return;
      event.preventDefault();
      const currentIdx = list.findIndex((item) => item.file.id === selectedFileId);
      const delta = keyChar === "n" ? 1 : -1;
      const nextIdx = ((currentIdx >= 0 ? currentIdx : 0) + delta + list.length) % list.length;
      const nextItem = list[nextIdx];
      if (nextItem) setSelectedFileId(nextItem.file.id);
      return;
    }

    if (keyChar === "v") {
      if (!selectedFileId) return;
      event.preventDefault();
      toggleViewedAndAdvance(true);
      return;
    }

    if (keyChar === "s" && selectedFile && index && !index.readOnly && kind === "unstaged" && !busy) {
      event.preventDefault();
      void runFileAction(selectedFile, "stage");
      return;
    }

    if (keyChar === "u" && selectedFile && index && !index.readOnly && kind === "staged" && !busy) {
      event.preventDefault();
      void runFileAction(selectedFile, "unstage");
      return;
    }

    if (keyChar === "c" && selectedFile && !selectedFile.binary) {
      const hunk = selectedFile.hunks[activeHunkIndex] ?? selectedFile.hunks[0];
      if (!hunk) return;
      event.preventDefault();
      const changedLine =
        hunk.lines.find((l) => l.kind === "addition" || l.kind === "deletion") ?? hunk.lines[0];
      const side = changedLine?.newLine !== undefined ? "new" : "old";
      const lineNum = changedLine?.newLine ?? changedLine?.oldLine ?? hunk.newStart ?? 1;
      beginComment({
        path: side === "old" && selectedFile.oldPath ? selectedFile.oldPath : selectedFile.path,
        side,
        startLine: lineNum,
        endLine: lineNum,
      });
    }
  };

  const beginResize = (event: React.PointerEvent<HTMLDivElement>): void => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = width;
    const move = (moveEvent: PointerEvent): void =>
      setWidth(Math.max(440, Math.min(820, startWidth + startX - moveEvent.clientX)));
    const finish = (): void => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      setWidth((current) => {
        localStorage.setItem("grok:right-width:review", String(current));
        return current;
      });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
  };

  const groupedNavigator = useMemo(() => {
    return REVIEW_TOUR_GROUPS.map((group) => ({
      group,
      items: filteredTourFiles.filter((item) => item.group.id === group.id),
    })).filter((section) => section.items.length > 0);
  }, [filteredTourFiles]);

  const availableScopes: PanelScopeKind[] = sessionId && turnCheckpoints.length > 0
    ? ["turn-checkpoint", "last-turn", "unstaged", "branch", "staged", "commit"]
    : ["last-turn", "unstaged", "branch", "staged", "commit"];

  return (
    <aside
      ref={paneRef}
      className="review-pane"
      aria-label="变更审核"
      tabIndex={0}
      style={{ width, outline: "none" }}
      onKeyDown={handlePaneKeyDown}
    >
      <div
        className="review-resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label="调整 Review 宽度"
        onPointerDown={beginResize}
      />
      <header className="review-header">
        <div>
          <strong>代码变更审阅</strong>
          <span>
            {index ? `${index.files.length} 个文件 · +${index.additions} −${index.deletions}` : "代码变更"}
          </span>
        </div>
        <button className="icon-button" aria-label="关闭审核" title="关闭 Review" onClick={onClose}>
          <UiIcon name="close" />
        </button>
      </header>

      {onTool && (
        <nav className="right-utility-tabs" aria-label="右侧检查器标签">
          <button onClick={() => onTool("launcher")}>工具</button>
          <button className="active" onClick={() => onTool("review")}>
            审阅 Diff
          </button>
          <button onClick={() => onTool("files")}>文件</button>
          <button onClick={() => onTool("document")}>计划/结果</button>
          <button onClick={() => onTool("tasks")}>任务</button>
          <button onClick={() => onTool("session")}>会话</button>
        </nav>
      )}

      <nav className="review-scopes" aria-label="审核范围">
        {availableScopes.map((value) => (
          <button
            key={value}
            className={kind === value ? "active" : ""}
            onClick={() => setKind(value)}
          >
            {scopeLabel(value)}
            {value === "last-turn" && lastTurnPaths.length > 0 ? ` (${lastTurnPaths.length})` : ""}
            {value === "turn-checkpoint" && turnCheckpoints.length > 0 ? ` (${turnCheckpoints.length})` : ""}
          </button>
        ))}
      </nav>

      {kind === "turn-checkpoint" && turnCheckpoints.length > 0 && (
        <select
          className="review-reference"
          aria-label="选择回合快照"
          value={selectedTurnOrdinal}
          onChange={(event) => setSelectedTurnOrdinal(Number(event.target.value))}
        >
          {[...turnCheckpoints].reverse().map((cp) => (
            <option key={cp.turnOrdinal} value={cp.turnOrdinal}>
              第 {cp.turnOrdinal} 回合 · {cp.filesChanged} 文件 (+{cp.additions} / −{cp.deletions})
            </option>
          ))}
        </select>
      )}

      {kind === "commit" && (
        <select
          className="review-reference"
          aria-label="选择提交"
          value={commit}
          onChange={(event) => setCommit(event.target.value)}
        >
          {commits.map((value) => (
            <option key={value.hash} value={value.hash}>
              {value.shortHash} {value.subject}
            </option>
          ))}
        </select>
      )}

      {kind === "branch" && (
        <select
          className="review-reference"
          aria-label="选择对比基准分支"
          value={branch}
          onChange={(event) => setBranch(event.target.value)}
        >
          {branches.map((value) => (
            <option key={value.name} value={value.name}>
              对比基准：{value.name}
              {value.current ? "（当前）" : ""}
            </option>
          ))}
        </select>
      )}

      {kind === "last-turn" && !lastTurnPaths.length && (
        <div className="review-empty compact">最近一回合没有可确认的写入路径。</div>
      )}

      <div className="review-toolbar">
        <button onClick={() => void refresh()} disabled={loading}>
          <UiIcon name="refresh" /> 刷新
        </button>
        {index && !index.readOnly && index.files.length > 0 && (
          <button disabled={Boolean(busy)} onClick={() => void runAllAction()}>
            {kind === "staged" ? "全部取消暂存" : "全部暂存"}
          </button>
        )}
        <div
          className="ui-seg ui-seg-sm review-mode-toggle"
          role="group"
          aria-label="Diff 视图模式"
          style={{ marginLeft: "auto" }}
        >
          <button
            type="button"
            aria-pressed={diffViewMode === "unified"}
            onClick={() => updateDiffViewMode("unified")}
          >
            统一
          </button>
          <button
            type="button"
            aria-pressed={diffViewMode === "split"}
            onClick={() => updateDiffViewMode("split")}
          >
            双栏
          </button>
        </div>
      </div>

      {!loading && index && index.files.length > 0 && (
        <ReviewTourBar
          tourFiles={tourFiles}
          selectedFileId={selectedFileId}
          viewedKeys={viewedKeys}
          onlyUnviewed={onlyUnviewed}
          onlyPriority={onlyPriority}
          onToggleOnlyUnviewed={() => setOnlyUnviewed((v) => !v)}
          onToggleOnlyPriority={() => setOnlyPriority((v) => !v)}
          onSelectFile={setSelectedFileId}
          onToggleCurrentViewed={toggleViewedAndAdvance}
        />
      )}

      {loading && <div className="review-empty">正在建立文件索引…</div>}
      {!loading && capability && !capability.available && (
        <div className="review-empty review-capability-empty">
          <UiIcon name="folder" />
          <strong>{capability.message}</strong>
          <span>
            {capability.reason === "not-repository"
              ? "仍可在“最近文件”中查看本回合写入内容；Review 只在 Git 工作区中启用。"
              : "选择可用的 Git 工作区后刷新。"}
          </span>
        </div>
      )}

      {!loading && index && (
        <div className="review-body">
          <main className="review-selected-file">
            {loadingFile && <div className="review-empty">正在读取所选文件 Diff…</div>}
            {!loadingFile && selectedFile && (
              <ReviewFileDetail
                file={selectedFile}
                index={index}
                kind={kind}
                diffViewMode={diffViewMode}
                activeHunkIndex={activeHunkIndex}
                onSelectHunk={setActiveHunkIndex}
                viewed={viewedKeys.has(viewedFileSignature(selectedFile))}
                onToggleViewed={() => toggleViewedAndAdvance(true)}
                busy={busy}
                cwd={cwd}
                sessionId={sessionId}
                onNavigate={onNavigate}
                onFileAction={runFileAction}
                onHunkAction={runHunkAction}
                onComment={beginComment}
              />
            )}
            {!loadingFile && !selectedFile && index.files.length > 0 && (
              <div className="review-empty">从右侧导览列表中选择一个文件。</div>
            )}
            {!index.files.length && (
              <div className="review-empty">
                <UiIcon name="check" />
                <strong>此范围没有变更</strong>
                <span>切换范围或继续修改文件后刷新。</span>
              </div>
            )}
          </main>

          <aside className="review-file-navigator" aria-label="变更文件导览列表">
            <label className="review-file-search">
              <UiIcon name="search" />
              <input
                value={fileFilter}
                onChange={(event) => setFileFilter(event.target.value)}
                placeholder="筛选文件…"
                aria-label="筛选审核文件"
              />
            </label>
            <div className="review-file-list">
              {groupedNavigator.map(({ group, items }) => (
                <div key={group.id} className="review-tour-group-block">
                  <div className="review-tour-group-head">
                    <span>
                      {group.order}. {group.label}
                    </span>
                    <small>{items.length}</small>
                  </div>
                  {items.map((item) => (
                    <FileSummary
                      key={item.file.id}
                      item={item}
                      active={item.file.id === selectedFileId}
                      viewed={viewedKeys.has(viewedFileSignature(item.file))}
                      onSelect={() => setSelectedFileId(item.file.id)}
                    />
                  ))}
                </div>
              ))}
            </div>
            <footer>
              {filteredTourFiles.length} / {index.files.length} 个文件
            </footer>
          </aside>
        </div>
      )}

      {annotations.panel}

      <UiDialog
        open={Boolean(pendingConfirm)}
        onOpenChange={(open) => {
          if (!open) setPendingConfirm(undefined);
        }}
        title={pendingConfirm?.title || "请确认"}
      >
        {pendingConfirm && (
          <div style={{ display: "grid", gap: 14 }}>
            <p style={{ margin: 0, color: "var(--color-fg-subtle)" }}>{pendingConfirm.message}</p>
            <div className="button-row" style={{ justifyContent: "flex-end" }}>
              <button type="button" onClick={() => setPendingConfirm(undefined)}>
                取消
              </button>
              <button
                type="button"
                className="danger"
                onClick={() => {
                  const action = pendingConfirm.execute;
                  setPendingConfirm(undefined);
                  void action();
                }}
              >
                确认恢复
              </button>
            </div>
          </div>
        )}
      </UiDialog>
    </aside>
  );
}

function FileSummary({
  item,
  active,
  viewed,
  onSelect,
}: {
  item: AnnotatedTourFile;
  active: boolean;
  viewed: boolean;
  onSelect(): void;
}): React.JSX.Element {
  const { file, priority, priorityReason } = item;
  return (
    <button
      className={`review-file-summary ${active ? "active" : ""} ${viewed ? "is-viewed" : ""}`}
      onClick={onSelect}
      title={`${file.path}${priorityReason ? ` · 重点审阅：${priorityReason}` : ""}`}
    >
      <span className={`review-file-status kind-${file.kind}`}>{viewed ? "✓" : statusGlyph(file.kind)}</span>
      <span>
        <strong>
          {file.path.split("/").at(-1)}
          {priority && <em className="review-priority-badge">重点审阅</em>}
        </strong>
        <small>{file.path}</small>
      </span>
      <span className="diff-stat">
        <b>+{file.additions}</b>
        <i>−{file.deletions}</i>
      </span>
    </button>
  );
}

function pairSplitLines(
  lines: GitReviewHunk["lines"],
): Array<{ left?: GitReviewHunk["lines"][number]; right?: GitReviewHunk["lines"][number] }> {
  const rows: Array<{ left?: GitReviewHunk["lines"][number]; right?: GitReviewHunk["lines"][number] }> = [];
  let deletions: GitReviewHunk["lines"] = [];
  let additions: GitReviewHunk["lines"] = [];
  const flush = (): void => {
    const count = Math.max(deletions.length, additions.length);
    for (let i = 0; i < count; i += 1) {
      rows.push({ left: deletions[i], right: additions[i] });
    }
    deletions = [];
    additions = [];
  };
  for (const line of lines) {
    if (line.kind === "deletion") deletions.push(line);
    else if (line.kind === "addition") additions.push(line);
    else {
      flush();
      rows.push({ left: line, right: line });
    }
  }
  flush();
  return rows;
}

function ReviewFileDetail({
  file,
  index,
  kind,
  diffViewMode,
  activeHunkIndex,
  onSelectHunk,
  viewed,
  onToggleViewed,
  busy,
  cwd,
  sessionId,
  onNavigate,
  onFileAction,
  onHunkAction,
  onComment,
}: {
  file: GitReviewFile;
  index: GitReviewIndex;
  kind: PanelScopeKind;
  diffViewMode: DiffViewMode;
  activeHunkIndex: number;
  onSelectHunk(idx: number): void;
  viewed: boolean;
  onToggleViewed(): void;
  busy: string;
  cwd: string;
  sessionId?: string;
  onNavigate(intent: NavigationIntent): void;
  onFileAction(file: GitReviewFile, action: "stage" | "unstage" | "revert"): Promise<void>;
  onHunkAction(file: GitReviewFile, hunkId: string, action: "stage" | "unstage" | "revert"): Promise<void>;
  onComment(range: DiffLineRange): void;
}): React.JSX.Element {
  const [selection, setSelection] = useState<{
    hunkId: string;
    side: "old" | "new";
    anchor: number;
    start: number;
    end: number;
  }>();
  useEffect(() => setSelection(undefined), [file.id, index.id]);
  const selectLine = (hunkId: string, side: "old" | "new", line: number, extend: boolean): void => {
    setSelection((current) => {
      const anchor = extend && current?.hunkId === hunkId && current.side === side ? current.anchor : line;
      return { hunkId, side, anchor, start: Math.min(anchor, line), end: Math.max(anchor, line) };
    });
  };

  return (
    <div className="review-file-detail">
      <header>
        <div>
          <strong>{file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}</strong>
          <span>
            {statusLabel(file.kind)} · +{file.additions} −{file.deletions}
          </span>
        </div>
        <div className="review-file-actions">
          <button
            type="button"
            className={viewed ? "active-viewed" : ""}
            onClick={onToggleViewed}
            title="标记已审阅并跳转下一个未审阅文件 (v)"
          >
            {viewed ? "✓ 已审阅" : "标记已审阅"}
          </button>
          <button onClick={() => onNavigate({ sessionId, executionRoot: cwd, targetPath: file.path, surface: "diff" })}>
            完整 Diff
          </button>
          <button onClick={() => onNavigate({ sessionId, executionRoot: cwd, targetPath: file.path, surface: "editor" })}>
            编辑文件
          </button>
          {!index.readOnly && kind === "unstaged" && (
            <button disabled={Boolean(busy)} onClick={() => void onFileAction(file, "stage")} title="快捷键 s">
              暂存 (s)
            </button>
          )}
          {!index.readOnly && kind === "staged" && (
            <button disabled={Boolean(busy)} onClick={() => void onFileAction(file, "unstage")} title="快捷键 u">
              取消暂存 (u)
            </button>
          )}
          {!index.readOnly && kind === "unstaged" && (
            <button className="danger-text" disabled={Boolean(busy)} onClick={() => void onFileAction(file, "revert")}>
              恢复
            </button>
          )}
        </div>
      </header>

      {file.binary ? (
        <div className="review-empty compact">二进制文件不显示行级 Diff</div>
      ) : (
        file.hunks.map((hunk, hunkIdx) => (
          <section
            className={`review-hunk${hunkIdx === activeHunkIndex ? " active-hunk" : ""}`}
            key={hunk.id}
            onClick={() => onSelectHunk(hunkIdx)}
          >
            <header>
              <code>{hunk.header}</code>
              <span>
                {hunk.mutable && kind === "unstaged" && (
                  <>
                    <button onClick={() => void onHunkAction(file, hunk.id, "stage")}>暂存区块</button>
                    <button className="danger-text" onClick={() => void onHunkAction(file, hunk.id, "revert")}>
                      恢复区块
                    </button>
                  </>
                )}
                {hunk.mutable && kind === "staged" && (
                  <button onClick={() => void onHunkAction(file, hunk.id, "unstage")}>取消暂存</button>
                )}
              </span>
            </header>

            {diffViewMode === "split" ? (
              <div className="review-lines review-split-lines">
                {pairSplitLines(hunk.lines).map((pair, position) => {
                  const leftNum = pair.left?.oldLine;
                  const rightNum = pair.right?.newLine;
                  const leftSelected =
                    selection?.hunkId === hunk.id &&
                    selection.side === "old" &&
                    leftNum !== undefined &&
                    leftNum >= selection.start &&
                    leftNum <= selection.end;
                  const rightSelected =
                    selection?.hunkId === hunk.id &&
                    selection.side === "new" &&
                    rightNum !== undefined &&
                    rightNum >= selection.start &&
                    rightNum <= selection.end;
                  return (
                    <div className="review-split-row" key={`${position}:${leftNum ?? ""}:${rightNum ?? ""}`}>
                      <div className={`review-split-cell ${pair.left?.kind ?? "empty"}${leftSelected ? " annotation-selected" : ""}`}>
                        <button
                          className="review-comment-button"
                          disabled={leftNum === undefined}
                          title="为旧文件行添加批注 (c)"
                          onClick={() => {
                            if (leftNum === undefined) return;
                            onComment({
                              path: file.oldPath || file.path,
                              side: "old",
                              startLine: leftSelected && selection ? selection.start : leftNum,
                              endLine: leftSelected && selection ? selection.end : leftNum,
                            });
                          }}
                        >
                          +
                        </button>
                        <button
                          className="line-number"
                          disabled={leftNum === undefined}
                          onClick={(event) => leftNum !== undefined && selectLine(hunk.id, "old", leftNum, event.shiftKey)}
                        >
                          {leftNum ?? ""}
                        </button>
                        <code>{pair.left ? `${pair.left.kind === "deletion" ? "−" : " "}${pair.left.text}` : ""}</code>
                      </div>
                      <div className={`review-split-cell ${pair.right?.kind ?? "empty"}${rightSelected ? " annotation-selected" : ""}`}>
                        <button
                          className="review-comment-button"
                          disabled={rightNum === undefined}
                          title="为新文件行添加批注 (c)"
                          onClick={() => {
                            if (rightNum === undefined) return;
                            onComment({
                              path: file.path,
                              side: "new",
                              startLine: rightSelected && selection ? selection.start : rightNum,
                              endLine: rightSelected && selection ? selection.end : rightNum,
                            });
                          }}
                        >
                          +
                        </button>
                        <button
                          className="line-number"
                          disabled={rightNum === undefined}
                          onClick={(event) => rightNum !== undefined && selectLine(hunk.id, "new", rightNum, event.shiftKey)}
                        >
                          {rightNum ?? ""}
                        </button>
                        <code>{pair.right ? `${pair.right.kind === "addition" ? "+" : " "}${pair.right.text}` : ""}</code>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="review-lines">
                {hunk.lines.map((line, position) => {
                  const targetLine = line.newLine ?? line.oldLine;
                  const side = line.newLine !== undefined ? "new" : "old";
                  const selectedNumber = selection?.side === "old" ? line.oldLine : line.newLine;
                  const selected =
                    selection?.hunkId === hunk.id &&
                    selectedNumber !== undefined &&
                    selectedNumber >= selection.start &&
                    selectedNumber <= selection.end;
                  return (
                    <div
                      className={`review-line ${line.kind}${selected ? " annotation-selected" : ""}`}
                      key={`${position}:${line.oldLine}:${line.newLine}`}
                    >
                      <button
                        className="review-comment-button"
                        disabled={!targetLine}
                        title="添加批注 (c)；点击行号，Shift 点击结束行可选择范围"
                        onClick={() => {
                          if (!targetLine) return;
                          const chosenSide = selected && selection ? selection.side : side;
                          onComment({
                            path: chosenSide === "old" && file.oldPath ? file.oldPath : file.path,
                            side: chosenSide,
                            startLine: selected && selection ? selection.start : targetLine,
                            endLine: selected && selection ? selection.end : targetLine,
                          });
                        }}
                      >
                        +
                      </button>
                      <button
                        className="line-number"
                        disabled={line.oldLine === undefined}
                        title="选择旧文件行；Shift 点击可选择连续范围"
                        onClick={(event) => line.oldLine !== undefined && selectLine(hunk.id, "old", line.oldLine, event.shiftKey)}
                      >
                        {line.oldLine ?? ""}
                      </button>
                      <button
                        className="line-number"
                        disabled={line.newLine === undefined}
                        title="选择新文件行；Shift 点击可选择连续范围"
                        onClick={(event) => line.newLine !== undefined && selectLine(hunk.id, "new", line.newLine, event.shiftKey)}
                      >
                        {line.newLine ?? ""}
                      </button>
                      <code>
                        {line.kind === "addition" ? "+" : line.kind === "deletion" ? "−" : " "}
                        {line.text}
                      </code>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        ))
      )}
    </div>
  );
}

function scopeLabel(kind: PanelScopeKind): string {
  return {
    "turn-checkpoint": "回合快照",
    "last-turn": "本轮增量",
    unstaged: "工作树未提交",
    branch: "分支对比",
    staged: "已暂存",
    commit: "提交记录",
  }[kind];
}

function statusGlyph(kind: GitReviewFile["kind"]): string {
  return {
    added: "A",
    modified: "M",
    deleted: "D",
    renamed: "R",
    copied: "C",
    untracked: "U",
    conflicted: "!",
    unknown: "?",
  }[kind];
}

function statusLabel(kind: GitReviewFile["kind"]): string {
  return {
    added: "新增",
    modified: "修改",
    deleted: "删除",
    renamed: "重命名",
    copied: "复制",
    untracked: "未跟踪",
    conflicted: "冲突",
    unknown: "未知",
  }[kind];
}
