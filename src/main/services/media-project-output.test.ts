import { mkdtemp, readFile, rm, writeFile, mkdir, symlink, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { prepareMediaProjectOutput, saveProjectMedia } from "./media-project-output";
import { validateIpcInvocation } from "../ipc-schema";

const roots:string[]=[];
afterEach(async()=>{for(const root of roots.splice(0))await rm(root,{recursive:true,force:true})});
async function fixture(){const root=await mkdtemp(join(tmpdir(),"grok-media-output-"));roots.push(root);const project=join(root,"project");await mkdir(project);const source=join(root,"cache.png");await writeFile(source,"already-validated-image");return {root,project,source};}
describe("project media copies",()=>{
  it("creates a project-relative output and saves distinct files without moving the preview cache",async()=>{
    const {project,source}=await fixture();const output=await prepareMediaProjectOutput(project,"generated/images");
    const first=await saveProjectMedia(output,source,"image/png"),second=await saveProjectMedia(output,source,"image/png");
    expect(first).not.toBe(second);expect(await readFile(first,"utf8")).toBe(await readFile(source,"utf8"));
    expect(await readdir(output.directory)).toHaveLength(2);
  });
  it("rejects absolute paths, parent traversal, ADS, reserved names and invalid IPC fields before generation",async()=>{
    const {project}=await fixture();
    for(const value of ["../outside","C:\\outside","/outside","foo/../bar","foo:stream","con","foo/","a\\..\\b"])
      await expect(prepareMediaProjectOutput(project,value)).rejects.toThrow();
    expect(()=>validateIpcInvocation("media:start",[{sessionId:"s",kind:"image",prompt:"image",aspectRatio:"1:1",projectOutputDirectory:12}],1)).toThrow();
    expect(()=>validateIpcInvocation("media:start",[{sessionId:"s",kind:"image",prompt:"image",aspectRatio:"1:1",projectOutputDirectory:"generated/images"}],1)).not.toThrow();
  });
  it("refuses junction escapes both before generation and after a destination is replaced",async()=>{
    const {root,project,source}=await fixture();const outside=join(root,"outside");await mkdir(outside);
    await symlink(outside,join(project,"escape"),process.platform==="win32"?"junction":"dir");
    await expect(prepareMediaProjectOutput(project,"escape/images")).rejects.toThrow();
    const output=await prepareMediaProjectOutput(project,"images");
    await rm(output.directory,{recursive:true});await symlink(outside,output.directory,process.platform==="win32"?"junction":"dir");
    await expect(saveProjectMedia(output,source,"image/png")).rejects.toThrow();
    expect(await readdir(outside)).toEqual([]);
  });
  it("does not recreate a deleted destination or save after cancellation",async()=>{
    const {project,source}=await fixture();const output=await prepareMediaProjectOutput(project,"images");
    const abort=new AbortController();abort.abort();
    await expect(saveProjectMedia(output,source,"image/png",abort.signal)).rejects.toThrow();
    expect(await readdir(output.directory)).toEqual([]);
    await rm(output.directory,{recursive:true});
    await expect(saveProjectMedia(output,source,"image/png")).rejects.toThrow();
    expect(await readdir(project)).toEqual([]);
  });
});
