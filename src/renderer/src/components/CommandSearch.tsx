import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AtSign,
  Command as CommandIcon,
  FileCode,
  Folder,
  MessageSquare,
  Palette,
  Pin,
  Search,
} from "lucide-react";
import type {
  OfficialSessionSearchHit,
  SessionSummary,
  ThemeSettings,
  WorkspaceFileCandidate,
  WorkspaceSummary,
} from "../../../shared/types";
import { matchesAllWords, searchWords } from "../../../shared/search-words";
import { matchesShortcut, shortcutFor } from "../../../shared/shortcuts";
import { useAppStore } from "../store";
import {
  applyThemeToDocument,
  cacheThemeForEarlyStartup,
  THEME_PRESETS,
  type ThemePreset,
} from "../theme";
import { useWorkbenchStore } from "../workbench-store";
import type { UiAction } from "./ui/ActionMenu";
import { UiDialog } from "./ui/primitives";
import "../styles/t3-chrome.css";

export function flattenActions(actions: UiAction[], prefix = ""): UiAction[] {
  return actions.flatMap((action) =>
    action.children?.length
      ? flattenActions(action.children, `${prefix}${action.label} / `)
      : [{ ...action, label: `${prefix}${action.label}` }],
  );
}

export interface CommandSearchProps {
  actions: UiAction[];
  defaultOpen?: boolean;
  onError(message: string): void;
  onSelectSession?(target: { sessionId: string; cwd: string }): void | Promise<void>;
  onSelectWorkspace?(cwd: string): void | Promise<void>;
  onOpenFile?(file: WorkspaceFileCandidate, workspace: string): void | Promise<void>;
  onInsertFileIntoComposer?(file: WorkspaceFileCandidate, workspace: string): void | Promise<void>;
}

type PaletteItem =
  | {
      kind: "session";
      id: string;
      sessionId: string;
      cwd: string;
      title: string;
      projectLabel: string;
      snippet?: string;
      status?: SessionSummary["status"];
      pinned?: boolean;
      rank: number;
      updatedMs: number;
      ftsScore: number;
    }
  | {
      kind: "workspace";
      id: string;
      workspace: WorkspaceSummary;
    }
  | {
      kind: "file";
      id: string;
      file: WorkspaceFileCandidate;
      workspace: string;
    }
  | {
      kind: "action";
      id: string;
      action: UiAction;
    }
  | {
      kind: "theme-preset";
      id: string;
      preset: ThemePreset;
      active: boolean;
    };

function mirasimSessionRank(session?: SessionSummary): number {
  if (!session) return 3;
  if (session.status === "needs-user") return 0;
  if (session.status === "working" || session.status === "queued") return 1;
  if (session.pinned) return 2;
  return 3;
}

function statusPill(status?: SessionSummary["status"]): { text: string; className: string } | null {
  if (status === "needs-user") return { text: "等待确认", className: "ui-badge ui-badge-warning" };
  if (status === "working") return { text: "运行中", className: "ui-badge ui-badge-accent" };
  if (status === "queued") return { text: "排队中", className: "ui-badge ui-badge-accent" };
  if (status === "error") return { text: "异常", className: "ui-badge ui-badge-danger" };
  if (status === "unread") return { text: "未读完成", className: "ui-badge ui-badge-success" };
  return null;
}

function folderBasename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) || path;
}

function isSystemDarkPreferred(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-color-scheme: dark)").matches
    : true;
}

function themePresetVars(colors: ThemePreset["colors"]): React.CSSProperties {
  return {
    "--preset-accent": colors.accent,
    "--preset-bg": colors.background,
    "--preset-surface": colors.surface,
    "--preset-border": colors.border,
    "--preset-text": colors.text,
  } as React.CSSProperties;
}

