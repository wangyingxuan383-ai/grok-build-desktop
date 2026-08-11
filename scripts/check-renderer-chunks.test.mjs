import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { inspectRendererChunks, rendererChunkLimits } from "./check-renderer-chunks.mjs";

const workers = [
  "editor.worker-ABCDEFGH.js",
  "json.worker-ABCDEFGH.js",
  "css.worker-ABCDEFGH.js",
  "html.worker-ABCDEFGH.js",
  "ts.worker-ABCDEFGH.js",
];

async function withAssets(files, action) {
  const root = await mkdtemp(join(tmpdir(), "renderer-chunk-gate-"));
  try {
    for (const [name, size] of Object.entries(files)) {
      await writeFile(join(root, name), Buffer.alloc(size));
    }
    return await action(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("accepts one stable Vite chunk for every Monaco worker", async () => {
  const files = Object.fromEntries(workers.map((name) => [name, 16]));
  files["index-ABCDEFGH.js"] = 32;
  files["index-ABCDEFGH.css"] = 32;
  const result = await withAssets(files, inspectRendererChunks);
  assert.deepEqual(result.failures, []);
});

test("rejects missing, duplicate, or generically named worker chunks", async () => {
  const files = Object.fromEntries(workers.filter((name) => !name.startsWith("ts.worker")).map((name) => [name, 16]));
  files["editor.worker-IJKLMNOP.js"] = 16;
  files["worker-ABCDEFGH.js"] = 16;
  files["index-ABCDEFGH.js"] = 32;
  const result = await withAssets(files, inspectRendererChunks);
  assert.ok(result.failures.some((failure) => failure.includes("worker-ABCDEFGH.js") && failure.includes("Worker 文件名")));
  assert.ok(result.failures.some((failure) => failure.includes("editor.worker") && failure.includes("实际 2 个")));
  assert.ok(result.failures.some((failure) => failure.includes("ts.worker") && failure.includes("实际 0 个")));
});

test("uses tighter class-specific budgets instead of one broad Monaco exemption", async () => {
  const files = Object.fromEntries(workers.map((name) => [name, 16]));
  files["index-ABCDEFGH.js"] = 32;
  files["syntax-highlighter-ABCDEFGH.js"] = rendererChunkLimits.ordinaryChunkBytes + 1;
  files["css.worker-ABCDEFGH.js"] = rendererChunkLimits.languageWorkerBytes + 1;
  const result = await withAssets(files, inspectRendererChunks);
  assert.ok(result.failures.some((failure) => failure.startsWith("syntax-highlighter-ABCDEFGH.js:")));
  assert.ok(result.failures.some((failure) => failure.startsWith("css.worker-ABCDEFGH.js:")));
});
