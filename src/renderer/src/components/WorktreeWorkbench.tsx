import { useCallback, useEffect, useRef, useState } from "react";
import type { GitBranchSummary } from "../../../shared/types";
import { errorMessage } from "../error-message";
import { useAppStore } from "../store";
import { useWorkbenchStore, type WorkbenchView } from "../workbench-store";
import { useWorktreeStore } from "../worktree-store";
import { UiDialog } from "./ui/primitives";
import {
  executeInPlaceWorktreeHandoff,
  readProjectDefaultExecMode,
  resolveEffectiveBaseRef,
  writeProjectDefaultExecMode,
  type CarryDirtyChangesMode,
  type ProjectDefaultExecMode,
} from "./WorktreeModePicker";

interface Dialogs {
  askConfirm(message: string, options?: { title?: string; confirmLabel?: string; danger?: boolean }): Promise<boolean>;
  askText(message: string, initialValue: string, options?: { title?: string; confirmLabel?: string }): Promise<string | null>;
  setError(message: string): void;
}

export function WorktreeExplorer({
  workspace,
  dialogs,
  onOpenConversation,
}: {
  workspace: string;
  dialogs: Dialogs;
  onOpenConversation?(target: { cwd: string; sessionId: string }): void;
}): React.JSX.Element {
  const store = useWorktreeStore();
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const sessions = useAppStore((s) => s.sessions);
  const activeSession = sessions.find((s) => s.id === activeSessionId);

  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [baseBranch, setBaseBranch] = useState("HEAD");
  const [branches, setBranches] = useState<GitBranchSummary[]>([]);
  const [startFromOrigin, setStartFromOrigin] = useState(false);
  const [handoffCurrentSession, setHandoffCurrentSession] = useState(false);
  const [carryDirtyChanges, setCarryDirtyChanges] = useState<CarryDirtyChangesMode>("move");
  const [defaultMode, setDefaultMode] = useState<ProjectDefaultExecMode>(() => readProjectDefaultExecMode(workspace));

  const refreshGeneration = useRef(0);

  useEffect(() => {
    setDefaultMode(readProjectDefaultExecMode(workspace));
  }, [workspace]);

  const refresh = useCallback(async (): Promise<void> => {
    const generation = ++refreshGeneration.current;
    if (!workspace) return useWorktreeStore.getState().reset();
    useWorktreeStore.getState().setLoading(true);
    try {
      const capability = await window.grokDesktop.getGitWorkspaceCapability(workspace);
      if (generation !== refreshGeneration.current) return;
      if (!capability.available) {
        useWorktreeStore.getState().reset(workspace);
        useWorktreeStore.getState().setUnavailable(capability.message);
        return;
      }
      const [items, branchList] = await Promise.all([
        window.grokDesktop.listWorktrees(workspace),
        window.grokDesktop.listGitBranches(workspace).catch(() => [] as GitBranchSummary[]),
      ]);
      if (generation === refreshGeneration.current) {
        useWorktreeStore.getState().setItems(workspace, items);
        setBranches(branchList);
        const cur = branchList.find((b) => b.current)?.name || branchList[0]?.name || "HEAD";
        setBaseBranch((prev) => (prev === "HEAD" ? cur : prev));
      }
    } catch (error) {
      if (generation === refreshGeneration.current) {
        useWorktreeStore.getState().reset(workspace);
        dialogs.setError(errorMessage(error));
      }
    } finally {
      if (generation === refreshGeneration.current) useWorktreeStore.getState().setLoading(false);
    }
  }, [dialogs, workspace]);

  useEffect(() => {
    void refresh();
    return () => {
      refreshGeneration.current += 1;
    };
  }, [refresh]);

  const submitCreate = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (!workspace || !name.trim()) return;
    store.setLoading(true);
    try {
      const resolvedRef = resolveEffectiveBaseRef(baseBranch, branches, startFromOrigin);
      if (handoffCurrentSession && activeSessionId) {
        const profiles = await window.grokDesktop.listExecutionProfiles(workspace).catch(() => []);
        const wtProfileId =
          profiles.find((p) => p.id === "builtin-worktree")?.id ??
          profiles.find((p) => p.worktree)?.id ??
          "builtin-worktree";
        const result = await executeInPlaceWorktreeHandoff({
          sessionId: activeSessionId,
          workspacePath: workspace,
          worktreeProfileId: wtProfileId,
          worktreeName: name.trim(),
          baseRef: resolvedRef,
          startFromOrigin,
          carryDirtyChanges,
        });
        const items = await window.grokDesktop.listWorktrees(workspace);
        store.setItems(workspace, items);
        if (result.worktreeId) store.setSelected(result.worktreeId);
        setCreateOpen(false);
        setName("");
        onOpenConversation?.({ cwd: result.cwd, sessionId: result.sessionId });
        return;
      }

      if (startFromOrigin) {
        await window.grokDesktop.pullGitRepository(workspace, `fetch-${crypto.randomUUID()}`).catch(() => undefined);
      }
      const created = await window.grokDesktop.createWorktree({
        workspacePath: workspace,
        name: name.trim(),
        baseRef: resolvedRef,
      });
      const items = await window.grokDesktop.listWorktrees(workspace);
      store.setItems(workspace, items);
      store.setSelected(created.id);
      setCreateOpen(false);
      setName("");
    } catch (error) {
      dialogs.setError(errorMessage(error));
    } finally {
      store.setLoading(false);
    }
  };

  const gc = async (): Promise<void> => {
    try {
      const preview = await window.grokDesktop.previewWorktreeGc(workspace);
      if (!preview.candidates.length) return dialogs.setError("没有可清理的孤儿或过期 Worktree 记录。");
      const confirmed = await dialogs.askConfirm(
        `Git 标记了 ${preview.candidates.length} 项可清理记录：\n${preview.candidates.map((item) => `• ${item.path} — ${item.reason}`).join("\n")}`,
        { title: "Worktree GC 预览", confirmLabel: "确认清理", danger: true },
      );
      if (!confirmed) return;
      await window.grokDesktop.gcWorktrees(workspace, preview.confirmationToken, true);
      await refresh();
    } catch (error) {
      dialogs.setError(errorMessage(error));
    }
  };

  const canHandoffActive = Boolean(activeSessionId && activeSession && !activeSession.worktreeId);

  return (
    <section className="worktree-explorer" aria-label="Worktree">
      <header>
        <strong>Worktree</strong>
        <span>{store.loading ? "处理中…" : `${store.items.length} 个`}</span>
      </header>
      <div className="worktree-toolbar">
        <button
          className="primary"
          disabled={!workspace || store.loading || Boolean(store.unavailableReason)}
          onClick={() => setCreateOpen(true)}
        >
          ＋ 新建
        </button>
        <button disabled={!workspace || store.loading} onClick={() => void refresh()}>
          ↻ 刷新
        </button>
        <button disabled={!workspace || store.loading || Boolean(store.unavailableReason)} onClick={() => void gc()}>
          GC
        </button>
      </div>

      {workspace && !store.unavailableReason && (
        <label
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 6,
            padding: "4px 10px 8px",
            fontSize: "var(--text-xs)",
            color: "var(--color-fg-subtle)",
          }}
        >
          <span>此项目新任务默认：</span>
          <select
            className="ui-select"
            style={{ height: 22, width: "auto", fontSize: 11, padding: "0 6px" }}
            value={defaultMode}
            onChange={(e) => {
              const next = e.target.value as ProjectDefaultExecMode;
              setDefaultMode(next);
              writeProjectDefaultExecMode(workspace, next);
            }}
          >
            <option value="local">本地目录</option>
            <option value="worktree">隔离 Worktree</option>
          </select>
        </label>
      )}

      {store.unavailableReason && <p className="file-empty">{store.unavailableReason}</p>}
      {!workspace ? (
        <p className="file-empty">请选择工作区</p>
      ) : !store.items.length ? (
        <p className="file-empty">{store.loading ? "正在读取 Worktree…" : "尚无隔离 Worktree"}</p>
      ) : (
        <div className="worktree-list">
          {store.items.map((item) => (
            <button
              key={item.id}
              className={store.selectedId === item.id ? "selected" : ""}
              onClick={() => store.setSelected(item.id)}
            >
              <span className={`worktree-state ${item.state}`} />
              <div>
                <strong>{item.name}</strong>
                <span>
                  {item.branch || "无分支"} · {stateLabel(item.state)}
                </span>
                <small>
                  {item.changedFiles} 个未提交变更 · {item.official ? "Grok 原生" : "Git 兼容层"}
                </small>
              </div>
            </button>
          ))}
        </div>
      )}

      <UiDialog open={createOpen} onOpenChange={setCreateOpen} title="创建隔离 Worktree / 热迁移会话">
        <form onSubmit={(e) => void submitCreate(e)} style={{ display: "grid", gap: 12 }}>
          <label className="ui-field">
            <span>Worktree 名称</span>
            <input
              className="ui-input"
              autoFocus
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：feat-review-tour"
            />
          </label>

          <label className="ui-field">
            <span>基础分支 (Base Ref)</span>
            {branches.length > 0 ? (
              <select
                className="ui-select"
                value={baseBranch}
                onChange={(e) => setBaseBranch(e.target.value)}
              >
                {branches.map((b) => (
                  <option key={b.name} value={b.name}>
                    {b.name}
                    {b.current ? " (当前)" : ""}
                  </option>
                ))}
              </select>
            ) : (
              <input className="ui-input" value={baseBranch} onChange={(e) => setBaseBranch(e.target.value)} />
            )}
          </label>

          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "var(--text-caption)", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={startFromOrigin}
              onChange={(e) => setStartFromOrigin(e.target.checked)}
            />
            <span>从远端 origin 最新分支起点创建 (startFromOrigin)</span>
          </label>

          {canHandoffActive && (
            <div style={{ display: "grid", gap: 8, paddingTop: 8, borderTop: "1px solid var(--color-border)" }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "var(--text-caption)", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={handoffCurrentSession}
                  onChange={(e) => setHandoffCurrentSession(e.target.checked)}
                />
                <span>热迁移当前会话“{activeSession?.title}”到此新 Worktree</span>
              </label>

              {handoffCurrentSession && (
                <label className="ui-field">
                  <span>携带当前未提交改动策略 (carryDirtyChanges)</span>
                  <select
                    className="ui-select"
                    value={carryDirtyChanges}
                    onChange={(e) => setCarryDirtyChanges(e.target.value as CarryDirtyChangesMode)}
                  >
                    <option value="move">迁移改动并恢复原工作树干净 (move)</option>
                    <option value="copy">复制改动到新 Worktree 并保留原目录 (copy)</option>
                    <option value="none">不携带未提交改动 (none)</option>
                  </select>
                </label>
              )}
            </div>
          )}

          <div className="button-row" style={{ justifyContent: "flex-end" }}>
            <button type="button" onClick={() => setCreateOpen(false)}>
              取消
            </button>
            <button type="submit" className="primary" disabled={store.loading || !name.trim()}>
              {handoffCurrentSession ? "创建并热迁移会话" : "创建 Worktree"}
            </button>
          </div>
        </form>
      </UiDialog>
    </section>
  );
}

