import { expect, it, vi } from "vitest";
import { installDiffAnnotationActions, mappedDiffRange, splitPatchWithLines } from "./DiffAnnotations";

it("maps compact patch selections to real old/new lines and rejects gaps", () => {
  const result = splitPatchWithLines("diff --git a/a b/a\n@@ -100,2 +100,2 @@\n before\n-old\n+new\n@@ -500,1 +500,1 @@\n-last\n+next\n");
  expect(result.original).toBe("before\nold\nlast");
  expect(result.modified).toBe("before\nnew\nnext");
  expect(mappedDiffRange(result.oldLines, 1, 2)).toEqual({ startLine: 100, endLine: 101 });
  expect(mappedDiffRange(result.newLines, 3, 3)).toEqual({ startLine: 500, endLine: 500 });
  expect(() => mappedDiffRange(result.newLines, 2, 3)).toThrow("跨越 Diff 区块");
  expect(() => mappedDiffRange(result.newLines, 4, 4)).toThrow();
});

it("uses explicit Monaco context-menu actions, keeps sides and ignores the next unselected line", () => {
  const actions: any[] = [], dispose = vi.fn();
  const selection = { startLineNumber: 10, endLineNumber: 13, endColumn: 1, isEmpty: () => false };
  const model = { addAction: (action: unknown) => { actions.push(action); return { dispose }; }, getSelection: () => selection };
  const begin = vi.fn();
  const cleanup = installDiffAnnotationActions({ getOriginalEditor: () => model, getModifiedEditor: () => model } as any, begin);
  expect(begin).not.toHaveBeenCalled();
  actions[0].run();
  expect(begin).toHaveBeenLastCalledWith("old", 10, 12);
  actions[1].run();
  expect(begin).toHaveBeenLastCalledWith("new", 10, 12);
  selection.isEmpty = () => true;
  actions[1].run();
  expect(begin).toHaveBeenCalledTimes(2);
  cleanup();
  expect(dispose).toHaveBeenCalledTimes(2);
});
