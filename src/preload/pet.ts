import { contextBridge, ipcRenderer } from "electron";
import type { PetAction, PetApi, PetSnapshot } from "../shared/desktop-pet";

// This preload deliberately exposes no IPC transport, filesystem or main-window API.
// Rebuild each message so extra properties cannot turn a pet action into a capability.
function narrowAction(input: PetAction): PetAction {
  if (!input || typeof input !== "object") throw new TypeError("Invalid pet action");
  switch (input.type) {
    case "ready": case "quick-ask": case "screenshot": case "tasks": case "menu":
      return { type: input.type };
    case "hit":
      if (typeof input.interactive === "boolean") return { type: "hit", interactive: input.interactive };
      break;
    case "toolbar":
      if (typeof input.open === "boolean") return { type: "toolbar", open: input.open };
      break;
    case "drag":
      if (["start", "move", "end"].includes(input.phase)) return { type: "drag", phase: input.phase };
      break;
    case "interact":
      if (input.part === "head" || input.part === "body") return { type: "interact", part: input.part };
      break;
    case "animation-end":
      if (Number.isSafeInteger(input.transition) && input.transition >= 0 &&
        ["idle", "waiting", "pickup", "working", "success", "error", "pat", "wave", "sleepy", "enter", "exit"].includes(input.clip)) {
        return { type: "animation-end", transition: input.transition, clip: input.clip };
      }
      break;
    case "navigate":
      if (input.target === undefined) return { type: "navigate" };
      if (input.target && ["session", "image", "automation"].includes(input.target.kind) &&
        typeof input.target.id === "string" && input.target.id.length > 0 && input.target.id.length <= 2048) {
        return { type: "navigate", target: { kind: input.target.kind, id: input.target.id } };
      }
  }
  throw new TypeError("Invalid pet action");
}

const api: PetApi = Object.freeze({
  snapshot: (): Promise<PetSnapshot> => ipcRenderer.invoke("pet:snapshot"),
  action: async (action: PetAction): Promise<void> => { await ipcRenderer.invoke("pet:action", narrowAction(action)); },
  subscribe: (listener: (snapshot: PetSnapshot) => void): (() => void) => {
    if (typeof listener !== "function") throw new TypeError("Invalid pet listener");
    let active = true;
    const handler = (_event: Electron.IpcRendererEvent, snapshot: PetSnapshot): void => { if (active) listener(snapshot); };
    ipcRenderer.on("pet:changed", handler);
    return () => {
      if (!active) return;
      active = false;
      ipcRenderer.removeListener("pet:changed", handler);
    };
  },
});

contextBridge.exposeInMainWorld("grokPet", api);
