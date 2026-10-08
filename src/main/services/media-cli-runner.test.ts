import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildCliMediaArgs, cliMediaTurnUsage, mediaCliFailureMessage, runCliMediaProcess } from "./media-cli-runner";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

async function fixture(source: string): Promise<{ root: string; script: string }> {
  const root = await mkdtemp(join(tmpdir(), "grok-media-cli-"));
  roots.push(root);
  const script = join(root, "fake-cli.cjs");
  await writeFile(script, source, "utf8");
  return { root, script };
}

describe("runCliMediaProcess", () => {
  it("passes the explicit dispatch model for both new and resumed work",()=>{for(const resume of [false,true]){const args=buildCliMediaArgs("draw","id","image_gen",resume,"explicit-model");expect(args.slice(-2)).toEqual(["--model","explicit-model"]);}});
  it("extends the same running process and accepts a buffered tool response",async()=>{
    const {root,script}=await fixture("console.log(JSON.stringify({type:'tool_use',name:'image_gen'}));process.stdin.once('data',()=>{process.stdout.write(JSON.stringify({type:'tool_result',name:'image_gen',result:{path:process.argv[2]}}));process.stdin.destroy()});process.stdin.resume();");
    let child: ChildProcessWithoutNullStreams | undefined, extend: (() => void) | undefined, spawns=0;
    let generating!: () => void;
    const ready = new Promise<void>(resolve => { generating = resolve; });
    vi.useFakeTimers();
    try {
      const running = runCliMediaProcess({executable:process.execPath,args:[script,join(root,"buffered.png")],cwd:root,env:process.env,media:"image",signal:new AbortController().signal,idleTimeoutMs:80,generationTimeoutMs:170,
        onSpawn:value=>{child=value;spawns++;}, onWaitControl:value=>{extend=value;}, onProgress:value=>{if(value?.stage==="generating")generating();}});
      await ready;
      await vi.advanceTimersByTimeAsync(150); extend!();
      await vi.advanceTimersByTimeAsync(150);
      expect(child!.killed).toBe(false); expect(spawns).toBe(1);
      child!.stdin.end("finish\n");
      expect(await running).toHaveLength(1);
    } finally { child?.kill(); vi.useRealTimers(); }
  });
  it("records only explicit invocation-final usage, never sums per-message notifications or invents totals",async()=>{
    const {root,script}=await fixture("console.log(JSON.stringify({type:'usage',usage:{input_tokens:80,output_tokens:20}})); console.log(JSON.stringify({type:'tool_result',name:'image_gen',result:{path:process.argv[2]}})); console.log(JSON.stringify({type:'end',usage:{inputTokens:80,outputTokens:20,totalTokens:100},modelUsage:{actual:{}}}));");
    const onUsage=vi.fn();await runCliMediaProcess({executable:process.execPath,args:[script,join(root,'image.png')],cwd:root,env:process.env,media:'image',signal:new AbortController().signal,onUsage});
    expect(onUsage).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({totalTokens:100,inputTokens:80,modelId:"actual"}));
    expect(cliMediaTurnUsage({type:"end",usage:{input_tokens:8,output_tokens:2}})?.totalTokens).toBeUndefined();
    expect(cliMediaTurnUsage({type:"end",usage:{}})).toBeUndefined();
  });
  it("ends on an official terminal error without waiting for inactivity or accepting a prior artifact", async () => {
    const { root, script } = await fixture("console.log(JSON.stringify({type:'tool_result',name:'image_gen',result:{path:process.argv[2]}})); console.log(JSON.stringify({type:'error',message:'Not signed in: credentials expired'})); setInterval(()=>{},1000);");
    await expect(runCliMediaProcess({executable:process.execPath,args:[script,join(root,'partial.png')],cwd:root,env:process.env,media:'image',signal:new AbortController().signal,idleTimeoutMs:30_000})).rejects.toThrow('Not signed in: credentials expired');
  });
  it("does not treat assistant text or nested tool errors as terminal protocol errors", async () => {
    const { root, script } = await fixture("console.log(JSON.stringify({type:'assistant',message:'Not signed in'})); console.log(JSON.stringify({type:'tool_result',name:'image_gen',result:{type:'error',message:'retrying'}})); console.log(JSON.stringify({type:'tool_result',name:'image_gen',result:{path:process.argv[2]}}));");
    const path=join(root,'success.png');
    await expect(runCliMediaProcess({executable:process.execPath,args:[script,path],cwd:root,env:process.env,media:'image',signal:new AbortController().signal})).resolves.toEqual([expect.objectContaining({source:path})]);
  });
  it("continues an image conversation's CLI session instead of starting a new one", () => {
    const args = buildCliMediaArgs("make it blue", "00000000-0000-4000-8000-000000000002", "image_gen,image_edit", true);
    expect(args).toContain("--resume");
    expect(args).not.toContain("--session-id");
    expect(args[args.indexOf("--resume") + 1]).toBe("00000000-0000-4000-8000-000000000002");
  });
  it("isolates headless media work in an explicit transient CLI session", () => {
    expect(buildCliMediaArgs("draw a cat", "00000000-0000-4000-8000-000000000001", "image_gen")).toEqual([
      "--no-auto-update", "--single", "draw a cat",
      "--session-id", "00000000-0000-4000-8000-000000000001",
      "--output-format", "streaming-json",
      "--always-approve",
      "--tools", "image_gen",
    ]);
  });

  it("extracts a concrete artifact from fake streaming-json", async () => {
    const { root, script } = await fixture("process.stdout.write(JSON.stringify({type:'tool_result',name:'image_gen',result:{path:process.argv[2]}})+'\\n');");
    const output = join(root, "result.png");
    const result = await runCliMediaProcess({
      executable: process.execPath,
      args: [script, output],
      cwd: root,
      env: process.env,
      media: "image",
      signal: new AbortController().signal,
    });
    expect(result).toEqual([expect.objectContaining({ media: "image", source: output })]);
  });

  it("terminates a fake CLI when the inactivity timeout expires", async () => {
    const { root, script } = await fixture("setInterval(() => {}, 1000);");
    await expect(runCliMediaProcess({
      executable: process.execPath,
      args: [script],
      cwd: root,
      env: process.env,
      media: "video",
      signal: new AbortController().signal,
      idleTimeoutMs: 60,
    })).rejects.toThrow("连续 1 秒没有输出");
  });

  it("does not impose a wall-clock ceiling while the CLI keeps reporting progress", async () => {
    const { root, script } = await fixture("let n=0; const t=setInterval(()=>{ process.stderr.write('progress\\n'); if(++n===4){ clearInterval(t); process.stdout.write(JSON.stringify({type:'tool_result',name:'image_gen',result:{path:process.argv[2]}})+'\\n'); } },80);");
    const output = join(root, "long-result.png");
    await expect(runCliMediaProcess({
      executable: process.execPath,
      args: [script, output],
      cwd: root,
      env: process.env,
      media: "image",
      signal: new AbortController().signal,
      idleTimeoutMs: 200,
    })).resolves.toEqual([expect.objectContaining({ source: output })]);
  });

  it("terminates a fake CLI immediately when the media job is cancelled", async () => {
    const { root, script } = await fixture("setInterval(() => {}, 1000);");
    const controller = new AbortController();
    const running = runCliMediaProcess({
      executable: process.execPath,
      args: [script],
      cwd: root,
      env: process.env,
      media: "image",
      signal: controller.signal,
      idleTimeoutMs: 5_000,
    });
    setTimeout(() => controller.abort(new Error("用户取消媒体任务")), 40);
    await expect(running).rejects.toThrow("用户取消媒体任务");
  });

  it("keeps the actionable ZDR video configuration error when the CLI exits without an artifact", async () => {
    const message = "Video generation API error: Zero Data Retention teams must provide output.upload_url for video generation.";
    const { root, script } = await fixture(`process.stderr.write(${JSON.stringify(message)});`);
    await expect(runCliMediaProcess({
      executable: process.execPath,
      args: [script],
      cwd: root,
      env: process.env,
      media: "video",
      signal: new AbortController().signal,
    })).rejects.toThrow("output.upload_url");
    expect(mediaCliFailureMessage(`\u001b[31m${message}\u001b[0m`)).toContain("output.upload_url");
  });
});
