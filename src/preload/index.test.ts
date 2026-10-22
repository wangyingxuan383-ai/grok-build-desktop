import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { GrokDesktopApi } from "../shared/types";
import type { AttachmentDropEvent } from "../shared/attachment-drop";

const mocks = vi.hoisted(() => ({ api: undefined as GrokDesktopApi | undefined, invoke: vi.fn() }));
vi.mock("electron", () => ({
  contextBridge: { exposeInMainWorld: (_: string, api: GrokDesktopApi) => { mocks.api = api; } },
  ipcRenderer: { on: vi.fn(), invoke: mocks.invoke }, webUtils: { getPathForFile: (file: { path: string }) => file.path },
}));
let drop!: (event: unknown) => void;
beforeEach(async () => {
  vi.resetModules(); mocks.invoke.mockReset();
  vi.stubGlobal("window", { addEventListener: (_: string, listener: () => void) => listener() });
  vi.stubGlobal("document", { addEventListener: (name: string, listener: typeof drop) => { if (name === "drop") drop = listener; } });
  await import("./index");
});
afterEach(() => vi.unstubAllGlobals());
const files = () => ({ preventDefault: vi.fn(), dataTransfer: { files: [{ path: "D:/fixture/image.png" }] } });

it("publishes the draft-binding start before asynchronous file preparation completes", async () => {
  let finish!: (value: unknown[]) => void;
  mocks.invoke.mockImplementation(() => new Promise<unknown[]>(resolve => { finish = resolve; }));
  const events: AttachmentDropEvent[] = [], lateEvents: AttachmentDropEvent[] = [];
  const off = mocks.api!.onAttachmentDrop(event => events.push(event));
  drop(files());
  expect(events).toEqual([{ phase: "started", id: expect.any(String) }]);
  const lateOff = mocks.api!.onAttachmentDrop(event => lateEvents.push(event));
  finish([]); await vi.waitFor(() => expect(events).toHaveLength(2));
  expect(events[1]).toEqual({ phase: "completed", id: events[0]!.id, attachments: [] });
  expect(lateEvents).toEqual([]); off(); lateOff();
});

it("handles preparation failures and ignores results after the original consumer unsubscribes", async () => {
  mocks.invoke.mockRejectedValueOnce(Error("file removed"));
  const events: AttachmentDropEvent[] = [];
  const off = mocks.api!.onAttachmentDrop(event => events.push(event));
  drop(files()); await vi.waitFor(() => expect(events).toHaveLength(2));
  expect(events[1]).toEqual({ phase: "failed", id: events[0]!.id, message: "file removed" });
  let finish!: (value: unknown[]) => void;
  mocks.invoke.mockImplementationOnce(() => new Promise<unknown[]>(resolve => { finish = resolve; }));
  drop(files()); expect(events).toHaveLength(3); off(); finish([]);
  await new Promise(resolve => setImmediate(resolve)); expect(events).toHaveLength(3);
});
