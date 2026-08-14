import { appendFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const snapshot = JSON.parse(await readFile(resolve(root, "docs/upstream-snapshots/grok-build.json"), "utf8"));
for (const field of ["repositoryCommit", "sourceRevision", "stableVersion", "verifiedDesktopCliVersion"]) {
  if (typeof snapshot[field] !== "string" || !snapshot[field].trim()) throw new Error(`上游快照缺少 ${field}`);
}
if (process.argv.includes("--validate")) {
  process.stdout.write(`${JSON.stringify({ valid: true, snapshot }, null, 2)}\n`);
  process.exit(0);
}

const headers = { Accept: "application/vnd.github+json", "User-Agent": "grok-build-desktop-upstream-tracker" };
if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
const getText = async (url) => {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(30_000), redirect: "error" });
  if (!response.ok) throw new Error(`${url} -> HTTP ${response.status}`);
  return response.text();
};
const getJson = async (url) => JSON.parse(await getText(url));
const normalizeVersion = (value) => {
  const version = String(value ?? "").trim().replace(/^v/i, "");
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) throw new Error(`stable 返回无效版本：${JSON.stringify(value)}`);
  return version;
};

try {
  const [commit, sourceRevisionRaw, stableRaw] = await Promise.all([
    getJson("https://api.github.com/repos/xai-org/grok-build/commits/main"),
    getText("https://raw.githubusercontent.com/xai-org/grok-build/main/SOURCE_REV"),
    getText("https://x.ai/cli/stable"),
  ]);
  const current = {
    repositoryCommit: String(commit.sha ?? ""),
    sourceRevision: sourceRevisionRaw.trim(),
    stableVersion: normalizeVersion(stableRaw),
  };
  const stableChanged = current.stableVersion !== snapshot.stableVersion;
  const sourceChanged = current.repositoryCommit !== snapshot.repositoryCommit || current.sourceRevision !== snapshot.sourceRevision;
  // Source-only syncs remain visible in the JSON result but do not create
  // recurring issues once the distributed stable has already been verified.
  const changed = stableChanged || current.stableVersion !== snapshot.verifiedDesktopCliVersion;
  const result = {
    changed,
    stableChanged,
    sourceChanged,
    snapshot: {
      repositoryCommit: snapshot.repositoryCommit,
      sourceRevision: snapshot.sourceRevision,
      stableVersion: snapshot.stableVersion,
      verifiedDesktopCliVersion: snapshot.verifiedDesktopCliVersion,
    },
    current,
    repository: "https://github.com/xai-org/grok-build",
    changelog: "https://x.ai/build/changelog",
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT, [
      `changed=${changed}`,
      `stable_changed=${stableChanged}`,
      `source_changed=${sourceChanged}`,
      `stable_version=${current.stableVersion}`,
      `commit=${current.repositoryCommit}`,
      `source_revision=${current.sourceRevision}`,
      "",
    ].join("\n"), "utf8");
  }
} catch (error) {
  const reason = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Grok Build 上游检查失败：${reason}\n`);
  process.exitCode = 1;
}
