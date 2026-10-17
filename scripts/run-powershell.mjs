// Run a repository PowerShell script with the newest PowerShell available:
// PowerShell 7 (pwsh) when installed, otherwise Windows PowerShell 5.1.
// Usage: node scripts/run-powershell.mjs -File scripts/x.ps1 [args] | -Command "<script>"
import { spawnSync } from "node:child_process";

const candidates = process.platform === "win32" ? ["pwsh.exe", "powershell.exe"] : ["pwsh"];
const shell = candidates.find((name) => spawnSync(name, ["-NoProfile", "-NonInteractive", "-Command", "exit 0"], { stdio: "ignore", windowsHide: true }).status === 0);
if (!shell) {
  console.error("PowerShell was not found. Install PowerShell 7 or use Windows PowerShell 5.1.");
  process.exit(1);
}
const result = spawnSync(shell, ["-NoProfile", "-ExecutionPolicy", "Bypass", ...process.argv.slice(2)], { stdio: "inherit" });
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
