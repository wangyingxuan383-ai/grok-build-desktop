import { parentPort, workerData } from "node:worker_threads";
import { unzipSync } from "fflate";
import type { PetClip, PetClipId, PetSkin } from "../shared/desktop-pet";

const PET_CLIPS: readonly PetClipId[] = ["idle", "walk", "sleepy", "working", "waiting", "success", "error", "pickup", "pat", "poke", "wave", "stretch", "perch", "enter", "exit"];

function validatePetSkin(input: unknown): PetSkin {
    const s = input as PetSkin;
    if (!s || typeof s !== "object" || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(s.id) || typeof s.name !== "string" || !s.name.trim() || s.name.length > 100
        || typeof s.author !== "string" || s.author.length > 240 || typeof s.license !== "string" || s.license.length > 1000 || !s.clips || !s.clips.idle)
        throw Error("形象清单无效，需包含名称、作者、许可和待机动作");
    const clips: PetSkin["clips"] = {};
    let pixels = 0;
    for (const [id, c] of Object.entries(s.clips)) {
        if (!PET_CLIPS.includes(id as PetClipId) || !c || !/^[a-zA-Z0-9_-]+\.(?:png|webp)$/.test(c.file) || !Number.isInteger(c.width) || !Number.isInteger(c.height)
            || c.width < 1 || c.height < 1 || c.width > 4096 || c.height > 4096 || !Number.isFinite(c.referenceHeight) || c.referenceHeight < 1 || c.referenceHeight > 4096
            || typeof c.loop !== "boolean" || !Array.isArray(c.frames) || !c.frames.length || c.frames.length > 120)
            throw Error("动作清单超限或格式无效");
        if (c.loopFrom !== undefined && (!Number.isInteger(c.loopFrom) || c.loopFrom < 0 || c.loopFrom >= c.frames.length))
            throw Error("循环起始帧无效");
        pixels += c.width * c.height;
        const frames = c.frames.map(f => {
            if (![f.x, f.y, f.width, f.height, f.anchorX, f.anchorY, f.duration].every(Number.isFinite) || f.x < 0 || f.y < 0 || f.width < 1 || f.height < 1 || f.x + f.width > c.width || f.y + f.height > c.height
                || f.anchorX < 0 || f.anchorX > f.width || f.anchorY < 0 || f.anchorY > f.height || f.duration < 30 || f.duration > 10000)
                throw Error("动作帧超出图集或时长无效");
            return { x: f.x, y: f.y, width: f.width, height: f.height, anchorX: f.anchorX, anchorY: f.anchorY, duration: f.duration };
        });
        clips[id as keyof typeof clips] = {
            file: c.file,
            width: c.width,
            height: c.height,
            referenceHeight: c.referenceHeight,
            loop: c.loop,
            ...(c.loopFrom !== undefined ? { loopFrom: c.loopFrom } : {}),
            frames,
        };
    }
    if (pixels > 64 * 1024 * 1024)
        throw Error("形象图集总像素超限");
    return { id: s.id, name: s.name, author: s.author, license: s.license, clips };
}

/** Header inspection bounds sandboxed renderer decoding, and rejects animated WebP/APNG. */
function dimensions(bytes: Uint8Array): { width: number; height: number } {
    const b = Buffer.from(bytes);
    if (b.length >= 33 && b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
        let at = 8;
        while (at + 12 <= b.length) {
            const n = b.readUInt32BE(at), type = b.toString("ascii", at + 4, at + 8);
            if (type === "acTL")
                throw Error("请将动画整理为静态图集");
            if (n > b.length - at - 12)
                throw Error("PNG 内容不完整");
            at += n + 12;
        }
        return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
    }
    if (b.length >= 30 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") {
        const type = b.toString("ascii", 12, 16);
        if (type === "VP8X") {
            if (b[20]! & 2)
                throw Error("请将动画整理为静态图集");
            return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
        }
        if (type === "VP8L") {
            const bits = b.readUInt32LE(21);
            return { width: 1 + (bits & 16383), height: 1 + ((bits >>> 14) & 16383) };
        }
        if (type === "VP8 ")
            return { width: b.readUInt16LE(26) & 16383, height: b.readUInt16LE(28) & 16383 };
    }
    throw Error("只接受 PNG 或 WebP 静态图片及图集");
}

