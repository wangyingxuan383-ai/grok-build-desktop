import test from "node:test";
import assert from "node:assert/strict";
import { createRequestQueue, CancelledError } from "./request-queue.ts";

const tick = () => new Promise(resolve => setTimeout(resolve, 0));
function deferred<T>() { let resolve!: (v: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }

test("runs at most the configured number of jobs and higher priority first", async () => {
    const queue = createRequestQueue(1), order: string[] = [];
    const gate = deferred<void>();
    queue.request("first", 2, async () => { order.push("first"); await gate.promise; return 1; });
    await tick();
    const prefetch = queue.request("prefetch", 2, async () => { order.push("prefetch"); return 2; });
    const user = queue.request("user", 0, async () => { order.push("user"); return 3; });
    await tick();
    assert.deepEqual(order, ["first"]);
    gate.resolve();
    assert.equal(await user.promise, 3);
    assert.equal(await prefetch.promise, 2);
    assert.deepEqual(order, ["first", "user", "prefetch"]);
});

test("the same key shares one job and a later request raises its priority", async () => {
    const queue = createRequestQueue(1), gate = deferred<void>();
    let runs = 0;
    queue.request("busy", 0, async () => { await gate.promise; });
    const a = queue.request("photo", 2, async () => { runs++; return "file"; });
    const other = queue.request("other", 1, async () => "other");
    const b = queue.request("photo", 0, async () => { runs++; return "second"; });
    gate.resolve();
    assert.equal(await a.promise, "file");
    assert.equal(await b.promise, "file");
    await other.promise;
    assert.equal(runs, 1);
});

test("a cancelled job that has not started never runs", async () => {
    const queue = createRequestQueue(1), gate = deferred<void>();
    let ran = false;
    queue.request("busy", 0, async () => { await gate.promise; });
    const ticket = queue.request("thumb", 1, async () => { ran = true; });
    ticket.cancel();
    await assert.rejects(ticket.promise, CancelledError);
    gate.resolve();
    await tick(); await tick();
    assert.equal(ran, false);
    assert.deepEqual(queue.stats(), { active: 0, queued: 0 });
});

test("cancelling one waiter keeps the job for the others", async () => {
    const queue = createRequestQueue(1);
    const a = queue.request("photo", 1, async () => "ok"), b = queue.request("photo", 1, async () => "unused");
    a.cancel();
    await assert.rejects(a.promise, CancelledError);
    assert.equal(await b.promise, "ok");
});

test("failures reach every waiter and free the slot", async () => {
    const queue = createRequestQueue(1);
    const failing = queue.request("bad", 0, async () => { throw Error("下载失败"); });
    await assert.rejects(failing.promise, /下载失败/);
    assert.equal(await queue.request("next", 0, async () => 7).promise, 7);
});
