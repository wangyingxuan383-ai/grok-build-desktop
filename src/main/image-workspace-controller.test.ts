import {mkdtemp,mkdir,readFile,realpath,rm,writeFile} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {afterEach,expect,it,vi} from "vitest";
vi.mock("electron",()=>({app:{},clipboard:{},desktopCapturer:{},dialog:{},Menu:{},nativeImage:{},nativeTheme:{},Notification:class{},session:{},shell:{},safeStorage:{}}));
import {AppController} from "./app-controller";
import {MediaAccessService} from "./services/media-access-service";
import {sessionCacheKey} from "./services/media-cache-service";
import {ImageWorkspaceService} from "./services/image-workspace-service";
import {recordOwnedMediaFile} from "./services/media-file-ownership";
const roots:string[]=[];afterEach(async()=>{for(const root of roots.splice(0))await rm(root,{recursive:true,force:true})});
function wireMediaCleanup(controller:any,root:string){
 Object.setPrototypeOf(controller,AppController.prototype);
 controller.userDataPath=root;
 controller.mediaAccess??={};controller.mediaAccess.removeSources??=vi.fn(async()=>undefined);
 controller.mediaThumbnails={removeSession:vi.fn(async()=>undefined)};
 return controller;
}
it("deletes all proven files of one new artwork across native/cache/output directories and preserves its conversation",async()=>{
 const root=await mkdtemp(join(tmpdir(),"grok-owned-artwork-"));roots.push(root);
 const imageWorkspace=new ImageWorkspaceService(root,join(root,"Pictures"));const row=await imageWorkspace.create();
 const reserved=await imageWorkspace.reserve({conversationId:row.id,requestId:"one",request:{kind:"image",prompt:"cat",aspectRatio:"auto"}});
 await imageWorkspace.setCliSession(row.id,"native-context");
 const nativeDir=join(root,"native-session"),outputDir=join(root,"new-output"),cacheDir=join(root,"session-media",sessionCacheKey(row.id));
 await Promise.all([nativeDir,outputDir,cacheDir].map(directory=>mkdir(directory,{recursive:true})));
 const original=join(nativeDir,"generated.png"),saved=join(outputDir,"saved.png"),cached=join(cacheDir,"preview.png"),sibling=join(nativeDir,"sibling.png"),mine=join(outputDir,"my-image.png");
 await Promise.all([original,saved,cached,sibling,mine].map(path=>writeFile(path,"fixture")));
 const mediaAccess=new MediaAccessService(root),handle=await mediaAccess.register(row.id,cached,"image","image/png");
 const ownedFiles=await Promise.all([recordOwnedMediaFile(original,nativeDir),recordOwnedMediaFile(saved,outputDir),recordOwnedMediaFile(cached,cacheDir)]);
 await imageWorkspace.update({...reserved.job,status:"completed",artifacts:[{id:"a",media:"image",source:handle.url,savedPath:saved,ownedFiles},{id:"b",media:"image",source:sibling,ownedFiles:[await recordOwnedMediaFile(sibling,nativeDir)]}],updatedAt:new Date(Date.parse(reserved.job.updatedAt)+1000).toISOString()});
 const controller:any=wireMediaCleanup({deletingSessions:new Set(),imageWorkspace,mediaAccess,mediaJobs:new Map(),catalog:{delete:vi.fn()}},root);
 const result=await AppController.prototype.deleteImageArtifact.call(controller,row.id,reserved.job.jobId,"a",true);
 expect(result).toEqual({removedFiles:3,keptFiles:[],recordRemoved:false});
 for(const path of [original,saved,cached])await expect(readFile(path)).rejects.toThrow();
 expect(await readFile(sibling,"utf8")).toBe("fixture");expect(await readFile(mine,"utf8")).toBe("fixture");
 expect((await imageWorkspace.get(row.id))?.cliSessionId).toBe("native-context");
 expect((await imageWorkspace.get(row.id))?.jobs[0]?.job.artifacts.map(artifact=>artifact.id)).toEqual(["b"]);
 await expect(mediaAccess.resolve(handle.url)).rejects.toThrow("已失效");expect(controller.catalog.delete).not.toHaveBeenCalled();
});
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
it("starts a Provider image conversation without opening a coding CLI",async()=>{const root=await mkdtemp(join(tmpdir(),"grok-image-main-"));roots.push(root);const controller={deletingSessions:new Set(),processes:{snapshot:vi.fn(()=>undefined),open:vi.fn()},imageWorkspace:{get:vi.fn(async()=>({cwd:root}))},mediaJobs:new Map(),mediaJobControls:new Map(),mediaJobFlights:new Map(),publishMediaJob:vi.fn(),runMediaJob:vi.fn(async()=>undefined),log:{log:vi.fn(async()=>undefined)}};const result=await AppController.prototype.startMediaGeneration.call(controller as any,{sessionId:"image-one",kind:"image",prompt:"cat",aspectRatio:"1:1",route:"provider",providerId:"p",modelId:"m",projectOutputDirectory:"originals"});expect(result.status).toBe("queued");expect(controller.processes.open).not.toHaveBeenCalled();expect(controller.runMediaJob).toHaveBeenCalled()});
it("authorizes background media by its explicit owner and rejects a mismatched owner",async()=>{const root=await mkdtemp(join(tmpdir(),"grok-media-owner-"));roots.push(root);const directory=join(root,"session-media",sessionCacheKey("background"));await mkdir(directory,{recursive:true});const path=join(directory,"image.png");await writeFile(path,"fixture");const mediaAccess=new MediaAccessService(root);const handle=await mediaAccess.register("background",path,"image","image/png");const controller={mediaAccess,focusedSessionId:"foreground",deletingSessions:new Set(),resolveTrustedMediaPath:(AppController.prototype as any).resolveTrustedMediaPath};expect((await AppController.prototype.resolveMediaRequest.call(controller as any,`${handle.url}?session=background`)).path).toBe(await realpath(path));await expect(AppController.prototype.resolveMediaRequest.call(controller as any,`${handle.url}?session=foreground`)).rejects.toThrow("不属于");controller.deletingSessions.add("background");await expect(AppController.prototype.resolveMediaRequest.call(controller as any,`${handle.url}?session=background`)).rejects.toThrow("删除")});
it("retains legacy files without ownership proof and keeps cleanup retryable", async () => {
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

  wireMediaCleanup(controller,root);
  const keepFiles = await AppController.prototype.deleteImageJob.call(controller as any, "image-one", "job", false);
  expect(keepFiles).toEqual({ removedFiles: 0, keptFiles: [], recordRemoved: true });
  expect(removeJob).toHaveBeenCalledWith("image-one", "job");
  expect(await readFile(inside, "utf8")).toBe("png");
  removeJob.mockClear();

  const result = await AppController.prototype.deleteImageJob.call(controller as any, "image-one", "job", true);
  expect(result.removedFiles).toBe(0);
  expect(result.keptFiles).toEqual(expect.arrayContaining([inside, outside, notImage]));
  expect(result.keptFiles).not.toContain(missing);
  expect(result.recordRemoved).toBe(false);
  expect(removeJob).not.toHaveBeenCalled();
  expect(await readFile(outside, "utf8")).toBe("png");
  expect(await readFile(notImage, "utf8")).toBe("text");
  expect(await readFile(inside, "utf8")).toBe("png");

  controller.deletingSessions.add("image-one");
  await expect(AppController.prototype.deleteImageJob.call(controller as any, "image-one", "job", false)).rejects.toThrow("正在删除");
});

