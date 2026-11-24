import { useCallback, useEffect, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import {
  Bug,
  CheckCircle2,
  FlaskConical,
  Hammer,
  LoaderCircle,
  Play,
  Plus,
  ShieldAlert,
  Sparkles,
  Square,
  Trash2,
  Wrench,
} from "lucide-react";
import type {
  WorkspaceScript,
  WorkspaceScriptIcon,
  WorkspaceScriptRunReceipt,
} from "../../../shared/workspace-tools";
import { errorMessage } from "../error-message";

export interface ProjectScriptsBarProps {
  workspace: string;
  executionCwd?: string;
  sessionId?: string;
  worktreeId?: string;
  onError(message: string): void;
}

const NO_DRAG_STYLE = { WebkitAppRegion: "no-drag" } as React.CSSProperties;

const ICON_OPTIONS: ReadonlyArray<{ value: WorkspaceScriptIcon; label: string }> = [
  { value: "play", label: "运行 (Play)" },
  { value: "test", label: "测试 (Test)" },
  { value: "lint", label: "检查 (Lint)" },
  { value: "build", label: "构建 (Build)" },
  { value: "configure", label: "初始化 (Setup)" },
  { value: "debug", label: "调试 (Debug)" },
];

function ScriptGlyph({ icon }: { icon: WorkspaceScriptIcon }): React.JSX.Element {
  switch (icon) {
    case "test":
      return <FlaskConical size={12} />;
    case "lint":
      return <Sparkles size={12} />;
    case "build":
      return <Hammer size={12} />;
    case "configure":
      return <Wrench size={12} />;
    case "debug":
      return <Bug size={12} />;
    default:
      return <Play size={12} />;
  }
}

export function ProjectScriptsBar({
  workspace,
  executionCwd,
  sessionId,
  worktreeId,
  onError,
}: ProjectScriptsBarProps): React.JSX.Element | null {
  const [open, setOpen] = useState(false);
  const [scripts, setScripts] = useState<WorkspaceScript[]>([]);
  const [running, setRunning] = useState<WorkspaceScriptRunReceipt[]>([]);
  const [repoTrusted, setRepoTrusted] = useState(true);
  const [repoRoot, setRepoRoot] = useState("");
  const [busyId, setBusyId] = useState("");
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [command, setCommand] = useState("");
  const [icon, setIcon] = useState<WorkspaceScriptIcon>("play");
  const [runOnWorktreeCreate, setRunOnWorktreeCreate] = useState(false);
  const [stopOnSettle, setStopOnSettle] = useState(true);
  const [runOnSettle, setRunOnSettle] = useState(false);
  const [autoOpenPreview, setAutoOpenPreview] = useState(false);
  const [previewUrl, setPreviewUrl] = useState("");

  const reqGenRef = useState(() => ({ current: 0 }))[0];

  const refresh = useCallback(async () => {
    const gen = ++reqGenRef.current;
    if (!workspace || typeof window.grokDesktop.listWorkspaceScripts !== "function") {
      setScripts([]);
      setRunning([]);
      return;
    }
    try {
      const [listRes, runningRes] = await Promise.all([
        window.grokDesktop.listWorkspaceScripts(workspace, executionCwd),
        window.grokDesktop.listRunningWorkspaceScripts?.(executionCwd || workspace).catch(() => [] as WorkspaceScriptRunReceipt[]) ??
          Promise.resolve([] as WorkspaceScriptRunReceipt[]),
      ]);
      if (gen !== reqGenRef.current) return;
      setScripts(listRes.scripts);
      setRepoTrusted(!listRes.repositoryTrustRequired || listRes.repositoryTrusted);
      setRepoRoot(listRes.repositoryRoot || workspace);
      setRunning(runningRes.filter((r) => r.status === "running"));
    } catch {
      // Non-fatal in header toolbar
    }
  }, [executionCwd, reqGenRef, workspace]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!open) return;
    void refresh();
    const timer = window.setInterval(() => void refresh(), 2500);
    return () => window.clearInterval(timer);
  }, [open, refresh]);

  useEffect(() => {
    return window.grokDesktop.onWorkspaceTerminal((ev) => {
      if (ev.exitCode !== undefined) {
        setRunning((prev) => prev.filter((item) => item.terminalId !== ev.id));
      }
    });
  }, []);

  if (!workspace || typeof window.grokDesktop.listWorkspaceScripts !== "function") {
    return null;
  }

  const handleRun = async (script: WorkspaceScript): Promise<void> => {
    if (busyId) return;
    setBusyId(script.id);
    try {
      const receipt = await window.grokDesktop.runWorkspaceScript({
        workspacePath: workspace,
        scriptId: script.id,
        executionCwd: executionCwd || workspace,
        ...(sessionId ? { sessionId } : {}),
        ...(worktreeId ? { worktreeId } : {}),
      });
      await refresh();
      window.dispatchEvent(
        new CustomEvent("grok:open-terminal", {
          detail: { terminalId: receipt.terminalId, workspace: receipt.cwd },
        }),
      );
      if (script.autoOpenPreview && (receipt.previewUrl || script.previewUrl)) {
        window.dispatchEvent(
          new CustomEvent("grok:project-preview", {
            detail: { workspace: receipt.cwd, sessionId },
          }),
        );
      }
      setOpen(false);
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setBusyId("");
    }
  };

  const handleApprove = async (script: WorkspaceScript): Promise<void> => {
    if (busyId) return;
    setBusyId(script.id);
    try {
      if (!repoTrusted) {
        await window.grokDesktop.setGitRepositoryTrust(workspace, repoRoot || workspace, true);
      }
      await window.grokDesktop.approveWorkspaceScript(workspace, script.id, script.commandHash, true, executionCwd);
      await refresh();
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setBusyId("");
    }
  };

  const handleStop = async (runId: string): Promise<void> => {
    if (busyId) return;
    setBusyId(runId);
    try {
      await window.grokDesktop.stopWorkspaceScript(runId);
      await refresh();
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setBusyId("");
    }
  };

  const handleDelete = async (scriptId: string): Promise<void> => {
    if (busyId) return;
    setBusyId(scriptId);
    try {
      await window.grokDesktop.deleteWorkspaceScript(workspace, scriptId);
      await refresh();
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setBusyId("");
    }
  };

  const handleSave = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!name.trim() || !command.trim() || busyId) return;
    setBusyId("save");
    try {
      await window.grokDesktop.saveWorkspaceScript({
        workspacePath: workspace,
        name: name.trim(),
        command: command.trim(),
        icon,
        runOnWorktreeCreate,
        stopOnSettle,
        runOnSettle,
        autoOpenPreview,
        ...(previewUrl.trim() ? { previewUrl: previewUrl.trim() } : {}),
      });
      setName("");
      setCommand("");
      setPreviewUrl("");
      setRunOnWorktreeCreate(false);
      setRunOnSettle(false);
      setAutoOpenPreview(false);
      setAdding(false);
      await refresh();
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setBusyId("");
    }
  };

  const runningCount = running.length;

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className={`ui-btn ui-btn-ghost ui-btn-sm project-scripts-trigger${runningCount > 0 ? " is-active" : ""}`}
          style={{ ...NO_DRAG_STYLE, height: 26, padding: "0 8px", gap: 5 }}
          title="项目生命周期脚本（Worktree 初始化 / 开发服务器 / 测试 / 结算自动收尾）"
          aria-label="项目脚本"
        >
          {runningCount > 0 ? (
            <LoaderCircle size={13} className="ui-spin" style={{ color: "var(--color-success)" }} />
          ) : (
            <Play size={12} style={{ color: "var(--color-accent)" }} />
          )}
          <span>脚本{scripts.length > 0 ? ` (${scripts.length})` : ""}</span>
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          className="ui-popover"
          align="end"
          sideOffset={6}
          collisionPadding={10}
          style={{ width: "min(380px, calc(100vw - 24px))", display: "grid", gap: 10 }}
        >
          <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <strong style={{ fontSize: "var(--text-caption)", color: "var(--color-fg)" }}>
              项目脚本与生命周期钩子
            </strong>
            <button
              type="button"
              className="ui-btn ui-btn-ghost ui-btn-sm"
              onClick={() => setAdding((v) => !v)}
            >
              <Plus size={12} />
              <span>{adding ? "取消新建" : "添加脚本"}</span>
            </button>
          </header>

          {!repoTrusted && (
            <div
              role="alert"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "6px 8px",
                borderRadius: "var(--radius-md)",
                background: "var(--color-warning-soft)",
                color: "var(--color-warning)",
                fontSize: "var(--text-xs)",
              }}
            >
              <ShieldAlert size={13} style={{ flex: "none" }} />
              <span>检测到仓库级脚本配置（.grok/project.json 或 t3.json），需逐项核对命令并信任后方可执行。</span>
            </div>
          )}

          {adding && (
            <form
              onSubmit={(e) => void handleSave(e)}
              style={{
                display: "grid",
                gap: 7,
                padding: 8,
                borderRadius: "var(--radius-lg)",
                border: "1px solid var(--color-border)",
                background: "var(--color-card)",
              }}
            >
              <div style={{ display: "grid", gridTemplateColumns: "1fr 112px", gap: 6 }}>
                <input
                  className="ui-input"
                  style={{ height: 26, fontSize: "var(--text-xs)" }}
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="脚本名称（如 Dev Server）"
                />
                <select
                  aria-label="脚本图标"
                  className="ui-select"
                  style={{ height: 26, fontSize: "var(--text-xs)", padding: "0 6px" }}
                  value={icon}
                  onChange={(e) => setIcon(e.target.value as WorkspaceScriptIcon)}
                >
                  {ICON_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              <input
                className="ui-input"
                style={{ height: 26, fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)" }}
                required
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                placeholder="命令（如 npm run dev 或 pnpm test）"
              />
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--color-fg-subtle)" }}>
                <input
                  type="checkbox"
                  checked={runOnWorktreeCreate}
                  onChange={(e) => setRunOnWorktreeCreate(e.target.checked)}
                />
                <span>新建隔离 Worktree 时自动执行 (Setup)</span>
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--color-fg-subtle)" }}>
                <input
                  type="checkbox"
                  checked={stopOnSettle}
                  onChange={(e) => setStopOnSettle(e.target.checked)}
                />
                <span>会话结算 (Settle) 时自动停止后台进程</span>
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--color-fg-subtle)" }}>
                <input
                  type="checkbox"
                  checked={runOnSettle}
                  onChange={(e) => setRunOnSettle(e.target.checked)}
                />
                <span>会话结算时运行（仅隔离 Worktree 生效，主目录硬锁拦截）</span>
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--color-fg-subtle)" }}>
                <input
                  type="checkbox"
                  checked={autoOpenPreview}
                  onChange={(e) => setAutoOpenPreview(e.target.checked)}
                />
                <span>启动后自动打开内置预览</span>
              </label>
              {autoOpenPreview && (
                <input
                  className="ui-input"
                  style={{ height: 25, fontSize: 11 }}
                  value={previewUrl}
                  onChange={(e) => setPreviewUrl(e.target.value)}
                  placeholder="可选预览地址（如 http://localhost:5173）"
                />
              )}
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button type="submit" className="ui-btn ui-btn-primary ui-btn-sm" disabled={Boolean(busyId)}>
                  保存脚本
                </button>
              </div>
            </form>
          )}

          <div style={{ display: "grid", gap: 5, maxHeight: 240, overflowY: "auto" }}>
            {scripts.map((script) => {
              const activeRun = running.find((r) => r.scriptId === script.id && r.status === "running");
              const needsApproval = script.source !== "user" && (!script.trusted || !repoTrusted);
              return (
                <div
                  key={`${script.source}:${script.id}`}
                  style={{
                    display: "grid",
                    gap: 4,
                    padding: "6px 8px",
                    borderRadius: "var(--radius-lg)",
                    border: "1px solid var(--color-border)",
                    background: "var(--color-card)",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                      <ScriptGlyph icon={script.icon} />
                      <strong style={{ fontSize: "var(--text-xs)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {script.name}
                      </strong>
                      {script.source !== "user" && (
                        <span className="ui-badge" style={{ height: 16, fontSize: 9 }}>
                          {script.source === "t3" ? "t3.json" : ".grok"}
                        </span>
                      )}
                    </span>

                    <div style={{ display: "inline-flex", alignItems: "center", gap: 4, flex: "none" }}>
                      {needsApproval ? (
                        <button
                          type="button"
                          className="ui-btn ui-btn-secondary ui-btn-sm"
                          style={{ height: 22, fontSize: 11 }}
                          disabled={Boolean(busyId)}
                          onClick={() => void handleApprove(script)}
                          title={`信任并批准命令哈希 ${script.commandHash.slice(0, 12)}`}
                        >
                          <CheckCircle2 size={11} /> 信任命令
                        </button>
                      ) : activeRun ? (
                        <button
                          type="button"
                          className="ui-btn ui-btn-danger ui-btn-sm"
                          style={{ height: 22, fontSize: 11 }}
                          disabled={Boolean(busyId)}
                          onClick={() => void handleStop(activeRun.runId)}
                        >
                          <Square size={10} /> 停止
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="ui-btn ui-btn-primary ui-btn-sm"
                          style={{ height: 22, fontSize: 11 }}
                          disabled={Boolean(busyId)}
                          onClick={() => void handleRun(script)}
                        >
                          <Play size={10} /> 运行
                        </button>
                      )}
                      {script.source === "user" && (
                        <button
                          type="button"
                          className="ui-icon-btn ui-icon-btn-sm"
                          style={{ width: 20, height: 20 }}
                          aria-label={`删除脚本 ${script.name}`}
                          disabled={Boolean(busyId)}
                          onClick={() => void handleDelete(script.id)}
                        >
                          <Trash2 size={11} />
                        </button>
                      )}
                    </div>
                  </div>
                  <code
                    style={{
                      fontSize: 11,
                      color: "var(--color-fg-subtlest)",
                      fontFamily: "var(--font-mono)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                    title={script.command}
                  >
                    {script.command}
                  </code>
                </div>
              );
            })}

            {scripts.length === 0 && !adding && (
              <small style={{ padding: "8px 4px", color: "var(--color-fg-subtlest)", fontSize: "var(--text-xs)" }}>
                尚未配置项目脚本。点击上方“添加脚本”，或在仓库中放入只读 `.grok/project.json` / `t3.json` 即可自动发现。
              </small>
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
