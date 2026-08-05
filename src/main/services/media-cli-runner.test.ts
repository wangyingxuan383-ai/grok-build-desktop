import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildCliMediaArgs, mediaCliFailureMessage, runCliMediaProcess } from "./media-cli-runner";

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
  it("isolates headless media work in an explicit transient CLI session", () => {
    expect(buildCliMediaArgs("draw a cat", "00000000-0000-4000-8000-000000000001", "image_gen")).toEqual([
      "--single", "draw a cat",
      "--session-id", "00000000-0000-4000-8000-000000000001",
      "--output-format", "streaming-json",
      "--always-approve",
      "--tools", "image_gen",
    ]);
  });

  it("extracts a concrete artifact from fake streaming-json", async () => {
    const { root, script } = await fixture("process.stdout.write(JSON.stringify({type:'tool_result',result:{path:process.argv[2]}})+'\\n');");
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
    const { root, script } = await fixture("let n=0; const t=setInterval(()=>{ process.stderr.write('progress\\n'); if(++n===4){ clearInterval(t); process.stdout.write(JSON.stringify({type:'tool_result',result:{path:process.argv[2]}})+'\\n'); } },80);");
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
