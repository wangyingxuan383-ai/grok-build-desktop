import test from "node:test";
import assert from "node:assert/strict";
import { backAction, nextStack, pickBanners, stripLeadingTitle, configSummary, plainPreview } from "./app-model.ts";

const base = { tab: "sessions" as const, sheet: null, sessionId: "", stack: [] as string[] };

test("back closes the innermost layer first and only exits from the home list", () => {
  assert.deepEqual(backAction({ ...base, sessionId: "s", sheet: "config", overlay: "navigator" }), { kind: "close-overlay" });
  assert.deepEqual(backAction({ ...base, sessionId: "s", sheet: "config" }), { kind: "close-sheet" });
  assert.deepEqual(backAction({ ...base, sessionId: "child", stack: ["root", "parent"] }), { kind: "open-parent", sessionId: "parent" });
  assert.deepEqual(backAction({ ...base, sessionId: "s" }), { kind: "close-session" });
  assert.deepEqual(backAction({ ...base, tab: "gallery" }), { kind: "home-tab" });
  assert.deepEqual(backAction(base), { kind: "exit" });
});

test("child navigation keeps a bounded, duplicate-free parent trail", () => {
  assert.deepEqual(nextStack([], "a", true), ["a"]);
  assert.deepEqual(nextStack(["a"], "b", true), ["a", "b"]);
  assert.deepEqual(nextStack(["a", "b"], "a", true), ["b", "a"]);
  assert.deepEqual(nextStack(["a"], "b", false), []);
  assert.deepEqual(nextStack([], "", true), []);
  assert.equal(nextStack(Array.from({ length: 20 }, (_, i) => String(i)), "x", true).length, 12);
});

test("banners show connection health plus one most actionable message", () => {
  const input = { phase: "online", error: "", notice: "", creationPending: false, failedSend: false, shareWaiting: false };
  assert.deepEqual(pickBanners(input), []);
  assert.deepEqual(pickBanners({ ...input, notice: "已复制" }).map((b) => b.kind), ["notice"]);
  const busy = pickBanners({ ...input, phase: "offline", error: "boom", notice: "n", creationPending: true, shareWaiting: true });
  assert.deepEqual(busy.map((b) => b.kind), ["connection", "error"]);
  const failed = pickBanners({ ...input, error: "电脑拒绝", failedSend: true });
  assert.deepEqual(failed.map((b) => [b.kind, b.text]), [["failed-send", "电脑拒绝"]]);
  assert.equal(pickBanners({ ...input, phase: "blocked", connectionDetail: "证书不匹配" })[0]!.text, "证书不匹配");
  assert.deepEqual(pickBanners({ ...input, creationPending: true, notice: "x" }).map((b) => b.kind), ["creating"]);
});

test("a heading that repeats the card title is removed, other text is untouched", () => {
  assert.equal(stripLeadingTitle("## 执行计划\n1. 检查", "执行计划"), "1. 检查");
  assert.equal(stripLeadingTitle("## 执行计划\n\n1. 检查", "执行计划"), "1. 检查");
  assert.equal(stripLeadingTitle("## 另一标题\n1. 检查", "执行计划"), "## 另一标题\n1. 检查");
  assert.equal(stripLeadingTitle("正文 ## 执行计划", "执行计划"), "正文 ## 执行计划");
  assert.equal(stripLeadingTitle("## 执行计划", undefined), "## 执行计划");
});

test("previews drop markdown syntax but keep the words", () => {
  assert.equal(plainPreview("这是可阅读的 **演示回答**。\n\n```ts\nconst answer = 42;\n```"), "这是可阅读的 演示回答。 const answer = 42;");
  assert.equal(plainPreview("## 计划\n- 读 [文件](a.md) 和 `x`"), "计划 读 文件 和 x");
  assert.equal(plainPreview("2 * 3 = 6"), "2 * 3 = 6");
});

test("configuration summary is short and tolerates unknown values", () => {
  assert.deepEqual(configSummary("Grok 4", "agent", "high"), { model: "Grok 4", detail: "询问 · 推理高" });
  assert.deepEqual(configSummary(undefined, "custom", undefined), { model: "模型待同步", detail: "custom" });
  assert.deepEqual(configSummary("m"), { model: "m", detail: "" });
});
import { orderWorkspaces } from "./app-model.ts";
test("new-session project picker puts recent projects first, searches paths and folds the rest", () => {
    const workspaces = Array.from({ length: 10 }, (_, i) => ({ id: `w${i}`, name: `Project ${i}`, path: `D:\\code\\p${i}` }));
    const sessions = [{ cwd: "D:\\code\\p7\\", updatedAt: "2026-10-08T01:00:00Z" }, { cwd: "d:/code/p3", updatedAt: "2026-10-07T01:00:00Z" }];
    const first = orderWorkspaces(workspaces, sessions);
    assert.deepEqual(first.rows.slice(0, 3).map(w => w.id), ["w7", "w3", "w0"]);
    assert.equal(first.rows.length, 6); assert.equal(first.hidden, 4);
    assert.deepEqual(orderWorkspaces(workspaces, sessions, "p9").rows.map(w => w.id), ["w9"]);
    assert.equal(orderWorkspaces(workspaces.slice(0, 7), []).hidden, 0);
});

test("the composer button never turns typed text into a stop", async () => {
  const { primaryAction } = await import("./app-model.ts");
  const base = { draft: "", working: false, readOnly: false, pending: 0, busy: false, disabled: false };
  assert.deepEqual(primaryAction(base), { action: "send", enabled: false });
  assert.deepEqual(primaryAction({ ...base, working: true }), { action: "stop", enabled: true });
  assert.deepEqual(primaryAction({ ...base, working: true, draft: "补充" }), { action: "queue", enabled: true });
  assert.deepEqual(primaryAction({ ...base, draft: "问题", pending: 1 }), { action: "send", enabled: false });
  assert.deepEqual(primaryAction({ ...base, readOnly: true, draft: "x" }), { action: "none", enabled: false });
});
