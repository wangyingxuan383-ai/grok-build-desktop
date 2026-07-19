import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";

const root = resolve(import.meta.dirname, "..");
const resources = join(root, "resources");
const required = [
  join(resources, "native", "win-x64", "GrokComputerHost.exe"),
  join(resources, "plugins", "grok-computer-use"),
];

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
if (!entries.some((entry) => entry.path === "native/win-x64/GrokComputerHost.exe")) throw new Error("未生成 GrokComputerHost.exe，无法创建资源清单");
await writeFile(join(resources, "resource-manifest.json"), `${JSON.stringify({ version: 1, entries }, null, 2)}\n`, "utf8");
console.log(`Resource manifest generated for ${entries.length} files.`);

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
