import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { preferredPowerShell } from "./powershell-path";

describe("preferred PowerShell", () => {
  const roots: string[] = [];
  afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
  const root = async (): Promise<string> => { const value = await mkdtemp(join(tmpdir(), "pwsh-path-")); roots.push(value); return value; };

  it("uses PowerShell 7 from PATH or its default install folder", async () => {
    const onPath = await root();
    await writeFile(join(onPath, "pwsh.exe"), "");
    expect(preferredPowerShell({ PATH: onPath })).toBe(join(onPath, "pwsh.exe"));
    const programFiles = await root();
    await mkdir(join(programFiles, "PowerShell", "7"), { recursive: true });
    await writeFile(join(programFiles, "PowerShell", "7", "pwsh.exe"), "");
    expect(preferredPowerShell({ PATH: "", ProgramFiles: programFiles })).toBe(join(programFiles, "PowerShell", "7", "pwsh.exe"));
  });

  it("falls back to Windows PowerShell when PowerShell 7 is absent", async () => {
    expect(preferredPowerShell({ PATH: await root(), ProgramFiles: await root() })).toBe("powershell.exe");
  });
});
