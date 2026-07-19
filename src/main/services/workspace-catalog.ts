import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import type { AppSettings, WorkspaceSource, WorkspaceSummary } from "../../shared/types";
import type { CodexSessionCatalog } from "./codex-session-catalog";
import { JsonStore } from "./json-store";

interface WorkspaceMetadata {
  pinned: Record<string, string>;
}

interface MutableWorkspace extends WorkspaceSummary {
  sourceSet: Set<WorkspaceSource>;
}

export class WorkspaceCatalog {
  private readonly metadata: JsonStore<WorkspaceMetadata>;
  private cache?: { at: number; rows: WorkspaceSummary[] };

  constructor(
    userDataPath: string,
    private readonly codex: CodexSessionCatalog,
    private readonly grokHome = join(homedir(), ".grok"),
  ) {
    this.metadata = new JsonStore(join(userDataPath, "workspace-metadata.json"), { pinned: {} });
  }

  async discover(settings: AppSettings, force = false): Promise<WorkspaceSummary[]> {
    if (!force && this.cache && Date.now() - this.cache.at < 30_000) return structuredClone(this.cache.rows);
    const metadata = await this.metadata.get();
    const rows = new Map<string, MutableWorkspace>();
    const add = (cwd: string, source: WorkspaceSource, patch: Partial<WorkspaceSummary> = {}): void => {
      if (!cwd) return;
      const key = normalize(cwd);
      const current = rows.get(key) ?? {
        cwd, name: basename(cwd) || cwd, exists: false, pinned: false, sources: [], sourceSet: new Set<WorkspaceSource>(),
        grokSessions: 0, codexSessions: 0,
      };
      current.sourceSet.add(source);
      Object.assign(current, patch);
      rows.set(key, current);
    };

    for (const cwd of Object.values(metadata.pinned)) add(cwd, "pinned", { pinned: true });
    for (const cwd of settings.recentWorkspaces) add(cwd, "recent");
    if (settings.activeWorkspace) add(settings.activeWorkspace, "recent");

    const grokRoot = join(this.grokHome, "sessions");
    const grokEntries = await readdir(grokRoot, { withFileTypes: true }).catch(() => []);
    for (const entry of grokEntries) {
      if (!entry.isDirectory()) continue;
      let cwd = "";
      try { cwd = decodeURIComponent(entry.name); } catch { continue; }
      const sessionEntries = await readdir(join(grokRoot, entry.name), { withFileTypes: true }).catch(() => []);
      const sessionDirs = sessionEntries.filter((value) => value.isDirectory());
      const directoryStat = await stat(join(grokRoot, entry.name)).catch(() => undefined);
      add(cwd, "grok", { grokSessions: sessionDirs.length, lastUsedAt: directoryStat?.mtime.toISOString() });
    }

    for (const session of await this.codex.listAll(force)) {
      const key = normalize(session.cwd);
      const existing = rows.get(key);
      add(session.cwd, "codex", {
        codexSessions: (existing?.codexSessions ?? 0) + 1,
        lastUsedAt: maxDate(existing?.lastUsedAt, session.updatedAt),
      });
    }

    const resolved = await Promise.all(Array.from(rows.values()).map(async (row): Promise<WorkspaceSummary> => ({
      ...row,
      exists: await stat(row.cwd).then((value) => value.isDirectory()).catch(() => false),
      sources: Array.from(row.sourceSet),
      sourceSet: undefined,
    } as WorkspaceSummary)));
    resolved.sort((a, b) => Number(b.pinned) - Number(a.pinned) || (b.lastUsedAt || "").localeCompare(a.lastUsedAt || "") || a.name.localeCompare(b.name));
    this.cache = { at: Date.now(), rows: resolved };
    return structuredClone(resolved);
  }

  async pin(cwd: string, pinned: boolean, settings: AppSettings): Promise<WorkspaceSummary[]> {
    const data = await this.metadata.get();
    const key = normalize(cwd);
    if (pinned) data.pinned[key] = cwd;
    else delete data.pinned[key];
    await this.metadata.set(data);
    this.cache = undefined;
    return this.discover(settings, true);
  }
}

function normalize(value: string): string {
  return value.replace(/[\\/]+$/, "").toLocaleLowerCase();
}

function maxDate(left?: string, right?: string): string | undefined {
  if (!left) return right;
  if (!right) return left;
  return left.localeCompare(right) >= 0 ? left : right;
}
