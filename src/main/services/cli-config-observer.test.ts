import { EventEmitter } from "node:events";
import { realpathSync, watch, type FSWatcher } from "node:fs";
import { mkdtemp, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CliConfigState } from "../../shared/cli-config-state";
import { CliConfigObserver } from "./cli-config-observer";

vi.mock("node:fs", async (original) => {
  const fs = await original<typeof import("node:fs")>();
  return { ...fs, watch: vi.fn(fs.watch) };
});

const roots: string[] = [];
const observers: CliConfigObserver[] = [];
afterEach(async () => {
  observers.splice(0).forEach((observer) => observer.dispose());
  vi.useRealTimers();
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function config(id: string, endpoint = "https://example.test/v1"): string {
  return `[models]\ndefault = ${JSON.stringify(id)}\n[model.${JSON.stringify(id)}]\nmodel = "remote"\nbase_url = ${JSON.stringify(endpoint)}\n`;
}

async function fixture(content = config("first")) {
  const root = await mkdtemp(join(tmpdir(), "grok-config-observer-"));
  roots.push(root);
  const path = join(root, "config.toml");
  await writeFile(path, content);
  const observer = new CliConfigObserver(path);
  observers.push(observer);
  return { root, path, observer };
}

describe("CliConfigObserver", () => {
  it("watches the parent across repeated atomic replacements and deduplicates events", async () => {
    const { root, path, observer } = await fixture();
    const states: CliConfigState[] = [];
    await observer.start((state) => states.push(state));
    expect(vi.mocked(watch).mock.calls.at(-1)?.[0]).toBe(realpathSync.native(root));
    const first = observer.getState();
    for (const id of ["second", "third"]) {
      const temp = join(root, "replacement.tmp");
      await writeFile(temp, config(id));
      await rename(temp, path);
      await vi.waitFor(() => expect(states.at(-1)?.defaultModelId).toBe(id));
    }
    expect(states.map((state) => state.revision)).toEqual([1, 2, 3]);
    expect(Date.parse(states.at(-1)!.changedAt)).toBeGreaterThanOrEqual(Date.parse(first.changedAt));
    const previous = observer.getState();
    await writeFile(path, config("third"));
    await observer.read();
    await writeFile(join(root, "unrelated.tmp"), "ignored");
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(observer.getState()).toEqual(previous);
    expect(await readFile(path, "utf8")).toBe(config("third"));
    expect((await readdir(root)).sort()).toEqual(["config.toml", "unrelated.tmp"]);
  });

  it("preserves the last catalog through malformed/partial writes and recovers", async () => {
    const { path, observer } = await fixture();
    const states: CliConfigState[] = [];
    await observer.start((state) => states.push(state));
    const previous = await observer.read();
    const partial = '[models]\ndefault = "private-C:\\Users\\secret-token';
    await writeFile(path, partial);
    await vi.waitFor(() => expect(states.at(-1)?.notice).toBe("config-invalid"));
    expect(await observer.read()).toEqual(previous);
    expect(observer.getState().defaultModelId).toBe("first");
    expect(JSON.stringify(states)).not.toContain("secret-token");
    const failedRevision = observer.getState().revision;
    await observer.read();
    expect(observer.getState().revision).toBe(failedRevision);
    await writeFile(path, config("recovered"));
    await vi.waitFor(() => expect(states.at(-1)?.defaultModelId).toBe("recovered"));
    expect(observer.getState().notice).toBeUndefined();
  });

  it("retains a valid catalog when the file disappears or exceeds the read bound", async () => {
    const { path, observer } = await fixture();
    const previous = await observer.read();
    await rm(path);
    expect(await observer.read()).toEqual(previous);
    expect(observer.getState().notice).toBe("config-unavailable");
    await writeFile(path, "#".repeat(1024 * 1024 + 1));
    expect(await observer.read()).toEqual(previous);
    expect(observer.getState().notice).toBe("config-too-large");
    await writeFile(path, config("first"));
    await observer.read();
    expect(observer.getState().notice).toBeUndefined();
  });

  it("bounds a continuous event storm with one watcher and closes after unsubscribe", async () => {
    const { path, observer } = await fixture();
    const fakeWatcher = Object.assign(new EventEmitter(), { close: vi.fn() });
    let emit: (() => void) | undefined;
    vi.mocked(watch).mockImplementationOnce(((_folder: unknown, _options: unknown, listener: (event: string, filename: string | null) => void) => {
      emit = () => listener("rename", "config.toml");
      return fakeWatcher as unknown as FSWatcher;
    }) as typeof watch);
    vi.useFakeTimers();
    const unsubscribe = await observer.start(() => undefined);
    const secondUnsubscribe = await observer.start(() => undefined);
    const read = vi.spyOn(observer, "read");
    await writeFile(path, config("second"));
    for (let index = 0; index < 10; index += 1) {
      emit!();
      await vi.advanceTimersByTimeAsync(75);
    }
    expect(read).toHaveBeenCalledTimes(1);
    unsubscribe();
    expect(fakeWatcher.close).not.toHaveBeenCalled();
    secondUnsubscribe();
    expect(fakeWatcher.close).toHaveBeenCalledTimes(1);
    emit!();
    await vi.advanceTimersByTimeAsync(1000);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("closes watchers/timers and suppresses callbacks after disposal, including in-flight reads", async () => {
    const { path, observer } = await fixture();
    const onChange = vi.fn();
    await observer.start(onChange);
    const watcher = vi.mocked(watch).mock.results.at(-1)!.value as FSWatcher;
    const close = vi.spyOn(watcher, "close");
    await writeFile(path, config("second"));
    const pending = observer.read();
    const previous = observer.getState();
    observer.dispose();
    observer.dispose();
    await pending;
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(close).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(observer.getState()).toEqual(previous);
    await observer.start(onChange);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["http://user:secret@127.0.0.1:15721/private/user?token=secret#fragment", true],
    ["https://localhost:443/private", true],
    ["http://[::1]:9999/private", true],
    ["http://10.42.0.1:9000/private?token=secret", false],
    ["https://private-host.internal/private", false],
    ["https://localhost.evil.test/private", false],
    ["${PRIVATE_ENDPOINT}", false],
    ["file:///C:/Users/private/config.toml", false],
  ])("publishes only a boolean for explicit local endpoint %s", async (endpoint, externalRouting) => {
    const { observer } = await fixture(config("selected", endpoint));
    await observer.read();
    expect(observer.getState()).toMatchObject({ defaultModelId: "selected", externalRouting });
    expect(Object.keys(observer.getState()).sort()).toEqual(["changedAt", "defaultModelId", "externalRouting", "revision"]);
    expect(JSON.stringify(observer.getState())).not.toContain(endpoint);
    expect(JSON.stringify(observer.getState())).not.toMatch(/secret|private|15721|9999/);
  });

  it("does not infer a route from a manager directory or an unselected local model", async () => {
    const { root, observer } = await fixture(config("selected") + '\n[model.unused]\nbase_url = "http://127.0.0.1:15721"\n');
    await mkdir(join(root, ".cc-switch"));
    await observer.read();
    expect(observer.getState().externalRouting).toBe(false);
    expect(JSON.stringify(observer.getState())).not.toContain("cc-switch");
  });

  it("omits unsafe default identifiers and does not create a missing parent", async () => {
    const { root, observer } = await fixture('[models]\ndefault = "C:\\Users\\private"\n'.replaceAll("\\", "\\\\"));
    await observer.read();
    expect(observer.getState().defaultModelId).toBeUndefined();
    const missing = new CliConfigObserver(join(root, "private-missing", "config.toml"));
    observers.push(missing);
    const onChange = vi.fn();
    await missing.start(onChange);
    expect(missing.getState().notice).toBe("config-unavailable");
    expect(JSON.stringify(onChange.mock.calls)).not.toContain(root);
    expect(await readdir(root)).toEqual(["config.toml"]);
  });

  it("isolates subscriber mutations and exceptions", async () => {
    const { observer } = await fixture();
    await observer.start((state) => { state.defaultModelId = "tampered"; throw new Error("private callback error"); });
    expect(observer.getState().defaultModelId).toBe("first");
    const state = observer.getState();
    state.defaultModelId = "tampered";
    expect(observer.getState().defaultModelId).toBe("first");
  });
});
