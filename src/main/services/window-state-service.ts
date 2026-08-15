import type { BrowserWindow, Rectangle } from "electron";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface PersistedWindowState extends Rectangle { maximized: boolean; }

const DEFAULT_STATE: PersistedWindowState = { x: 0, y: 0, width: 1440, height: 920, maximized: false };

/** Persists only geometry; no session, workspace or display names enter this file. */
export class WindowStateService {
  readonly path: string;
  private saveTimer?: NodeJS.Timeout;

  constructor(userDataPath: string) { this.path = join(userDataPath, "window-state.json"); }

  async load(workAreas: Rectangle[]): Promise<PersistedWindowState> {
    const value = await readFile(this.path, "utf8").then((text) => JSON.parse(text) as Partial<PersistedWindowState>).catch(() => undefined);
    return normalizeWindowState(value, workAreas);
  }

  scheduleSave(window: BrowserWindow): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => { this.saveTimer = undefined; void this.save(window); }, 250);
  }

  async save(window: BrowserWindow): Promise<void> {
    if (window.isDestroyed() || window.isMinimized() || window.isFullScreen()) return;
    const bounds = window.getNormalBounds();
    await this.write({ ...bounds, maximized: window.isMaximized() });
  }

  async reset(): Promise<void> {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = undefined;
    await rm(this.path, { force: true });
  }

  async dispose(window?: BrowserWindow): Promise<void> {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = undefined;
    if (window) await this.save(window);
  }

  private async write(value: PersistedWindowState): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${process.pid}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify(value)}\n`, "utf8");
      await rename(temporary, this.path);
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
  }
}

export function normalizeWindowState(value: Partial<PersistedWindowState> | undefined, workAreas: Rectangle[]): PersistedWindowState {
  const width = boundedInteger(value?.width, 820, 7680, DEFAULT_STATE.width);
  const height = boundedInteger(value?.height, 620, 4320, DEFAULT_STATE.height);
  const candidates = workAreas.filter(validRectangle);
  if (!candidates.length) return { ...DEFAULT_STATE, width, height };
  const x = finiteInteger(value?.x);
  const y = finiteInteger(value?.y);
  if (x !== undefined && y !== undefined) {
    const state = { x, y, width, height, maximized: value?.maximized === true };
    if (candidates.some((area) => intersectsVisibleArea(state, area))) return state;
  }
  const primary = candidates[0]!;
  return {
    x: primary.x + Math.max(0, Math.floor((primary.width - Math.min(width, primary.width)) / 2)),
    y: primary.y + Math.max(0, Math.floor((primary.height - Math.min(height, primary.height)) / 2)),
    width: Math.min(width, primary.width),
    height: Math.min(height, primary.height),
    maximized: false,
  };
}

function intersectsVisibleArea(window: Rectangle, area: Rectangle): boolean {
  const overlapWidth = Math.max(0, Math.min(window.x + window.width, area.x + area.width) - Math.max(window.x, area.x));
  const overlapHeight = Math.max(0, Math.min(window.y + window.height, area.y + area.height) - Math.max(window.y, area.y));
  return overlapWidth >= 96 && overlapHeight >= 64;
}
function validRectangle(value: Rectangle): boolean { return [value.x, value.y, value.width, value.height].every(Number.isFinite) && value.width > 0 && value.height > 0; }
function finiteInteger(value: unknown): number | undefined { return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : undefined; }
function boundedInteger(value: unknown, min: number, max: number, fallback: number): number { const parsed = finiteInteger(value); return parsed === undefined ? fallback : Math.max(min, Math.min(max, parsed)); }
