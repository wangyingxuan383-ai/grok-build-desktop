import { useMemo } from "react";
import { Check, CheckCheck, Flame, Sparkles } from "lucide-react";
import type { GitReviewFileSummary } from "../../../shared/types";

export type ReviewTourGroupId = "contracts" | "backend" | "ui" | "tests" | "config";

export interface ReviewTourGroupMeta {
  id: ReviewTourGroupId;
  order: number;
  label: string;
  shortLabel: string;
}

export const REVIEW_TOUR_GROUPS: readonly ReviewTourGroupMeta[] = [
  { id: "contracts", order: 1, label: "契约与类型", shortLabel: "契约" },
  { id: "backend", order: 2, label: "主进程与服务", shortLabel: "服务" },
  { id: "ui", order: 3, label: "界面与样式", shortLabel: "界面" },
  { id: "tests", order: 4, label: "测试与脚本", shortLabel: "测试" },
  { id: "config", order: 5, label: "配置与锁文件", shortLabel: "配置" },
] as const;

export interface AnnotatedTourFile {
  file: GitReviewFileSummary;
  group: ReviewTourGroupMeta;
  priority: boolean;
  priorityReason?: string;
}

const LOCKFILE_RE = /(?:^|\/)(?:package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|Cargo\.lock|poetry\.lock|go\.sum)$/i;

export function classifyReviewTourGroup(pathInput: string): ReviewTourGroupMeta {
  const p = pathInput.replace(/\\/g, "/");

  if (
    /\.(?:test|spec|e2e)\.[^/]+$/i.test(p) ||
    /^(?:tests?|__tests__|e2e|fixtures|scripts)\//i.test(p) ||
    /\/(?:tests?|__tests__|fixtures|scripts)\//i.test(p) ||
    /\.(?:ps1|sh)$/i.test(p)
  ) {
    return REVIEW_TOUR_GROUPS[3]!;
  }

  if (
    LOCKFILE_RE.test(p) ||
    /^(?:\.github|\.vscode|build)\//i.test(p) ||
    /(?:^|\/)(?:package\.json|tsconfig[^/]*\.json|vite[^/]*\.config\.[^/]+|vitest[^/]*\.config\.[^/]+|electron-builder[^/]*|\.[a-z0-9]+rc(?:\.[^/]+)?)$/i.test(p) ||
    /\.(?:json|ya?ml|toml|ini|md)$/i.test(p)
  ) {
    return REVIEW_TOUR_GROUPS[4]!;
  }

  if (
    /^src\/(?:shared|preload)\//i.test(p) ||
    /\/(?:shared|preload|contracts?|schemas?|protocols?)\//i.test(p) ||
    /(?:^|\/)(?:types|schema|ipc-schema|protocol|api|workbench-types|workspace-tools)\.[^/]+$/i.test(p) ||
    /\.d\.ts$/i.test(p)
  ) {
    return REVIEW_TOUR_GROUPS[0]!;
  }

  if (
    /^src\/main\//i.test(p) ||
    /\/(?:main|services?|server|backend|workers?|daemon|cli)\//i.test(p) ||
    /\.(?:rs|go|py|cs|c|cpp|h|java)$/i.test(p)
  ) {
    return REVIEW_TOUR_GROUPS[1]!;
  }

  if (
    /^src\/renderer\//i.test(p) ||
    /\/(?:renderer|components?|hooks?|views?|pages?|styles?)\//i.test(p) ||
    /\.(?:tsx|jsx|css|scss|less|vue|svelte|html)$/i.test(p)
  ) {
    return REVIEW_TOUR_GROUPS[2]!;
  }

  return REVIEW_TOUR_GROUPS[1]!;
}

export function evaluatePriorityFlag(file: GitReviewFileSummary): { priority: boolean; reason?: string } {
  const p = file.path.replace(/\\/g, "/");
  if (LOCKFILE_RE.test(p)) return { priority: false };
  if (file.kind === "conflicted") return { priority: true, reason: "合并冲突" };
  if (/(?:ipc|security|preload|auth|permission|vault|credential|trust|sandbox)/i.test(p)) {
    return { priority: true, reason: "安全与进程边界" };
  }
  if (/^src\/shared\//i.test(p) || /(?:types|schema)\.[^/]+$/i.test(p)) {
    return { priority: true, reason: "核心契约变更" };
  }
  if (/(?:^|\/)(?:App\.tsx|app-controller\.ts|store\.ts|index\.ts)$/i.test(p) && file.additions + file.deletions >= 25) {
    return { priority: true, reason: "核心入口变更" };
  }
  if (file.additions + file.deletions >= 80 || file.hunkCount >= 5) {
    return { priority: true, reason: `大篇幅改动 (+${file.additions}/−${file.deletions})` };
  }
  return { priority: false };
}

export function buildReviewTour(files: GitReviewFileSummary[]): AnnotatedTourFile[] {
  return files
    .map((file) => {
      const group = classifyReviewTourGroup(file.path);
      const prio = evaluatePriorityFlag(file);
      return {
        file,
        group,
        priority: prio.priority,
        priorityReason: prio.reason,
      };
    })
    .sort((a, b) => {
      if (a.group.order !== b.group.order) return a.group.order - b.group.order;
      if (a.priority !== b.priority) return a.priority ? -1 : 1;
      const churnDiff = b.file.additions + b.file.deletions - (a.file.additions + a.file.deletions);
      if (churnDiff !== 0) return churnDiff;
      return a.file.path.localeCompare(b.file.path);
    });
}

