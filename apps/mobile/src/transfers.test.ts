import test from "node:test";
import assert from "node:assert/strict";
import { trackTransfer, transfersSnapshot, canRetry, retryTransfer, canCancel, cancelTransfer, clearFinishedTransfers } from "./transfers.ts";

test("transfers retain real byte progress, retry and cancellation separately from remote tasks", () => {
  let cancelled = 0, retried = 0;
  trackTransfer("upload", "upload", "file", "running", undefined, undefined, {received:50,total:100}, () => {cancelled++;});
  assert.equal(transfersSnapshot()[0]?.received, 50);
  assert.equal(canCancel("upload"), true); cancelTransfer("upload"); assert.equal(cancelled, 1);
  trackTransfer("upload", "upload", "file", "failed", "offline", () => {retried++;});
  assert.equal(canCancel("upload"), false); retryTransfer("upload"); assert.equal(retried, 1);
  trackTransfer("upload", "upload", "file", "done");
  assert.equal(canRetry("upload"), false); clearFinishedTransfers();
  assert.equal(transfersSnapshot().some(row => row.id === "upload"), false);
});

test("bounded history also releases callbacks that retain files and connection credentials", () => {
  trackTransfer("old", "original", "file", "failed", "offline", () => undefined);
  for (let i=0;i<65;i++) trackTransfer("item"+i,"original","file","done");
  assert.equal(transfersSnapshot().length,60); assert.equal(canRetry("old"),false);
  clearFinishedTransfers();
});