export function WorktreeWorkbench({
  workspace,
  dialogs,
  onOpenConversation,
}: {
  workspace: string;
  dialogs: Dialogs;
  onOpenConversation?(target: { cwd: string; sessionId: string }): void;
}): React.JSX.Element {
  const store = useWorktreeStore();
  const selected = store.items.find((item) => item.id === store.selectedId);
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const activeSession = useAppStore((s) => s.sessions.find((item) => item.id === s.activeSessionId));

  const [cleanup, setCleanup] = useState(false);
  const [result, setResult] = useState("");
  const [handoffBusy, setHandoffBusy] = useState(false);
  const [carryMode, setCarryMode] = useState<CarryDirtyChangesMode>("move");

  const refresh = async (): Promise<void> => {
    try {
      store.setItems(workspace, await window.grokDesktop.listWorktrees(workspace));
    } catch (error) {
      dialogs.setError(errorMessage(error));
    }
  };

  const preview = async (): Promise<void> => {
    if (!selected) return;
    store.setLoading(true);
    setResult("");
    try {
      store.setPreview(await window.grokDesktop.previewWorktreeApply(workspace, selected.id));
    } catch (error) {
      dialogs.setError(errorMessage(error));
    } finally {
      store.setLoading(false);
    }
  };

  const apply = async (): Promise<void> => {
    const value = store.preview;
    if (!selected || !value?.canApply || !value.confirmationToken) return;
    const confirmed = await dialogs.askConfirm(
      `将 ${value.commits.length} 个提交、${value.files.length} 个文件应用到目标工作区。\n+${value.additions} / −${value.deletions}${cleanup ? "\n成功后清理 Worktree。" : "\n成功后保留 Worktree。"}`,
      { title: "确认安全应用 Worktree", confirmLabel: "应用", danger: false },
    );
    if (!confirmed) return;
    store.setLoading(true);
    try {
      const applied = await window.grokDesktop.applyWorktree(
        workspace,
        selected.id,
        value.confirmationToken,
        true,
        cleanup,
      );
      setResult(applied.message);
      store.setPreview(undefined);
      await refresh();
      if (applied.conflicted) useWorkbenchStore.getState().setActiveView("source-control");
    } catch (error) {
      dialogs.setError(errorMessage(error));
    } finally {
      store.setLoading(false);
    }
  };

  const remove = async (): Promise<void> => {
    if (!selected) return;
    const confirmed = await dialogs.askConfirm(
      `删除 Worktree“${selected.name}”？仅当不存在未提交或未应用变更时才会执行。`,
      { title: "删除 Worktree", confirmLabel: "删除", danger: true },
    );
    if (!confirmed) return;
    try {
      await window.grokDesktop.removeWorktree(workspace, selected.id, true);
      store.setPreview(undefined);
      await refresh();
    } catch (error) {
      dialogs.setError(errorMessage(error));
    }
  };

  const openWorkspace = async (view: WorkbenchView): Promise<void> => {
    if (!selected) return;
    try {
      const app = useAppStore.getState();
      app.setSessions(await window.grokDesktop.setWorkspace(selected.path));
      app.setSettings(await window.grokDesktop.getSettings());
      app.setActiveSession("");
      useWorkbenchStore.getState().setActiveView(view);
    } catch (error) {
      dialogs.setError(errorMessage(error));
    }
  };

  const openSession = async (): Promise<void> => {
    if (!selected?.sourceSessionId) return;
    try {
      if (onOpenConversation) {
        onOpenConversation({ cwd: selected.path, sessionId: selected.sourceSessionId });
        return;
      }
      throw new Error("当前壳层未提供统一会话导航入口");
    } catch (error) {
      dialogs.setError(errorMessage(error));
    }
  };

  const handoffCurrentToNewWorktree = async (): Promise<void> => {
    if (!activeSessionId || !workspace || handoffBusy) return;
    setHandoffBusy(true);
    try {
      const profiles = await window.grokDesktop.listExecutionProfiles(workspace).catch(() => []);
      const wtProfileId =
        profiles.find((p) => p.id === "builtin-worktree")?.id ??
        profiles.find((p) => p.worktree)?.id ??
        "builtin-worktree";
      const migrated = await executeInPlaceWorktreeHandoff({
        sessionId: activeSessionId,
        workspacePath: workspace,
        worktreeProfileId: wtProfileId,
        baseRef: selected?.branch || selected?.baseRef || "HEAD",
        startFromOrigin: false,
        carryDirtyChanges: carryMode,
      });
      await refresh();
      onOpenConversation?.({ cwd: migrated.cwd, sessionId: migrated.sessionId });
    } catch (error) {
      dialogs.setError(errorMessage(error));
    } finally {
      setHandoffBusy(false);
    }
  };

  if (!selected) {
    return (
      <div className="worktree-empty">
        <h2>隔离 Worktree</h2>
        <p>{store.unavailableReason || "从左侧新建或选择一个 Worktree。"}</p>
      </div>
    );
  }

  const value = store.preview;
  const canHandoffActive = Boolean(activeSessionId && activeSession && !activeSession.worktreeId);

  return (
    <div className="worktree-workbench">
      <header>
        <div>
          <h2>{selected.name}</h2>
          <span>
            {selected.branch || "无分支"} · {selected.official ? "Grok 原生" : "受控 Git 兼容层"}
          </span>
        </div>
        <div>
          <button onClick={() => void openWorkspace("files")}>打开文件</button>
          <button onClick={() => void openWorkspace("source-control")}>打开 Git</button>
          <button disabled={!selected.sourceSessionId} onClick={() => void openSession()}>
            打开会话
          </button>
          <button className="danger-link" disabled={store.loading} onClick={() => void remove()}>
            删除
          </button>
        </div>
      </header>

      <section className="worktree-overview">
        <dl>
          <dt>路径</dt>
          <dd title={selected.path}>{selected.path}</dd>
          <dt>基础 Ref</dt>
          <dd>{selected.baseRef || "未知"}</dd>
          <dt>HEAD</dt>
          <dd>{selected.head?.slice(0, 12) || "未知"}</dd>
          <dt>来源会话</dt>
          <dd>{selected.sourceSessionId || "无"}</dd>
          <dt>Agent</dt>
          <dd>{selected.agentId || "无"}</dd>
          <dt>状态</dt>
          <dd>
            {stateLabel(selected.state)} · {selected.changedFiles} 个未提交变更
          </dd>
        </dl>
        <div style={{ display: "grid", gap: 8, justifyItems: "end" }}>
          <button className="primary" disabled={store.loading} onClick={() => void preview()}>
            {store.loading ? "检查中…" : "预览安全应用"}
          </button>

          {canHandoffActive && (
            <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <select
                aria-label="携带未提交修改策略"
                className="ui-select"
                style={{ height: 28, width: "auto", fontSize: "var(--text-xs)" }}
                value={carryMode}
                onChange={(e) => setCarryMode(e.target.value as CarryDirtyChangesMode)}
              >
                <option value="move">迁移改动 (move)</option>
                <option value="copy">复制改动 (copy)</option>
                <option value="none">不带改动 (none)</option>
              </select>
              <button
                type="button"
                disabled={handoffBusy || store.loading}
                onClick={() => void handoffCurrentToNewWorktree()}
              >
                {handoffBusy ? "迁移中…" : "热迁移当前会话到新 Worktree"}
              </button>
            </div>
          )}
        </div>
      </section>

      {result && <div className="worktree-result">{result}</div>}

      {value && (
        <section className={`worktree-preview ${value.canApply ? "ready" : "blocked"}`}>
          <header>
            <div>
              <h3>应用预览</h3>
              <span>{value.targetClean ? "目标工作区干净" : "目标工作区有修改"}</span>
            </div>
            <strong>
              +{value.additions} / −{value.deletions}
            </strong>
          </header>
          {!value.canApply && <p className="worktree-blocked">{value.reason}</p>}
          <div className="worktree-preview-grid">
            <div>
              <h4>提交（{value.commits.length}）</h4>
              {value.commits.map((commit) => (
                <p key={commit.hash}>
                  <code>{commit.hash.slice(0, 8)}</code> {commit.subject}
                </p>
              ))}
            </div>
            <div>
              <h4>文件（{value.files.length}）</h4>
              {value.files.map((file) => (
                <p key={file.path}>
                  <b>{file.kind}</b>
                  <span>{file.path}</span>
                  <small>
                    +{file.additions ?? "–"} / −{file.deletions ?? "–"}
                  </small>
                </p>
              ))}
            </div>
          </div>
          <footer>
            <label>
              <input
                type="checkbox"
                checked={cleanup}
                onChange={(event) => setCleanup(event.target.checked)}
              />
              成功后清理 Worktree（默认关闭）
            </label>
            <button className="primary" disabled={!value.canApply || store.loading} onClick={() => void apply()}>
              确认并应用
            </button>
          </footer>
        </section>
      )}
    </div>
  );
}

function stateLabel(value: string): string {
  return (
    (
      {
        ready: "就绪",
        applying: "应用中",
        conflicted: "有冲突",
        orphaned: "未关联",
        stale: "可清理",
        missing: "路径缺失",
        unknown: "未知",
      } as Record<string, string>
    )[value] ?? value
  );
}
