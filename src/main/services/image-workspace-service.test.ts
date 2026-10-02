import {mkdtemp,readFile,rm,writeFile} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {afterEach,expect,it} from "vitest";
import {ImageWorkspaceService} from "./image-workspace-service";
const roots:string[]=[];afterEach(async()=>{for(const root of roots.splice(0))await rm(root,{recursive:true,force:true})});
async function fixture(){const root=await mkdtemp(join(tmpdir(),"grok-image-workspace-"));roots.push(root);const service=new ImageWorkspaceService(root,join(root,"Pictures"));return {root,service,row:await service.create()}}
it("keeps full drafts and execution identity independently for image conversations",async()=>{const {service,row,root}=await fixture();const other=await service.create();const draft={draft:"edit",ratio:"16:9" as const,route:"cli" as const,model:"",cliModel:"explicit",references:[{id:"ref",name:"ref.png",kind:"image" as const,path:join(row.cwd,"ref.png")}],sources:[]};await service.composer(row.id,draft);await service.execution(row.id,{modelId:"explicit",providerId:"selected"});const restored=await new ImageWorkspaceService(root,"unused").get(row.id);expect(restored?.composerDraft).toEqual(draft);expect(restored?.execution?.providerId).toBe("selected");expect((await service.get(other.id))?.composerDraft).toBeUndefined();const reserved=await service.reserve({conversationId:row.id,requestId:"one",request:{kind:"image",prompt:"edit",aspectRatio:"16:9",modelId:"explicit",referencePaths:draft.references.map(row=>row.path)}});const after=await service.get(row.id);expect(after?.jobs[0]?.request?.modelId).toBe("explicit");expect(after?.composerDraft?.draft).toBe("");expect(after?.composerDraft?.references).toEqual([]);expect(reserved.created).toBe(true)});
it("reserves a repeated request once, rejects parallel generation and preserves ownership",async()=>{const {service,row}=await fixture();const input={conversationId:row.id,requestId:"same",request:{kind:"image" as const,prompt:"cat",aspectRatio:"1:1" as const}};const results=await Promise.all([service.reserve(input),service.reserve(input)]);expect(results.map(row=>row.created).sort()).toEqual([false,true]);expect(results[0]!.job.jobId).toBe(results[1]!.job.jobId);await expect(service.reserve({...input,requestId:"different"})).rejects.toThrow("运行");expect((await service.list()).conversations).toHaveLength(1)});
it("persists drafts and outputs, changes only future destinations, removes records without original files",async()=>{const {service,row,root}=await fixture();await service.draft(row.id,"edit draft");const first=await service.reserve({conversationId:row.id,requestId:"1",request:{kind:"image",prompt:"cat",aspectRatio:"1:1"}});await service.update({...first.job,status:"completed",updatedAt:new Date().toISOString()});const file=join(row.cwd,"original.png");await writeFile(file,"original");await service.root(join(root,"NewPictures"));await service.reserve({conversationId:row.id,requestId:"2",request:{kind:"image",prompt:"dog",aspectRatio:"1:1"}});
 // The CLI session's history is stored per folder, so an existing conversation must keep its own
 // folder even after the output root changes; only new conversations start under the new root.
 expect((await service.get(row.id))?.cwd).toBe(row.cwd);
 const empty=await service.create();expect(empty.cwd).toContain("NewPictures");const restarted=new ImageWorkspaceService(root,"unused",true);expect((await restarted.get(row.id))?.jobs[1]?.job.status).toBe("failed");expect((await restarted.get(row.id))?.jobs[0]?.job.status).toBe("completed");await restarted.draft(row.id,"saved draft");expect((await new ImageWorkspaceService(root,"unused").get(row.id))?.draft).toBe("saved draft");await restarted.remove(row.id);expect(await readFile(file,"utf8")).toBe("original");expect((await restarted.list()).conversations.map(value=>value.id)).toEqual([empty.id])});
it("worker readers do not mark a live GUI image task interrupted",async()=>{const {service,row,root}=await fixture();await service.reserve({conversationId:row.id,requestId:"1",request:{kind:"image",prompt:"x",aspectRatio:"auto"}});const worker=new ImageWorkspaceService(root,"unused");expect((await worker.get(row.id))?.jobs[0]?.job.status).toBe("queued");await expect(worker.remove(row.id)).rejects.toThrow("取消")});

