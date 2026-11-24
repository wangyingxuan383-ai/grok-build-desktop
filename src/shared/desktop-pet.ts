/** Local desktop companion contracts. No command, path or credential capability is exposed. */
export type PetClipId = "idle" | "waiting" | "pickup" | "working" | "success" | "error" | "pat" | "wave" | "sleepy" | "enter" | "exit" | "walk" | "poke" | "stretch" | "perch";
export type PetPhysicsMode = "nearby" | "gravity" | "off";
export interface DesktopPetSettings {
    enabled: boolean;
    skinId: string;
    size: 128 | 192 | 256;
    mode: "companion" | "status";
    idleActions: boolean;
    roaming?: boolean;
    perchOnWindow?: boolean;
    physics?: PetPhysicsMode;
    reduceMotion: boolean;
    locked: boolean;
    compatibility: boolean;
    shortcut: string;
    customScale: number;
    footAnchor: number;
    position?: {
        displayId: number;
        x: number;
        y: number;
    };
}
export const DEFAULT_DESKTOP_PET: DesktopPetSettings = {
    enabled: true,
    skinId: "b",
    size: 192,
    mode: "companion",
    idleActions: true,
    roaming: true,
    perchOnWindow: false,
    physics: "nearby",
    reduceMotion: false,
    locked: false,
    compatibility: false,
    shortcut: "",
    customScale: 1,
    footAnchor: 1,
};
export function desktopPetSettings(value?: Partial<DesktopPetSettings>): DesktopPetSettings {
    return {
        ...DEFAULT_DESKTOP_PET,
        ...value,
        enabled: value?.enabled !== false,
        roaming: value?.roaming ?? DEFAULT_DESKTOP_PET.roaming,
        perchOnWindow: value?.perchOnWindow ?? DEFAULT_DESKTOP_PET.perchOnWindow,
        physics: value?.physics ?? DEFAULT_DESKTOP_PET.physics,
    };
}
export interface PetFrame {
    x: number;
    y: number;
    width: number;
    height: number;
    anchorX: number;
    anchorY: number;
    duration: number;
}
export interface PetClip {
    file: string;
    width: number;
    height: number;
    referenceHeight: number;
    frames: PetFrame[];
    loop: boolean;
    /** Optional frame index where looping restarts after an intro sequence (e.g. drowsy -> yawn -> loop sleep). */
    loopFrom?: number;
}
export interface PetSkin {
    id: string;
    name: string;
    author: string;
    license: string;
    clips: Partial<Record<PetClipId, PetClip>>;
}
export interface PetSpriteSheetImportInput {
    path?: string;
    rows: number;
    cols: number;
    clip?: PetClipId;
    targetSkinId?: string;
    name?: string;
    frameDurationMs?: number;
    loop?: boolean;
    loopFrom?: number;
}
export interface PetTarget {
    kind: "session" | "image" | "automation";
    id: string;
    title: string;
    status: "awaiting" | "error" | "completed" | "running";
}
export interface PetSnapshot {
    revision: number;
    transition: number;
    visibility: "entering" | "visible" | "exiting" | "hidden";
    clip: PetClipId;
    settings: DesktopPetSettings;
    skin: PetSkin;
    reducedMotion: boolean;
    quiet: boolean;
    targets: PetTarget[];
    unread: number;
    phones: number;
    running: number;
    awaiting: number;
    theme: "light" | "dark";
    warning?: string;
    doubleClickTime?: number;
    pointerInteractive?: boolean;
    gesture?: "dragging" | "falling" | "landing" | "settling";
    tilt?: number;
    facing?: "left" | "right";
    speech?: string;
    visibleTop?: number;
    visibleLeft?: number;
    visibleRight?: number;
    colors?: {
        surface: string;
        text: string;
        muted: string;
        accent: string;
        border: string;
    };
}
export type PetAction = {
    type: "ready";
} | {
    type: "animation-end";
    transition: number;
    clip: PetClipId;
} | {
    type: "hit";
    interactive: boolean;
} | {
    type: "toolbar";
    open: boolean;
} | {
    type: "drag";
    phase: "start" | "move" | "end";
} | {
    type: "interact";
    part: "head" | "body";
    gesture?: "click" | "stroke" | "poke";
} | {
    type: "navigate";
    target?: {
        kind: PetTarget["kind"];
        id: string;
    };
} | {
    type: "quick-ask" | "screenshot" | "tasks" | "menu";
};
export interface PetApi {
    snapshot(): Promise<PetSnapshot>;
    action(action: PetAction): Promise<void>;
    subscribe(listener: (snapshot: PetSnapshot) => void): () => void;
}
export const PET_CLIPS: PetClipId[] = ["idle", "waiting", "pickup", "working", "success", "error", "pat", "wave", "sleepy", "enter", "exit", "walk", "poke", "stretch", "perch"];
export function validateDesktopPetSettings(value: unknown): asserts value is DesktopPetSettings {
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw Error("桌宠设置无效");
    const row = value as Record<string, unknown>;
    const keys = [...Object.keys(DEFAULT_DESKTOP_PET), "position"];
    if (Object.keys(row).some(key => !keys.includes(key)))
        throw Error("桌宠设置包含未知字段");
    for (const key of ["enabled", "idleActions", "reduceMotion", "locked", "compatibility"])
        if (typeof row[key] !== "boolean")
            throw Error("桌宠开关无效");
    for (const key of ["roaming", "perchOnWindow"])
        if (row[key] !== undefined && typeof row[key] !== "boolean")
            throw Error("桌宠开关无效");
    if (row.physics !== undefined && !["nearby", "gravity", "off"].includes(String(row.physics)))
        throw Error("桌宠物理设置无效");
    if (typeof row.skinId !== "string" || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(row.skinId))
        throw Error("形象身份无效");
    if (![128, 192, 256].includes(row.size as number) || !["companion", "status"].includes(String(row.mode)))
        throw Error("桌宠显示设置无效");
    if (typeof row.shortcut !== "string" || row.shortcut.length > 100)
        throw Error("桌宠快捷键无效");
    if (typeof row.customScale !== "number" || !Number.isFinite(row.customScale) || row.customScale < .75 || row.customScale > 1.25 || typeof row.footAnchor !== "number" || !Number.isFinite(row.footAnchor) || row.footAnchor < .5 || row.footAnchor > 1)
        throw Error("形象缩放或脚底位置无效");
    if (row.position !== undefined) {
        const p = row.position as Record<string, unknown>;
        if (!p || Array.isArray(p) || Object.keys(p).some(key => !["displayId", "x", "y"].includes(key)) || !Number.isInteger(p.displayId)
            || typeof p.x !== "number" || !Number.isFinite(p.x) || p.x < -1 || p.x > 2
            || typeof p.y !== "number" || !Number.isFinite(p.y) || p.y < -1 || p.y > 1)
            throw Error("桌宠位置无效");
    }
}
