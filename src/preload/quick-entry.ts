import { contextBridge, ipcRenderer } from "electron";
import type { QuickEntryApi } from "../renderer/quick-entry/contracts";

// This window receives none of the main renderer API, IPC transport or Node APIs.
const api: QuickEntryApi = {
  context: cwd => ipcRenderer.invoke("quick-entry:context", ...(cwd === undefined ? [] : [cwd])),
  files: id => ipcRenderer.invoke("quick-entry:files", id),
  clipboard: id => ipcRenderer.invoke("quick-entry:clipboard", id),
  snip: id => ipcRenderer.invoke("quick-entry:snip", id),
  remove: (id, attachmentId) => ipcRenderer.invoke("quick-entry:remove", id, attachmentId),
  send: input => ipcRenderer.invoke("quick-entry:send", input),
  cancel: () => ipcRenderer.invoke("quick-entry:cancel"),
};
contextBridge.exposeInMainWorld("quickEntry", api);
