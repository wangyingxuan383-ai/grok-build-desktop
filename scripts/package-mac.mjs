#!/usr/bin/env node
/**
 * macOS packaging entry: resources → build → electron-builder dmg/zip → SHA256SUMS.
 */
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { access, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const releaseDir = join(root, "release");
const targets = process.argv.includes("--dir") ? ["--mac", "--dir"] : ["--mac", "dmg", "zip"];

async function run(command, args) {
  await new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: "inherit", shell: false, env: process.env });
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolvePromise() : reject(new Error(`${command} exited ${code}`))));
  });
}

console.log("[package-mac] build resources");
await run(process.execPath, [join(root, "scripts", "build-resources.mjs")]);
console.log("[package-mac] compile");
await run("npm", ["run", "build"]);
console.log(`[package-mac] electron-builder ${targets.join(" ")}`);
await run(join(root, "node_modules", ".bin", "electron-builder"), targets);

await mkdir(releaseDir, { recursive: true });
const files = (await readdir(releaseDir)).filter((name) => /\.(dmg|zip|AppImage)$/i.test(name) || name.endsWith(".app"));
const lines = [];
for (const name of files.sort()) {
  const full = join(releaseDir, name);
  try {
    await access(full);
    const data = await readFile(full);
    lines.push(`${createHash("sha256").update(data).digest("hex")}  ${name}`);
  } catch {
    /* skip directories like mac/ */
  }
}
if (lines.length) {
  await writeFile(join(releaseDir, "SHA256SUMS-mac.txt"), `${lines.join("\n")}\n`, "utf8");
  console.log(`[package-mac] wrote SHA256SUMS-mac.txt (${lines.length} artifacts)`);
} else {
  console.log("[package-mac] no dmg/zip artifacts found yet (dir build may only produce .app under release/mac)");
}
console.log("[package-mac] done");
