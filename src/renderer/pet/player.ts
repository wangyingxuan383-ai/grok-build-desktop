import type { PetAction, PetClip, PetClipId, PetFrame, PetSkin, PetSnapshot, PetTarget } from "../../shared/desktop-pet";

const oneShots = new Set<PetClipId>(["pickup", "success", "pat", "wave", "enter", "exit"]);
const priority: Record<PetTarget["status"], number> = { awaiting: 0, error: 1, completed: 2, running: 3 };

export function sortedTargets(targets: readonly PetTarget[]): PetTarget[] {
  return targets.map((target, index) => ({ target, index }))
    .sort((a, b) => priority[a.target.status] - priority[b.target.status] || a.index - b.index).map(value => value.target);
}

export function navigationTarget(targets: readonly PetTarget[]): PetTarget | "card" | undefined {
  const sorted = sortedTargets(targets);
  const first = sorted[0];
  return first && sorted[1]?.status === first.status ? "card" : first;
}

export function assetUrl(file: string, skinId: string): string | undefined {
  // Accept only main-supplied, local raster URLs. No file:, HTTP, SVG or traversal.
  if (!file.startsWith("grok-pet://assets/")) return undefined;
  try {
    const url = new URL(file);
    const parts = url.pathname.split("/").slice(1).map(decodeURIComponent);
    if (url.username || url.password || url.port || url.search || url.hash || parts.length !== 2 || parts[0] !== skinId ||
      !/^[a-zA-Z0-9_-]+$/.test(skinId) || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.(png|webp)$/i.test(parts[1] ?? "") ||
      file.includes("\\") || /(?:^|\/)\.{1,2}(?:\/|$)/.test(decodeURIComponent(file))) return undefined;
    return url.href;
  } catch { return undefined; }
}

export function usableClip(clip: PetClip | undefined, skinId: string): clip is PetClip {
  return !!clip && !!assetUrl(clip.file, skinId) && Number.isFinite(clip.referenceHeight) && clip.referenceHeight > 0 &&
    Number.isFinite(clip.width) && clip.width > 0 && Number.isFinite(clip.height) && clip.height > 0 &&
    clip.frames.length > 0 && clip.frames.every(frame =>
      [frame.x, frame.y, frame.width, frame.height, frame.anchorX, frame.anchorY, frame.duration].every(Number.isFinite) &&
      frame.x >= 0 && frame.y >= 0 && frame.width > 0 && frame.height > 0 && frame.duration > 0 &&
      frame.x + frame.width <= clip.width && frame.y + frame.height <= clip.height);
}

export function selectClip(skin: PetSkin, requested: PetClipId): { id: PetClipId; clip: PetClip } | undefined {
  const fallbacks: PetClipId[] = [requested, "idle"];
  for (const id of fallbacks) {
    const clip = skin.clips[id];
    if (usableClip(clip, skin.id)) return { id, clip };
  }
  return undefined;
}

export interface FramePlacement { x: number; y: number; width: number; height: number; }
export function placeFrame(frame: PetFrame, referenceHeight: number, size: number, viewportWidth: number, viewportHeight: number): FramePlacement {
  const scale = size / referenceHeight;
  return { x: viewportWidth / 2 - frame.anchorX * scale, y: viewportHeight - 14 - frame.anchorY * scale,
    width: frame.width * scale, height: frame.height * scale };
}

export interface PlayerSample {
  clip?: PetClip;
  frame?: PetFrame;
  index: number;
  progress: number;
  opacity: number;
  nextAt?: number;
  ended?: Extract<PetAction, { type: "animation-end" }>;
}

/** The main process owns transitions; ordinary status revisions never restart a clip. */
export class PetPlayer {
  private key = "";
  private started = 0;
  private pausedAt: number | undefined;
  private reduced = false;
  private frozenIndex = 0;
  private reported = false;
  private snapshot?: PetSnapshot;
  private selected?: ReturnType<typeof selectClip>;

