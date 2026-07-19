import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { WorkspaceFileService, fuzzyScore } from "./workspace-file-service";
import { inspectAttachmentPrivacy } from "./attachment-privacy-service";

describe("workspace file search and attachment privacy", () => {
  it("indexes Chinese paths and respects hard and git ignore rules", async () => {
    const root = await mkdtemp(join(tmpdir(), "工作区 file search "));
    await mkdir(join(root, "src", "组件"), { recursive: true });
    await mkdir(join(root, "node_modules", "hidden"), { recursive: true });
    await writeFile(join(root, ".gitignore"), "private.txt\nignored/\n");
    await writeFile(join(root, "src", "组件", "聊天面板.tsx"), "export {};");
    await writeFile(join(root, "private.txt"), "secret");
    await writeFile(join(root, "node_modules", "hidden", "x.js"), "x");
    const values = await new WorkspaceFileService().search(root, "聊天");
    expect(values.map((value) => value.relativePath)).toEqual(["src/组件/聊天面板.tsx"]);
    expect(fuzzyScore("src/components/chat.tsx", "sct")).toBeGreaterThan(0);
  });

  it("warns about files outside the workspace and sensitive names", () => {
    const values = inspectAttachmentPrivacy("D:\\Workspace", [{ id: "a", name: ".env.production", path: "D:\\Other\\.env.production", kind: "file" }]);
    expect(values.map((value) => value.kind)).toEqual(["outside-workspace", "environment"]);
  });
});
