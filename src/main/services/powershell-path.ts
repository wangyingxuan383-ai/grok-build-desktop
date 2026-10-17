import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";

/**
 * Newest PowerShell for user-visible windows: PowerShell 7 (pwsh) when it is installed,
 * otherwise the Windows PowerShell 5.1 that every Windows machine has. File checks only.
 */
export function preferredPowerShell(env: NodeJS.ProcessEnv = process.env): string {
  const dirs = [...(env.PATH ?? env.Path ?? "").split(delimiter), env.ProgramFiles ? join(env.ProgramFiles, "PowerShell", "7") : ""];
  for (const dir of dirs.filter(Boolean)) {
    const candidate = join(dir, "pwsh.exe");
    if (existsSync(candidate)) return candidate;
  }
  return "powershell.exe";
}
