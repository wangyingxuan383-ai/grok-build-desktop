import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
vi.mock("electron",()=>({app:{},clipboard:{},desktopCapturer:{},dialog:{},Menu:{},nativeImage:{},nativeTheme:{},Notification:class{},session:{},shell:{},safeStorage:{}}));
import { AppController } from "./app-controller";
import { prepareMediaProjectOutput } from "./services/media-project-output";

async function setup() {
  const root=await mkdtemp(join(tmpdir(),"grok-media-job-output-"));
  const workspace=join(root,"original-project");await mkdir(workspace);
  const source=join(root,"validated-cache.png");await writeFile(source,"validated-image");
  const output=await prepareMediaProjectOutput(workspace,"generated/images");
  const job:any={jobId:"job",sessionId:"original-session",route:"provider",kind:"image",artifacts:[]};
  const controller:any={mediaJobs:new Map([["job",job]]),mediaJobControls:new Map([["job",{abort:new AbortController()}]]),mediaWaitExtensions:new Map(),
    inbox:{add:vi.fn(async()=>undefined)},notices:()=>({show:vi.fn(async()=>undefined)}),
    publishMediaJob:vi.fn(),runProviderMedia:vi.fn(async()=>[{id:"image",media:"image",source:"provider-data"}]),
    providerMediaAllowedOrigins:async()=>[],cacheMediaArtifact:vi.fn(async()=>({id:"image",media:"image",source:"grok-media://access/fixture",mimeType:"image/png"})),
    mediaAccess:{resolve:vi.fn(async()=>({path:source,mimeType:"image/png"}))},handleEvent:vi.fn(async()=>{})};
  const run=()=> (AppController.prototype as any).runMediaJob.call(controller,"job",{sessionId:"original-session",kind:"image",route:"provider"},output,workspace);
  return {root,workspace,output,job,controller,run};
}
describe("media result project handoff",()=>{
  it("rejects invalid output or a changed project before starting any generation",async()=>{
    const test=await setup();try {
      test.controller.deletingSessions=new Set();
      test.controller.processes={snapshot:vi.fn(()=>({cwd:test.workspace}))};
      test.controller.runMediaJob=vi.fn();
      const request:any={sessionId:"original-session",kind:"image",prompt:"draw",aspectRatio:"1:1",route:"cli",projectOutputDirectory:"../outside"};
      await expect(AppController.prototype.startMediaGeneration.call(test.controller,request)).rejects.toThrow();
      test.controller.processes.snapshot.mockReturnValueOnce({cwd:test.workspace}).mockReturnValue({cwd:join(test.root,"other")});
      await expect(AppController.prototype.startMediaGeneration.call(test.controller,{...request,projectOutputDirectory:"generated/images"})).rejects.toThrow("项目已改变");
      expect(test.controller.runMediaJob).not.toHaveBeenCalled();
    }finally{await rm(test.root,{recursive:true,force:true})}
  });
  it("ignores a late cached result after cancellation before publishing or exporting it",async()=>{
    const test=await setup();try {
      test.controller.cacheMediaArtifact.mockImplementation(async()=>{test.controller.mediaJobControls.get("job").abort.abort();return {id:"late",source:"grok-media://access/late"}});
      await test.run();expect(test.job.status).toBe("cancelled");
      expect(test.controller.handleEvent).not.toHaveBeenCalled();expect(test.controller.mediaAccess.resolve).not.toHaveBeenCalled();
    }finally{await rm(test.root,{recursive:true,force:true})}
  });
  it("saves from the exact session handle to the submitted project and keeps cache preview",async()=>{
    const test=await setup();try {
      await test.run();expect(test.job.status).toBe("completed");
      expect(test.controller.mediaAccess.resolve).toHaveBeenCalledWith("grok-media://access/fixture","original-session");
      expect(test.job.savedProjectFiles).toHaveLength(1);
      expect(await readFile(test.job.savedProjectFiles[0],"utf8")).toBe("validated-image");
      expect(test.controller.handleEvent).toHaveBeenCalledWith(expect.objectContaining({sessionId:"original-session",source:"grok-media://access/fixture"}));
    }finally{await rm(test.root,{recursive:true,force:true})}
  });
  it("keeps generated media on export failure and never regenerates to retry saving",async()=>{
    const test=await setup();try {
      await rm(test.output.directory,{recursive:true});await test.run();
      expect(test.job.status).toBe("completed");expect(test.job.artifacts).toHaveLength(1);
      expect(test.job.outputWarning).toContain("无需重新生成");
      expect(test.controller.runProviderMedia).toHaveBeenCalledTimes(1);
    }finally{await rm(test.root,{recursive:true,force:true})}
  });
  it("never labels an empty generation successful",async()=>{
    const test=await setup();try {
      test.controller.runProviderMedia.mockResolvedValue([]);await test.run();
      expect(test.job.status).toBe("failed");expect(test.job.error).toContain("没有返回");
      expect(test.controller.cacheMediaArtifact).not.toHaveBeenCalled();
    }finally{await rm(test.root,{recursive:true,force:true})}
  });
});