export function CommandSearch({
  actions,
  defaultOpen = false,
  onError,
  onSelectSession,
  onSelectWorkspace,
  onOpenFile,
  onInsertFileIntoComposer,
}: CommandSearchProps): React.JSX.Element {
  const [open, setOpen] = useState(defaultOpen);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const [officialHits, setOfficialHits] = useState<OfficialSessionSearchHit[]>([]);
  const [fileHits, setFileHits] = useState<WorkspaceFileCandidate[]>([]);
  const [searchingRemote, setSearchingRemote] = useState(false);

  const sessions = useAppStore((state) => state.sessions);
  const workspaces = useAppStore((state) => state.workspaces);
  const activeWorkspace = useAppStore((state) => state.settings?.activeWorkspace || "");
  const currentTheme = useAppStore((state) => state.settings?.theme);

  const baselineThemeRef = useRef<ThemeSettings | undefined>(undefined);
  const previewingPresetRef = useRef<string | undefined>(undefined);
  const themeCommittedRef = useRef(false);
  const dialogAnchorRef = useRef<HTMLDivElement>(null);

  const revertThemePreview = useCallback(() => {
    if (previewingPresetRef.current && baselineThemeRef.current && !themeCommittedRef.current) {
      applyThemeToDocument(baselineThemeRef.current, isSystemDarkPreferred());
    }
    previewingPresetRef.current = undefined;
  }, []);

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    if (!nextOpen) {
      revertThemePreview();
      baselineThemeRef.current = undefined;
      themeCommittedRef.current = false;
    }
    setOpen(nextOpen);
  }, [revertThemePreview]);

  useEffect(() => {
    const show = (event?: Event): void => {
      const ownDialog = dialogAnchorRef.current?.closest('[role="dialog"]');
      const hasBlockingModal = Array.from(
        document.querySelectorAll(
          '[role="dialog"][aria-modal="true"], [role="dialog"][data-state="open"]:not(.ui-popover), [role="alertdialog"], .add-palette',
        ),
      ).some((node) => node !== ownDialog);
      if (hasBlockingModal) return;
      const initialQuery = (event as CustomEvent<{ initialQuery?: string }> | undefined)?.detail?.initialQuery ?? "";
      const snapTheme = useAppStore.getState().settings?.theme;
      baselineThemeRef.current = snapTheme ? structuredClone(snapTheme) : undefined;
      previewingPresetRef.current = undefined;
      themeCommittedRef.current = false;
      setQuery(initialQuery);
      setIndex(0);
      setOpen(true);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (
        !event.defaultPrevented
        && matchesShortcut(event, shortcutFor("command-search", useAppStore.getState().settings?.productivity))
      ) {
        event.preventDefault();
        show();
      }
    };
    window.addEventListener("grok:command-search", show);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("grok:command-search", show);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  const trimmedStart = query.trimStart();
  const mode: "omni" | "files" | "commands" = trimmedStart.startsWith("@")
    ? "files"
    : trimmedStart.startsWith(">")
      ? "commands"
      : "omni";
  const cleanQuery = mode === "omni" ? query.trim() : trimmedStart.slice(1).trim();

  useEffect(() => {
    if (!open || mode !== "omni" || !cleanQuery || !window.grokDesktop.searchOfficialSessions) {
      setOfficialHits([]);
      setSearchingRemote(false);
      return;
    }
    let cancelled = false;
    setSearchingRemote(true);
    const timer = window.setTimeout(() => {
      void window.grokDesktop.searchOfficialSessions!(cleanQuery, undefined, 24)
        .then((result) => {
          if (!cancelled) setOfficialHits(result.supported ? result.hits : []);
        })
        .catch(() => {
          if (!cancelled) setOfficialHits([]);
        })
        .finally(() => {
          if (!cancelled) setSearchingRemote(false);
        });
    }, 150);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [cleanQuery, mode, open]);

  useEffect(() => {
    if (!open || mode !== "files" || !activeWorkspace) {
      setFileHits([]);
      return;
    }
    let cancelled = false;
    setSearchingRemote(true);
    const timer = window.setTimeout(() => {
      void window.grokDesktop.searchWorkspaceFiles(activeWorkspace, cleanQuery, 40)
        .then((files) => {
          if (!cancelled) setFileHits(files);
        })
        .catch(() => {
          if (!cancelled) setFileHits([]);
        })
        .finally(() => {
          if (!cancelled) setSearchingRemote(false);
        });
    }, 90);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [activeWorkspace, cleanQuery, mode, open]);

  const workspaceNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const ws of workspaces) {
      map.set(ws.cwd.replace(/[\\/]+$/, "").toLocaleLowerCase(), ws.name);
      map.set(ws.canonicalPath.replace(/[\\/]+$/, "").toLocaleLowerCase(), ws.name);
    }
    return map;
  }, [workspaces]);

  const nonSessionActions = useMemo(
    () => flattenActions(actions).filter((item) => !item.id.startsWith("session:")),
    [actions],
  );

  const sessionActionById = useMemo(() => {
    const map = new Map<string, UiAction>();
    for (const item of flattenActions(actions)) {
      if (item.id.startsWith("session:")) map.set(item.id.slice("session:".length), item);
    }
    return map;
  }, [actions]);

  const rows = useMemo<PaletteItem[]>(() => {
    const words = searchWords(cleanQuery);

    if (mode === "files") {
      return fileHits.map((file) => ({
        kind: "file",
        id: `file:${file.path}`,
        file,
        workspace: activeWorkspace,
      }));
    }

    if (mode === "commands") {
      const matchedActions: PaletteItem[] = nonSessionActions
        .filter((action) => matchesAllWords(`${action.label} ${action.reason ?? ""}`, words))
        .map((action) => ({ kind: "action", id: `action:${action.id}`, action }));

      const matchedPresets: PaletteItem[] = THEME_PRESETS
        .filter((preset) =>
          matchesAllWords(
            `主题 配色 外观 theme preset ${preset.id} ${preset.name} ${preset.subtitle} ${preset.base === "dark" ? "深色 暗色 dark" : "浅色 亮色 light"}`,
            words,
          ),
        )
        .map((preset) => ({
          kind: "theme-preset",
          id: `theme:${preset.id}`,
          preset,
          active: currentTheme?.presetId === preset.id && currentTheme?.mode !== "custom",
        }));

      return [...matchedActions, ...matchedPresets].slice(0, 100);
    }

    const sessionCandidates = new Map<string, Extract<PaletteItem, { kind: "session" }>>();

    for (const session of sessions) {
      if (session.archived && !words.length) continue;
      const projectName = workspaceNameMap.get(session.cwd.replace(/[\\/]+$/, "").toLocaleLowerCase()) || folderBasename(session.cwd);
      const haystack = `${session.title} ${projectName} ${session.preview ?? ""}`;
      if (!matchesAllWords(haystack, words)) continue;
      const parsedTime = Date.parse(session.updatedAt);
      sessionCandidates.set(session.id, {
        kind: "session",
        id: `session:${session.id}`,
        sessionId: session.id,
        cwd: session.cwd,
        title: session.title,
        projectLabel: projectName,
        ...(words.length && session.preview ? { snippet: session.preview } : {}),
        status: session.status,
        pinned: session.pinned,
        rank: mirasimSessionRank(session),
        updatedMs: Number.isFinite(parsedTime) ? parsedTime : 0,
        ftsScore: 0,
      });
    }

    for (const hit of officialHits) {
      const existing = sessionCandidates.get(hit.sessionId);
      if (existing) {
        if (hit.snippet) existing.snippet = hit.snippet;
        if (typeof hit.score === "number") existing.ftsScore = hit.score;
        continue;
      }
      const cwd = hit.cwd || activeWorkspace;
      if (!cwd) continue;
      const localMatch = sessions.find((s) => s.id === hit.sessionId);
      const projectName = workspaceNameMap.get(cwd.replace(/[\\/]+$/, "").toLocaleLowerCase()) || folderBasename(cwd);
      const parsedTime = hit.updatedAt ? Date.parse(hit.updatedAt) : 0;
      sessionCandidates.set(hit.sessionId, {
        kind: "session",
        id: `session:${hit.sessionId}`,
        sessionId: hit.sessionId,
        cwd,
        title: hit.title || localMatch?.title || "历史会话",
        projectLabel: projectName,
        snippet: hit.snippet,
        status: localMatch?.status,
        pinned: localMatch?.pinned,
        rank: mirasimSessionRank(localMatch),
        updatedMs: Number.isFinite(parsedTime) ? parsedTime : 0,
        ftsScore: hit.score ?? 1,
      });
    }

    const orderedSessions = [...sessionCandidates.values()].sort(
      (a, b) => a.rank - b.rank || b.updatedMs - a.updatedMs || b.ftsScore - a.ftsScore,
    );

    const matchedWorkspaces: PaletteItem[] = workspaces
      .filter((ws) => !ws.hidden && ws.exists && matchesAllWords(`${ws.name} ${ws.displayPath}`, words))
      .slice(0, words.length ? 12 : 5)
      .map((workspace) => ({
        kind: "workspace",
        id: `workspace:${workspace.projectId}`,
        workspace,
      }));

    const matchedActions: PaletteItem[] = nonSessionActions
      .filter((action) => matchesAllWords(`${action.label} ${action.reason ?? ""}`, words))
      .slice(0, 50)
      .map((action) => ({ kind: "action", id: `action:${action.id}`, action }));

    const matchedThemes: PaletteItem[] = words.length
      ? THEME_PRESETS
          .filter((preset) =>
            matchesAllWords(`主题 theme ${preset.id} ${preset.name} ${preset.subtitle}`, words),
          )
          .map((preset) => ({
            kind: "theme-preset",
            id: `theme:${preset.id}`,
            preset,
            active: currentTheme?.presetId === preset.id && currentTheme?.mode !== "custom",
          }))
      : [];

    return [...orderedSessions, ...matchedWorkspaces, ...matchedActions, ...matchedThemes].slice(0, 100);
  }, [
    activeWorkspace,
    cleanQuery,
    currentTheme?.mode,
    currentTheme?.presetId,
    fileHits,
    mode,
    nonSessionActions,
    officialHits,
    sessions,
    workspaceNameMap,
    workspaces,
  ]);

  const safeIndex = rows.length ? Math.min(index, rows.length - 1) : 0;

  useEffect(() => {
    document.getElementById(`command-${safeIndex}`)?.scrollIntoView({ block: "nearest" });
  }, [safeIndex]);

  useEffect(() => {
    if (!open) return;
    const selected = rows[safeIndex];
    if (selected?.kind === "theme-preset") {
      const base = baselineThemeRef.current ?? useAppStore.getState().settings?.theme;
      if (base && previewingPresetRef.current !== selected.preset.id) {
        previewingPresetRef.current = selected.preset.id;
        const preview: ThemeSettings = {
          ...base,
          mode: selected.preset.base,
          presetId: selected.preset.id,
          customBase: selected.preset.base,
          colors: selected.preset.colors,
        };
        applyThemeToDocument(preview, isSystemDarkPreferred());
      }
    } else if (previewingPresetRef.current) {
      revertThemePreview();
    }
  }, [open, revertThemePreview, rows, safeIndex]);

  const executeFileInsert = async (file: WorkspaceFileCandidate, workspace: string): Promise<void> => {
    revertThemePreview();
    setOpen(false);
    try {
      if (onInsertFileIntoComposer) {
        await onInsertFileIntoComposer(file, workspace);
        return;
      }
      const added = await window.grokDesktop.attachmentsFromPaths([file.path], useAppStore.getState().activeSessionId || undefined);
      useAppStore.getState().addAttachments(added);
      useWorkbenchStore.getState().setActiveView("chat");
      window.dispatchEvent(new CustomEvent("grok:insert-composer-mention", { detail: { file, relativePath: file.relativePath } }));
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    }
  };

  const choose = async (item: PaletteItem | undefined, secondaryAction = false): Promise<void> => {
    if (!item) return;
    if (item.kind === "action" && (item.action.disabled || !item.action.run)) return;

    if (item.kind === "theme-preset") {
      themeCommittedRef.current = true;
      previewingPresetRef.current = undefined;
      setOpen(false);
      try {
        const updatedSettings = await window.grokDesktop.updateTheme({
          mode: item.preset.base,
          presetId: item.preset.id,
          customBase: item.preset.base,
          colors: item.preset.colors,
          ...(item.preset.base === "dark"
            ? { darkPresetId: item.preset.id }
            : { lightPresetId: item.preset.id }),
        });
        useAppStore.getState().setSettings(updatedSettings);
        applyThemeToDocument(updatedSettings.theme, isSystemDarkPreferred());
        cacheThemeForEarlyStartup(updatedSettings.theme);
      } catch (error) {
        onError(error instanceof Error ? error.message : String(error));
      }
      return;
    }

    if (item.kind === "file" && secondaryAction) {
      await executeFileInsert(item.file, item.workspace);
      return;
    }

    revertThemePreview();
    setOpen(false);

    try {
      if (item.kind === "action") {
        await item.action.run?.();
        return;
      }

      if (item.kind === "session") {
        if (onSelectSession) {
          await onSelectSession({ sessionId: item.sessionId, cwd: item.cwd });
          return;
        }
        const existingAction = sessionActionById.get(item.sessionId);
        if (existingAction?.run) {
          await existingAction.run();
          return;
        }
        const currentWs = useAppStore.getState().settings?.activeWorkspace || "";
        if (item.cwd && currentWs.toLocaleLowerCase() !== item.cwd.toLocaleLowerCase()) {
          const nextSessions = await window.grokDesktop.setWorkspace(item.cwd);
          useAppStore.getState().setSessions(nextSessions);
          useAppStore.getState().setSettings(await window.grokDesktop.getSettings());
        }
        await window.grokDesktop.openSession(item.cwd, item.sessionId);
        useAppStore.getState().setActiveSession(item.sessionId);
        useWorkbenchStore.getState().setActiveView("chat");
        return;
      }

      if (item.kind === "workspace") {
        if (onSelectWorkspace) {
          await onSelectWorkspace(item.workspace.cwd);
          return;
        }
        const nextSessions = await window.grokDesktop.setWorkspace(item.workspace.cwd);
        useAppStore.getState().setSessions(nextSessions);
        useAppStore.getState().setSettings(await window.grokDesktop.getSettings());
        useAppStore.getState().setActiveSession("");
        useWorkbenchStore.getState().setActiveView("chat");
        return;
      }

      if (item.kind === "file") {
        if (onOpenFile) {
          await onOpenFile(item.file, item.workspace);
          return;
        }
        const opened = await window.grokDesktop.openEditorDocument(item.workspace, item.file.path);
        if (opened.kind === "external") {
          await window.grokDesktop.openPath(opened.path);
        } else if (opened.document) {
          useWorkbenchStore.getState().openDocument(opened.document);
          window.dispatchEvent(
            new CustomEvent("grok:reveal-file", {
              detail: {
                kind: "file",
                workspace: item.workspace,
                id: useWorkbenchStore.getState().activeTabKey,
                title: opened.document.relativePath,
              },
            }),
          );
        }
      }
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <UiDialog title="全局命令与搜索面板" open={open} onOpenChange={handleOpenChange}>
      <div ref={dialogAnchorRef} className="command-search-header">
        <div className="command-search-field">
          <input
            className="command-search-input"
            autoFocus
            placeholder="搜索会话与全文记录… 输入 @ 搜文件，输入 > 执行命令或预览主题"
            aria-label="搜索命令、文件和会话"
            role="combobox"
            aria-expanded
            aria-controls="command-results"
            aria-activedescendant={rows[safeIndex] ? `command-${safeIndex}` : undefined}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setIndex(0);
            }}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                setIndex((current) => {
                  const base = Math.min(current, Math.max(0, rows.length - 1));
                  return Math.max(0, Math.min(rows.length - 1, base + (event.key === "ArrowDown" ? 1 : -1)));
                });
                return;
              }
              if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && /^[1-9]$/.test(event.key)) {
                const quickIndex = Number(event.key) - 1;
                const target = rows[quickIndex];
                if (target) {
                  event.preventDefault();
                  void choose(target);
                }
                return;
              }
              if (event.key === "Enter") {
                event.preventDefault();
                void choose(rows[safeIndex], event.shiftKey);
              }
            }}
          />
        </div>

        <div className="command-search-toolbar">
          <div className="command-search-modes">
            <button
              type="button"
              aria-pressed={mode === "omni"}
              className={`ui-btn ui-btn-sm ${mode === "omni" ? "ui-btn-secondary" : "ui-btn-ghost"}`}
              onClick={() => { setQuery(cleanQuery); setIndex(0); }}
            >
              <Search size={12} /> 全部
            </button>
            <button
              type="button"
              aria-pressed={mode === "files"}
              className={`ui-btn ui-btn-sm ${mode === "files" ? "ui-btn-secondary" : "ui-btn-ghost"}`}
              onClick={() => { setQuery(`@${cleanQuery}`); setIndex(0); }}
            >
              <AtSign size={12} /> 文件 (@)
            </button>
            <button
              type="button"
              aria-pressed={mode === "commands"}
              className={`ui-btn ui-btn-sm ${mode === "commands" ? "ui-btn-secondary" : "ui-btn-ghost"}`}
              onClick={() => { setQuery(`>${cleanQuery}`); setIndex(0); }}
            >
              <CommandIcon size={12} /> 命令与主题 (&gt;)
            </button>
          </div>
          {searchingRemote && (
            <span className="command-search-status">正在检索…</span>
          )}
        </div>
      </div>

      <div id="command-results" className="command-results" role="listbox">
        {rows.map((item, i) => {
          const selected = safeIndex === i;
          const quickShortcut = i < 9 ? `Ctrl+${i + 1}` : undefined;
          const isDisabled = item.kind === "action" && Boolean(item.action.disabled);
          const pill = item.kind === "session" ? statusPill(item.status) : null;
          const optionVars = item.kind === "theme-preset" ? themePresetVars(item.preset.colors) : undefined;

          return (
            <div
              key={item.id}
              className="command-result-row"
              onMouseMove={() => {
                if (safeIndex !== i) setIndex(i);
              }}
            >
              <button
                id={`command-${i}`}
                type="button"
                role="option"
                aria-selected={selected}
                aria-disabled={isDisabled}
                className={selected ? "command-result-option selected" : "command-result-option"}
                style={optionVars}
                onClick={() => void choose(item, false)}
              >
                {item.kind === "session" && (
                  <>
                    <span className="command-result-main is-top">
                      <MessageSquare size={14} className="command-result-icon is-session" />
                      <span className="command-result-body is-fill">
                        <span className="command-result-title-row">
                          <strong className="command-result-session-title">
                            {item.title}
                          </strong>
                          {item.pinned && <Pin size={11} className="command-result-pin" />}
                          {pill && (
                            <span className={`${pill.className} command-badge-xs`}>
                              {pill.text}
                            </span>
                          )}
                          <span className="ui-badge command-badge-xs">
                            {item.projectLabel}
                          </span>
                        </span>
                        {item.snippet && (
                          <small className="command-result-snippet">
                            {item.snippet}
                          </small>
                        )}
                      </span>
                    </span>
                    {quickShortcut && <kbd className="ui-kbd">{quickShortcut}</kbd>}
                  </>
                )}

                {item.kind === "workspace" && (
                  <>
                    <span className="command-result-main">
                      <Folder size={14} className="command-result-icon is-accent" />
                      <span className="command-result-body">
                        <strong>切换项目 / {item.workspace.name}</strong>
                        <small className="command-result-snippet">
                          {item.workspace.displayPath}
                        </small>
                      </span>
                    </span>
                    {quickShortcut && <kbd className="ui-kbd">{quickShortcut}</kbd>}
                  </>
                )}

                {item.kind === "file" && (
                  <>
                    <span className="command-result-main">
                      <FileCode size={14} className="command-result-icon is-accent" />
                      <span className="command-result-body">
                        <strong>{item.file.name}</strong>
                        <small className="command-result-snippet is-mono">
                          {item.file.relativePath}
                        </small>
                      </span>
                    </span>
                    {quickShortcut && <kbd className="ui-kbd">{quickShortcut}</kbd>}
                  </>
                )}

                {item.kind === "action" && (
                  <>
                    <span className="command-result-main">
                      <CommandIcon size={14} className="command-result-icon" />
                      <span className="command-result-body">
                        <span>{item.action.label}</span>
                        {item.action.reason && <small>{item.action.reason}</small>}
                      </span>
                    </span>
                    <span className="command-result-tail">
                      {item.action.shortcut && <kbd className="ui-kbd">{item.action.shortcut}</kbd>}
                      {quickShortcut && <kbd className="ui-kbd">{quickShortcut}</kbd>}
                    </span>
                  </>
                )}

                {item.kind === "theme-preset" && (
                  <>
                    <span className="command-result-main">
                      <Palette size={14} className="command-result-icon is-preset" />
                      <span className="command-result-body">
                        <span className="command-result-preset-head">
                          <strong>主题 / {item.preset.name}</strong>
                          {item.active && <span className="ui-badge ui-badge-accent">当前</span>}
                        </span>
                        <small>{item.preset.subtitle} · 悬停或方向键实时预览</small>
                      </span>
                    </span>
                    <span className="command-result-tail">
                      <span aria-hidden="true" className="command-theme-swatches">
                        <i className="is-surface" />
                        <i className="is-accent" />
                        <i className="is-text" />
                      </span>
                      {quickShortcut && <kbd className="ui-kbd">{quickShortcut}</kbd>}
                    </span>
                  </>
                )}
              </button>

              {item.kind === "file" && (
                <button
                  type="button"
                  className="ui-btn ui-btn-secondary ui-btn-sm command-result-insert"
                  title="作为附件插入当前对话输入框 (Shift+Enter)"
                  onClick={() => void executeFileInsert(item.file, item.workspace)}
                >
                  插入对话
                </button>
              )}
            </div>
          );
        })}

        {!rows.length && (
          <p className="empty-copy">
            {mode === "files" && !activeWorkspace
              ? "请先打开一个项目工作区再搜索文件"
              : "没有匹配的会话、文件或命令"}
          </p>
        )}
      </div>

      <small className="command-search-hint">
        ↑ ↓ 选择 · Enter 打开{mode === "files" ? " · Shift+Enter 插入对话" : ""} · Ctrl+1..9 速选 · Esc 关闭（取消主题预览）
      </small>
    </UiDialog>
  );
}
