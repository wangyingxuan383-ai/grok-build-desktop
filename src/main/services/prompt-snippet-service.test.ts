import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PromptSnippetService } from "./prompt-snippet-service";
const dirs: string[] = [];
afterEach(async () => { for (const path of dirs.splice(0)) await rm(path, { recursive: true, force: true }); });
describe("shared prompt snippets", () => {
  it("merges concurrent creations and preserves content literally", async () => {
    const dir = await mkdtemp(join(tmpdir(), "snippet-store-")); dirs.push(dir);
    const a = new PromptSnippetService(dir), b = new PromptSnippetService(dir);
    await Promise.all([a.save({ title: "审查", body: "检查 {{项目}}；不要自动发送" }), b.save({ title: "进度", body: "总结" })]);
    const list = await a.list(); expect(list).toHaveLength(2);
    expect(list.find(item => item.title === "审查")?.body).toContain("{{项目}}");
  });
  it("rejects stale edits, deletes and resurrection", async () => {
    const dir = await mkdtemp(join(tmpdir(), "snippet-store-")); dirs.push(dir);
    const service = new PromptSnippetService(dir), [first] = await service.save({ title: "标题", body: "正文" });
    const [next] = await service.save({ ...first!, body: "更新正文" });
    await expect(service.save({ ...first!, body: "过期正文" })).rejects.toThrow("其他端");
    await expect(service.delete(first!.id, first!.updatedAt)).rejects.toThrow("其他端");
    await expect(service.delete(first!.id)).rejects.toThrow("其他端");
    await service.delete(next!.id, next!.updatedAt);
    await expect(service.save({ ...next!, body: "旧草稿" })).rejects.toThrow("其他端");
    expect(await service.list()).toHaveLength(0);
  });
});
