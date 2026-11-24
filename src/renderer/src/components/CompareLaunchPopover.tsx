import { useCallback, useEffect, useMemo, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import {
  AlertTriangle,
  FolderGit2,
  GitCompareArrows,
  LoaderCircle,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import type {
  ModelInfo,
  ReasoningEffort,
  SessionMode,
} from "../../../shared/types";
import { effortControlState } from "../model-capabilities";
import { SESSION_MODE_OPTIONS } from "../session-mode-labels";
import { useShallow } from "zustand/react/shallow";
import { useAppStore } from "../store";
import { useWorktreeStore } from "../worktree-store";
import type { CompareRunMeta, CompareVariantMeta, ContentTarget, GridPreset } from "../workspace-layout";

export interface CompareLaunchResult {
  preset: GridPreset;
  targets: ContentTarget[];
  compareMeta: CompareRunMeta;
}

export interface CompareLaunchPopoverProps {
  workspace: string;
  disabled?: boolean;
  onLaunched(result: CompareLaunchResult): void;
  onError(message: string): void;
}

interface VariantDraft {
  key: string;
  label: string;
  modelId: string;
  effort: ReasoningEffort;
  mode: SessionMode;
}

const LABELS = ["方案 A", "方案 B", "方案 C", "方案 D"];

export function CompareLaunchPopover({
  workspace,
  disabled = false,
  onLaunched,
  onError,
}: CompareLaunchPopoverProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [isolatedWorktrees, setIsolatedWorktrees] = useState(true);
  const [gitAvailable, setGitAvailable] = useState(false);
  const [baseBranch, setBaseBranch] = useState("");
  const [catalogModels, setCatalogModels] = useState<ModelInfo[]>([]);
  const [launching, setLaunching] = useState(false);

  const defaultModel = useAppStore((s) => s.settings?.defaultModel || "");
  const defaultEffort = useAppStore((s) => s.settings?.defaultEffort || "");
  const storeModels = useAppStore(
    useShallow((state) => {
      const map = new Map<string, ModelInfo>();
      for (const view of Object.values(state.views)) {
        for (const m of view.models) map.set(m.modelId, m);
      }
      return [...map.values()];
    }),
  );

  const models = useMemo(() => {
    const map = new Map<string, ModelInfo>();
    for (const m of catalogModels) map.set(m.modelId, m);
    for (const m of storeModels) map.set(m.modelId, m);
    return [...map.values()];
  }, [catalogModels, storeModels]);

  const [variants, setVariants] = useState<VariantDraft[]>(() => [
    { key: "v-a", label: "方案 A", modelId: defaultModel, effort: defaultEffort, mode: "agent" },
    { key: "v-b", label: "方案 B", modelId: defaultModel, effort: defaultEffort, mode: "agent" },
  ]);

  const loadContext = useCallback(async () => {
    if (!workspace) return;
    try {
      const [cap, fetchedModels] = await Promise.all([
        window.grokDesktop.getGitWorkspaceCapability(workspace).catch(() => ({ available: false })),
        window.grokDesktop.listModelCatalog(false).catch(() => [] as ModelInfo[]),
      ]);
      if (fetchedModels.length) setCatalogModels(fetchedModels);
      setGitAvailable(cap.available);
      if (cap.available) {
        const branches = await window.grokDesktop.listGitBranches(workspace).catch(() => []);
        const current = branches.find((b) => b.current)?.name || branches[0]?.name || "HEAD";
        setBaseBranch(current);
        setIsolatedWorktrees(true);
      } else {
        setIsolatedWorktrees(false);
      }
    } catch {
      setGitAvailable(false);
      setIsolatedWorktrees(false);
    }
  }, [workspace]);

  useEffect(() => {
    if (!open) return;
    void loadContext();
  }, [loadContext, open]);

  useEffect(() => {
    if (models.length < 2) return;
    setVariants((current) =>
      current.map((item, idx) => {
        if (item.modelId) return item;
        const candidate = models[idx % models.length];
        return candidate ? { ...item, modelId: candidate.modelId } : item;
      }),
    );
  }, [models]);

  const updateVariant = (key: string, patch: Partial<VariantDraft>): void => {
    setVariants((rows) => rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  };

  const addVariant = (): void => {
    if (variants.length >= 4) return;
    const idx = variants.length;
    setVariants((rows) => [
      ...rows,
      {
        key: `v-${crypto.randomUUID().slice(0, 6)}`,
        label: LABELS[idx] || `方案 ${idx + 1}`,
        modelId: models[idx % Math.max(1, models.length)]?.modelId || defaultModel,
        effort: defaultEffort,
        mode: "agent",
      },
    ]);
  };

  const removeVariant = (key: string): void => {
    if (variants.length <= 2) return;
    setVariants((rows) =>
      rows
        .filter((row) => row.key !== key)
        .map((row, idx) => ({ ...row, label: LABELS[idx] || `方案 ${idx + 1}` })),
    );
  };

  const hasSameCwdWriteRisk = useMemo(() => {
    if (isolatedWorktrees && gitAvailable) return false;
    const writableCount = variants.filter((v) => v.mode !== "plan").length;
    return writableCount >= 2;
  }, [gitAvailable, isolatedWorktrees, variants]);

  const handleLaunch = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    const trimmedPrompt = prompt.trim();
    if (!workspace || !trimmedPrompt || launching) return;
    setLaunching(true);
    try {
      const profiles = gitAvailable
        ? await window.grokDesktop.listExecutionProfiles(workspace).catch(() => [])
        : [];
      const wtProfileId =
        profiles.find((p) => p.id === "builtin-worktree")?.id ??
        profiles.find((p) => p.worktree)?.id ??
        "builtin-worktree";
      const localProfileId =
        profiles.find((p) => p.id === "builtin-normal")?.id ??
        profiles.find((p) => !p.worktree)?.id ??
        "builtin-normal";

      const runTag = `${new Date().toISOString().slice(11, 19).replace(/:/g, "")}-${crypto.randomUUID().slice(0, 4)}`;
      const createdVariants: Array<{
        draft: VariantDraft;
        sessionId: string;
        cwd: string;
        worktreeId?: string;
      }> = [];

      try {
        for (const [idx, variant] of variants.entries()) {
          const selectedModel = models.find((m) => m.modelId === variant.modelId);
          const useWt = isolatedWorktrees && gitAvailable;
          const created = await window.grokDesktop.createSession({
            workspacePath: workspace,
            profileId: useWt ? wtProfileId : localProfileId,
            ...(useWt ? { worktreeName: `ab-${idx + 1}-${runTag}`, worktreeRef: baseBranch || "HEAD" } : {}),
            ...(variant.modelId ? { modelId: variant.modelId } : {}),
            ...(selectedModel?.providerId ? { providerId: selectedModel.providerId } : {}),
            ...(variant.effort ? { effort: variant.effort } : {}),
            mode: variant.mode,
          });
          const title = `${variant.label}${selectedModel ? ` · ${selectedModel.name}` : ""}`;
          await window.grokDesktop.renameSession(created.sessionId, title).catch(() => undefined);
          createdVariants.push({
            draft: variant,
            sessionId: created.sessionId,
            cwd: created.cwd,
            worktreeId: created.worktreeId,
          });
        }
      } catch (launchErr) {
        await Promise.all(
          createdVariants.map(async (item) => {
            await window.grokDesktop.deleteSession(item.cwd, item.sessionId).catch(() => undefined);
            if (item.worktreeId) {
              await window.grokDesktop.removeWorktree(workspace, item.worktreeId, true).catch(() => undefined);
            }
          }),
        );
        throw launchErr;
      }

      const [sessions, worktrees] = await Promise.all([
        window.grokDesktop.listSessions(workspace).catch(() => useAppStore.getState().sessions),
        gitAvailable ? window.grokDesktop.listWorktrees(workspace).catch(() => []) : Promise.resolve([]),
      ]);
      useAppStore.getState().setSessions(sessions);
      if (gitAvailable) useWorktreeStore.getState().setItems(workspace, worktrees);

      const preset: GridPreset = createdVariants.length <= 2 ? "1x2" : "2x2";
      const targets: ContentTarget[] = createdVariants.map((item) => {
        const modelName = models.find((m) => m.modelId === item.draft.modelId)?.name;
        return {
          kind: "session",
          workspace: item.cwd,
          id: item.sessionId,
          title: `${item.draft.label}${modelName ? ` · ${modelName}` : ""}`,
        };
      });

      const metaVariants: CompareVariantMeta[] = createdVariants.map((item, idx) => ({
        paneId: idx === 0 ? "main" : `pane-${idx + 1}`,
        sessionId: item.sessionId,
        workspace: item.cwd,
        label: item.draft.label,
        ...(item.draft.modelId ? { modelId: item.draft.modelId } : {}),
        ...(item.draft.effort ? { effort: item.draft.effort } : {}),
        mode: item.draft.mode,
        ...(item.worktreeId ? { worktreeId: item.worktreeId } : {}),
        ...(worktrees.find((w) => w.id === item.worktreeId)?.branch
          ? { branch: worktrees.find((w) => w.id === item.worktreeId)?.branch }
          : {}),
      }));

      const compareMeta: CompareRunMeta = {
        id: crypto.randomUUID(),
        prompt: trimmedPrompt,
        createdAt: new Date().toISOString(),
        sourceWorkspace: workspace,
        isolatedWorktrees: isolatedWorktrees && gitAvailable,
        variants: metaVariants,
      };

      onLaunched({ preset, targets, compareMeta });
      setOpen(false);
      setPrompt("");

      await Promise.all(
        createdVariants.map(async (item) => {
          await window.grokDesktop.openSession(item.cwd, item.sessionId);
          void window.grokDesktop
            .sendPrompt({
              sessionId: item.sessionId,
              text: trimmedPrompt,
              attachments: [],
              clientMessageId: crypto.randomUUID(),
            })
            .catch((err) => {
              onError(err instanceof Error ? err.message : String(err));
            });
        }),
      ).catch((err) => {
        onError(err instanceof Error ? err.message : String(err));
      });
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    } finally {
      setLaunching(false);
    }
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="ui-btn ui-btn-ghost ui-btn-sm stage-compare-trigger"
          disabled={disabled || !workspace}
          title="发起多模型 / 多推理强度 A/B 并排评测（自动隔离 Worktree）"
          aria-label="发起 A/B 分屏对比"
        >
          <GitCompareArrows size={13} />
          <span>A/B 对比</span>
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          className="ui-popover compare-launch-popover"
          align="end"
          sideOffset={6}
          collisionPadding={10}
          style={{ width: "min(440px, calc(100vw - 24px))", display: "grid", gap: 10 }}
        >
          <form onSubmit={(e) => void handleLaunch(e)} style={{ display: "grid", gap: 10 }}>
            <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <Sparkles size={14} style={{ color: "var(--color-accent)" }} />
                <strong style={{ fontSize: "var(--text-base)", color: "var(--color-fg)" }}>
                  A/B 并排模型评测
                </strong>
              </div>
              <button
                type="button"
                className="ui-btn ui-btn-ghost ui-btn-sm"
                disabled={variants.length >= 4 || launching}
                onClick={addVariant}
              >
                <Plus size={12} /> 添加方案 ({variants.length}/4)
              </button>
            </header>

            <div style={{ display: "grid", gap: 6, maxHeight: 200, overflowY: "auto" }}>
              {variants.map((variant) => {
                const effortState = effortControlState(
                  models,
                  variant.modelId || models[0]?.modelId,
                  variant.effort,
                );
                return (
                  <div
                    key={variant.key}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "56px minmax(0, 1fr) 82px 86px auto",
                      alignItems: "center",
                      gap: 5,
                      padding: "6px 8px",
                      borderRadius: "var(--radius-lg)",
                      border: "1px solid var(--color-border)",
                      background: "var(--color-card)",
                    }}
                  >
                    <strong style={{ fontSize: "var(--text-xs)", color: "var(--color-accent)" }}>
                      {variant.label}
                    </strong>
                    <select
                      aria-label={`${variant.label} 模型`}
                      className="ui-select"
                      style={{ height: 26, fontSize: "var(--text-xs)", padding: "0 6px" }}
                      value={variant.modelId}
                      disabled={launching}
                      onChange={(e) => updateVariant(variant.key, { modelId: e.target.value })}
                    >
                      <option value="">默认模型</option>
                      {models.map((m) => (
                        <option key={m.modelId} value={m.modelId}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                    <select
                      aria-label={`${variant.label} 推理强度`}
                      className="ui-select"
                      style={{ height: 26, fontSize: "var(--text-xs)", padding: "0 4px" }}
                      value={variant.effort}
                      disabled={launching || !effortState.supported}
                      title={effortState.reason}
                      onChange={(e) =>
                        updateVariant(variant.key, { effort: e.target.value as ReasoningEffort })
                      }
                    >
                      <option value="">默认强度</option>
                      {effortState.options.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                    <select
                      aria-label={`${variant.label} 模式`}
                      className="ui-select"
                      style={{ height: 26, fontSize: "var(--text-xs)", padding: "0 4px" }}
                      value={variant.mode}
                      disabled={launching}
                      onChange={(e) =>
                        updateVariant(variant.key, { mode: e.target.value as SessionMode })
                      }
                    >
                      {SESSION_MODE_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.value.toUpperCase()}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="ui-icon-btn ui-icon-btn-sm"
                      style={{ width: 22, height: 22 }}
                      disabled={variants.length <= 2 || launching}
                      aria-label={`移除 ${variant.label}`}
                      onClick={() => removeVariant(variant.key)}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                );
              })}
            </div>

            {gitAvailable && (
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 7,
                  fontSize: "var(--text-xs)",
                  color: "var(--color-fg-subtle)",
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={isolatedWorktrees}
                  disabled={launching}
                  onChange={(e) => setIsolatedWorktrees(e.target.checked)}
                />
                <FolderGit2 size={13} style={{ color: "var(--color-accent)", flex: "none" }} />
                <span>为每个对比方案分配独立 Git Worktree（基于 {baseBranch || "HEAD"}，防文件冲突）</span>
              </label>
            )}

            {hasSameCwdWriteRisk && (
              <div
                role="alert"
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 7,
                  padding: "7px 9px",
                  borderRadius: "var(--radius-md)",
                  background: "var(--color-warning-soft)",
                  color: "var(--color-warning)",
                  fontSize: "var(--text-xs)",
                }}
              >
                <AlertTriangle size={14} style={{ flex: "none", marginTop: 1 }} />
                <span>
                  多个非 Plan 方案将共享同一目录并发写入，可能互相覆盖！建议勾选独立 Worktree 或将模式切换为 PLAN。
                </span>
              </div>
            )}

            <textarea
              className="ui-textarea"
              rows={3}
              required
              disabled={launching}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="输入统一的评测任务 Prompt，所有对比方案将同时并排启动…"
            />

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 6 }}>
              <button
                type="button"
                className="ui-btn ui-btn-ghost ui-btn-sm"
                disabled={launching}
                onClick={() => setOpen(false)}
              >
                取消
              </button>
              <button
                type="submit"
                className="ui-btn ui-btn-primary ui-btn-sm"
                disabled={launching || !prompt.trim()}
              >
                {launching ? <LoaderCircle size={12} className="ui-spin" /> : <GitCompareArrows size={12} />}
                <span>并排启动 {variants.length} 路评测</span>
              </button>
            </div>
          </form>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
