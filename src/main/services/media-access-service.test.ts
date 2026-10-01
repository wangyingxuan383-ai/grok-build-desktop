import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MediaAccessService } from "./media-access-service";
import { sessionCacheKey } from "./media-cache-service";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));
async function root(): Promise<string> { const value = await mkdtemp(join(tmpdir(), "grok-media-access-")); roots.push(value); return value; }

describe("MediaAccessService", () => {
  it("revokes a removed artwork and its cache without touching siblings or another session",async()=>{
    const userData=await root(),service=new MediaAccessService(userData);
    const directory=join(userData,"session-media",sessionCacheKey("image-one"));await mkdir(directory,{recursive:true});
    const a=join(directory,"a.png"),b=join(directory,"b.png");await writeFile(a,"a");await writeFile(b,"b");
    const first=await service.register("image-one",a,"image","image/png"),second=await service.register("image-one",b,"image","image/png");
    await service.removeSources("another-session",[first.url]);expect(await readFile(a,"utf8")).toBe("a");
    await service.removeSources("image-one",[first.url]);
    await expect(service.resolve(first.url)).rejects.toThrow("已失效");
    await expect(readFile(a,"utf8")).rejects.toThrow();
    expect((await service.resolve(second.url)).sessionId).toBe("image-one");
  });
  it("code gallery excludes attachments, image-mode and deleting owners without exposing paths",async()=>{
    const userData=await root(),service=new MediaAccessService(userData);
    for(const id of ["code","deleting","image-gallery"]){
      const directory=join(userData,"session-media",sessionCacheKey(id));await mkdir(directory,{recursive:true});const path=join(directory,"image.png");await writeFile(path,"fixture");await service.register(id,path,"image","image/png");
    }
    const attachments=join(userData,"session-attachments",sessionCacheKey("code"));await mkdir(attachments,{recursive:true});const attachment=join(attachments,"reference.png");await writeFile(attachment,"fixture");await service.registerAttachment("code",attachment,"image/png");
    const rows=await service.listGeneratedImages(new Set(["deleting"]));
    expect(rows).toHaveLength(1);expect(rows[0]?.sessionId).toBe("code");expect(rows[0]).not.toHaveProperty("path");
    expect(await service.listGeneratedImages(new Set(),0)).toEqual([]);
  });
  it("rejects empty and malformed session identities before deriving cache paths", async () => {
    const userData = await root();
    const service = new MediaAccessService(userData);
    await expect(service.register("", join(userData, "missing.png"), "image", "image/png")).rejects.toThrow(/会话 ID 无效/);
    await expect(service.removeSession(`bad\0session`)).rejects.toThrow(/会话 ID 无效/);
  });

  it("returns an opaque persistent handle for one session cache", async () => {
    const userData = await root();
    const directory = join(userData, "session-media", sessionCacheKey("s"));
    await mkdir(directory, { recursive: true });
    const path = join(directory, "result.png");
    await writeFile(path, "png");
    const canonical = await realpath(path);
    const handle = await new MediaAccessService(userData).register("s", path, "image", "image/png");
    expect(handle.url).toMatch(/^grok-media:\/\/access\/[0-9a-f-]{36}$/);
    expect(handle.url).not.toContain(path);
    expect((await new MediaAccessService(userData).resolve(handle.url)).path).toBe(canonical);
  });

  it("reuses one handle for the same cached file instead of growing the ledger", async () => {
    const userData = await root();
    const directory = join(userData, "session-media", sessionCacheKey("s"));
    await mkdir(directory, { recursive: true });
    const path = join(directory, "result.png");
    await writeFile(path, "png");
    const service = new MediaAccessService(userData);
    const first = await service.register("s", path, "image", "image/png");
    const second = await service.register("s", path, "image", "image/png", "renamed.png");
    expect(second.url).toBe(first.url);
    expect(second.name).toBe("renamed.png");
  });

  it("rejects a valid handle when the caller expects another session", async () => {
    const userData = await root();
    const directory = join(userData, "session-media", sessionCacheKey("first"));
    await mkdir(directory, { recursive: true });
    const path = join(directory, "result.png");
    await writeFile(path, "png");
    const canonical = await realpath(path);
    const service = new MediaAccessService(userData);
    const handle = await service.register("first", path, "image", "image/png");
    await expect(service.resolve(handle.url, "second")).rejects.toThrow(/不属于当前会话/);
    await expect(service.resolve(handle.url, "first")).resolves.toMatchObject({ sessionId: "first", path: canonical });
  });

  it("rejects registration outside the exact session cache", async () => {
    const userData = await root();
    const directory = join(userData, "session-media", sessionCacheKey("s"));
    await mkdir(directory, { recursive: true });
    const outside = join(userData, "outside.png");
    await writeFile(outside, "png");
    await expect(new MediaAccessService(userData).register("s", outside, "image", "image/png")).rejects.toThrow(/不属于/);
  });

  it("issues the same opaque handle for one session attachment without exposing its path", async () => {
    const userData = await root();
    const directory = join(userData, "session-attachments", sessionCacheKey("s"));
    await mkdir(directory, { recursive: true });
    const path = join(directory, "paste.png");
    await writeFile(path, "png");
    const canonical = await realpath(path);
    const service = new MediaAccessService(userData);
    const handle = await service.registerAttachment("s", path, "image/png", "paste.png");
    expect(handle.url).toMatch(/^grok-media:\/\/access\/[0-9a-f-]{36}$/);
    expect(handle.url).not.toContain(path);
    expect((await service.resolve(handle.url)).path).toBe(canonical);
  });

  it("revokes handles when a session is deleted", async () => {
    const userData = await root();
    const directory = join(userData, "session-media", sessionCacheKey("s"));
    await mkdir(directory, { recursive: true });
    const path = join(directory, "result.png");
    await writeFile(path, "png");
    const service = new MediaAccessService(userData);
    const handle = await service.register("s", path, "image", "image/png");
    await service.removeSession("s");
    await expect(service.resolve(handle.url)).rejects.toThrow(/失效/);
  });

  it("expires old handles and caps records retained for one live session", async () => {
    const userData = await root();
    let now = new Date("2026-01-01T00:00:00.000Z");
    const directory = join(userData, "session-media", sessionCacheKey("s"));
    await mkdir(directory, { recursive: true });
    const service = new MediaAccessService(userData, { now: () => now, ttlMs: 1_000, maxRecordsPerSession: 2, maxRecords: 10 });
    const firstPath = join(directory, "first.png");
    await writeFile(firstPath, "one");
    const expired = await service.register("s", firstPath, "image", "image/png");
    now = new Date(now.getTime() + 1_001);
    await expect(service.resolve(expired.url, "s")).rejects.toThrow(/过期/);

    const handles = [];
    for (const name of ["a.png", "b.png", "c.png"]) {
      const path = join(directory, name);
      await writeFile(path, name);
      handles.push(await service.register("s", path, "image", "image/png"));
      now = new Date(now.getTime() + 1);
    }
    await service.sweep(new Set(["s"]));
    await expect(service.resolve(handles[0]!.url, "s")).rejects.toThrow(/失效/);
    await expect(service.resolve(handles[1]!.url, "s")).resolves.toMatchObject({ sessionId: "s" });
    await expect(service.resolve(handles[2]!.url, "s")).resolves.toMatchObject({ sessionId: "s" });
  });
});
