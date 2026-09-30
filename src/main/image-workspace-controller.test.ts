import {mkdtemp,mkdir,readFile,realpath,rm,writeFile} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {afterEach,expect,it,vi} from "vitest";
vi.mock("electron",()=>({app:{},clipboard:{},desktopCapturer:{},dialog:{},Menu:{},nativeImage:{},nativeTheme:{},Notification:class{},session:{},shell:{},safeStorage:{}}));
import {AppController} from "./app-controller";
import {MediaAccessService} from "./services/media-access-service";
import {sessionCacheKey} from "./services/media-cache-service";
const roots:string[]=[];afterEach(async()=>{for(const root of roots.splice(0))await rm(root,{recursive:true,force:true})});
it("recovers an original from its persisted receipt, but revokes a late recovery after deletion",async()=>{
 const root=await mkdtemp(join(tmpdir(),"grok-original-"));roots.push(root);const path=join(root,"original.png");await writeFile(path,"fixture");
 let exists=true;
 const artifact={id:"original",source:"grok-media://access/fixture"};
 const controller={deletingSessions:new Set(),imageWorkspace:{get:vi.fn(async()=>exists?{jobs:[{job:{jobId:"job",artifacts:[{id:"art-1",savedPath:path}]}}]}:undefined)},cacheMediaArtifact:vi.fn(async()=>artifact),mediaAccess:{removeSession:vi.fn()}};
 expect(await AppController.prototype.previewImageOriginal.call(controller as any,"image-one","job","art-1")).toBe(artifact);
 await expect(AppController.prototype.previewImageOriginal.call(controller as any,"image-one","job","art-2")).rejects.toThrow("保存记录");
 controller.cacheMediaArtifact.mockImplementation(async()=>{exists=false;return artifact});
 await expect(AppController.prototype.previewImageOriginal.call(controller as any,"image-one","job","art-1")).rejects.toThrow("已删除");
 expect(controller.mediaAccess.removeSession).toHaveBeenCalledWith("image-one");
});
it("starts a Provider image conversation without opening a coding CLI",async()=>{const root=await mkdtemp(join(tmpdir(),"grok-image-main-"));roots.push(root);const controller={deletingSessions:new Set(),processes:{snapshot:vi.fn(()=>undefined),open:vi.fn()},imageWorkspace:{get:vi.fn(async()=>({cwd:root}))},mediaJobs:new Map(),mediaJobControls:new Map(),publishMediaJob:vi.fn(),runMediaJob:vi.fn()};const result=await AppController.prototype.startMediaGeneration.call(controller as any,{sessionId:"image-one",kind:"image",prompt:"cat",aspectRatio:"1:1",route:"provider",providerId:"p",modelId:"m",projectOutputDirectory:"originals"});expect(result.status).toBe("queued");expect(controller.processes.open).not.toHaveBeenCalled();expect(controller.runMediaJob).toHaveBeenCalled()});
it("authorizes background media by its explicit owner and rejects a mismatched owner",async()=>{const root=await mkdtemp(join(tmpdir(),"grok-media-owner-"));roots.push(root);const directory=join(root,"session-media",sessionCacheKey("background"));await mkdir(directory,{recursive:true});const path=join(directory,"image.png");await writeFile(path,"fixture");const mediaAccess=new MediaAccessService(root);const handle=await mediaAccess.register("background",path,"image","image/png");const controller={mediaAccess,focusedSessionId:"foreground",deletingSessions:new Set(),resolveTrustedMediaPath:(AppController.prototype as any).resolveTrustedMediaPath};expect((await AppController.prototype.resolveMediaRequest.call(controller as any,`${handle.url}?session=background`)).path).toBe(await realpath(path));await expect(AppController.prototype.resolveMediaRequest.call(controller as any,`${handle.url}?session=foreground`)).rejects.toThrow("不属于");controller.deletingSessions.add("background");await expect(AppController.prototype.resolveMediaRequest.call(controller as any,`${handle.url}?session=background`)).rejects.toThrow("删除")});
it("deletes a generation record and only removes its image files from the conversation folder", async () => {
  const root = await mkdtemp(join(tmpdir(), "grok-delete-job-")); roots.push(root);
  const conversation = join(root, "image-one"); await mkdir(conversation, { recursive: true });
  const inside = join(conversation, "originals-1.png"); await writeFile(inside, "png");
  const outside = join(root, "unrelated.png"); await writeFile(outside, "png");
  const notImage = join(conversation, "notes.txt"); await writeFile(notImage, "text");
  const missing = join(conversation, "gone.png");
  const removeJob = vi.fn(async () => undefined);
  const job = { jobId: "job", status: "completed", artifacts: [], savedProjectFiles: [inside, outside, notImage, missing] };
  const controller = {
    deletingSessions: new Set<string>(),
    imageWorkspace: { get: vi.fn(async () => ({ cwd: conversation, jobs: [{ job }] })), removeJob },
    savedFilesOf: (AppController.prototype as any).savedFilesOf,
    removeOwnedMediaFiles: (AppController.prototype as any).removeOwnedMediaFiles,
  };

  const keepFiles = await AppController.prototype.deleteImageJob.call(controller as any, "image-one", "job", false);
  expect(keepFiles).toEqual({ removedFiles: 0, keptFiles: [], recordRemoved: true });
  expect(removeJob).toHaveBeenCalledWith("image-one", "job");
  expect(await readFile(inside, "utf8")).toBe("png");
  removeJob.mockClear();

  const result = await AppController.prototype.deleteImageJob.call(controller as any, "image-one", "job", true);
  expect(result.removedFiles).toBe(1);
  expect(result.keptFiles).toEqual(expect.arrayContaining([outside, notImage]));
  expect(result.keptFiles).not.toContain(missing);
  expect(result.recordRemoved).toBe(false);
  expect(removeJob).not.toHaveBeenCalled();
  expect(await readFile(outside, "utf8")).toBe("png");
  expect(await readFile(notImage, "utf8")).toBe("text");
  await expect(readFile(inside, "utf8")).rejects.toThrow();

  controller.deletingSessions.add("image-one");
  await expect(AppController.prototype.deleteImageJob.call(controller as any, "image-one", "job", false)).rejects.toThrow("正在删除");
});