it("deletes one picture without touching its siblings, and drops a record left empty", async () => {
  const root = await mkdtemp(join(tmpdir(), "grok-delete-artifact-")); roots.push(root);
  const conversation = join(root, "image-two"); await mkdir(conversation, { recursive: true });
  const first = join(conversation, "a.png"); await writeFile(first, "a");
  const second = join(conversation, "b.png"); await writeFile(second, "b");
  const removeArtifact = vi.fn(async () => ({ cwd: conversation, savedPath: first, recordRemoved: false }));
  const job = { jobId: "job", status: "completed", artifacts: [{ id: "art-a", savedPath: first, ownedFiles:[await recordOwnedMediaFile(first,conversation)] }, { id: "art-b", savedPath: second, ownedFiles:[await recordOwnedMediaFile(second,conversation)] }] };
  const controller = {
    deletingSessions: new Set<string>(),
    mediaJobs: new Map([["job", job]]),
    imageWorkspace: { get: vi.fn(async () => ({ cwd: conversation, jobs: [{ job }] })), list:vi.fn(async()=>({conversations:[]})), removeArtifact },
    savedFilesOf: (AppController.prototype as any).savedFilesOf,
    removeOwnedMediaFiles: (AppController.prototype as any).removeOwnedMediaFiles,
  };

  wireMediaCleanup(controller,root);
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
  const ownProof=await recordOwnedMediaFile(own,conversation);
  const remove = vi.fn(async () => undefined);
  const controller = {
    deletingSessions: new Set<string>(),
    catalog: { delete: vi.fn(async () => undefined) },
    mediaAccess: { removeSession: vi.fn() },
    imageWorkspace: {
      get: vi.fn(async () => ({ id: "image-three", cwd: conversation, cliSessionId: undefined, jobs: [{ job: { jobId: "job", status: "completed", artifacts: [{ id: "art-a", savedPath: own,ownedFiles:[ownProof] }], savedProjectFiles: [own] } }] })),
      list: vi.fn(async () => ({ outputRoot: root, conversations: [] })),
      remove,
    },
    savedFilesOf: (AppController.prototype as any).savedFilesOf,
    removeOwnedMediaFiles: (AppController.prototype as any).removeOwnedMediaFiles,
    pruneEmptyMediaFolder: (AppController.prototype as any).pruneEmptyMediaFolder,
  };

  wireMediaCleanup(controller,root);
  const result = await AppController.prototype.deleteImageConversation.call(controller as any, "image-three", true);
  expect(result).toMatchObject({ removedFiles: true, removedFileCount: 1, keptFiles: [] });
  await expect(readFile(own, "utf8")).rejects.toThrow();
  // The folder is offered to the user in the UI, so their own file must survive it.
  expect(await readFile(mine, "utf8")).toBe("mine");
  expect(remove).toHaveBeenCalledWith("image-three");
});

