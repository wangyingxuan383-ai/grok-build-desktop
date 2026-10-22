import { readFile, writeFile } from "node:fs/promises";
const file = new URL("../release/THIRD_PARTY_LICENSES.json", import.meta.url);
const report = JSON.parse(await readFile(file, "utf8"));
for (const entry of Object.values(report)) {
  delete entry.path;
  if (typeof entry.licenseFile === "string") {
    const normalized = entry.licenseFile.replaceAll("\\", "/");
    const at = normalized.lastIndexOf("/node_modules/");
    entry.licenseFile = at >= 0 ? normalized.slice(at + 1) : normalized.split("/").at(-1);
  }
}
await writeFile(file, JSON.stringify(report, null, 2) + "\n");
console.log(`License report normalized: ${Object.keys(report).length} packages; no local filesystem paths.`);
