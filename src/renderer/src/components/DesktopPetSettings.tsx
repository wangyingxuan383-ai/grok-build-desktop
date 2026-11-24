import { useEffect, useRef, useState } from "react";
import type { AppSettings } from "../../../shared/types";
import { desktopPetSettings, PET_CLIPS, type DesktopPetSettings as PetSettings, type PetClipId, type PetPhysicsMode, type PetSkin, type PetSnapshot } from "../../../shared/desktop-pet";
import { PetPlayer, placeFrame, selectClip } from "../../pet/player";
import "../styles/desktop-pet-settings.css";

const labels: Record<PetClipId, string> = {
    idle: "待机",
    waiting: "等你确认",
    pickup: "拎起与落地",
    working: "工作",
    success: "完成",
    error: "出错",
    pat: "摸头",
    wave: "挥手",
    sleepy: "困倦打盹",
    enter: "出场",
    exit: "退场",
    walk: "漫步",
    poke: "戳一戳",
    stretch: "伸懒腰",
    perch: "窗口端坐",
};

function PetPreview({ skin, clip = "idle", animate = false, settings }: {
    skin: PetSkin;
    clip?: PetClipId;
    animate?: boolean;
    settings?: PetSettings;
}): React.JSX.Element {
    const ref = useRef<HTMLCanvasElement>(null);
    useEffect(() => {
        const canvas = ref.current!, ctx = canvas.getContext("2d")!, player = new PetPlayer();
        let cancelled = false, timer: ReturnType<typeof setTimeout> | undefined;
        const reduced = !animate || !!settings?.reduceMotion || matchMedia("(prefers-reduced-motion: reduce)").matches;
        const match = selectClip(skin, reduced && (clip === "enter" || clip === "exit") ? "idle" : clip);
        if (!match) return () => undefined;
        const selected = match.clip;
        let repaint = () => undefined as void;
        const image = new Image();
        image.crossOrigin = "anonymous";
        image.onload = () => {
            if (cancelled) return;
            const snapshot: PetSnapshot = { revision: 1, transition: 1, visibility: clip === "enter" ? "entering" : clip === "exit" ? "exiting" : "visible", clip, settings: desktopPetSettings({ size: 128 }), skin, reducedMotion: !animate, quiet: false, targets: [], unread: 0, phones: 0, running: 0, awaiting: 0, theme: "dark" };
            player.set(snapshot, performance.now(), reduced);
            const paint = () => {
                if (cancelled) return;
                clearTimeout(timer);
                const dpr = devicePixelRatio || 1;
                if (canvas.width !== Math.round(220 * dpr)) {
                    canvas.width = Math.round(220 * dpr);
                    canvas.height = Math.round(174 * dpr);
                }
                ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
                const sample = player.sample(performance.now());
                ctx.clearRect(0, 0, 220, 174);
                if (sample.frame && sample.clip) {
                    const f = sample.frame, custom = !["a", "b"].includes(skin.id), size = 128 * (custom ? (settings?.customScale ?? 1) : 1), p = placeFrame(f, sample.clip.referenceHeight, size, 220, 174);
                    if (custom) p.y += (1 - (settings?.footAnchor ?? 1)) * f.anchorY * size / sample.clip.referenceHeight;
                    ctx.save();
                    ctx.globalAlpha = sample.opacity;
                    ctx.translate(110, 160);
                    ctx.scale(1, sample.breatheScaleY);
                    ctx.drawImage(image, f.x, f.y, f.width, f.height, p.x - 110, p.y - 160, p.width, p.height);
                    ctx.restore();
                }
                if (animate && sample.nextAt)
                    timer = setTimeout(paint, Math.max(15, sample.nextAt - performance.now()));
            };
            repaint = paint;
            paint();
        };
        image.src = selected.file;
        const resize = () => repaint();
        window.addEventListener("resize", resize);
        return () => { cancelled = true; clearTimeout(timer); image.onload = null; image.src = ""; window.removeEventListener("resize", resize); };
    }, [skin, clip, animate, settings?.customScale, settings?.footAnchor, settings?.reduceMotion]);
    return <canvas ref={ref} width={220} height={174} aria-label={`${skin.name} · ${labels[clip]}`}/>;
}

