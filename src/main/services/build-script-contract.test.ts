import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const scripts = join(process.cwd(), "scripts");

describe("Windows build script failure contracts", () => {
  it("keeps Task Scheduler cleanup from replacing the create/run failure", async () => {
    const source = await readFile(join(scripts, "probe-task-scheduler.ps1"), "utf8");
    expect(source).not.toContain("<UserId>");
    expect(source).toContain("$created = $false");
    expect(source).toContain("if ($created)");
    expect(source).toContain("if ($primaryFailure)");
    expect(source.indexOf("$cleanupFailure = $null")).toBeLessThan(source.indexOf("if ($primaryFailure)"));
    expect(source).not.toMatch(/finally\s*\{[^}]*schtasks\.exe/is);
  });

  it("lets the contributor bootstrap degrade a policy-blocked scheduler without weakening the release gate", async () => {
    const bootstrap = await readFile(join(scripts, "bootstrap.ps1"), "utf8");
    const packaging = await readFile(join(scripts, "package-win.ps1"), "utf8");
    expect(bootstrap).toContain("-AllowUnavailableTaskScheduler");
    expect(packaging).toContain("[switch]$AllowUnavailableTaskScheduler");
    expect(packaging).toContain("if (-not $AllowUnavailableTaskScheduler) { throw }");
  });
});
