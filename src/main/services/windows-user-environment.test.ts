import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { expect, it } from "vitest";
import { readWindowsUserVariable,WindowsUserEnvironment } from "./provider-service";

it.skipIf(process.platform !== "win32")("reads a real Windows user variable through stdin and restores the isolated variable", async () => {
  const name = `GROK_DESKTOP_TEST_${randomUUID().replaceAll("-", "")}`;
  const write = (value: string | null) => new Promise<void>((resolve, reject) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "$ErrorActionPreference='Stop';$p=[Console]::In.ReadToEnd()|ConvertFrom-Json;[Environment]::SetEnvironmentVariable($p.name,$p.value,[EnvironmentVariableTarget]::User)"], { windowsHide: true, stdio: ["pipe", "ignore", "ignore"] });
    child.once("error", reject); child.once("close", code => code === 0 ? resolve() : reject(new Error("fixture write failed")));
    child.stdin.end(JSON.stringify({ name, value }));
  });
  const before = await readWindowsUserVariable(name);
  const inherited=process.env[name];
  const environment=new WindowsUserEnvironment();
  try { process.env[name]="process-only-value";expect(await environment.readFresh(name)).toBe("process-only-value");await write("non-sensitive value"); expect(await readWindowsUserVariable(name)).toBe("non-sensitive value");expect(await environment.readFresh(name)).toBe("non-sensitive value");await write(null);expect(await environment.readFresh(name)).toBeUndefined(); }
  finally { await write(before ?? null);if(inherited===undefined)delete process.env[name];else process.env[name]=inherited; }
  expect(await readWindowsUserVariable(name)).toBe(before);
}, 30_000);
