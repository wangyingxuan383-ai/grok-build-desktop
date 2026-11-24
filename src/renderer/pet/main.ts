import type { PetAction, PetFrame, PetSnapshot } from "../../shared/desktop-pet";
import { PetPlayer, assetUrl, navigationTarget, petControlsLayout, placeFrame, sortedTargets, selectClip } from "./player";
import { PetGestures, type GestureEffect } from "./gestures";
import { PetScheduler } from "./scheduler";

const canvas = document.querySelector<HTMLCanvasElement>("#pet")!;
const ctx = canvas.getContext("2d")!;
const toolbar = document.querySelector<HTMLElement>("#toolbar")!, card = document.querySelector<HTMLElement>("#status-card")!;
const speechBubble = document.querySelector<HTMLElement>("#speech-bubble")!;
const unavailable = document.querySelector<HTMLElement>("#unavailable")!;
const motion = matchMedia("(prefers-reduced-motion: reduce)");
const player = new PetPlayer();

let snapshot: PetSnapshot | undefined, disposed = false, activeHit = false, cardOpen = false;
let lastPlacement: { x: number; y: number; width: number; height: number; mask?: Uint8Array } | undefined;
let lastClipRendered = "";
let lastSleepEmit = 0;

interface Particle {
    glyph: "♥" | "✦" | "Z";
    x: number;
    y: number;
    vx: number;
    vy: number;
    born: number;
    life: number;
    color: string;
}
const particles: Particle[] = [];

const images = new Map<string, { image: HTMLImageElement; ready: boolean }>();
const hitMasks = new Map<string, Uint8Array>();
const pending = new Map<string, Promise<HTMLImageElement>>();
const api = window.grokPet;

const action = (value: PetAction) => {
    if (!disposed)
        void api.action(value).catch(() => {
            if (value.type === "navigate") {
                cardOpen = true;
                renderCard();
            }
        });
};

function getHitMask(file: string, img: HTMLImageElement, f: PetFrame): Uint8Array | undefined {
    const key = `${file}:${f.x}:${f.y}:${f.width}:${f.height}`;
    const existing = hitMasks.get(key);
    if (existing) return existing;
    try {
        const off = document.createElement("canvas");
        off.width = 64;
        off.height = 64;
        const octx = off.getContext("2d");
        if (!octx) return undefined;
        octx.drawImage(img, f.x, f.y, f.width, f.height, 0, 0, 64, 64);
        const data = octx.getImageData(0, 0, 64, 64).data;
        const mask = new Uint8Array(64 * 64);
        for (let i = 0; i < 4096; i++) mask[i] = data[i * 4 + 3]! > 32 ? 1 : 0;
        if (hitMasks.size > 96) hitMasks.clear();
        hitMasks.set(key, mask);
        return mask;
    } catch {
        return undefined;
    }
}

function spawnParticles(kind: "heart" | "star" | "sleep", now: number): void {
    if (!snapshot || snapshot.reducedMotion || motion.matches) return;
    const cx = innerWidth / 2;
    const cy = innerHeight - 14 - snapshot.settings.size * 0.92;
    const count = kind === "sleep" ? 1 : 3;
    for (let i = 0; i < count && particles.length < 8; i++) {
        particles.push({
            glyph: kind === "heart" ? "♥" : kind === "star" ? "✦" : "Z",
            x: cx + (i - 1) * 14 + (kind === "sleep" ? 18 : 0),
            y: cy - i * 6,
            vx: kind === "sleep" ? 8 : (i - 1) * 14,
            vy: kind === "sleep" ? -18 : -28 - i * 6,
            born: now,
            life: kind === "sleep" ? 1500 : 880,
            color: kind === "heart" ? "#f28ba8" : kind === "star" ? "#f5cc6a" : "#94c8e4",
        });
    }
}

function image(file: string): Promise<HTMLImageElement> {
    const cached = images.get(file);
    if (cached?.ready) return Promise.resolve(cached.image);
    if (pending.has(file)) return pending.get(file)!;
    const job = new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => { images.set(file, { image: img, ready: true }); pending.delete(file); trimCache(); resolve(img); scheduler.wake(); };
        img.onerror = () => { pending.delete(file); reject(Error("图片无法解码")); };
        img.src = file;
    });
    pending.set(file, job);
    return job;
}