export function DesktopPetSettings({ value, onChanged }: {
    value?: PetSettings;
    onChanged(settings: AppSettings): void;
}): React.JSX.Element {
    const current = desktopPetSettings(value);
    const [skins, setSkins] = useState<PetSkin[]>([]);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const [busy, setBusy] = useState(false);
    const [clip, setClip] = useState<PetClipId>("enter");
    const [replay, setReplay] = useState(0);
    const [shortcut, setShortcut] = useState(current.shortcut);
    const [description, setDescription] = useState("");
    const [stage, setStage] = useState<PetClipId | "base">("base");
    const [imported, setImported] = useState<PetSkin>();
    const [sliceGrid, setSliceGrid] = useState<"2x2" | "2x3" | "1x4">("2x2");
    const [sliceClip, setSliceClip] = useState<PetClipId>("walk");
    const [sliceTargetSkin, setSliceTargetSkin] = useState<string>("");
    const alive = useRef(true);
    const busyGuard = useRef(false);
    const [previewOpen, setPreviewOpen] = useState(false);

    useEffect(() => { setShortcut(current.shortcut); }, [current.shortcut]);
    useEffect(() => {
        alive.current = true;
        void window.grokDesktop.listPetSkins().then(rows => { if (alive.current) setSkins(rows); }).catch(e => { if (alive.current) setError(String(e)); });
        return () => { alive.current = false; };
    }, []);

    const run = async (action: () => Promise<void>) => {
        if (busyGuard.current) return;
        busyGuard.current = true;
        setBusy(true);
        setError("");
        setNotice("");
        try {
            await action();
        }
        catch (e) {
            if (alive.current) setError(e instanceof Error ? e.message : String(e));
        }
        finally {
            busyGuard.current = false;
            if (alive.current) setBusy(false);
        }
    };

    const update = (patch: Partial<PetSettings>) => run(async () => {
        const pet = { ...current, ...patch };
        delete pet.position;
        const result = await window.grokDesktop.updateSettings({ desktopPet: pet });
        if (alive.current) onChanged(result);
    });

    const selected = skins.find(s => s.id === current.skinId) ?? skins.find(s => s.id === "b");
    const customSkins = skins.filter(s => !["a", "b"].includes(s.id));

    const removeCustomSkin = (id: string) => run(async () => {
        const nextSkins = await window.grokDesktop.deletePetSkin(id);
        if (!alive.current) return;
        setSkins(nextSkins);
        if (imported?.id === id) setImported(undefined);
        if (current.skinId === id) {
            if (window.grokDesktop.getSettings) onChanged(await window.grokDesktop.getSettings());
            else {
                const pet = { ...current, skinId: "b" };
                delete pet.position;
                onChanged(await window.grokDesktop.updateSettings({ desktopPet: pet }));
            }
        }
    });

    const importSpriteSheet = () => run(async () => {
        if (!window.grokDesktop.importPetSpriteSheet) throw Error("当前环境尚未开放图集切分接口");
        const [rows, cols] = sliceGrid.split("x").map(Number) as [number, number];
        const skin = await window.grokDesktop.importPetSpriteSheet({
            rows,
            cols,
            clip: sliceClip,
            targetSkinId: sliceTargetSkin || undefined,
        });
        if (!skin || !alive.current) return;
        setImported(skin);
        setSkins(await window.grokDesktop.listPetSkins());
        setNotice(`已切分并导入 ${rows}×${cols} 动作「${labels[sliceClip]}」`);
    });

    const exportSkin = (format: "grok" | "codex") => run(async () => {
        if (!window.grokDesktop.exportPetSkin) throw Error("当前环境尚未开放形象导出接口");
        const targetId = current.skinId === "b" && customSkins[0] ? customSkins[0].id : current.skinId;
        const saved = await window.grokDesktop.exportPetSkin(targetId, format);
        if (saved && alive.current) setNotice(`已导出 ${format === "codex" ? "Codex" : "Grok"} 形象包：${saved}`);
    });

    const workshop = () => run(async () => {
        const input = description.trim();
        if (!input) throw Error("先描述想要的形象或动作");
        const conversation = await window.grokDesktop.createImageConversation();
        if (!alive.current) return;
        const prompt = `制作 Grok 桌宠${stage === "base" ? "透明全身基础形象" : labels[stage] + "动作图集"}。${input}\n银白、炭黑，少量冰蓝；柔和细腻动漫插画。纯白或真实透明背景，完整人物与鞋子，四周留白。${stage === "base" ? "先生成一张用于确认的人物设定图。" : "以我添加的基础参考图保持同一人物；2×2 四格图集，人物等比例、脚底一致、格间留白。"}不要文字、水印或背景场景。`;
        await window.grokDesktop.saveImageComposerDraft(conversation.id, { draft: prompt, ratio: "1:1", route: "cli", model: "", cliModel: "", references: [], sources: [] });
        if (!alive.current) return;
        try { localStorage.setItem("grok.image-notification-target", conversation.id); } catch { /* Navigation remains explicit. */ }
        window.dispatchEvent(new CustomEvent("grok:pet-image-draft", { detail: { id: conversation.id } }));
    });

    return <fieldset className="conversation-reading-settings desktop-pet-settings"><legend>桌面伴侣</legend>
  <p className="settings-note">跟随应用启动，安静显示工作状态。此处修改立即保存；关闭桌宠不影响会话与手机连接。</p>
  <label className="check"><input type="checkbox" checked={current.enabled} disabled={busy} onChange={e => void update({ enabled: e.target.checked })}/>开启桌面伴侣</label>
  <div className="pet-skin-choices">{skins.filter(s => s.id === "a" || s.id === "b").map(s => <button type="button" key={s.id} className={`pet-skin-choice ${current.skinId === s.id ? "selected" : ""}`} aria-pressed={current.skinId === s.id} disabled={busy} onClick={() => void update({ skinId: s.id })}><PetPreview skin={s}/><span>{s.id.toUpperCase()} · {s.name}</span></button>)}</div>
  {customSkins.length > 0 && <label>当前形象<select disabled={busy} value={current.skinId} onChange={e => void update({ skinId: e.target.value })}>{skins.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>}
  {!["a", "b"].includes(current.skinId) && <div className="button-row"><button type="button" disabled={busy} onClick={() => void removeCustomSkin(current.skinId)}>删除当前自定义形象</button></div>}
  <div className="pet-settings-grid">
   <label>人物大小<select disabled={busy} value={current.size} onChange={e => void update({ size: Number(e.target.value) as PetSettings["size"] })}>{[128, 192, 256].map(n => <option key={n} value={n}>{n} · {n === 128 ? "小" : n === 192 ? "标准" : "大"}</option>)}</select></label>
   <label>陪伴模式<select disabled={busy} value={current.mode} onChange={e => void update({ mode: e.target.value as PetSettings["mode"] })}><option value="companion">安静陪伴</option><option value="status">仅显示状态</option></select></label>
   <label>拖拽物理手感<select disabled={busy} value={current.physics ?? "nearby"} onChange={e => void update({ physics: e.target.value as PetPhysicsMode })}><option value="nearby">就近轻落（快速甩动可轻抛）</option><option value="gravity">重力落底与边缘轻弹</option><option value="off">松手即停</option></select></label>
  </div>
  <label className="check"><input type="checkbox" checked={current.idleActions} disabled={busy || current.mode === "status"} onChange={e => void update({ idleActions: e.target.checked })}/>空闲较久时困倦打哈欠入睡，回来轻挥手</label>
  <label className="check"><input type="checkbox" checked={current.roaming !== false} disabled={busy || current.mode === "status" || current.locked} onChange={e => void update({ roaming: e.target.checked })}/>陪伴模式下沿屏幕底边轻步自主漫步与伸懒腰</label>
  <label className="check"><input type="checkbox" checked={Boolean(current.perchOnWindow)} disabled={busy || current.mode === "status" || current.locked} onChange={e => void update({ perchOnWindow: e.target.checked })}/>允许在前台活动窗口标题栏顶沿端坐</label>
  {!["a", "b"].includes(current.skinId) && <div className="pet-settings-grid"><label>自定义缩放<select disabled={busy} value={current.customScale} onChange={e => void update({ customScale: Number(e.target.value) })}>{[.75, 1, 1.25].map(n => <option key={n} value={n}>{Math.round(n * 100)}%</option>)}</select></label><label>脚底在画面中的位置<select disabled={busy} value={current.footAnchor} onChange={e => void update({ footAnchor: Number(e.target.value) })}>{[1, .95, .9, .85, .8, .7, .6, .5].map(n => <option key={n} value={n}>{Math.round(n * 100)}%</option>)}</select></label></div>}
  <div className="button-row"><button type="button" disabled={busy} onClick={() => void run(() => window.grokDesktop.petCommand("show"))}>显示桌宠</button><button type="button" disabled={busy || !current.enabled} onClick={() => void run(() => window.grokDesktop.petCommand("hide"))}>本次暂时隐藏</button><button type="button" disabled={busy} onClick={() => void run(() => window.grokDesktop.petCommand("reset"))}>重置位置与交互</button></div>
  <details onToggle={e => setPreviewOpen(e.currentTarget.open)}><summary>动作预览与显示选项</summary>
   {selected && previewOpen && <div className="pet-action-preview"><PetPreview key={`${selected.id}:${clip}:${replay}`} skin={selected} clip={clip} animate settings={current}/><div><label>预览动作<select value={clip} onChange={e => { setClip(e.target.value as PetClipId); setReplay(n => n + 1); }}>{PET_CLIPS.map(id => <option key={id} value={id}>{labels[id]}</option>)}</select></label><button type="button" onClick={() => setReplay(n => n + 1)}>重播</button><small>仅在此处演示，不改变真实任务状态。</small></div></div>}
   <label className="check"><input type="checkbox" checked={current.reduceMotion} disabled={busy} onChange={e => void update({ reduceMotion: e.target.checked })}/>减少动态效果（始终尊重系统设置）</label>
   <label className="check"><input type="checkbox" checked={current.locked} disabled={busy} onChange={e => void update({ locked: e.target.checked })}/>锁定位置，保留点击、抚摸和菜单</label>
   <label className="check"><input type="checkbox" checked={current.compatibility} disabled={busy} onChange={e => void update({ compatibility: e.target.checked })}/>透明显示兼容模式</label>
   <label>显示／隐藏快捷键<input value={shortcut} disabled={busy} placeholder="留空禁用，例如 Control+Alt+P" onChange={e => setShortcut(e.target.value)} onBlur={() => { if (shortcut !== current.shortcut) void update({ shortcut }); }}/></label>
  </details>
  <details><summary>自定义形象与生图工坊<span className="pet-unfinished"> · 未完善功能</span></summary>
   <p className="settings-note">支持单张 PNG／WebP、Grok 动画包（skin.json）、Codex 宠物包（pet.json）及 Shimeji 压缩包直接导入；缺失动作自动回退。</p>
   <div className="button-row pet-studio-actions">
    <button type="button" disabled={busy} onClick={() => void run(async () => { const skin = await window.grokDesktop.importPetSkin(); if (!skin || !alive.current) return; setImported(skin); setSkins(await window.grokDesktop.listPetSkins()); })}>导入形象或宠物包…</button>
    {window.grokDesktop.exportPetSkin && <button type="button" disabled={busy} onClick={() => void exportSkin("grok")}>导出 Grok 包</button>}
    {window.grokDesktop.exportPetSkin && <button type="button" disabled={busy} onClick={() => void exportSkin("codex")}>导出 Codex 兼容包</button>}
   </div>
   <div className="pet-settings-grid pet-slicer-box">
    <label>图集网格规格<select disabled={busy} value={sliceGrid} onChange={e => setSliceGrid(e.target.value as typeof sliceGrid)}><option value="2x2">2×2 四格图集</option><option value="2x3">2×3 六格图集</option><option value="1x4">1×4 横排条带</option></select></label>
    <label>挂载动作槽位<select disabled={busy} value={sliceClip} onChange={e => setSliceClip(e.target.value as PetClipId)}>{PET_CLIPS.map(id => <option key={id} value={id}>{labels[id]}</option>)}</select></label>
    {customSkins.length > 0 && <label>合并到已有自定义形象<select disabled={busy} value={sliceTargetSkin} onChange={e => setSliceTargetSkin(e.target.value)}><option value="">新建独立自定义形象</option>{customSkins.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>}
   </div>
   {window.grokDesktop.importPetSpriteSheet && <div className="button-row"><button type="button" disabled={busy} onClick={() => void importSpriteSheet()}>选择多格图集并切分导入…</button></div>}
   {imported && <div className="pet-import-preview"><PetPreview skin={imported}/><p>{imported.name} · {imported.author}</p><small>{imported.license}</small><button type="button" disabled={busy} onClick={() => void update({ skinId: imported.id })}>使用导入形象</button></div>}
   <p className="settings-note">工坊目前只在现有图像会话中准备草稿，尚不提供一键生成完整桌宠。添加参考图、检查模型与费用后，由你发送；生成结果可保存后通过上方切分器导入对应动作槽位。</p>
   <label>制作阶段<select value={stage} onChange={e => setStage(e.target.value as typeof stage)}><option value="base">基础形象</option>{PET_CLIPS.map(id => <option key={id} value={id}>{labels[id]}</option>)}</select></label>
   <label>形象或动作描述<textarea rows={3} value={description} onChange={e => setDescription(e.target.value)} maxLength={4000} placeholder="例如：银白长发、冰蓝眼睛、圆润可爱的小只角色"/></label>
   <button type="button" disabled={busy || !description.trim()} onClick={() => void workshop()}>准备图像草稿…</button>
  </details>
  {busy && <small role="status">正在保存或准备…</small>}
  {notice && <p role="status" className="settings-note">{notice}</p>}
  {error && <p role="alert" className="settings-note">{error}</p>}
 </fieldset>;
}