export function viewedFileSignature(file: Pick<GitReviewFileSummary, "path" | "kind" | "additions" | "deletions">): string {
  return `${file.path}::${file.kind}::+${file.additions}:-${file.deletions}`;
}

export interface ReviewTourBarProps {
  tourFiles: AnnotatedTourFile[];
  selectedFileId: string;
  viewedKeys: ReadonlySet<string>;
  onlyUnviewed: boolean;
  onlyPriority: boolean;
  onToggleOnlyUnviewed(): void;
  onToggleOnlyPriority(): void;
  onSelectFile(fileId: string): void;
  onToggleCurrentViewed(advanceNext: boolean): void;
}

export function ReviewTourBar({
  tourFiles,
  selectedFileId,
  viewedKeys,
  onlyUnviewed,
  onlyPriority,
  onToggleOnlyUnviewed,
  onToggleOnlyPriority,
  onSelectFile,
  onToggleCurrentViewed,
}: ReviewTourBarProps): React.JSX.Element | null {
  const stats = useMemo(() => {
    const viewed = tourFiles.filter((item) => viewedKeys.has(viewedFileSignature(item.file))).length;
    const priorityCount = tourFiles.filter((item) => item.priority).length;
    const byGroup = REVIEW_TOUR_GROUPS.map((group) => {
      const items = tourFiles.filter((item) => item.group.id === group.id);
      const done = items.filter((item) => viewedKeys.has(viewedFileSignature(item.file))).length;
      return { group, items, done };
    }).filter((entry) => entry.items.length > 0);
    return { total: tourFiles.length, viewed, priorityCount, byGroup };
  }, [tourFiles, viewedKeys]);

  if (tourFiles.length === 0) return null;

  const currentItem = tourFiles.find((item) => item.file.id === selectedFileId);
  const currentViewed = currentItem ? viewedKeys.has(viewedFileSignature(currentItem.file)) : false;
  const percent = stats.total > 0 ? Math.round((stats.viewed / stats.total) * 100) : 0;

  return (
    <section className="review-tour-bar" aria-label="Review 导览与进度">
      <div className="review-tour-top">
        <div className="review-tour-progress">
          <Sparkles size={12} className="review-tour-icon" />
          <strong>审阅导览</strong>
          <span className="review-tour-count">
            ✓ {stats.viewed}/{stats.total} ({percent}%)
          </span>
          <div className="review-tour-meter" aria-hidden="true">
            <span style={{ width: `${percent}%` }} />
          </div>
        </div>

        <div className="review-tour-filters">
          {stats.priorityCount > 0 && (
            <button
              type="button"
              className={`review-tour-chip${onlyPriority ? " active warning" : ""}`}
              aria-pressed={onlyPriority}
              onClick={onToggleOnlyPriority}
              title="仅显示重点审阅文件"
            >
              <Flame size={11} />
              <span>重点 ({stats.priorityCount})</span>
            </button>
          )}
          <button
            type="button"
            className={`review-tour-chip${onlyUnviewed ? " active" : ""}`}
            aria-pressed={onlyUnviewed}
            onClick={onToggleOnlyUnviewed}
            title="仅显示尚未标记已审阅的文件"
          >
            <span>仅未阅</span>
          </button>
          {currentItem && (
            <button
              type="button"
              className={`review-tour-chip primary-check${currentViewed ? " viewed" : ""}`}
              onClick={() => onToggleCurrentViewed(!currentViewed)}
              title="标记当前文件已审阅并自动跳至下一项 (快捷键 v)"
            >
              {currentViewed ? <CheckCheck size={11} /> : <Check size={11} />}
              <span>{currentViewed ? "✓ 已审阅" : "标为已阅 (v)"}</span>
            </button>
          )}
        </div>
      </div>

      <div className="review-tour-groups" role="navigation" aria-label="按架构分层跳转">
        {stats.byGroup.map(({ group, items, done }) => {
          const isGroupActive = currentItem?.group.id === group.id;
          const allDone = done === items.length;
          return (
            <button
              key={group.id}
              type="button"
              className={`review-tour-step${isGroupActive ? " active" : ""}${allDone ? " done" : ""}`}
              title={`${group.order}. ${group.label}（已审阅 ${done}/${items.length}）`}
              onClick={() => {
                const nextUnviewed = items.find((i) => !viewedKeys.has(viewedFileSignature(i.file)));
                const target = nextUnviewed ?? items[0];
                if (target) onSelectFile(target.file.id);
              }}
            >
              <span className="step-num">{allDone ? "✓" : group.order}</span>
              <span>{group.label}</span>
              <small>
                {done}/{items.length}
              </small>
            </button>
          );
        })}
      </div>

      <div className="review-tour-shortcuts" aria-hidden="true">
        <span><kbd>j</kbd>/<kbd>k</kbd> 区块</span>
        <span><kbd>n</kbd>/<kbd>p</kbd> 文件</span>
        <span><kbd>v</kbd> 已阅下一项</span>
        <span><kbd>s</kbd>/<kbd>u</kbd> 暂存/取消</span>
        <span><kbd>c</kbd> 批注</span>
      </div>
    </section>
  );
}
