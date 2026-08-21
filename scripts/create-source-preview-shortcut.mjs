import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const electron = join(root, "node_modules", "electron", "dist", "electron.exe");
const shortcut = join(root, "Grok Build Desktop 源码预览.lnk");
const script = join(tmpdir(), "grok-create-source-preview-shortcut.ps1");
writeFileSync(script, `
$shell = New-Object -ComObject WScript.Shell
$link = $shell.CreateShortcut(${JSON.stringify(shortcut)})
$link.TargetPath = ${JSON.stringify(electron)}
$link.Arguments = "."
$link.WorkingDirectory = ${JSON.stringify(root)}
$link.WindowStyle = 1
$link.Description = "Source UI preview. Isolated from the installed app."
$link.Save()
`, "utf8");
const result = spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script], { encoding: "utf8" });
if (result.status !== 0) {
  process.stderr.write(result.stderr || result.stdout || "shortcut failed\n");
  process.exit(result.status ?? 1);
}
process.stdout.write(`${shortcut}\n`);
