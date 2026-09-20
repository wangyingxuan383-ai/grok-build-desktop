import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, expect, it } from "vitest";

const children: ChildProcessWithoutNullStreams[] = [];
afterEach(async () => {
  await Promise.all(children.splice(0).map(child => new Promise<void>(done => {
    if (child.exitCode !== null || child.signalCode !== null) { done(); return; }
    child.once("exit", () => done()); child.kill();
  })));
});
const host = resolve("resources/native/win-x64/GrokComputerHost.exe");
it.skipIf(process.platform !== "win32" || !existsSync(host))("the native desktop mutex excludes another process and is reclaimed after its owner crashes", async () => {
  const start = async () => {
    const child = spawn(host, ["--lease-probe"], { windowsHide: true, stdio: "pipe" }); children.push(child);
    const result = await new Promise<string>((done, reject) => { child.once("error", reject); child.stdout.once("data", chunk => done(String(chunk).trim())); });
    return { child, result };
  };
  const owner = await start(); expect(owner.result).toBe("acquired");
  expect((await start()).result).toBe("busy");
  await new Promise<void>(done => { owner.child.once("exit", () => done()); owner.child.kill(); });
  expect((await start()).result).toBe("acquired");
});
