import { mkdtemp, mkdir, readFile, readdir, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import iconv from "iconv-lite";
import { describe, expect, it } from "vitest";
import { EditorService } from "./editor-service";
import { WorkspaceTreeService } from "./workspace-tree-service";

describe("workspace tree and editor services", () => {
  it("lists one lazy directory level and hides ignored/build/hidden entries by default", async () => {
    const root = await mkdtemp(join(tmpdir(), "grok editor tree "));
    await mkdir(join(root, "src"));
    await mkdir(join(root, "node_modules"));
    await mkdir(join(root, "ignored"));
    await writeFile(join(root, ".gitignore"), "ignored/\n*.secret\n!important.secret\n");
    await writeFile(join(root, ".hidden"), "hidden");
    await writeFile(join(root, "visible.ts"), "export {};");
    await writeFile(join(root, "value.secret"), "ignored");
    await writeFile(join(root, "important.secret"), "visible");

    const service = new WorkspaceTreeService();
    const normal = await service.list(root);
    expect(normal.map((value) => value.name)).toEqual(["src", "important.secret", "visible.ts"]);
    expect(normal.find((value) => value.name === "src")?.children).toBeUndefined();
    const all = await service.list(root, "", { showIgnored: true, showHidden: true });
    expect(all.map((value) => value.name)).toEqual(expect.arrayContaining([".gitignore", ".hidden", "ignored", "node_modules", "value.secret"]));
  });

  it("preserves UTF-8 BOM/CRLF and GB18030 through atomic saves", async () => {
    const root = await mkdtemp(join(tmpdir(), "grok editor encoding "));
    const bomPath = join(root, "bom.txt");
    await writeFile(bomPath, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("第一行\r\n第二行\r\n")]));
    const service = new EditorService();
    const opened = await service.open(root, "bom.txt");
    expect(opened.document).toMatchObject({ encoding: "utf8-bom", lineEnding: "crlf", editable: true });
    const saved = await service.save({
      workspacePath: root,
      path: bomPath,
      content: "第一行\n已修改\n",
      encoding: opened.document!.encoding,
      lineEnding: opened.document!.lineEnding,
      expectedHash: opened.document!.hash,
      expectedModifiedAt: opened.document!.modifiedAt,
    });
    expect(saved.saved).toBe(true);
    const bomBytes = await readFile(bomPath);
    expect([...bomBytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(bomBytes.toString("utf8")).toContain("第一行\r\n已修改\r\n");

    const gbPath = join(root, "legacy.txt");
    await writeFile(gbPath, iconv.encode("简体中文\r\n", "gb18030"));
    const gb = await service.open(root, gbPath);
    expect(gb.document).toMatchObject({ encoding: "gb18030", lineEnding: "crlf" });
    await service.save({ workspacePath: root, path: gbPath, content: "继续编辑\n", encoding: "gb18030", lineEnding: "crlf", expectedHash: gb.document!.hash, expectedModifiedAt: gb.document!.modifiedAt });
    expect(iconv.decode(await readFile(gbPath), "gb18030")).toBe("继续编辑\r\n");
    expect((await readdir(root)).some((name) => /\.(?:tmp|bak)$/.test(name))).toBe(false);
  });

  it("returns a disk conflict instead of silently overwriting an external edit", async () => {
    const root = await mkdtemp(join(tmpdir(), "grok editor conflict "));
    const path = join(root, "shared.ts");
    await writeFile(path, "export const value = 1;\n");
    const service = new EditorService();
    const opened = await service.open(root, path);
    await new Promise((resolve) => setTimeout(resolve, 12));
    await writeFile(path, "export const value = 2;\n");
    const conflict = await service.save({ workspacePath: root, path, content: "export const value = 3;\n", encoding: "utf8", lineEnding: "lf", expectedHash: opened.document!.hash, expectedModifiedAt: opened.document!.modifiedAt });
    expect(conflict).toMatchObject({ saved: false, conflict: { kind: "modified", diskContent: "export const value = 2;\n" } });
    expect(await readFile(path, "utf8")).toContain("value = 2");

    const overwritten = await service.save({ workspacePath: root, path, content: "export const value = 3;\n", encoding: "utf8", lineEnding: "lf", expectedHash: opened.document!.hash, expectedModifiedAt: opened.document!.modifiedAt, overwrite: true });
    expect(overwritten.saved).toBe(true);
    expect(await readFile(path, "utf8")).toContain("value = 3");
  });

  it("enforces workspace/symlink boundaries and size thresholds", async () => {
    const root = await mkdtemp(join(tmpdir(), "grok editor boundary "));
    const outside = await mkdtemp(join(tmpdir(), "grok editor outside "));
    await writeFile(join(outside, "outside.txt"), "outside");
    const service = new EditorService({ editableLimit: 12, readableLimit: 24 });
    await writeFile(join(root, "read-only.txt"), "123456789012345678");
    await writeFile(join(root, "external.txt"), "1234567890123456789012345");
    expect((await service.open(root, "read-only.txt")).document).toMatchObject({ editable: false });
    expect(await service.open(root, "external.txt")).toMatchObject({ kind: "external", byteLength: 25 });
    await expect(service.open(root, "../outside.txt")).rejects.toThrow("超出当前工作区");

    const link = join(root, "outside-link");
    const linked = await symlink(outside, link, process.platform === "win32" ? "junction" : "dir").then(() => true).catch(() => false);
    if (linked) {
      await expect(service.open(root, join(link, "outside.txt"))).rejects.toThrow("超出当前工作区");
      const tree = await new WorkspaceTreeService().list(root, "", { showHidden: true, showIgnored: true });
      expect(tree.find((value) => value.name === "outside-link")).toMatchObject({ kind: "symlink", readOnly: true });
    }
  });

  it("creates, renames and deletes only after explicit confirmation", async () => {
    const root = await mkdtemp(join(tmpdir(), "grok editor mutation "));
    const service = new EditorService();
    await service.createDirectory(root, "folder");
    const created = await service.createFile(root, "folder/new.txt", "hello");
    expect(created.content).toBe("hello");
    const renamed = await service.rename(root, "folder/new.txt", "folder/renamed.txt");
    expect((await stat(renamed)).isFile()).toBe(true);
    await expect(service.delete(root, "folder", false)).rejects.toThrow("明确确认");
    await service.delete(root, "folder", true);
    await expect(stat(join(root, "folder"))).rejects.toThrow();
  });
});