function trimCache(): void {
    if (!snapshot) return;
    const retain = new Set([
        snapshot.skin.clips[snapshot.clip]?.file,
        snapshot.skin.clips.idle?.file,
        snapshot.skin.clips.exit?.file,
        snapshot.skin.clips.walk?.file,
    ]);
    for (const key of images.keys())
        if (images.size > 5 && !retain.has(key)) images.delete(key);
}

function sendHit(hit: boolean): void {
    if (hit === activeHit) return;
    activeHit = hit;
    action({ type: "hit", interactive: hit });
}

function isVisible(): boolean { return !!snapshot && snapshot.visibility !== "hidden" && !document.hidden && !disposed; }

function renderCard(): void {
    card.hidden = !cardOpen || snapshot?.visibility === "exiting";
    if (!snapshot) return;
    document.querySelector("#counts")!.textContent = `${snapshot.running} 项运行 · ${snapshot.awaiting} 项待处理 · ${snapshot.unread} 条未读 · ${snapshot.phones} 台手机在线`;
    const rows = document.querySelector("#targets")!;
    rows.replaceChildren();
    for (const target of sortedTargets(snapshot.targets).slice(0, 3)) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "target";
        button.dataset.status = target.status;
        const title = document.createElement("span");
        title.className = "target-title";
        title.textContent = target.title;
        const state = document.createElement("span");
        state.className = "target-state";
        state.textContent = { awaiting: "等你确认", error: "需要查看", completed: "已完成", running: "运行中" }[target.status];
        button.append(title, state);
        button.onclick = () => action({ type: "navigate", target: { id: target.id, kind: target.kind } });
        rows.append(button);
    }
    if (!snapshot.targets.length) {
        const p = document.createElement("p");
        p.className = "empty";
        p.textContent = "暂时没有待处理事项";
        rows.append(p);
    }
    const all = document.createElement("button");
    all.className = "target";
    all.textContent = "查看全部任务与收件箱 →";
    all.onclick = () => action({ type: "tasks" });
    rows.append(all);
    const warning = document.querySelector<HTMLElement>("#warning")!;
    warning.hidden = !snapshot.warning;
    warning.textContent = snapshot.warning ?? "";
}

function activate(): void {
    if (!snapshot) return;
    const target = navigationTarget(snapshot.targets);
    if (target === "card") {
        cardOpen = true;
        renderCard();
    }
    else action({ type: "navigate", target: target ? { id: target.id, kind: target.kind } : undefined });
}

function effect(e: GestureEffect): void {
    if (e.type === "activate") activate();
    else if (e.type === "hover-open" || e.type === "hover-close") {
        toolbar.hidden = e.type === "hover-close";
        action({ type: "toolbar", open: !toolbar.hidden });
    }
    else {
        if (e.type === "interact" && (e.part === "head" || e.gesture === "stroke")) {
            spawnParticles("heart", performance.now());
        }
        action(e as PetAction);
    }
}

const gestures = new PetGestures(effect);

function drawSpriteFrame(
    img: HTMLImageElement,
    f: PetFrame,
    refHeight: number,
    size: number,
    custom: boolean,
    footAnchor: number,
    alpha: number,
    lift: number,
    scaleX: number,
    scaleY: number,
    tiltDeg: number,
): { x: number; y: number; width: number; height: number } {
    const p = placeFrame(f, refHeight, size, innerWidth, innerHeight);
    if (custom) p.y += (1 - footAnchor) * f.anchorY * size / refHeight;
    const pivotX = innerWidth / 2;
    const pivotY = tiltDeg !== 0 ? p.y + p.height * 0.22 : innerHeight - 14;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(pivotX, pivotY - lift);
    if (tiltDeg !== 0) ctx.rotate((tiltDeg * Math.PI) / 180);
    ctx.scale(scaleX, scaleY);
    ctx.drawImage(img, f.x, f.y, f.width, f.height, p.x - pivotX, p.y - pivotY, p.width, p.height);
    ctx.restore();
    const absScaleX = Math.abs(scaleX);
    const absScaleY = Math.abs(scaleY);
    const drawnX = scaleX >= 0
        ? pivotX + (p.x - pivotX) * scaleX
        : pivotX + (p.x + p.width - pivotX) * scaleX;
    const drawnY = (pivotY - lift) + (p.y - pivotY) * scaleY;
    return {
        x: drawnX,
        y: drawnY,
        width: p.width * absScaleX,
        height: p.height * absScaleY,
    };
}