function safeBaseName(entryName: string): string {
    const normalized = entryName.replace(/\\/g, "/").replace(/^\.\//, "");
    if (normalized.includes("..") || normalized.startsWith("/"))
        throw Error("形象包含危险路径、非支持文件或资源超限");
    const parts = normalized.split("/").filter(Boolean);
    if (parts.length === 0 || parts.length > 3)
        throw Error("形象包含危险路径、非支持文件或资源超限");
    return parts.at(-1)!;
}

const CODEX_CLIP_MAP: Record<string, PetClipId> = {
    idle: "idle", stand: "idle", default: "idle",
    walk: "walk", run: "walk", move: "walk",
    sleep: "sleepy", sleepy: "sleepy", yawn: "sleepy",
    work: "working", working: "working", think: "working", coding: "working",
    wait: "waiting", waiting: "waiting", question: "waiting",
    happy: "success", celebrate: "success", success: "success",
    error: "error", sad: "error",
    pat: "pat", pet: "pat", rub: "pat",
    poke: "poke", boop: "poke", tap: "poke",
    wave: "wave", greet: "wave",
    stretch: "stretch",
    perch: "perch", sit: "perch",
    pickup: "pickup", drag: "pickup",
    enter: "enter", spawn: "enter",
    exit: "exit", bye: "exit",
};

function convertCodexPack(raw: Record<string, unknown>, rawFiles: Record<string, Uint8Array>): { skin: PetSkin; files: Record<string, Uint8Array> } {
    const imageFile = typeof raw.spriteSheet === "string" ? safeBaseName(raw.spriteSheet)
        : typeof raw.file === "string" ? safeBaseName(raw.file)
        : Object.keys(rawFiles).find(f => /\.(?:png|webp)$/i.test(f));
    if (!imageFile || !rawFiles[imageFile])
        throw Error("Codex 形象包缺少精灵图文件");
    const bytes = rawFiles[imageFile]!;
    const d = dimensions(bytes);
    const cols = Number.isInteger(raw.cols) && (raw.cols as number) > 0 ? (raw.cols as number) : d.width === 1536 ? 8 : Math.max(1, Math.round(d.width / (Number(raw.frameWidth) || d.width)));
    const rows = Number.isInteger(raw.rows) && (raw.rows as number) > 0 ? (raw.rows as number) : d.height === 1872 ? 9 : Math.max(1, Math.round(d.height / (Number(raw.frameHeight) || d.height)));
    const cellW = Number.isInteger(raw.frameWidth) && (raw.frameWidth as number) > 0 ? (raw.frameWidth as number) : Math.floor(d.width / cols);
    const cellH = Number.isInteger(raw.frameHeight) && (raw.frameHeight as number) > 0 ? (raw.frameHeight as number) : Math.floor(d.height / rows);
    const clips: PetSkin["clips"] = {};
    const sourceClips = (raw.animations ?? raw.clips ?? {}) as Record<string, unknown>;
    const buildRowClip = (rowIdx: number, count: number, duration: number, loop: boolean): PetClip => ({
        file: imageFile,
        width: d.width,
        height: d.height,
        referenceHeight: Math.round(cellH * 0.85),
        loop,
        frames: Array.from({ length: Math.min(cols, Math.max(1, count)) }, (_, col) => ({
            x: col * cellW,
            y: Math.min(rows - 1, Math.max(0, rowIdx)) * cellH,
            width: cellW,
            height: cellH,
            anchorX: cellW / 2,
            anchorY: Math.round(cellH * 0.96),
            duration,
        })),
    });
    for (const [key, spec] of Object.entries(sourceClips)) {
        const mapped = CODEX_CLIP_MAP[key.toLowerCase()];
        if (!mapped || clips[mapped] || !spec || typeof spec !== "object")
            continue;
        const item = spec as Record<string, unknown>;
        if (Array.isArray(item.frames) && item.frames.length > 0 && typeof item.frames[0] === "object") {
            clips[mapped] = {
                file: typeof item.file === "string" && rawFiles[safeBaseName(item.file)] ? safeBaseName(item.file) : imageFile,
                width: d.width,
                height: d.height,
                referenceHeight: Number(item.referenceHeight) || Math.round(cellH * 0.85),
                loop: item.loop !== false,
                ...(Number.isInteger(item.loopFrom) ? { loopFrom: Number(item.loopFrom) } : {}),
                frames: (item.frames as Array<Record<string, unknown>>).map(f => ({
                    x: Number(f.x ?? 0),
                    y: Number(f.y ?? 0),
                    width: Number(f.width ?? cellW),
                    height: Number(f.height ?? cellH),
                    anchorX: Number(f.anchorX ?? cellW / 2),
                    anchorY: Number(f.anchorY ?? Math.round(cellH * 0.96)),
                    duration: Math.max(30, Math.min(10000, Number(f.duration ?? item.frameDuration ?? 180))),
                })),
            };
        }
        else {
            const row = Number(item.row ?? 0);
            const count = Number(item.count ?? item.frames ?? Math.min(4, cols));
            const duration = Math.max(30, Math.min(10000, Number(item.frameDuration ?? item.duration ?? 200)));
            const loop = item.loop !== undefined ? Boolean(item.loop) : !["pickup", "success", "pat", "wave", "poke", "stretch", "enter", "exit"].includes(mapped);
            clips[mapped] = buildRowClip(row, count, duration, loop);
        }
    }
    if (!clips.idle) {
        clips.idle = buildRowClip(0, Math.min(4, cols), 260, true);
        if (rows >= 2 && !clips.walk) clips.walk = buildRowClip(1, Math.min(4, cols), 200, true);
        if (rows >= 3 && !clips.working) clips.working = buildRowClip(2, Math.min(4, cols), 240, true);
        if (rows >= 4 && !clips.sleepy) clips.sleepy = buildRowClip(3, Math.min(4, cols), 900, true);
        if (rows >= 5 && !clips.perch) clips.perch = buildRowClip(4, Math.min(4, cols), 500, true);
    }
    const usedFiles: Record<string, Uint8Array> = {};
    for (const c of Object.values(clips)) {
        if (c && rawFiles[c.file]) usedFiles[c.file] = rawFiles[c.file]!;
    }
    return {
        skin: {
            id: "import",
            name: typeof raw.name === "string" && raw.name.trim() ? raw.name.trim().slice(0, 80) : "Codex 宠物形象",
            author: typeof raw.author === "string" && raw.author.trim() ? raw.author.trim().slice(0, 120) : "Codex 导入",
            license: typeof raw.license === "string" && raw.license.trim() ? raw.license.trim().slice(0, 400) : "由导入者保留原作者许可",
            clips,
        },
        files: usedFiles,
    };
}

function convertShimejiPack(rawFiles: Record<string, Uint8Array>): { skin: PetSkin; files: Record<string, Uint8Array> } {
    const shimeMap: Array<[PetClipId, string[], number, boolean]> = [
        ["idle", ["shime1.png", "shime1.webp"], 3200, true],
        ["walk", ["shime2.png", "shime3.png", "shime2.webp", "shime3.webp"], 220, true],
        ["pickup", ["shime4.png", "shime4.webp"], 240, false],
        ["perch", ["shime11.png", "shime11.webp"], 2000, true],
        ["sleepy", ["shime18.png", "shime19.png", "shime20.png"], 1200, true],
        ["pat", ["shime15.png", "shime16.png"], 400, false],
        ["wave", ["shime26.png", "shime27.png"], 320, false],
    ];
    const clips: PetSkin["clips"] = {};
    const usedFiles: Record<string, Uint8Array> = {};
    for (const [clipId, candidates, duration, loop] of shimeMap) {
        const found = candidates.find(name => rawFiles[name]);
        if (!found) continue;
        const bytes = rawFiles[found]!;
        const d = dimensions(bytes);
        usedFiles[found] = bytes;
        clips[clipId] = {
            file: found,
            width: d.width,
            height: d.height,
            referenceHeight: Math.round(d.height * 0.9),
            loop,
            frames: [{ x: 0, y: 0, width: d.width, height: d.height, anchorX: d.width / 2, anchorY: d.height, duration }],
        };
    }
    if (!clips.idle)
        throw Error("Shimeji 形象包缺少 shime1 基础待机图");
    return {
        skin: {
            id: "import",
            name: "Shimeji 桌宠形象",
            author: "Shimeji 导入",
            license: "由导入者保留原作者许可",
            clips,
        },
        files: usedFiles,
    };
}

try {
    const bytes = new Uint8Array(workerData.bytes);
    let files: Record<string, Uint8Array>, skin: PetSkin;
    if (workerData.slice) {
        const s = workerData.slice as { rows: number; cols: number; clip?: PetClipId; frameDurationMs?: number; loop?: boolean; loopFrom?: number; name?: string };
        const rows = Math.max(1, Math.min(16, Math.trunc(Number(s.rows) || 1)));
        const cols = Math.max(1, Math.min(16, Math.trunc(Number(s.cols) || 1)));
        const clipId: PetClipId = s.clip && PET_CLIPS.includes(s.clip) ? s.clip : "idle";
        const file = `${clipId}.${workerData.extension === "webp" ? "webp" : "png"}`;
        const d = dimensions(bytes);
        const cellW = Math.floor(d.width / cols), cellH = Math.floor(d.height / rows);
        if (cellW < 16 || cellH < 16)
            throw Error("图集单格尺寸过小，请检查行列设置");
        const duration = Math.max(30, Math.min(10000, Math.trunc(Number(s.frameDurationMs) || (clipId === "idle" ? 1200 : 220))));
        const loop = s.loop !== undefined ? Boolean(s.loop) : !["pickup", "success", "pat", "wave", "poke", "stretch", "enter", "exit"].includes(clipId);
        const frames = [];
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                frames.push({ x: c * cellW, y: r * cellH, width: cellW, height: cellH, anchorX: cellW / 2, anchorY: Math.round(cellH * 0.96), duration });
            }
        }
        const builtClip: PetClip = {
            file,
            width: d.width,
            height: d.height,
            referenceHeight: Math.round(cellH * 0.85),
            loop,
            ...(s.loopFrom !== undefined && Number.isInteger(s.loopFrom) && s.loopFrom >= 0 && s.loopFrom < frames.length ? { loopFrom: s.loopFrom } : {}),
            frames,
        };
        const clips: PetSkin["clips"] = { [clipId]: builtClip };
        if (clipId !== "idle") clips.idle = { ...builtClip };
        skin = {
            id: "import",
            name: typeof s.name === "string" && s.name.trim() ? s.name.trim().slice(0, 80) : `切分图集 (${rows}×${cols})`,
            author: "工坊切分导入",
            license: "由导入者保留原作者许可",
            clips,
        };
        files = { [file]: bytes };
    }
    else if (workerData.extension === "zip") {
        let count = 0, total = 0;
        const rawEntries = unzipSync(bytes, { filter: entry => {
                if (entry.name.endsWith("/")) return false;
                const base = safeBaseName(entry.name);
                if (++count > 160 || entry.originalSize > 12 * 1024 * 1024 || (total += entry.originalSize) > 32 * 1024 * 1024)
                    throw Error("形象包含危险路径、非支持文件或资源超限");
                if (!/^(?:skin\.json|pet\.json|NOTICES\.md|README\.md|[a-zA-Z0-9._-]+\.(?:png|webp|xml|json))$/i.test(base))
                    throw Error("形象包含危险路径、非支持文件或资源超限");
                return true;
            } });
        const byBase: Record<string, Uint8Array> = {};
        for (const [entryPath, data] of Object.entries(rawEntries)) {
            byBase[safeBaseName(entryPath)] = data;
        }
        if (byBase["skin.json"]) {
            if (byBase["skin.json"].length > 256 * 1024)
                throw Error("缺少或超限的 skin.json");
            skin = validatePetSkin(JSON.parse(new TextDecoder().decode(byBase["skin.json"])));
            files = {};
            for (const [k, v] of Object.entries(byBase)) {
                if (k !== "skin.json" && k !== "NOTICES.md" && k !== "README.md") {
                    if (!/^[a-zA-Z0-9_-]+\.(?:png|webp)$/.test(k))
                        throw Error("形象包含危险路径、非支持文件或资源超限");
                    files[k] = v;
                }
            }
        }
        else if (byBase["pet.json"]) {
            if (byBase["pet.json"].length > 256 * 1024)
                throw Error("超限的 pet.json");
            const converted = convertCodexPack(JSON.parse(new TextDecoder().decode(byBase["pet.json"])) as Record<string, unknown>, byBase);
            skin = converted.skin;
            files = converted.files;
        }
        else if (byBase["shime1.png"] || byBase["shime1.webp"]) {
            const converted = convertShimejiPack(byBase);
            skin = converted.skin;
            files = converted.files;
        }
        else {
            throw Error("缺少 skin.json、pet.json 或 shime1.png 清单");
        }
    }
    else {
        const file = `image.${workerData.extension}`, d = dimensions(bytes);
        skin = { id: "import", name: "自定义形象", author: "本地导入", license: "由导入者保留原作者许可", clips: { idle: { file, ...d, referenceHeight: Math.max(d.height, d.width), loop: false, frames: [{ x: 0, y: 0, ...d, anchorX: d.width / 2, anchorY: d.height, duration: 5000 }] } } };
        files = { [file]: bytes };
    }
    skin = validatePetSkin(skin);
    for (const clip of Object.values(skin.clips)) {
        if (!clip) continue;
        const file = files[clip.file];
        if (!file)
            throw Error("形象包缺少动作图片");
        const d = dimensions(file);
        if (d.width !== clip.width || d.height !== clip.height)
            throw Error("图片尺寸与清单不一致");
    }
    if (Object.keys(files).some(file => !Object.values(skin.clips).some(c => c?.file === file)))
        throw Error("形象包含未引用文件");
    parentPort!.postMessage({ skin, files });
}
catch (error) {
    parentPort!.postMessage({ error: error instanceof Error ? error.message : "形象包无效" });
}
