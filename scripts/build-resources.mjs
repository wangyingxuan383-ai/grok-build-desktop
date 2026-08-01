#!/usr/bin/env node
/**
 * Cross-platform resource preparation.
 * Windows: optionally builds GrokComputerHost.exe via PowerShell when available.
 * macOS/Linux: packages the Computer Use plugin only; native host is not required to boot.
 */
import { spawn } from "node:child_process";
import { access, mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { relative, sep } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const resources = join(root, "resources");
const winHost = join(resources, "native", "win-x64", "GrokComputerHost.exe");
const pluginRoot = join(resources, "plugins", "grok-computer-use");

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: "inherit", shell: false, ...options });
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolvePromise() : reject(new Error(`${command} exited with ${code}`))));
  });
}

if (process.platform === "win32") {
  const ps1 = join(root, "scripts", "build-computer-host.ps1");
  if (await exists(ps1)) {
    try {
      await run("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ps1, "-SelfTest"]);
    } catch (error) {
      if (!(await exists(winHost))) {
        console.warn(`[build-resources] computer host build failed: ${error instanceof Error ? error.message : error}`);
        console.warn("[build-resources] continuing without GrokComputerHost.exe (Computer Use will be unavailable)");
      }
    }
  }
} else {
  console.log(`[build-resources] skip Windows Computer Host on ${process.platform}-${process.arch}`);
  // Ensure native directory exists so electron-builder filters do not fail if present.
  await mkdir(join(resources, "native", "win-x64"), { recursive: true });
}

const required = [pluginRoot];
if (await exists(winHost)) required.push(winHost);

const files = [];
for (const path of required) await collect(path, files);
files.sort((left, right) => left.localeCompare(right, "en"));
const entries = [];
for (const path of files) {
  const data = await readFile(path);
  entries.push({
    path: relative(resources, path).split(sep).join("/"),
    size: data.length,
    sha256: createHash("sha256").update(data).digest("hex"),
  });
}

if (!entries.some((entry) => entry.path.startsWith("plugins/grok-computer-use/"))) {
  throw new Error("未找到 grok-computer-use 插件资源");
}

await writeFile(join(resources, "resource-manifest.json"), `${JSON.stringify({ version: 1, entries }, null, 2)}\n`, "utf8");
console.log(`Resource manifest generated for ${entries.length} files (${process.platform}).`);

async function collect(path, output) {
  const rows = await readdir(path, { withFileTypes: true }).catch(() => undefined);
  if (!rows) {
    output.push(path);
    return;
  }
  for (const row of rows) {
    const child = join(path, row.name);
    if (row.isDirectory()) await collect(child, output);
    else if (row.isFile()) output.push(child);
  }
}
