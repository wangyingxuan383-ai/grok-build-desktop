import { readdir, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const rendererChunkLimits = Object.freeze({
  entryBytes: 475 * 1024,
  ordinaryChunkBytes: 1100 * 1024,
  typescriptWorkerBytes: 6900 * 1024,
  languageWorkerBytes: 1150 * 1024,
  monacoApiBytes: 2800 * 1024,
  monacoAuxiliaryBytes: 1250 * 1024,
  totalJavaScriptBytes: 19 * 1024 * 1024,
  stylesheetBytes: 210 * 1024,
});

const requiredWorkerNames = Object.freeze([
  "editor.worker",
  "json.worker",
  "css.worker",
  "html.worker",
  "ts.worker",
]);
const workerFilePattern = /^(editor|json|css|html|ts)\.worker-([A-Za-z0-9_-]{8})\.js$/;

const format = (bytes) => `${(bytes / 1024).toFixed(1)} KiB`;

function scriptLimit(assetName, limits) {
  if (/^index-[A-Za-z0-9_-]{8}\.js$/.test(assetName)) return limits.entryBytes;
  if (/^ts\.worker-/.test(assetName)) return limits.typescriptWorkerBytes;
  if (/^(?:editor|json|css|html)\.worker-/.test(assetName)) return limits.languageWorkerBytes;
  if (/^editor\.api-/.test(assetName)) return limits.monacoApiBytes;
  if (/^(?:toggleHighContrast|monaco)-/.test(assetName)) return limits.monacoAuxiliaryBytes;
  return limits.ordinaryChunkBytes;
}

export async function inspectRendererChunks(assetsDirectory, limits = rendererChunkLimits) {
  const assetsDir = resolve(assetsDirectory);
  const names = await readdir(assetsDir);
  const assets = await Promise.all(names.map(async (name) => ({
    name,
    size: (await stat(resolve(assetsDir, name))).size,
  })));
  const scripts = assets.filter((asset) => asset.name.endsWith(".js"));
  const styles = assets.filter((asset) => asset.name.endsWith(".css"));
  const failures = [];

  const workerCounts = new Map(requiredWorkerNames.map((name) => [name, 0]));
  for (const asset of scripts) {
    if (asset.name.includes(".worker-") || /^worker-/.test(asset.name)) {
      const match = workerFilePattern.exec(asset.name);
      if (!match) {
        failures.push(`${asset.name}: Worker 文件名必须为 <editor|json|css|html|ts>.worker-<8位构建哈希>.js`);
      } else {
        const workerName = `${match[1]}.worker`;
        workerCounts.set(workerName, (workerCounts.get(workerName) ?? 0) + 1);
      }
    }
    const limit = scriptLimit(asset.name, limits);
    if (asset.size > limit) failures.push(`${asset.name}: ${format(asset.size)} > ${format(limit)}`);
  }

  for (const workerName of requiredWorkerNames) {
    const count = workerCounts.get(workerName) ?? 0;
    if (count !== 1) failures.push(`${workerName}: 期望恰好 1 个命名稳定的 Worker 分块，实际 ${count} 个`);
  }
  for (const asset of styles) {
    if (asset.size > limits.stylesheetBytes) failures.push(`${asset.name}: ${format(asset.size)} > ${format(limits.stylesheetBytes)}`);
  }
  const total = scripts.reduce((sum, asset) => sum + asset.size, 0);
  if (total > limits.totalJavaScriptBytes) failures.push(`JavaScript 总量: ${format(total)} > ${format(limits.totalJavaScriptBytes)}`);

  return {
    assetsDir,
    scripts,
    styles,
    failures,
    total,
    largest: [...scripts].sort((left, right) => right.size - left.size).slice(0, 5),
  };
}

async function main() {
  const assetsArgumentIndex = process.argv.indexOf("--assets-dir");
  const assetsDir = assetsArgumentIndex >= 0
    ? process.argv[assetsArgumentIndex + 1]
    : resolve(process.cwd(), "out", "renderer", "assets");
  if (!assetsDir) throw new Error("--assets-dir 需要一个目录参数");
  const result = await inspectRendererChunks(assetsDir);
  if (result.failures.length) {
    console.error("Renderer 分块预算或 Worker 命名校验失败：\n- " + result.failures.join("\n- "));
    process.exitCode = 1;
    return;
  }
  console.log(`Renderer 分块门禁通过：${result.scripts.length} 个 JS，共 ${format(result.total)}。`);
  console.log(`最大分块：${result.largest.map((asset) => `${asset.name} ${format(asset.size)}`).join("；")}`);
  console.log(`Worker 命名：${requiredWorkerNames.join("、")}。`);
}

const isEntrypoint = process.argv[1]
  && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isEntrypoint) {
  main().catch((error) => {
    console.error(`Renderer 分块门禁无法执行：${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
