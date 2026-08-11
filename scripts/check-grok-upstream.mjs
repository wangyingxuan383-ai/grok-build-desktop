import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const snapshot = JSON.parse(await readFile(resolve(root, "docs/upstream-snapshots/grok-build.json"), "utf8"));
for (const field of ["repositoryCommit", "sourceRevision", "declaredCliVersion"]) {
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

try {
  const commit = await getJson("https://api.github.com/repos/xai-org/grok-build/commits/main");
  const sourceRevision = (await getText("https://raw.githubusercontent.com/xai-org/grok-build/main/SOURCE_REV")).trim();
  const current = { repositoryCommit: String(commit.sha ?? ""), sourceRevision };
  const changed = current.repositoryCommit !== snapshot.repositoryCommit || current.sourceRevision !== snapshot.sourceRevision;
  const result = {
    changed,
    snapshot: { repositoryCommit: snapshot.repositoryCommit, sourceRevision: snapshot.sourceRevision, declaredCliVersion: snapshot.declaredCliVersion },
    current,
    repository: "https://github.com/xai-org/grok-build",
    changelog: "https://x.ai/build/changelog",
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);

  if (process.env.GITHUB_OUTPUT) {
    const { appendFile } = await import("node:fs/promises");
    await appendFile(process.env.GITHUB_OUTPUT, `changed=${changed}\ncommit=${current.repositoryCommit}\nsource_revision=${current.sourceRevision}\n`, "utf8");
  }
} catch (error) {
  const reason = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Grok Build 上游检查失败：${reason}\n`);
  process.exitCode = 1;
}