  set(snapshot: PetSnapshot, now: number, reduced: boolean): void {
    let selected = selectClip(snapshot.skin, snapshot.visibility === "entering" ? "enter" : snapshot.visibility === "exiting" ? "exit" : snapshot.clip);
    if(reduced&&(snapshot.visibility==="entering"||snapshot.visibility==="exiting"))selected=selectClip(snapshot.skin,"idle");
    if(selected&&snapshot.clip==="pickup"&&snapshot.gesture){const frames=selected.clip.frames;selected={id:selected.id,clip:{...selected.clip,frames:snapshot.gesture==="dragging"?[{...frames[Math.min(1,frames.length-1)]!,duration:10000}]:frames.slice(Math.min(2,frames.length-1))}};}
    const key = `${snapshot.transition}:${snapshot.visibility}:${snapshot.clip}:${snapshot.skin.id}:${snapshot.gesture}:${selected?.clip.file ?? ""}`;
    if (key !== this.key) {
      this.key = key; this.started = now; this.reported = false; this.frozenIndex = 0;
      if (this.pausedAt !== undefined) this.pausedAt = now;
    } else if (reduced && !this.reduced) {
      this.frozenIndex = this.frameIndex(this.elapsed(now));
    } else if (!reduced && this.reduced && this.selected) {
      // Resume from the held frame, without replaying the beginning of a loop.
      if (this.loops()) {
        const elapsed = this.selected.clip.frames.slice(0, this.frozenIndex).reduce((sum, frame) => sum + frame.duration, 0);
        this.started = (this.pausedAt ?? now) - elapsed;
      }
    }
    this.snapshot = snapshot; this.selected = selected; this.reduced = reduced;
  }

  suspend(now: number): void { this.pausedAt ??= now; }
  resume(now: number): void {
    if (this.pausedAt !== undefined) { this.started += now - this.pausedAt; this.pausedAt = undefined; }
  }
  private elapsed(now: number): number { return Math.max(0, (this.pausedAt ?? now) - this.started); }
  private duration(): number { return this.selected?.clip.frames.reduce((sum, frame) => sum + frame.duration, 0) ?? 400; }
  private lifetime(): number {
    const duration = this.duration();
    if((this.snapshot?.visibility==="entering"||this.snapshot?.visibility==="exiting")&&(this.reduced||this.selected?.id!==this.snapshot.clip))return 120;
    return this.snapshot?.visibility === "entering" ? Math.min(1000, duration) : this.snapshot?.visibility === "exiting" ? Math.min(800, duration) : duration;
  }
  private loops(): boolean {
    return this.snapshot?.visibility === "visible" && !!this.selected?.clip.loop && !oneShots.has(this.snapshot.clip);
  }
  private frameIndex(elapsed: number): number {
    const frames = this.selected?.clip.frames;
    if (!frames) return 0;
    const duration = this.duration();
    let position = this.loops() ? elapsed % duration : Math.min(duration - 0.001, elapsed * duration / this.lifetime());
    for (let index = 0; index < frames.length; index++) {
      position -= frames[index]!.duration;
      if (position < 0) return index;
    }
    return frames.length - 1;
  }

  sample(now: number): PlayerSample {
    const snapshot = this.snapshot;
    if (!snapshot || snapshot.visibility === "hidden") return { index: 0, progress: 0, opacity: 0 };
    const elapsed = this.elapsed(now), lifetime = this.lifetime(), loops = this.loops();
    const complete = !loops && elapsed >= lifetime;
    const index = this.reduced ? this.frozenIndex : this.frameIndex(elapsed);
    const progress = Math.min(1, elapsed / lifetime);
    const transitioning = snapshot.visibility === "entering" || snapshot.visibility === "exiting";
    let nextAt: number | undefined;
    if (this.pausedAt === undefined && !complete) {
      if (!loops) nextAt = now + lifetime - elapsed;
      const clip = this.selected?.clip;
      if (!this.reduced && clip && clip.frames.length > 1) {
        const duration = this.duration();
        const boundary = clip.frames.slice(0, index + 1).reduce((sum, frame) => sum + frame.duration, 0);
        const untilFrame = loops ? boundary - elapsed % duration : boundary * lifetime / duration - elapsed;
        nextAt = Math.min(nextAt ?? Infinity, now + Math.max(1, untilFrame));
      }
      if (transitioning) nextAt = Math.min(nextAt ?? Infinity, now + 1000 / 30);
    }
    let ended: PlayerSample["ended"];
    if (complete && !this.reported && this.pausedAt === undefined) {
      this.reported = true;
      ended = { type: "animation-end", transition: snapshot.transition, clip: snapshot.clip };
    }
    const opacity = snapshot.visibility === "entering" ? Math.min(1, elapsed / Math.min(160,lifetime)) :
      snapshot.visibility === "exiting" ? Math.min(1, Math.max(0, (lifetime - elapsed) / Math.min(180, lifetime))) : 1;
    return { clip: this.selected?.clip, frame: this.selected?.clip.frames[index], index, progress, opacity, nextAt, ended };
  }
}
