import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, normalize, resolve, sep } from "node:path";
import { extractFile, listPackage } from "@electron/asar";

const executable = process.argv[2];
const expectedVersion = process.argv[3];
if (!executable || !expectedVersion) throw new Error("Usage: node scripts/verify-packaged-contents.mjs <executable> <expected-version>");

const executablePath = resolve(executable);
if (!existsSync(executablePath) || !statSync(executablePath).isFile()) throw new Error(`Packaged executable is missing: ${executablePath}`);
if (basename(executablePath) !== "Grok Build Desktop.exe") throw new Error(`Unexpected packaged executable: ${basename(executablePath)}`);

const applicationRoot = dirname(executablePath);
const resourcesRoot = join(applicationRoot, "resources");
const asarPath = join(resourcesRoot, "app.asar");
if (existsSync(join(resourcesRoot, "default_app.asar"))) throw new Error("The stock Electron demo application must not be packaged");
if (!existsSync(asarPath) || statSync(asarPath).size < 1_000_000) throw new Error(`Application ASAR is missing or truncated: ${asarPath}`);

const files = new Set(listPackage(asarPath).map((entry) => entry.replaceAll("\\", "/").replace(/^\//, "")));
const requiredAsarEntries = ["package.json", "out/main/index.js", "out/main/token-activity-worker.js", "out/main/pet-import-worker.js", "out/preload/index.cjs", "out/preload/pet.cjs", "out/renderer/index.html", "out/renderer/pet/index.html"];
for (const entry of requiredAsarEntries) if (!files.has(entry)) throw new Error(`Application ASAR is missing: ${entry}`);
for (const entry of files) if (/^node_modules\/.*(?:\.(?:map|log)$|\.test\.[^/]+$|\/(?:test|tests|__tests__|fixtures|coverage|example|examples)\/)/i.test(entry)) throw new Error(`Dependency debug/test material must not be packaged: ${entry}`);
for (const entry of files) if (/^node_modules\/node-pty\/(?:build\/|.*\.pdb$)/i.test(entry)) throw new Error(`Native build intermediate must not be packaged: ${entry}`);
for (const name of ["conpty.node", "conpty_console_list.node"]) {
  const path = join(resourcesRoot, "app.asar.unpacked", "node_modules", "node-pty", "prebuilds", "win32-x64", name);
  if (!existsSync(path) || statSync(path).size === 0) throw new Error(`Windows PTY runtime is missing: ${name}`);
}
const extractAsar = (entry) => extractFile(asarPath, entry.split("/").join(sep));

const packagedPackage = JSON.parse(extractAsar("package.json").toString("utf8"));
if (packagedPackage.name !== "grok-build-desktop") throw new Error(`Unexpected packaged application name: ${packagedPackage.name}`);
if (packagedPackage.version !== expectedVersion) throw new Error(`Packaged version mismatch: ${packagedPackage.version} != ${expectedVersion}`);
if (packagedPackage.main !== "out/main/index.js") throw new Error(`Unexpected packaged main entry: ${packagedPackage.main}`);

const rendererHtml = extractAsar("out/renderer/index.html").toString("utf8");
if (!rendererHtml.includes('<div id="root"></div>') || !rendererHtml.includes('<div id="overlay-root"></div>')) throw new Error("Packaged Renderer HTML is missing the application or overlay root");
const rendererAssets = [...rendererHtml.matchAll(/(?:src|href)=["']\.?\/?(assets\/[^"'?#]+)["']/g)].map((match) => `out/renderer/${match[1]}`);
if (rendererAssets.length < 2) throw new Error("Packaged Renderer HTML does not reference its production assets");
for (const entry of rendererAssets) if (!files.has(entry)) throw new Error(`Packaged Renderer asset is missing: ${entry}`);
const petHtml = extractAsar("out/renderer/pet/index.html").toString("utf8");
const petAssets = [...petHtml.matchAll(/(?:src|href)=["']\.\.\/(assets\/[^"'?#]+)["']/g)].map(match => `out/renderer/${match[1]}`);
if (petAssets.length < 2) throw new Error("Packaged companion does not reference its production player/style assets");
for (const entry of petAssets) if (!files.has(entry)) throw new Error(`Packaged companion asset is missing: ${entry}`);

const manifestPath = join(resourcesRoot, "resource-manifest.json");
if (!existsSync(manifestPath)) throw new Error(`Packaged resource manifest is missing: ${manifestPath}`);
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
if (manifest.version !== 1 || !Array.isArray(manifest.entries) || manifest.entries.length < 3) throw new Error("Packaged resource manifest is invalid");
const resourcesPrefix = resolve(resourcesRoot).replace(/[\\/]+$/, "") + sep;
for (const entry of manifest.entries) {
  if (!entry || typeof entry.path !== "string" || !Number.isSafeInteger(entry.size) || !/^[0-9a-f]{64}$/i.test(entry.sha256 || "")) throw new Error("Packaged resource manifest contains an invalid entry");
  const resourcePath = resolve(resourcesRoot, normalize(entry.path));
  if (!resourcePath.startsWith(resourcesPrefix)) throw new Error(`Packaged resource escapes the resources directory: ${entry.path}`);
  if (!existsSync(resourcePath) || !statSync(resourcePath).isFile()) throw new Error(`Packaged resource is missing: ${entry.path}`);
  const contents = readFileSync(resourcePath);
  if (contents.length !== entry.size) throw new Error(`Packaged resource size mismatch: ${entry.path}`);
  const sha256 = createHash("sha256").update(contents).digest("hex");
  if (sha256 !== entry.sha256.toLowerCase()) throw new Error(`Packaged resource hash mismatch: ${entry.path}`);
}

const manifestPaths = new Set(manifest.entries.map((entry) => entry.path.replaceAll("\\", "/")));
if (!manifestPaths.has("native/win-x64/GrokComputerHost.exe") || !manifestPaths.has("plugins/grok-computer-use/plugin.json")) throw new Error("Packaged native host or Computer Use plugin is missing from the resource manifest");
for (const id of ["a", "b"]) {
  for (const file of ["skin.json", "idle.webp", "enter.webp", "exit.webp"])
    if (!manifestPaths.has(`pets/${id}/${file}`)) throw new Error(`Packaged companion resource is missing: ${id}/${file}`);
}
const petBytes = manifest.entries.filter(entry => entry.path.replaceAll("\\", "/").startsWith("pets/")).reduce((sum, entry) => sum + entry.size, 0);
if (petBytes > 8 * 1024 * 1024) throw new Error("Packaged companion exceeds the combined 8 MiB artwork budget");

console.log(JSON.stringify({ ok: true, version: packagedPackage.version, asarEntries: files.size, rendererAssets: rendererAssets.length, petAssets: petAssets.length, petBytes, verifiedResources: manifest.entries.length }));
