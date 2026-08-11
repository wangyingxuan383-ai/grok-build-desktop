import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AppSettings, WorkspaceSource, WorkspaceSummary } from "../../shared/types";
import type { ClaudeSessionCatalog } from "./claude-session-catalog";
import type { CodexSessionCatalog } from "./codex-session-catalog";
import { JsonStore } from "./json-store";
import { resolveProjectIdentity } from "./project-identity";

interface WorkspaceMetadata {
  /** Values remain paths so old path-keyed metadata migrates without data loss. */
  pinned: Record<string, string>;
  hidden?: Record<string, string | { cwd: string; hiddenAt: string }>;
}

interface WorkspaceObservation {
  cwd: string;
  source?: WorkspaceSource;
  sessionId?: string;
  lastUsedAt?: string;
}

interface MutableWorkspace extends WorkspaceSummary {
  sourceSet: Set<WorkspaceSource>;
  grokIds: Set<string>;
  codexIds: Set<string>;
  claudeIds: Set<string>;
}

export class WorkspaceCatalog {
  private readonly metadata: JsonStore<WorkspaceMetadata>;
  private cache?: { at: number; rows: WorkspaceSummary[] };

  constructor(
    userDataPath: string,
    private readonly codex: CodexSessionCatalog,
    private readonly claude: ClaudeSessionCatalog,
    private readonly grokHome = join(homedir(), ".grok"),
  ) {
    this.metadata = new JsonStore(join(userDataPath, "workspace-metadata.json"), { pinned: {}, hidden: {} });
  }

  async discover(settings: AppSettings, force = false, includeHidden = false): Promise<WorkspaceSummary[]> {
    if (!force && this.cache && Date.now() - this.cache.at < 30_000) return filterRows(this.cache.rows, includeHidden);
    const metadata = await this.metadata.get();
    const observations: WorkspaceObservation[] = [];
    const pinnedPaths = Object.values(metadata.pinned ?? {}).filter(Boolean);
    const hiddenPaths = Object.values(metadata.hidden ?? {}).map((value) => typeof value === "string" ? value : value.cwd).filter(Boolean);
    observations.push(...pinnedPaths.map((cwd) => ({ cwd, source: "pinned" as const })));
    observations.push(...hiddenPaths.map((cwd) => ({ cwd })));
    observations.push(...settings.recentWorkspaces.filter(Boolean).map((cwd) => ({ cwd, source: "recent" as const })));
    if (settings.activeWorkspace) observations.push({ cwd: settings.activeWorkspace, source: "recent" });

    const grokRoot = join(this.grokHome, "sessions");
    const grokEntries = await readdir(grokRoot, { withFileTypes: true }).catch(() => []);
    for (const entry of grokEntries) {
      if (!entry.isDirectory()) continue;
      let cwd = "";
      try { cwd = decodeURIComponent(entry.name); } catch { continue; }
      const directory = join(grokRoot, entry.name);
      const sessionEntries = await readdir(directory, { withFileTypes: true }).catch(() => []);
      const directoryStat = await stat(directory).catch(() => undefined);
      const sessions = sessionEntries.filter((value) => value.isDirectory());
      if (!sessions.length) observations.push({ cwd, source: "grok", lastUsedAt: directoryStat?.mtime.toISOString() });
      else for (const session of sessions) observations.push({ cwd, source: "grok", sessionId: session.name, lastUsedAt: directoryStat?.mtime.toISOString() });
    }

    for (const session of await this.codex.listAll(force)) observations.push({ cwd: session.cwd, source: "codex", sessionId: session.id, lastUsedAt: session.updatedAt });
    for (const session of await this.claude.listAll(force)) observations.push({ cwd: session.cwd, source: "claude", sessionId: session.id, lastUsedAt: session.updatedAt });

    const [pinnedIdentities, hiddenIdentities, resolvedObservations] = await Promise.all([
      Promise.all(pinnedPaths.map((value) => resolveProjectIdentity(value))),
      Promise.all(hiddenPaths.map((value) => resolveProjectIdentity(value))),
      Promise.all(observations.map(async (observation) => ({ observation, identity: await resolveProjectIdentity(observation.cwd) }))),
    ]);
    const pinnedIds = new Set(pinnedIdentities.map((value) => value.id));
    const hiddenIds = new Set(hiddenIdentities.map((value) => value.id));
    const rows = new Map<string, MutableWorkspace>();
    for (const { observation, identity } of resolvedObservations) {
      const current = rows.get(identity.id) ?? {
        projectId: identity.id,
        cwd: identity.canonicalPath,
        displayPath: identity.displayPath,
        canonicalPath: identity.canonicalPath,
        name: identity.name,
        exists: identity.exists,
        hidden: hiddenIds.has(identity.id),
        pinned: pinnedIds.has(identity.id),
        sources: [],
        sourceSet: new Set<WorkspaceSource>(),
        grokIds: new Set<string>(),
        codexIds: new Set<string>(),
        claudeIds: new Set<string>(),
        grokSessions: 0,
        codexSessions: 0,
        claudeSessions: 0,
        draftCount: 0,
        activeSessions: 0,
        diagnostic: identity.diagnostic,
      };
      // Prefer a path which currently exists. Preserve the first user-facing
      // spelling separately while all operations use the canonical target.
      if (!current.exists && identity.exists) {
        current.cwd = identity.canonicalPath;
        current.canonicalPath = identity.canonicalPath;
        current.name = identity.name;
        current.exists = true;
        current.diagnostic = undefined;
      }
      if (observation.source) current.sourceSet.add(observation.source);
      if (observation.sessionId) {
        if (observation.source === "grok") current.grokIds.add(observation.sessionId);
        if (observation.source === "codex") current.codexIds.add(observation.sessionId);
        if (observation.source === "claude") current.claudeIds.add(observation.sessionId);
      }
      current.lastUsedAt = maxDate(current.lastUsedAt, observation.lastUsedAt);
      rows.set(identity.id, current);
    }

    const result = Array.from(rows.values()).map((row): WorkspaceSummary => ({
      ...row,
      pinned: pinnedIds.has(row.projectId),
      hidden: hiddenIds.has(row.projectId),
      sources: Array.from(row.sourceSet),
      grokSessions: row.grokIds.size,
      codexSessions: row.codexIds.size,
      claudeSessions: row.claudeIds.size,
      sourceSet: undefined,
      grokIds: undefined,
      codexIds: undefined,
      claudeIds: undefined,
    } as WorkspaceSummary));
    result.sort((a, b) => Number(b.pinned) - Number(a.pinned) || (b.lastUsedAt || "").localeCompare(a.lastUsedAt || "") || a.name.localeCompare(b.name));
    this.cache = { at: Date.now(), rows: result };
    return filterRows(result, includeHidden);
  }

