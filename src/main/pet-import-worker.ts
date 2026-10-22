import { parentPort, workerData } from "node:worker_threads";
import { unzipSync } from "fflate";
import { validatePetSkin } from "./services/desktop-pet-assets";
import type { PetSkin } from "../shared/desktop-pet";
/** Header inspection bounds sandboxed renderer decoding, and rejects animated WebP/APNG. */
function dimensions(bytes: Uint8Array): {
    width: number;
    height: number;
} {
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
try {
    const bytes = new Uint8Array(workerData.bytes);
    let files: Record<string, Uint8Array>, skin: PetSkin;
    if (workerData.extension === "zip") {
        let count = 0, total = 0;
        files = unzipSync(bytes, { filter: entry => {
                if (++count > 128 || entry.originalSize > 12 * 1024 * 1024 || (total += entry.originalSize) > 32 * 1024 * 1024 || !/^(?:skin\.json|[a-zA-Z0-9_-]+\.(?:png|webp))$/.test(entry.name))
                    throw Error("形象包含危险路径、非支持文件或资源超限");
                return true;
            } });
        if (!files["skin.json"] || files["skin.json"].length > 256 * 1024)
            throw Error("缺少或超限的 skin.json");
        skin = validatePetSkin(JSON.parse(new TextDecoder().decode(files["skin.json"])));
        delete files["skin.json"];
    }
    else {
        const file = `image.${workerData.extension}`, d = dimensions(bytes);
        skin = { id: "import", name: "自定义形象", author: "本地导入", license: "由导入者保留原作者许可", clips: { idle: { file, ...d, referenceHeight: Math.max(d.height, d.width), loop: false, frames: [{ x: 0, y: 0, ...d, anchorX: d.width / 2, anchorY: d.height, duration: 5000 }] } } };
        files = { [file]: bytes };
    }
    skin = validatePetSkin(skin);
    for (const clip of Object.values(skin.clips)) {
        const file = files[clip.file];
        if (!file)
            throw Error("形象包缺少动作图片");
        const d = dimensions(file);
        if (d.width !== clip.width || d.height !== clip.height)
            throw Error("图片尺寸与清单不一致");
    }
    if (Object.keys(files).some(file => !Object.values(skin.clips).some(c => c.file === file)))
        throw Error("形象包含未引用文件");
    parentPort!.postMessage({ skin, files });
}
catch (error) {
    parentPort!.postMessage({ error: error instanceof Error ? error.message : "形象包无效" });
}