it("deletes one picture without touching its siblings, and drops a record left empty", async () => {
  const root = await mkdtemp(join(tmpdir(), "grok-delete-artifact-")); roots.push(root);
  const conversation = join(root, "image-two"); await mkdir(conversation, { recursive: true });
  const first = join(conversation, "a.png"); await writeFile(first, "a");
  const second = join(conversation, "b.png"); await writeFile(second, "b");
  const removeArtifact = vi.fn(async () => ({ cwd: conversation, savedPath: first, recordRemoved: false }));
  const job = { jobId: "job", status: "completed", artifacts: [{ id: "art-a", savedPath: first }, { id: "art-b", savedPath: second }] };
  const controller = {
    deletingSessions: new Set<string>(),
    mediaJobs: new Map([["job", job]]),
    imageWorkspace: { get: vi.fn(async () => ({ cwd: conversation, jobs: [{ job }] })), removeArtifact },
    savedFilesOf: (AppController.prototype as any).savedFilesOf,
    removeOwnedMediaFiles: (AppController.prototype as any).removeOwnedMediaFiles,
  };

  const result = await AppController.prototype.deleteImageArtifact.call(controller as any, "image-two", "job", "art-a", true);
  expect(result).toMatchObject({ removedFiles: 1, keptFiles: [], recordRemoved: false });
  await expect(readFile(first, "utf8")).rejects.toThrow();
  expect(await readFile(second, "utf8")).toBe("b");
  expect(removeArtifact).toHaveBeenCalledWith("image-two", "job", "art-a");
  expect(controller.mediaJobs.has("job")).toBe(false);
});

it("deletes a conversation's own files but keeps unrelated files and the folder holding them", async () => {
  const root = await mkdtemp(join(tmpdir(), "grok-delete-conversation-")); roots.push(root);
  const conversation = join(root, "image-three"); await mkdir(conversation, { recursive: true });
  const own = join(conversation, "originals-1.png"); await writeFile(own, "png");
  const mine = join(conversation, "my-notes.png"); await writeFile(mine, "mine");
  const remove = vi.fn(async () => undefined);
  const controller = {
    deletingSessions: new Set<string>(),
    catalog: { delete: vi.fn(async () => undefined) },
    mediaAccess: { removeSession: vi.fn() },
    imageWorkspace: {
      get: vi.fn(async () => ({ id: "image-three", cwd: conversation, cliSessionId: undefined, jobs: [{ job: { jobId: "job", status: "completed", artifacts: [{ id: "art-a", savedPath: own }], savedProjectFiles: [own] } }] })),
      list: vi.fn(async () => ({ outputRoot: root, conversations: [] })),
      remove,
    },
    savedFilesOf: (AppController.prototype as any).savedFilesOf,
    removeOwnedMediaFiles: (AppController.prototype as any).removeOwnedMediaFiles,
    pruneEmptyMediaFolder: (AppController.prototype as any).pruneEmptyMediaFolder,
  };

  const result = await AppController.prototype.deleteImageConversation.call(controller as any, "image-three", true);
  expect(result).toMatchObject({ removedFiles: true, removedFileCount: 1, keptFiles: [] });
  await expect(readFile(own, "utf8")).rejects.toThrow();
  // The folder is offered to the user in the UI, so their own file must survive it.
  expect(await readFile(mine, "utf8")).toBe("mine");
  expect(remove).toHaveBeenCalledWith("image-three");
});

it("keeps the conversation retryable after partial file removal and a CLI history failure", async () => {
  const job={jobId:"j",status:"completed",artifacts:[],savedProjectFiles:["saved.png"]};
  const row={id:"image-retry",cwd:"C:/pictures/image-retry",cliSessionId:"cli",jobs:[{job}]};
  const remove=vi.fn();
  const controller={deletingSessions:new Set<string>(),mediaJobs:new Map(),
    imageWorkspace:{get:vi.fn(async()=>row),remove},savedFilesOf:(AppController.prototype as any).savedFilesOf,
    removeOwnedMediaFiles:vi.fn(async()=>({removed:0,keptFiles:["saved.png"]})),
    catalog:{delete:vi.fn(async(): Promise<void>=>{throw Error("locked history")})},mediaAccess:{removeSession:vi.fn()},pruneEmptyMediaFolder:vi.fn()};
  const failed=await AppController.prototype.deleteImageConversation.call(controller as any,row.id,true);
  expect(failed.recordRemoved).toBe(false);expect(remove).not.toHaveBeenCalled();expect(controller.catalog.delete).not.toHaveBeenCalled();
  controller.removeOwnedMediaFiles.mockResolvedValue({removed:1,keptFiles:[]});
  const cliFailed=await AppController.prototype.deleteImageConversation.call(controller as any,row.id,true);
  expect(cliFailed).toMatchObject({recordRemoved:false,cleanupError:expect.stringContaining("locked history")});expect(remove).not.toHaveBeenCalled();
  controller.catalog.delete.mockResolvedValue(undefined);
  expect(await AppController.prototype.deleteImageConversation.call(controller as any,row.id,false)).toMatchObject({recordRemoved:true});
  expect(remove).toHaveBeenCalledWith(row.id);
});
