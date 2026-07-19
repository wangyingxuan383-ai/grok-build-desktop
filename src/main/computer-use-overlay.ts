import { BrowserWindow, globalShortcut, screen } from "electron";
import type { Rectangle } from "electron";
import type { ComputerTaskState } from "../shared/types";

const ACTIVE_STATUSES = new Set<ComputerTaskState["status"]>(["running", "paused", "awaiting-risk-confirmation"]);

export function isComputerTaskVisiblyActive(task: ComputerTaskState): boolean {
  return ACTIVE_STATUSES.has(task.status);
}

export function renderComputerOverlayHtml(task: ComputerTaskState, displayBounds: Rectangle, escRegistered: boolean): string {
  const appName = escapeHtml(task.appName || "Windows 应用");
  const message = escapeHtml(task.message || "Grok 正在观察目标窗口");
  const paused = task.status === "paused";
  const risk = task.status === "awaiting-risk-confirmation";
  const pointer = task.pointer && task.pointer.x >= displayBounds.x && task.pointer.x < displayBounds.x + displayBounds.width && task.pointer.y >= displayBounds.y && task.pointer.y < displayBounds.y + displayBounds.height
    ? `<div class="pointer ${task.pointer.action.includes("click") ? "clicking" : ""}" style="left:${Math.round(task.pointer.x - displayBounds.x)}px;top:${Math.round(task.pointer.y - displayBounds.y)}px" aria-hidden="true"><i></i></div>`
    : "";
  const stateLabel = risk ? "等待确认" : paused ? (task.manualInterventionRequired ? "等待手动确认" : "已暂停") : "正在控制";
  const stopLabel = escRegistered ? "Esc 停止" : "Ctrl+Alt+Esc 停止";
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>Grok Computer Use Active</title>
<style>
*{box-sizing:border-box}html,body{width:100%;height:100%;margin:0;overflow:hidden;background:transparent;font-family:"Segoe UI","Microsoft YaHei UI",sans-serif;user-select:none}
.frame{position:fixed;inset:0;border:4px solid #36a8ff;border-radius:9px;box-shadow:inset 0 0 22px rgba(37,154,255,.9),inset 0 0 4px #bde7ff;animation:glow 1.8s ease-in-out infinite;pointer-events:none}
.banner{position:absolute;left:50%;top:10px;transform:translateX(-50%);display:flex;align-items:center;gap:10px;max-width:min(860px,calc(100vw - 40px));padding:8px 13px;border:1px solid rgba(127,207,255,.75);border-radius:10px;background:rgba(5,20,34,.94);box-shadow:0 7px 28px rgba(0,0,0,.38),0 0 16px rgba(37,154,255,.45);color:#f4fbff;font-size:13px;line-height:1.25;white-space:nowrap}
.dot{width:9px;height:9px;border-radius:50%;background:${paused || risk ? "#ffc857" : "#45c4ff"};box-shadow:0 0 10px currentColor;flex:none}.state{font-weight:700;color:#8fd7ff}.app{font-weight:650;overflow:hidden;text-overflow:ellipsis}.message{color:#c3d6e4;overflow:hidden;text-overflow:ellipsis}.steps{color:#90a8b9;flex:none}.key{padding:2px 6px;border:1px solid #61829a;border-bottom-width:2px;border-radius:5px;background:#102d42;color:#dff5ff;font-weight:650;flex:none}
.pointer{position:absolute;width:28px;height:28px;margin:-14px 0 0 -14px;border:2px solid #71d2ff;border-radius:50%;box-shadow:0 0 0 5px rgba(40,169,255,.22),0 0 18px #159eff;animation:pointerPulse .8s ease-out infinite}.pointer i{position:absolute;left:11px;top:11px;width:3px;height:3px;border-radius:50%;background:#fff}.pointer.clicking{border-color:#fff;box-shadow:0 0 0 6px rgba(38,171,255,.32),0 0 22px #31b4ff}
@keyframes glow{50%{border-color:#77cbff;box-shadow:inset 0 0 30px rgba(37,154,255,1),inset 0 0 7px #fff}}@keyframes pointerPulse{70%{transform:scale(1.22);opacity:.7}}
</style></head><body><div class="frame" data-computer-overlay="active"><div class="banner"><span class="dot"></span><span class="state">${stateLabel}</span><span class="app">Grok · ${appName}</span><span class="message">${message}</span><span class="steps">${task.stepCount} 步</span><span class="key">${stopLabel}</span></div>${pointer}</div></body></html>`;
}

export class ComputerUseOverlay {
  private readonly tasks = new Map<string, ComputerTaskState>();
  private overlay?: BrowserWindow;
  private escRegistered = false;
  private disposed = false;

  constructor(private readonly stop: (source: string) => void) {}

  update(task: ComputerTaskState): void {
    if (this.disposed) return;
    if (isComputerTaskVisiblyActive(task)) this.tasks.set(task.sessionId, { ...task });
    else this.tasks.delete(task.sessionId);
    this.refresh();
  }

  dispose(): void {
    this.disposed = true;
    this.tasks.clear();
    this.unregisterEsc();
    this.overlay?.destroy();
    this.overlay = undefined;
  }

  private refresh(): void {
    const task = Array.from(this.tasks.values()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    if (!task) {
      this.unregisterEsc();
      this.overlay?.destroy();
      this.overlay = undefined;
      return;
    }
    if (!this.escRegistered) this.escRegistered = globalShortcut.register("Esc", () => this.stop("Esc"));
    const targetBounds = task.lastState?.window.bounds;
    const display = targetBounds ? screen.getDisplayMatching(targetBounds) : screen.getPrimaryDisplay();
    const bounds = display.bounds;
    if (!this.overlay || this.overlay.isDestroyed()) {
      this.overlay = new BrowserWindow({
        x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height,
        transparent: true, frame: false, show: false, focusable: false, resizable: false,
        movable: false, minimizable: false, maximizable: false, closable: false,
        skipTaskbar: true, hasShadow: false, roundedCorners: false,
        webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
      });
      this.overlay.setIgnoreMouseEvents(true, { forward: true });
      this.overlay.setAlwaysOnTop(true, "floating");
    } else this.overlay.setBounds(bounds, false);
    const html = renderComputerOverlayHtml(task, bounds, this.escRegistered);
    const overlay = this.overlay;
    void overlay.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`).then(() => {
      if (!overlay.isDestroyed()) overlay.showInactive();
    }).catch(() => undefined);
  }

  private unregisterEsc(): void {
    if (!this.escRegistered) return;
    globalShortcut.unregister("Esc");
    this.escRegistered = false;
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character] || character));
}
