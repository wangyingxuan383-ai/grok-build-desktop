import { readFile, mkdir, readdir, writeFile, rename, rm, lstat, realpath, open } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import type { PetSkin } from "../../shared/desktop-pet";
import { PET_CLIPS } from "../../shared/desktop-pet";
export function validatePetSkin(input: unknown): PetSkin {
    const s = input as PetSkin;
    if (!s || typeof s !== "object" || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(s.id) || typeof s.name !== "string" || !s.name.trim() || s.name.length > 100
        || typeof s.author !== "string" || s.author.length > 240 || typeof s.license !== "string" || s.license.length > 1000 || !s.clips || !s.clips.idle)
        throw Error("形象清单无效，需包含名称、作者、许可和待机动作");
    const clips: PetSkin["clips"] = {};
    let pixels = 0;
    for (const [id, c] of Object.entries(s.clips)) {
        if (!PET_CLIPS.includes(id as never) || !c || !/^[a-zA-Z0-9_-]+\.(?:png|webp)$/.test(c.file) || !Number.isInteger(c.width) || !Number.isInteger(c.height)
            || c.width < 1 || c.height < 1 || c.width > 4096 || c.height > 4096 || !Number.isFinite(c.referenceHeight) || c.referenceHeight < 1 || c.referenceHeight > 4096
            || typeof c.loop !== "boolean" || !Array.isArray(c.frames) || !c.frames.length || c.frames.length > 120)
            throw Error("动作清单超限或格式无效");
        pixels += c.width * c.height;
        const frames = c.frames.map(f => {
            if (![f.x, f.y, f.width, f.height, f.anchorX, f.anchorY, f.duration].every(Number.isFinite) || f.x < 0 || f.y < 0 || f.width < 1 || f.height < 1 || f.x + f.width > c.width || f.y + f.height > c.height
                || f.anchorX < 0 || f.anchorX > f.width || f.anchorY < 0 || f.anchorY > f.height || f.duration < 30 || f.duration > 10000)
                throw Error("动作帧超出图集或时长无效");
            return { x: f.x, y: f.y, width: f.width, height: f.height, anchorX: f.anchorX, anchorY: f.anchorY, duration: f.duration };
        });
        clips[id as keyof typeof clips] = { file: c.file, width: c.width, height: c.height, referenceHeight: c.referenceHeight, loop: c.loop, frames };
    }
    if (pixels > 64 * 1024 * 1024)
        throw Error("形象图集总像素超限");
    return { id: s.id, name: s.name, author: s.author, license: s.license, clips };
}
export class DesktopPetAssets {
    private readonly roots = new Map<string, string>();
    private importProtocol?: Promise<void>;
    constructor(private readonly builtins: string, private readonly userRoot: string, private readonly workerEntry?: string) { }
    async list(): Promise<PetSkin[]> {
        const skins: PetSkin[] = [];
        for (const base of [this.builtins, this.userRoot]) {
            for (const id of await readdir(base).catch(() => [])) {
                if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(id) || this.roots.has(id) && base === this.userRoot && ["a", "b"].includes(id))
                    continue;
                const root = join(base, id);
                const skin = await readFile(join(root, "skin.json"), "utf8").then(text => validatePetSkin(JSON.parse(text))).catch(() => undefined);
                if (skin && skin.id === id) {
                    this.roots.set(id, root);
                    skins.push(this.urls(skin));
                }
            }
        }
        return skins;
    }
    private urls(skin: PetSkin): PetSkin { return { ...skin, clips: Object.fromEntries(Object.entries(skin.clips).map(([id, clip]) => [id, { ...clip, file: `grok-pet://assets/${skin.id}/${clip.file}` }])) }; }
    async load(id: string): Promise<PetSkin> {
        const skin = (await this.list()).find(s => s.id === id);
        if (!skin) throw Error("形象资源不可用，请切换内置形象或重新导入");
        const root=await realpath(this.roots.get(id)!);
        await Promise.all(Object.values(skin.clips).map(async clip=>{
            const path=join(root,new URL(clip.file).pathname.split("/").at(-1)!);
            const info=await lstat(path);
            if(!info.isFile()||info.isSymbolicLink()||info.size<1||info.size>12*1024*1024||!(await realpath(path)).startsWith(root+sep))throw Error("动作图片缺失或超限");
        }));
        return skin;
    }
    async response(url: string): Promise<Response> {
        try {
            const u = new URL(url), parts = u.pathname.split("/").slice(1).map(decodeURIComponent);
            if (u.protocol !== "grok-pet:" || u.hostname !== "assets" || u.search || u.hash || parts.length !== 2 || !this.roots.has(parts[0]!) || !/^[a-zA-Z0-9_-]+\.(?:png|webp)$/.test(parts[1]!))
                return new Response(null, { status: 404 });
            const root = await realpath(this.roots.get(parts[0]!)!), path = join(root, parts[1]!);
            const stat = await lstat(path);
            if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 12 * 1024 * 1024 || !(await realpath(path)).startsWith(root + sep))
                return new Response(null, { status: 404 });
            return new Response(await readFile(path), { headers: { "Content-Type": path.endsWith(".png") ? "image/png" : "image/webp", "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" } });
        }
        catch {
            return new Response(null, { status: 404 });
        }
    }
    async import(path: string): Promise<PetSkin> {
        // Bound the read itself, not just the buffer after loading an arbitrary file.
        const input = await open(path, "r");
        let bytes: Buffer;
        try {
            const info = await input.stat();
            if (!info.isFile() || info.size < 1 || info.size > 24 * 1024 * 1024)
                throw Error("请选择不超过 24 MiB 的形象文件");
            bytes = Buffer.alloc(info.size);
            let offset = 0;
            while (offset < bytes.length) {
                const part = await input.read(bytes, offset, bytes.length - offset, null);
                if (!part.bytesRead)
                    break;
                offset += part.bytesRead;
            }
            if (offset !== bytes.length || (await input.read(Buffer.alloc(1), 0, 1, null)).bytesRead)
                throw Error("形象文件读取期间发生变化，请重试");
        }
        finally {
            await input.close();
        }
        // Decompression and untrusted JSON/header parsing never run on Electron's main thread.
        const result = await new Promise<{
            skin: PetSkin;
            files: Record<string, Uint8Array>;
        }>((resolve, reject) => {
            const worker = new Worker(this.workerEntry ?? fileURLToPath(new URL("./pet-import-worker.js", import.meta.url)), { workerData: { bytes, extension: path.toLowerCase().endsWith(".zip") ? "zip" : path.toLowerCase().endsWith(".webp") ? "webp" : "png" }, resourceLimits: { maxOldGenerationSizeMb: 96 } });
            const timer = setTimeout(() => { void worker.terminate(); reject(Error("形象包验证超时")); }, 10000);
            worker.once("message", result => { clearTimeout(timer); void worker.terminate(); result.error ? reject(Error(result.error)) : resolve(result); });
            worker.once("error", error => { clearTimeout(timer); reject(error); });
            worker.once("exit", code => { clearTimeout(timer); if (code !== 0)
                reject(Error("形象验证进程已结束")); });
        });
        let skin = validatePetSkin({ ...result.skin, id: `custom-${randomUUID()}` });
        await mkdir(this.userRoot, { recursive: true });
        const staging = join(this.userRoot, `.import-${randomUUID()}`), target = join(this.userRoot, skin.id);
        try {
            await mkdir(staging);
            for (const [name, data] of Object.entries(result.files))
                await writeFile(join(staging, name), data, { flag: "wx" });
            if (Object.keys(skin.clips).length === 1 && skin.clips.idle?.frames.length === 1) {
                this.roots.set(skin.id, staging);
                skin = await this.normalizeSingleImage(skin);
            }
            await writeFile(join(staging, "skin.json"), JSON.stringify(skin));
            await rename(staging, target);
        }
        catch (error) {
            this.roots.delete(skin.id);
            if (resolve(staging).startsWith(resolve(this.userRoot) + sep))
                await rm(staging, { recursive: true, force: true });
            throw error;
        }
        this.roots.set(skin.id, target);
        return this.urls(skin);
    }
    private async normalizeSingleImage(skin: PetSkin): Promise<PetSkin> {
        // Chromium decodes untrusted raster bytes in an isolated sandbox, never nativeImage in main.
        const { BrowserWindow, session } = await import("electron"), partition = session.fromPartition("grok-pet-import");
        await (this.importProtocol ??= (async () => { if (!await partition.protocol.isProtocolHandled("grok-pet"))
            partition.protocol.handle("grok-pet", req => this.response(req.url)); })());
        partition.setPermissionRequestHandler((_wc, _p, cb) => cb(false));
        partition.setPermissionCheckHandler(() => false);
        const window = new BrowserWindow({ show: false, width: 16, height: 16, focusable: false, skipTaskbar: true, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: false, partition: "grok-pet-import" } });
        window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
        const clip = skin.clips.idle!, url = `grok-pet://assets/${skin.id}/${clip.file}`;
        try {
            const work = (async () => {
                await window.loadURL('data:text/html,<meta http-equiv="Content-Security-Policy" content="default-src %27none%27; img-src grok-pet:;">');
                return await window.webContents.executeJavaScript(`(async()=>{const image=new Image();image.crossOrigin='anonymous';image.src=${JSON.stringify(url)};await image.decode();if(image.naturalWidth!==${clip.width}||image.naturalHeight!==${clip.height})throw Error('图片尺寸不一致');const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);const data=ctx.getImageData(0,0,canvas.width,canvas.height).data;let left=canvas.width,top=canvas.height,right=-1,bottom=-1;for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++)if(data[(y*canvas.width+x)*4+3]>32){left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x);bottom=Math.max(bottom,y);}if(right<left)throw Error('图片是空白的');const feet=[];for(let y=Math.max(top,bottom-4);y<=bottom;y++)for(let x=left;x<=right;x++)if(data[(y*canvas.width+x)*4+3]>96)feet.push(x);feet.sort((a,b)=>a-b);return {x:left,y:top,width:right-left+1,height:bottom-top+1,anchorX:(feet.length?feet[Math.floor(feet.length/2)]:(left+right)/2)-left,anchorY:bottom-top+1,duration:5000};})()`);
            })();
            let timer: NodeJS.Timeout | undefined;
            try {
                const frame = await Promise.race([work, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error("图片验证超时")), 5000); })]);
                return validatePetSkin({ ...skin, clips: { idle: { ...clip, referenceHeight: Math.max(frame.height, frame.width), frames: [frame] } } });
            }
            finally {
                clearTimeout(timer);
            }
        }
        finally {
            if (!window.isDestroyed())
                window.destroy();
        }
    }
}