it("keeps the conversation retryable after partial file removal and a CLI history failure", async () => {
  const root=await mkdtemp(join(tmpdir(),"grok-image-retry-"));roots.push(root);
  const job={jobId:"j",status:"completed",artifacts:[],savedProjectFiles:["saved.png"]};
  const row={id:"image-retry",cwd:"C:/pictures/image-retry",cliSessionId:"cli",jobs:[{job}]};
  const remove=vi.fn();
  const controller={deletingSessions:new Set<string>(),mediaJobs:new Map(),
    imageWorkspace:{get:vi.fn(async()=>row),remove},savedFilesOf:(AppController.prototype as any).savedFilesOf,
    removeOwnedMediaFiles:vi.fn(async()=>({removed:0,keptFiles:["saved.png"]})),
    catalog:{delete:vi.fn(async(): Promise<void>=>{throw Error("locked history")})},mediaAccess:{removeSession:vi.fn()},pruneEmptyMediaFolder:vi.fn()};
  wireMediaCleanup(controller,root);
  const failed=await AppController.prototype.deleteImageConversation.call(controller as any,row.id,true);
  expect(failed.recordRemoved).toBe(false);expect(remove).not.toHaveBeenCalled();expect(controller.catalog.delete).not.toHaveBeenCalled();
  controller.removeOwnedMediaFiles.mockResolvedValue({removed:1,keptFiles:[]});
  const cliFailed=await AppController.prototype.deleteImageConversation.call(controller as any,row.id,true);
  expect(cliFailed).toMatchObject({recordRemoved:false,cleanupError:expect.stringContaining("locked history")});expect(remove).not.toHaveBeenCalled();
  controller.catalog.delete.mockResolvedValue(undefined);
  expect(await AppController.prototype.deleteImageConversation.call(controller as any,row.id,false)).toMatchObject({recordRemoved:true});
  expect(remove).toHaveBeenCalledWith(row.id);
});
