import type { PetAction, PetSnapshot } from "../../shared/desktop-pet";
import { PetPlayer, assetUrl, navigationTarget, placeFrame, sortedTargets, selectClip } from "./player";
import { PetGestures, type GestureEffect } from "./gestures";
import { PetScheduler } from "./scheduler";
const canvas = document.querySelector<HTMLCanvasElement>("#pet")!;
const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
const toolbar = document.querySelector<HTMLElement>("#toolbar")!, card = document.querySelector<HTMLElement>("#status-card")!;
const unavailable = document.querySelector<HTMLElement>("#unavailable")!;
const motion = matchMedia("(prefers-reduced-motion: reduce)");
const player = new PetPlayer();
let snapshot: PetSnapshot | undefined, disposed = false, activeHit = false, cardOpen = false;
const images = new Map<string, {
    image: HTMLImageElement;
    ready: boolean;
}>();
const pending = new Map<string, Promise<HTMLImageElement>>();
const api = window.grokPet;
const action = (value: PetAction) => { if (!disposed)
    void api.action(value).catch(() => { if (value.type === "navigate") {
        cardOpen = true;
        renderCard();
    } }); };
function image(file: string): Promise<HTMLImageElement> {
    const cached = images.get(file);
    if (cached?.ready)
        return Promise.resolve(cached.image);
    if (pending.has(file))
        return pending.get(file)!;
    const job = new Promise<HTMLImageElement>((resolve, reject) => { const img = new Image(); img.crossOrigin = "anonymous"; img.onload = () => { images.set(file, { image: img, ready: true }); pending.delete(file); trimCache(); resolve(img); scheduler.wake(); }; img.onerror = () => { pending.delete(file); reject(Error("图片无法解码")); }; img.src = file; });
    pending.set(file, job);
    return job;
}
function trimCache(): void { if (!snapshot)
    return; const retain = new Set([snapshot.skin.clips[snapshot.clip]?.file, snapshot.skin.clips.idle?.file, snapshot.skin.clips.exit?.file]); for (const key of images.keys())
    if (images.size > 3 && !retain.has(key))
        images.delete(key); }
function sendHit(hit: boolean): void { if (hit === activeHit)
    return; activeHit = hit; action({ type: "hit", interactive: hit }); }