it("removes a failed or finished generation record, but refuses a running one", async () => {
  const { service, row } = await fixture();
  const submit = (requestId: string) => service.reserve({ conversationId: row.id, requestId, request: { kind: "image", prompt: requestId, aspectRatio: "1:1" } });
  const first = await submit("first");
  await expect(service.removeJob(row.id, first.job.jobId)).rejects.toThrow("请先取消");
  await service.update({ ...first.job, status: "failed", error: "登录已过期", updatedAt: new Date(Date.parse(first.job.updatedAt) + 1000).toISOString() });
  const second = await submit("second");
  await service.update({ ...second.job, status: "completed", savedProjectFiles: ["keep.png"], updatedAt: new Date(Date.parse(second.job.updatedAt) + 1000).toISOString() });

  const removed = await service.removeJob(row.id, first.job.jobId);
  expect(removed.job.error).toBe("登录已过期");
  expect((await service.get(row.id))?.jobs.map((record) => record.requestId)).toEqual(["second"]);
  await expect(service.removeJob(row.id, first.job.jobId)).rejects.toThrow("已不存在");
  await expect(service.removeJob("image-missing", "x")).rejects.toThrow("图像会话已不存在");
});

it("names a session after its first prompt only, and keeps a name the user chose", async () => {
  const { service, row } = await fixture();
  const submit = (requestId: string, prompt: string) => service.reserve({ conversationId: row.id, requestId, request: { kind: "image", prompt, aspectRatio: "1:1" } });
  const first = await submit("a", "a red fox in snow");
  await service.update({ ...first.job, status: "completed", updatedAt: new Date(Date.parse(first.job.updatedAt) + 1000).toISOString() });
  expect((await service.get(row.id))?.title).toBe("a red fox in snow");
  const second = await submit("b", "make it blue");
  await service.update({ ...second.job, status: "completed", updatedAt: new Date(Date.parse(second.job.updatedAt) + 1000).toISOString() });
  expect((await service.get(row.id))?.title).toBe("a red fox in snow");
  await service.rename(row.id, "  狐狸系列  ");
  expect((await service.get(row.id))?.title).toBe("狐狸系列");
  await expect(service.rename(row.id, "   ")).rejects.toThrow("不能为空");
  await expect(service.rename("image-missing", "x")).rejects.toThrow("已不存在");
});

it("records what each generation started from", async () => {
  const { service, row, root } = await fixture();
  await service.reserve({ conversationId: row.id, requestId: "a", referenceSources: ["grok-media://access/1"], request: { kind: "image", prompt: "edit", aspectRatio: "16:9", referencePaths: [join(root, "pics", "ref.png")] } });
  expect((await service.get(row.id))?.jobs[0]).toMatchObject({ aspectRatio: "16:9", references: { names: ["ref.png"], sources: ["grok-media://access/1"] } });
});

it("worker readers preserve newly created conversations and do not rewrite the GUI store", async () => {
  const { service, root, row } = await fixture();
  const kept = await service.create();
  await service.draft(kept.id, "half-typed idea");
  expect((await service.list()).conversations.map((value) => value.id)).toContain(row.id);
  const reopened = new ImageWorkspaceService(root, join(root, "Pictures"));
  const before = await readFile(join(root,"image-workspace.json"),"utf8");
  expect((await reopened.list()).conversations.map((value) => value.id)).toEqual([row.id,kept.id]);
  expect(await readFile(join(root,"image-workspace.json"),"utf8")).toBe(before);
  await service.reserve({conversationId:row.id,requestId:"gui-request",request:{kind:"image",prompt:"cat",aspectRatio:"auto"}});
});

it("keeps native conversation context after the last artwork is removed and the GUI restarts", async () => {
  const {service,row,root}=await fixture();
  const reserved=await service.reserve({conversationId:row.id,requestId:"one",request:{kind:"image",prompt:"cat",aspectRatio:"auto"}});
  await service.setCliSession(row.id,"native-child");
  await service.update({...reserved.job,status:"completed",artifacts:[{id:"a",media:"image",source:"grok-media://access/one"}],updatedAt:new Date(Date.parse(reserved.job.updatedAt)+1000).toISOString()});
  await service.removeArtifact(row.id,reserved.job.jobId,"a");
  expect((await new ImageWorkspaceService(root,"unused",true).get(row.id))?.cliSessionId).toBe("native-child");
});

it("changes the next output destination while preserving native execution context", async () => {
  const {service,row,root}=await fixture();
  const first=await service.reserve({conversationId:row.id,requestId:"one",request:{kind:"image",prompt:"cat",aspectRatio:"auto"}});
  await service.update({...first.job,status:"completed",updatedAt:new Date(Date.parse(first.job.updatedAt)+1000).toISOString()});
  await service.root(join(root,"NewPictures"));
  const next=await service.reserve({conversationId:row.id,requestId:"two",request:{kind:"image",prompt:"warmer",aspectRatio:"auto"}});
  expect(next.job.outputRoot).toContain("NewPictures");
  expect((await service.get(row.id))?.cwd).toBe(row.cwd);
  expect((await service.get(row.id))?.jobs[0]?.job.outputRoot).toBe(first.job.outputRoot);
});
