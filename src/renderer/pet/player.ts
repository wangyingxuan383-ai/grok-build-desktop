import type { PetAction, PetClip, PetClipId, PetFrame, PetSkin, PetSnapshot, PetTarget } from "../../shared/desktop-pet";

const oneShots = new Set<PetClipId>(["pickup", "success", "pat", "wave", "poke", "stretch", "enter", "exit"]);
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
      !/^[a-zA-Z0-9_-]+$/.test(skinId) || !/^[a-zA-Z0-9_-][a-zA-Z0-9._-]*\.(png|webp)$/i.test(parts[1] ?? "") ||
      file.includes("\\") || /(?:^|\/)\.{1,2}(?:\/|$)/.test(decodeURIComponent(file))) return undefined;
    return url.href;
  } catch { return undefined; }
}

export function usableClip(clip: PetClip | undefined, skinId: string): clip is PetClip {
  return !!clip && !!assetUrl(clip.file, skinId) && Number.isFinite(clip.referenceHeight) && clip.referenceHeight > 0 &&
    Number.isFinite(clip.width) && clip.width > 0 && Number.isFinite(clip.height) && clip.height > 0 &&
    (clip.loopFrom === undefined || (Number.isInteger(clip.loopFrom) && clip.loopFrom >= 0 && clip.loopFrom < clip.frames.length)) &&
    clip.frames.length > 0 && clip.frames.every(frame =>
      [frame.x, frame.y, frame.width, frame.height, frame.anchorX, frame.anchorY, frame.duration].every(Number.isFinite) &&
      frame.x >= 0 && frame.y >= 0 && frame.width > 0 && frame.height > 0 && frame.duration > 0 &&
      frame.x + frame.width <= clip.width && frame.y + frame.height <= clip.height);
}

export function selectClip(skin: PetSkin, requested: PetClipId): { id: PetClipId; clip: PetClip } | undefined {
  const fallbacks: PetClipId[] = requested === "poke" || requested === "stretch"
    ? [requested, "wave", "idle"]
    : [requested, "idle"];
  for (const id of fallbacks) {
    const clip = skin.clips[id];
    if (usableClip(clip, skin.id)) return { id, clip };
  }
  return undefined;
}

export interface FramePlacement { x: number; y: number; width: number; height: number; }
export function petControlsLayout(viewportHeight: number, visibleTop = 0, crownHeight?: number): { toolbarTop: number; cardTop: number; cardHeight: number } {
  const defaultToolbarTop = crownHeight !== undefined
    ? Math.max(10, Math.min(176, Math.round(viewportHeight - 14 - crownHeight - 40)))
    : 176;
  if (visibleTop <= 0) {
    const cardHeight = Math.max(48, Math.min(156, defaultToolbarTop - 20));
    return { toolbarTop: defaultToolbarTop, cardTop: 10, cardHeight };
  }
  const toolbarTop = Math.min(viewportHeight - 42, Math.max(defaultToolbarTop, visibleTop + 6));
  const cardTop = toolbarTop + 44;
  return { toolbarTop, cardTop, cardHeight: Math.max(48, Math.min(156, viewportHeight - cardTop - 8)) };
}

export function placeFrame(frame: PetFrame, referenceHeight: number, size: number, viewportWidth: number, viewportHeight: number): FramePlacement {
  const scale = size / referenceHeight;
  return { x: viewportWidth / 2 - frame.anchorX * scale, y: viewportHeight - 14 - frame.anchorY * scale,
    width: frame.width * scale, height: frame.height * scale };
}

export interface PlayerSample {
  clip?: PetClip;
  frame?: PetFrame;
  outgoingClip?: PetClip;
  outgoingFrame?: PetFrame;
  crossfadeAlpha?: number;
  breatheScaleY: number;
  squashX: number;
  squashY: number;
  index: number;
  progress: number;
  opacity: number;
  nextAt?: number;
  ended?: Extract<PetAction, { type: "animation-end" }>;
}