  async pin(cwd: string, pinned: boolean, settings: AppSettings): Promise<WorkspaceSummary[]> {
    const identity = await resolveProjectIdentity(cwd);
    await this.metadata.mutate((data) => {
      data.pinned ??= {};
      for (const [key, value] of Object.entries(data.pinned)) {
        if (key === identity.id || sameLexicalPath(value, cwd)) delete data.pinned[key];
      }
      if (pinned) data.pinned[identity.id] = identity.displayPath;
    });
    this.cache = undefined;
    return this.discover(settings, true);
  }

  async setHidden(cwd: string, hidden: boolean, settings: AppSettings): Promise<WorkspaceSummary[]> {
    const identity = await resolveProjectIdentity(cwd);
    await this.metadata.mutate((data) => {
      data.hidden ??= {};
      for (const [key, value] of Object.entries(data.hidden)) {
        const path = typeof value === "string" ? value : value.cwd;
        if (key === identity.id || sameLexicalPath(path, cwd)) delete data.hidden[key];
      }
      if (hidden) data.hidden[identity.id] = { cwd: identity.displayPath, hiddenAt: new Date().toISOString() };
    });
    this.cache = undefined;
    return this.discover(settings, true, false);
  }
}

function filterRows(rows: WorkspaceSummary[], includeHidden: boolean): WorkspaceSummary[] {
  return structuredClone(includeHidden ? rows : rows.filter((row) => !row.hidden));
}

function sameLexicalPath(left: string, right: string): boolean {
  return left.replace(/[\\/]+$/, "").toLocaleLowerCase() === right.replace(/[\\/]+$/, "").toLocaleLowerCase();
}

function maxDate(left?: string, right?: string): string | undefined {
  if (!left) return right;
  if (!right) return left;
  return left.localeCompare(right) >= 0 ? left : right;
}
