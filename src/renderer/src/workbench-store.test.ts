import { beforeEach, describe, expect, it } from "vitest";
import type { EditorDocument } from "../../shared/types";
import { useWorkbenchStore } from "./workbench-store";

const document: EditorDocument = {
  workspacePath: "C:\\workspace",
  path: "C:\\workspace\\src\\index.ts",
  relativePath: "src/index.ts",
  content: "export {};\n",
  encoding: "utf8",
  lineEnding: "lf",
  byteLength: 11,
  editable: true,
  hash: "hash",
  modifiedAt: "2026-07-22T00:00:00.000Z",
  languageId: "typescript",
};

describe("workbench store", () => {
  beforeEach(() => useWorkbenchStore.setState({ activeView: "chat", tabs: [], activeTabKey: "", selectedPath: "", treeByDirectory: {}, expandedDirectories: [], showIgnored: false, showHidden: false }));

  it("preserves tabs, dirty buffers and cursors while switching views", () => {
    const store = useWorkbenchStore.getState();
    store.openDocument(document);
    const key = useWorkbenchStore.getState().activeTabKey;
    store.updateBuffer(key, "export const value = 1;\n");
    store.updateCursor(key, { lineNumber: 1, column: 12 });
    store.setActiveView("chat");
    store.setActiveView("files");
    expect(useWorkbenchStore.getState().tabs[0]).toMatchObject({ dirty: true, buffer: "export const value = 1;\n", cursor: { lineNumber: 1, column: 12 } });
  });

  it("refreshes a saved document without duplicating its tab", () => {
    const store = useWorkbenchStore.getState();
    store.openDocument(document);
    store.openDocument({ ...document, content: "changed", hash: "new" });
    expect(useWorkbenchStore.getState().tabs).toHaveLength(1);
    store.replaceDocument({ ...document, content: "saved", hash: "saved" });
    expect(useWorkbenchStore.getState().tabs[0]).toMatchObject({ buffer: "saved", dirty: false, conflict: undefined });
  });
});
