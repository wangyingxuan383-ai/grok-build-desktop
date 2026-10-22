import { expect, it, vi } from "vitest";
import type { AttachmentDropEvent } from "../../shared/attachment-drop";
import { observeAttachmentDrops } from "./attachment-drop";

function fixture() {
  let listener!: (event: AttachmentDropEvent) => void;
  let owner = "code:A", mounted = true;
  const received: string[] = [], errors: string[] = [], unsubscribe = vi.fn();
  const stop = observeAttachmentDrops(next => { listener = next; return unsubscribe; }, () => {
    const captured = owner;
    return { isCurrent: () => mounted && owner === captured, receive: () => received.push(captured) };
  }, message => errors.push(message));
  const complete = (id: string) => listener({ phase: "completed", id, attachments: [] });
  return { emit: (event: AttachmentDropEvent) => listener(event), complete, stop, unsubscribe, received, errors,
    select: (next: string) => { owner = next; }, unmount: () => { mounted = false; } };
}

it("binds each drop before preparation and rejects a changed session, workspace or mode", () => {
  for (const target of ["code:B", "other-project:A", "image:B"]) {
    const f = fixture(); f.emit({ phase: "started", id: "one" }); f.select(target); f.complete("one");
    expect(f.received).toEqual([]); expect(f.errors).toEqual([expect.stringContaining("草稿已切换")]); f.stop();
  }
});

it("handles out-of-order completions once, and a late failure does not pollute a new owner", () => {
  const f = fixture(); f.emit({ phase: "started", id: "a" }); f.emit({ phase: "started", id: "b" });
  f.complete("b"); f.complete("a"); f.complete("a");
  expect(f.received).toEqual(["code:A", "code:A"]);
  f.emit({ phase: "started", id: "c" }); f.select("image:B"); f.emit({ phase: "failed", id: "c", message: "old failure" });
  expect(f.errors).toEqual([]); f.stop();
});

it("reports current preparation failures, and drops without an owning start never attach", () => {
  const f = fixture(); f.complete("unknown"); f.emit({ phase: "started", id: "a" });
  f.emit({ phase: "failed", id: "a", message: "File is unavailable" });
  expect(f.received).toEqual([]); expect(f.errors).toEqual(["File is unavailable"]);
  f.emit({ phase: "started", id: "b" }); f.stop(); f.complete("b");
  expect(f.unsubscribe).toHaveBeenCalledOnce(); expect(f.received).toEqual([]);
});

it("does not attach into an unmounted image composer", () => {
  const f = fixture(); f.emit({ phase: "started", id: "a" }); f.unmount(); f.complete("a");
  expect(f.received).toEqual([]); f.stop();
});
