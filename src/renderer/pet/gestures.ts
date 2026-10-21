import type { PetAction } from "../../shared/desktop-pet";

export const DRAG_THRESHOLD = 6;
export const DOUBLE_CLICK_MS = 500;
export const LONG_PRESS_MS = 500;
export const HOVER_MS = 350;
export type GestureEffect = PetAction | { type: "activate" } | { type: "hover-open" | "hover-close" };
interface Point { x: number; y: number; }
interface Press extends Point { id: number; part: "head" | "body"; at: number; locked: boolean; moved: boolean; consumed: boolean; double: boolean; }
interface Click extends Point { part: "head" | "body"; due: number; }

/** All coordinates are CSS pixels (DIP); only drag phases cross IPC. */
export class PetGestures {
  doubleClickTime = DOUBLE_CLICK_MS;
  private press?: Press;
  private click?: Click;
  private hoverDue?: number;
  private closeDue?: number;
  private hovering = false;
  private toolbar = false;
  private dragging = false;
  constructor(private readonly emit: (effect: GestureEffect) => void) {}
  get captured(): boolean { return this.press !== undefined; }
  get isDragging(): boolean { return this.dragging; }

  hover(inside: boolean, now: number): void {
    if (inside === this.hovering) return;
    this.hovering = inside;
    if (inside) { this.closeDue = undefined; if (!this.toolbar) this.hoverDue = now + HOVER_MS; }
    else { this.hoverDue = undefined; if (this.toolbar) this.closeDue = now + HOVER_MS; }
  }

  down(id: number, point: Point, part: Press["part"], locked: boolean, now: number): boolean {
    if (this.press) return false;
    const double = !!this.click && now < this.click.due && Math.hypot(point.x - this.click.x, point.y - this.click.y) < DRAG_THRESHOLD;
    if (this.click && !double) this.emit({ type: "interact", part: this.click.part });
    this.click = undefined;
    this.press = { ...point, id, part, locked, at: now, moved: false, consumed: false, double };
    this.hoverDue = undefined;
    return true;
  }

  move(id: number, point: Point): void {
    const press = this.press;
    if (!press || press.id !== id || press.consumed) return;
    if (!press.moved && Math.hypot(point.x - press.x, point.y - press.y) >= DRAG_THRESHOLD) {
      press.moved = true;
      this.click = undefined;
      if (!press.locked) {
        this.dragging = true; this.closeToolbar();
        this.emit({ type: "drag", phase: "start" });
      }
    }
    if (this.dragging) this.emit({ type: "drag", phase: "move" });
  }

  up(id: number, now: number): void {
    const press = this.press;
    if (!press || press.id !== id) return;
    this.press = undefined;
    if (this.dragging) { this.dragging = false; this.emit({ type: "drag", phase: "end" }); }
    else if (!press.moved && !press.consumed) {
      if (press.double) this.emit({ type: "activate" });
      else this.click = { x: press.x, y: press.y, part: press.part, due: now + this.doubleClickTime };
    }
    if (this.hovering && !this.toolbar) this.hoverDue = now + HOVER_MS;
  }

  context(): void { this.cancel(); this.emit({ type: "menu" }); }
  cancel(): void {
    this.press = undefined; this.click = undefined; this.hoverDue = undefined; this.closeDue = undefined; this.hovering = false;
    if (this.dragging) { this.dragging = false; this.emit({ type: "drag", phase: "end" }); }
    this.closeToolbar();
  }
  private closeToolbar(): void {
    this.hoverDue = undefined; this.closeDue = undefined;
    if (this.toolbar) { this.toolbar = false; this.emit({ type: "hover-close" }); }
  }

  tick(now: number): void {
    if (this.press && !this.press.moved && !this.press.consumed && now >= this.press.at + LONG_PRESS_MS) {
      this.press.consumed = true; this.click = undefined; this.closeToolbar(); this.emit({ type: "menu" });
    }
    if (this.click && now >= this.click.due) { const click = this.click; this.click = undefined; this.emit({ type: "interact", part: click.part }); }
    if (this.hoverDue !== undefined && now >= this.hoverDue) {
      this.hoverDue = undefined;
      if (!this.press && !this.dragging) { this.toolbar = true; this.emit({ type: "hover-open" }); }
    }
    if (this.closeDue !== undefined && now >= this.closeDue) this.closeToolbar();
  }

  get nextAt(): number | undefined {
    const longPress = this.press && !this.press.moved && !this.press.consumed ? this.press.at + LONG_PRESS_MS : Infinity;
    const next = Math.min(longPress, this.click?.due ?? Infinity, this.hoverDue ?? Infinity, this.closeDue ?? Infinity);
    return Number.isFinite(next) ? next : undefined;
  }
}