function isVisible(): boolean { return !!snapshot && snapshot.visibility !== "hidden" && !document.hidden && !disposed; }
function renderCard(): void {
    card.hidden = !cardOpen || snapshot?.visibility === "exiting";
    if (!snapshot)
        return;
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
function activate(): void { if (!snapshot)
    return; const target = navigationTarget(snapshot.targets); if (target === "card") {
    cardOpen = true;
    renderCard();
}
else
    action({ type: "navigate", target: target ? { id: target.id, kind: target.kind } : undefined }); }
function effect(e: GestureEffect): void {
    if (e.type === "activate")
        activate();
    else if (e.type === "hover-open" || e.type === "hover-close") {
        toolbar.hidden = e.type === "hover-close";
        action({ type: "toolbar", open: !toolbar.hidden });
    }
    else
        action(e as PetAction);
}
const gestures = new PetGestures(effect);
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
        const img = images.get(sample.clip.file)?.image;
        if (img) {
            const f = sample.frame, custom = !["a", "b"].includes(snapshot.skin.id), size = snapshot.settings.size * (custom ? snapshot.settings.customScale : 1), p = placeFrame(f, sample.clip.referenceHeight, size, innerWidth, innerHeight);
            if (custom)
                p.y += (1 - snapshot.settings.footAnchor) * f.anchorY * size / sample.clip.referenceHeight;
            ctx.save();
            ctx.globalAlpha = sample.opacity;
            const entering = snapshot.visibility === "entering" && !snapshot.reducedMotion && !motion.matches;
            const lift = entering ? Math.sin(Math.min(1, Math.max(0, (sample.progress - .15) / .55)) * Math.PI) * snapshot.settings.size * .12 : 0;
            ctx.drawImage(img, f.x, f.y, f.width, f.height, p.x, p.y - lift, p.width, p.height);
            if (entering && sample.progress < .75) {
                ctx.strokeStyle = `rgba(139,199,228,${.45 * (1 - sample.progress)})`;
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                ctx.ellipse(innerWidth / 2, innerHeight - 12, snapshot.settings.size * .22, 5, 0, 0, Math.PI * 2);
                ctx.stroke();
            }
            ctx.restore();
            unavailable.hidden = true;
        }
        else if (assetUrl(sample.clip.file, snapshot.skin.id)) {
            loading = true;
            void image(sample.clip.file).catch(() => { unavailable.hidden = false; });
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
    if (sample.ended && !loading)
        action(sample.ended);
    const deadlines = [sample.nextAt, gestures.nextAt].filter((n): n is number => n !== undefined);
    return deadlines.length ? Math.min(...deadlines) : undefined;
}
const scheduler = new PetScheduler(draw);
function receive(value: PetSnapshot): void {
    if (disposed || snapshot && value.revision < snapshot.revision)
        return;
    snapshot = value;
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
    document.body.classList.toggle("breathing", value.visibility === "visible" && value.clip === "idle" && !value.reducedMotion && !motion.matches);
    player.set(value, performance.now(), value.reducedMotion || motion.matches);
    if (value.visibility !== "hidden") {
        for (const id of ["idle", "exit"] as const) {
            const file = selectClip(value.skin, id)?.clip.file;
            if (file)
                void image(file).catch(() => undefined);
        }
    }
    if (value.visibility === "hidden" || value.visibility === "exiting") {
        gestures.cancel();
        toolbar.hidden = true;
        cardOpen = false;
        sendHit(false);
    }
    renderCard();
    trimCache();
    scheduler.wake();
}
const inside = (event: PointerEvent) => {
    if ((event.target as HTMLElement)?.closest?.("[data-pet-interactive]"))
        return true;
    try {
        return ctx.getImageData(Math.max(0, Math.min(canvas.width - 1, Math.round(event.clientX * devicePixelRatio))), Math.max(0, Math.min(canvas.height - 1, Math.round(event.clientY * devicePixelRatio))), 1, 1).data[3]! > 32;
    }
    catch {
        return false;
    }
};
window.addEventListener("pointermove", e => { if (!snapshot || snapshot.visibility === "exiting")
    return; const hit = inside(e); sendHit(hit || gestures.captured); gestures.hover(hit, performance.now()); gestures.move(e.pointerId, { x: e.screenX, y: e.screenY }); scheduler.wake(); });
canvas.addEventListener("pointerdown", e => { if (e.button !== 0 || !snapshot || !inside(e) || snapshot.visibility === "exiting")
    return; const part = e.clientY < innerHeight - 14 - snapshot.settings.size * .45 ? "head" : "body"; if (gestures.down(e.pointerId, { x: e.screenX, y: e.screenY }, part, snapshot.settings.locked, performance.now())) {
    canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
    scheduler.wake();
} });
canvas.addEventListener("pointerup", e => { gestures.up(e.pointerId, performance.now()); if (canvas.hasPointerCapture(e.pointerId))
    canvas.releasePointerCapture(e.pointerId); scheduler.wake(); });
canvas.addEventListener("lostpointercapture", () => { if (gestures.captured)
    gestures.cancel(); scheduler.wake(); });
canvas.addEventListener("pointercancel", () => { gestures.cancel(); scheduler.wake(); });
canvas.addEventListener("contextmenu", e => { e.preventDefault(); gestures.context(); scheduler.wake(); });
window.addEventListener("pointerleave", () => { if (!gestures.captured) {
    sendHit(false);
    gestures.hover(false, performance.now());
    scheduler.wake();
} });
document.querySelector("#quick-ask")!.addEventListener("click", () => action({ type: "quick-ask" }));
document.querySelector("#tasks")!.addEventListener("click", () => { cardOpen = !cardOpen; renderCard(); });
document.querySelector("#more")!.addEventListener("click", () => action({ type: "menu" }));
document.querySelector("#close-card")!.addEventListener("click", () => { cardOpen = false; renderCard(); });
document.querySelector("#open-status")!.addEventListener("click", () => action({ type: "menu" }));
canvas.addEventListener("keydown", e => { if (e.key === "Enter")
    activate();
else if (e.key === "ContextMenu" || e.key === "F10" && e.shiftKey)
    gestures.context(); });
motion.addEventListener("change", () => { if (snapshot)
    receive(snapshot); action({ type: "ready" }); });
document.addEventListener("visibilitychange", () => { if (document.hidden) {
    gestures.cancel();
    sendHit(false);
    player.suspend(performance.now());
    scheduler.stop();
}
else
    scheduler.wake(); });
window.addEventListener("resize", () => scheduler.wake());
const unsubscribe = api.subscribe(receive);
window.addEventListener("beforeunload", () => { disposed = true; unsubscribe(); gestures.cancel(); scheduler.dispose(); images.clear(); pending.clear(); }, { once: true });
void api.snapshot().then(async (value) => { receive(value); const file = selectClip(value.skin, value.reducedMotion || motion.matches ? "idle" : value.clip)?.clip.file; if (file)
    await image(file).catch(() => undefined); action({ type: "ready" }); }).catch(() => { unavailable.hidden = false; });