function draw(now: number): number | undefined {
    if (!isVisible()) {
        player.suspend(now);
        return;
    }
    player.resume(now);
    gestures.tick(now);
    const sample = player.sample(now);
    const dpr = devicePixelRatio || 1;
    if (canvas.width !== Math.round(innerWidth * dpr) || canvas.height !== Math.round(innerHeight * dpr)) {
        canvas.width = Math.round(innerWidth * dpr);
        canvas.height = Math.round(innerHeight * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    let loading = false;
    if (sample.clip && sample.frame && snapshot) {
        const custom = !["a", "b"].includes(snapshot.skin.id);
        const size = snapshot.settings.size * (custom ? snapshot.settings.customScale : 1);
        const entering = snapshot.visibility === "entering" && !snapshot.reducedMotion && !motion.matches;
        const lift = entering ? Math.sin(Math.min(1, Math.max(0, (sample.progress - .15) / .55)) * Math.PI) * snapshot.settings.size * .12 : 0;
        const flipX = snapshot.facing === "left" ? -1 : 1;
        const sx = flipX * sample.squashX;
        const sy = sample.breatheScaleY * sample.squashY;
        const tilt = snapshot.tilt ?? 0;

        if (sample.outgoingClip && sample.outgoingFrame && sample.crossfadeAlpha !== undefined) {
            const outImg = images.get(sample.outgoingClip.file)?.image;
            if (outImg) {
                drawSpriteFrame(outImg, sample.outgoingFrame, sample.outgoingClip.referenceHeight, size, custom, snapshot.settings.footAnchor, sample.opacity * (1 - sample.crossfadeAlpha), 0, sx, sy, tilt);
            }
        }

        const img = images.get(sample.clip.file)?.image;
        if (img) {
            const inAlpha = sample.opacity * (sample.crossfadeAlpha ?? 1);
            const p = drawSpriteFrame(img, sample.frame, sample.clip.referenceHeight, size, custom, snapshot.settings.footAnchor, inAlpha, lift, sx, sy, tilt);
            lastPlacement = { ...p, mask: getHitMask(sample.clip.file, img, sample.frame) };

            if (entering && sample.progress < .75) {
                ctx.save();
                ctx.strokeStyle = `rgba(139,199,228,${.45 * (1 - sample.progress)})`;
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                ctx.ellipse(innerWidth / 2, innerHeight - 12, snapshot.settings.size * .22, 5, 0, 0, Math.PI * 2);
                ctx.stroke();
                ctx.restore();
            }
            unavailable.hidden = true;
        }
        else if (assetUrl(sample.clip.file, snapshot.skin.id)) {
            loading = true;
            void image(sample.clip.file).catch(() => { unavailable.hidden = false; });
        }

        if (snapshot.clip === "sleepy" && now - lastSleepEmit > 2200 && sample.index >= 2) {
            lastSleepEmit = now;
            spawnParticles("sleep", now);
        }

        if (particles.length) {
            ctx.save();
            ctx.font = "bold 13px 'Segoe UI Symbol', 'Segoe UI', sans-serif";
            ctx.textAlign = "center";
            for (let i = particles.length - 1; i >= 0; i--) {
                const pt = particles[i]!;
                const age = now - pt.born;
                if (age >= pt.life) {
                    particles.splice(i, 1);
                    continue;
                }
                const t = age / pt.life;
                ctx.globalAlpha = Math.max(0, 1 - t * t);
                ctx.fillStyle = pt.color;
                ctx.fillText(pt.glyph, pt.x + pt.vx * t, pt.y + pt.vy * t);
            }
            ctx.restore();
        }

        if (snapshot.visibility === "visible" && snapshot.targets.length) {
            const state = snapshot.targets[0]!.status;
            ctx.fillStyle = state === "awaiting" ? "#d3ac69" : state === "error" ? "#c98b8b" : "#8dbbd3";
            ctx.beginPath();
            ctx.arc(innerWidth / 2 + snapshot.settings.size * .32, innerHeight - 14 - snapshot.settings.size * .65, 8, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = "#17202a";
            ctx.font = "bold 11px Segoe UI";
            ctx.textAlign = "center";
            ctx.fillText(state === "awaiting" ? "?" : state === "error" ? "!" : "·", innerWidth / 2 + snapshot.settings.size * .32, innerHeight - 10 - snapshot.settings.size * .65);
        }
    }
    if (sample.ended && !loading) action(sample.ended);
    const particleNext = particles.length ? now + 1000 / 30 : undefined;
    const deadlines = [sample.nextAt, gestures.nextAt, particleNext].filter((n): n is number => n !== undefined);
    return deadlines.length ? Math.min(...deadlines) : undefined;
}

const scheduler = new PetScheduler(draw);

function receive(value: PetSnapshot): void {
    if (disposed || snapshot && value.revision < snapshot.revision) return;
    const prevClip = lastClipRendered;
    lastClipRendered = `${value.transition}:${value.clip}`;
    snapshot = value;
    const crownHeight = Math.round(value.settings.size * (!["a", "b"].includes(value.skin.id) ? value.settings.customScale : 1) * 1.08);
    const layout = petControlsLayout(innerHeight, value.visibleTop, crownHeight);
    toolbar.style.top = `${layout.toolbarTop}px`;
    card.style.top = `${layout.cardTop}px`;
    card.style.maxHeight = `${layout.cardHeight}px`;
    const left = value.visibleLeft ?? 0, right = value.visibleRight ?? 0;
    const centerX = (left + innerWidth - right) / 2;
    toolbar.style.left = `${centerX}px`;
    speechBubble.style.left = `${centerX}px`;
    speechBubble.style.top = `${Math.max((value.visibleTop ?? 0) + 6, layout.toolbarTop - 30)}px`;
    if (value.speech && value.visibility === "visible" && toolbar.hidden && !cardOpen) {
        speechBubble.textContent = value.speech;
        speechBubble.hidden = false;
    } else {
        speechBubble.hidden = true;
    }
    card.style.left = `${left + 12}px`;
    card.style.right = `${right + 12}px`;
    document.documentElement.dataset.theme = value.theme;
    document.body.classList.toggle("compatibility", value.settings.compatibility);
    for (const [name, key] of [["card", "surface"], ["fg", "text"], ["muted", "muted"], ["accent", "accent"], ["border", "border"]] as const) {
        const color = value.colors?.[key];
        if (color && /^#[0-9a-f]{6}$/i.test(color))
            document.documentElement.style.setProperty(`--color-${name}`, color + (name === "card" ? "f5" : ""));
        else
            document.documentElement.style.removeProperty(`--color-${name}`);
    }
    gestures.doubleClickTime = value.doubleClickTime ?? 500;
    const now = performance.now();
    if (prevClip !== lastClipRendered && value.clip === "success") spawnParticles("star", now);
    if (prevClip !== lastClipRendered && value.clip === "pat") spawnParticles("heart", now);
    player.set(value, now, value.reducedMotion || motion.matches);
    if (value.visibility !== "hidden") {
        for (const id of ["idle", "exit"] as const) {
            const file = selectClip(value.skin, id)?.clip.file;
            if (file) void image(file).catch(() => undefined);
        }
    }
    if (value.visibility === "hidden" || value.visibility === "exiting") {
        gestures.cancel();
        toolbar.hidden = true;
        speechBubble.hidden = true;
        cardOpen = false;
        sendHit(false);
    }
    else if (value.pointerInteractive === false && activeHit && !gestures.captured) {
        activeHit = false;
        gestures.hover(false, now);
        toolbar.hidden = true;
    }
    renderCard();
    trimCache();
    scheduler.wake();
}

const inside = (event: MouseEvent) => {
    if ((event.target as HTMLElement)?.closest?.("[data-pet-interactive]")) return true;
    const p = lastPlacement;
    if (p?.mask && p.width > 0 && p.height > 0) {
        let rx = (event.clientX - p.x) / p.width;
        const ry = (event.clientY - p.y) / p.height;
        if (rx < 0 || rx >= 1 || ry < 0 || ry >= 1) return false;
        if (snapshot?.facing === "left") rx = 1 - rx;
        const mx = Math.min(63, Math.max(0, Math.floor(rx * 64)));
        const my = Math.min(63, Math.max(0, Math.floor(ry * 64)));
        return p.mask[my * 64 + mx] === 1;
    }
    try {
        return ctx.getImageData(Math.max(0, Math.min(canvas.width - 1, Math.round(event.clientX * devicePixelRatio))), Math.max(0, Math.min(canvas.height - 1, Math.round(event.clientY * devicePixelRatio))), 1, 1).data[3]! > 32;
    }
    catch {
        return false;
    }
};

function hitZonePart(clientY: number): "head" | "body" {
    if (lastPlacement && lastPlacement.height > 0) {
        return clientY < lastPlacement.y + lastPlacement.height * 0.55 ? "head" : "body";
    }
    return clientY < innerHeight - 14 - (snapshot?.settings.size ?? 96) * 0.45 ? "head" : "body";
}

window.addEventListener("pointermove", e => {
    if (!snapshot || snapshot.visibility === "exiting") return;
    const now = performance.now();
    const hit = inside(e);
    sendHit(hit || gestures.captured);
    gestures.hover(hit, now);
    if (hit) {
        const part = hitZonePart(e.clientY);
        gestures.hoverMove({ x: e.screenX, y: e.screenY }, part, now);
    }
    gestures.move(e.pointerId, { x: e.screenX, y: e.screenY });
    scheduler.wake();
});

canvas.addEventListener("pointerdown", e => {
    if (e.button !== 0 || !snapshot || !inside(e) || snapshot.visibility === "exiting") return;
    const now = performance.now();
    const part = hitZonePart(e.clientY);
    if (gestures.down(e.pointerId, { x: e.screenX, y: e.screenY }, part, snapshot.settings.locked, now)) {
        player.triggerSquash(now);
        canvas.setPointerCapture(e.pointerId);
        e.preventDefault();
        scheduler.wake();
    }
});

canvas.addEventListener("pointerup", e => {
    gestures.up(e.pointerId, performance.now());
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    scheduler.wake();
});
canvas.addEventListener("lostpointercapture", () => { if (gestures.captured) gestures.cancel(); scheduler.wake(); });
canvas.addEventListener("pointercancel", () => { gestures.cancel(); scheduler.wake(); });
canvas.addEventListener("contextmenu", e => { if (!inside(e)) return; e.preventDefault(); gestures.context(); scheduler.wake(); });
window.addEventListener("pointerleave", () => {
    if (!gestures.captured) {
        sendHit(false);
        gestures.hover(false, performance.now());
        scheduler.wake();
    }
});

document.querySelector("#quick-ask")!.addEventListener("click", () => action({ type: "quick-ask" }));
document.querySelector("#tasks")!.addEventListener("click", () => { cardOpen = !cardOpen; renderCard(); });
document.querySelector("#more")!.addEventListener("click", () => action({ type: "menu" }));
document.querySelector("#close-card")!.addEventListener("click", () => { cardOpen = false; renderCard(); });
document.querySelector("#open-status")!.addEventListener("click", () => action({ type: "menu" }));

canvas.addEventListener("keydown", e => {
    if (e.key === "Enter") activate();
    else if (e.key === "ContextMenu" || e.key === "F10" && e.shiftKey) gestures.context();
});

motion.addEventListener("change", () => { if (snapshot) receive(snapshot); });
document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
        gestures.cancel();
        sendHit(false);
        player.suspend(performance.now());
        scheduler.stop();
    }
    else scheduler.wake();
});
window.addEventListener("resize", () => scheduler.wake());

const unsubscribe = api.subscribe(receive);
window.addEventListener("beforeunload", () => { disposed = true; unsubscribe(); gestures.cancel(); scheduler.dispose(); images.clear(); hitMasks.clear(); pending.clear(); }, { once: true });
void api.snapshot().then(async (value) => {
    receive(value);
    const file = selectClip(value.skin, value.reducedMotion || motion.matches ? "idle" : value.clip)?.clip.file;
    if (file) await image(file).catch(() => undefined);
    action({ type: "ready" });
}).catch(() => { unavailable.hidden = false; });
