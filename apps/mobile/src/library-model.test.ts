import test from "node:test";
import assert from "node:assert/strict";
import { insertSnippet, rememberRecipe, snippetMatches, toggleBookmark } from "./library-model.ts";

test("recipes replace by name and stay bounded", () => {
    let list = rememberRecipe([], { name: "快速问答", modelId: "a" });
    list = rememberRecipe(list, { name: "深入审查", modelId: "b", effort: "high" });
    list = rememberRecipe(list, { name: "快速问答", modelId: "c" });
    assert.deepEqual(list.map(r => [r.name, r.modelId]), [["快速问答", "c"], ["深入审查", "b"]]);
    for (let i = 0; i < 20; i++) list = rememberRecipe(list, { name: "r" + i });
    assert.equal(list.length, 12);
});

test("bookmarks toggle per message", () => {
    const base = { sessionId: "s", sessionTitle: "会话", messageId: "m1", remoteIndex: 4, excerpt: "回答" };
    const added = toggleBookmark([], base, 1000);
    assert.equal(added.added, true);
    assert.equal(added.list[0]?.remoteIndex, 4);
    const removed = toggleBookmark(added.list, base, 2000);
    assert.equal(removed.added, false);
    assert.equal(removed.list.length, 0);
});

test("snippets insert after existing text and are searchable", () => {
    assert.equal(insertSnippet("", "审查"), "审查");
    assert.equal(insertSnippet("先看这个  \n", "审查"), "先看这个\n\n审查");
    assert.equal(snippetMatches({ id: "1", title: "代码审查", text: "x" }, "审查"), true);
    assert.equal(snippetMatches({ id: "1", title: "代码审查", text: "x" }, "测试"), false);
});