const CROSSFADE_MS = 140;
const SQUASH_MS = 150;

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
  private previous?: { clip: PetClip; frame: PetFrame; until: number };
  private squashAt?: number;

  triggerSquash(now: number): void {
    if (!this.reduced) this.squashAt = now;
  }

  set(snapshot: PetSnapshot, now: number, reduced: boolean): void {
    let selected = selectClip(snapshot.skin, snapshot.visibility === "entering" ? "enter" : snapshot.visibility === "exiting" ? "exit" : snapshot.clip);
    if (reduced && (snapshot.visibility === "entering" || snapshot.visibility === "exiting")) selected = selectClip(snapshot.skin, "idle");
    if (selected?.id === "pickup" && snapshot.gesture) {
      const frames = selected.clip.frames;
      const held = { ...frames[Math.min(1, frames.length - 1)]!, duration: 10000 };
      selected = { id: selected.id, clip: { ...selected.clip, frames: snapshot.gesture === "dragging"
        ? !reduced && frames.length > 1 ? [frames[0]!, held] : [held]
        : snapshot.gesture === "falling" ? [{ ...frames[Math.min(2, frames.length - 1)]!, duration: 10000 }]
        : frames.slice(Math.min(snapshot.gesture === "settling" ? 3 : 2, frames.length - 1)) } };
    }
    const key = `${snapshot.transition}:${snapshot.visibility}:${snapshot.clip}:${snapshot.skin.id}:${snapshot.gesture}:${selected?.clip.file ?? ""}`;
    if (key !== this.key) {
      if (!reduced && this.selected && this.snapshot?.visibility === "visible" && snapshot.visibility === "visible" && this.snapshot.skin.id === snapshot.skin.id && !snapshot.gesture && !this.snapshot.gesture) {
        const prevFrame = this.selected.clip.frames[this.frameIndex(this.elapsed(now))];
        if (prevFrame) this.previous = { clip: this.selected.clip, frame: prevFrame, until: now + CROSSFADE_MS };
      } else {
        this.previous = undefined;
      }
      this.key = key; this.started = now; this.reported = false; this.frozenIndex = 0;
      if (this.pausedAt !== undefined) this.pausedAt = now;
    } else if (reduced && !this.reduced) {
      this.frozenIndex = this.frameIndex(this.elapsed(now));
      this.previous = undefined;
    } else if (!reduced && this.reduced && this.selected) {
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
    if ((this.snapshot?.visibility === "entering" || this.snapshot?.visibility === "exiting") && (this.reduced || this.selected?.id !== this.snapshot.clip)) return 120;
    return this.snapshot?.visibility === "entering" ? Math.min(1000, duration) : this.snapshot?.visibility === "exiting" ? Math.min(800, duration) : duration;
  }
  private loops(): boolean {
    return this.snapshot?.visibility === "visible" && !!this.selected?.clip.loop && !oneShots.has(this.snapshot.clip);
  }
  private loopWindow(): { loopFrom: number; introDuration: number; loopDuration: number } {
    const clip = this.selected?.clip;
    if (!clip) return { loopFrom: 0, introDuration: 0, loopDuration: 400 };
    const loopFrom = clip.loopFrom && clip.loopFrom > 0 && clip.loopFrom < clip.frames.length ? clip.loopFrom : 0;
    const introDuration = clip.frames.slice(0, loopFrom).reduce((sum, f) => sum + f.duration, 0);
    const loopDuration = Math.max(1, clip.frames.slice(loopFrom).reduce((sum, f) => sum + f.duration, 0));
    return { loopFrom, introDuration, loopDuration };
  }
  private frameIndex(elapsed: number): number {
    const frames = this.selected?.clip.frames;
    if (!frames) return 0;
    if (this.loops()) {
      const { loopFrom, introDuration, loopDuration } = this.loopWindow();
      if (loopFrom > 0 && elapsed >= introDuration) {
        let pos = (elapsed - introDuration) % loopDuration;
        for (let index = loopFrom; index < frames.length; index++) {
          pos -= frames[index]!.duration;
          if (pos < 0) return index;
        }
        return frames.length - 1;
      }
      const total = this.duration();
      let position = loopFrom > 0 ? elapsed : elapsed % total;
      for (let index = 0; index < frames.length; index++) {
        position -= frames[index]!.duration;
        if (position < 0) return index;
      }
      return frames.length - 1;
    }
    const duration = this.duration();
    let position = Math.min(duration - 0.001, elapsed * duration / this.lifetime());
    for (let index = 0; index < frames.length; index++) {
      position -= frames[index]!.duration;
      if (position < 0) return index;
    }
    return frames.length - 1;
  }

  sample(now: number): PlayerSample {
    const snapshot = this.snapshot;
    if (!snapshot || snapshot.visibility === "hidden") {
      return { index: 0, progress: 0, opacity: 0, breatheScaleY: 1, squashX: 1, squashY: 1 };
    }
    const elapsed = this.elapsed(now), lifetime = this.lifetime(), loops = this.loops();
    const complete = !loops && elapsed >= lifetime;
    const index = this.reduced ? this.frozenIndex : this.frameIndex(elapsed);
    const progress = Math.min(1, elapsed / lifetime);
    const transitioning = snapshot.visibility === "entering" || snapshot.visibility === "exiting";

    let outgoingClip: PetClip | undefined;
    let outgoingFrame: PetFrame | undefined;
    let crossfadeAlpha: number | undefined;
    if (this.previous && now < this.previous.until && !this.reduced) {
      outgoingClip = this.previous.clip;
      outgoingFrame = this.previous.frame;
      crossfadeAlpha = Math.max(0, Math.min(1, 1 - (this.previous.until - now) / CROSSFADE_MS));
    } else if (this.previous && now >= this.previous.until) {
      this.previous = undefined;
    }

    let squashX = 1, squashY = 1;
    const squashActive = this.squashAt !== undefined && now - this.squashAt < SQUASH_MS && !this.reduced;
    if (squashActive) {
      const st = (now - this.squashAt!) / SQUASH_MS;
      const pulse = Math.sin(st * Math.PI);
      squashX = 1 + 0.055 * pulse;
      squashY = 1 - 0.055 * pulse;
    } else if (this.squashAt !== undefined && now - this.squashAt >= SQUASH_MS) {
      this.squashAt = undefined;
    }

    const canBreathe = !this.reduced && snapshot.visibility === "visible" && !snapshot.gesture && ["idle", "waiting", "error", "perch"].includes(snapshot.clip);
    const breatheScaleY = canBreathe ? 1 + Math.sin((now / 4800) * Math.PI * 2) * 0.008 : 1;

    let nextAt: number | undefined;
    if (this.pausedAt === undefined) {
      if (!complete && !loops) nextAt = now + lifetime - elapsed;
      const clip = this.selected?.clip;
      if (!this.reduced && clip && clip.frames.length > 1 && !complete) {
        if (loops) {
          const { loopFrom, introDuration, loopDuration } = this.loopWindow();
          if (loopFrom > 0 && elapsed >= introDuration) {
            const loopPos = (elapsed - introDuration) % loopDuration;
            const relBoundary = clip.frames.slice(loopFrom, index + 1).reduce((sum, f) => sum + f.duration, 0);
            nextAt = Math.min(nextAt ?? Infinity, now + Math.max(1, relBoundary - loopPos));
          } else {
            const total = this.duration();
            const pos = loopFrom > 0 ? elapsed : elapsed % total;
            const boundary = clip.frames.slice(0, index + 1).reduce((sum, f) => sum + f.duration, 0);
            nextAt = Math.min(nextAt ?? Infinity, now + Math.max(1, boundary - pos));
          }
        } else {
          const duration = this.duration();
          const boundary = clip.frames.slice(0, index + 1).reduce((sum, f) => sum + f.duration, 0);
          nextAt = Math.min(nextAt ?? Infinity, now + Math.max(1, boundary * lifetime / duration - elapsed));
        }
      }
      if (transitioning || crossfadeAlpha !== undefined || squashActive) {
        nextAt = Math.min(nextAt ?? Infinity, now + 1000 / 30);
      } else if (canBreathe) {
        nextAt = Math.min(nextAt ?? Infinity, now + 1000 / 12);
      }
    }

    let ended: PlayerSample["ended"];
    if (complete && !this.reported && this.pausedAt === undefined) {
      this.reported = true;
      ended = { type: "animation-end", transition: snapshot.transition, clip: snapshot.clip };
    }
    const opacity = snapshot.visibility === "entering" ? Math.min(1, elapsed / Math.min(160, lifetime)) :
      snapshot.visibility === "exiting" ? Math.min(1, Math.max(0, (lifetime - elapsed) / Math.min(180, lifetime))) : 1;
    return {
      clip: this.selected?.clip,
      frame: this.selected?.clip.frames[index],
      outgoingClip,
      outgoingFrame,
      crossfadeAlpha,
      breatheScaleY,
      squashX,
      squashY,
      index,
      progress,
      opacity,
      nextAt,
      ended,
    };
  }
}
