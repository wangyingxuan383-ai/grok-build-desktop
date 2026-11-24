import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { promisify } from "node:util";
import type {
  GitHubIssueDetail,
  GitHubIssueListQuery,
  GitHubIssueListResult,
  GitHubIssueSummary,
  PullRequestCreateInput,
  PullRequestCreateResult,
  PullRequestStackItem,
  PullRequestStackSnapshot,
  PullRequestStatus,
  PullRequestTemplate,
} from "../../shared/workspace-tools";

export type {
  GitHubIssueDetail,
  GitHubIssueListQuery,
  GitHubIssueListResult,
  GitHubIssueSummary,
  PullRequestCreateInput,
  PullRequestCreateResult,
  PullRequestStackItem,
  PullRequestStackSnapshot,
  PullRequestStatus,
  PullRequestTemplate,
} from "../../shared/workspace-tools";

const execute = promisify(execFile);
const MAX_TEMPLATE_BYTES = 256 * 1024;

export async function readPullRequest(workspace: string, env: NodeJS.ProcessEnv): Promise<PullRequestStatus> {
  try {
    const { stdout } = await execute(
      "gh",
      ["pr", "view", "--json", "number,title,url,state,isDraft,headRefName,baseRefName,statusCheckRollup"],
      { cwd: workspace, env, windowsHide: true, timeout: 20_000, maxBuffer: 1024 * 1024 },
    );
    return parsePullRequest(JSON.parse(stdout) as Record<string, unknown>);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return {
      available: false,
      reason: code === "ENOENT"
        ? "未找到 GitHub CLI；安装并登录 gh 后可查看当前分支 PR。"
        : "当前分支没有可读取的 PR，或 GitHub 登录/网络不可用。可在终端运行 gh pr view 检查。",
      checks: [],
      pending: false,
    };
  }
}

export async function createPullRequest(input: PullRequestCreateInput, env: NodeJS.ProcessEnv): Promise<PullRequestCreateResult> {
  const title = input.title.trim();
  if (!title || [...title].length > 256 || title.includes("\0")) throw new Error("PR 标题不能为空且不得超过 256 个字符");
  const body = input.body ?? "";
  if (Buffer.byteLength(body, "utf8") > 256 * 1024 || body.includes("\0")) throw new Error("PR 描述过长或包含无效字符");
  const base = input.base?.trim();
  if (base && (base.startsWith("-") || /[\s\0~^:?*[\\]/.test(base) || base.length > 200)) {
    throw new Error("目标基础分支名称无效");
  }
  const args = ["pr", "create", `--title=${title}`, "--body-file", "-"];
  if (base) args.push(`--base=${base}`);
  if (input.draft) args.push("--draft");
  try {
    const { stdout, stderr } = await runGhWithStdin(args, body, {
      cwd: input.workspace,
      env,
      timeoutMs: 60_000,
    });
    const combined = `${stdout}\n${stderr}`.trim();
    const urlMatch = /https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/(\d+)/.exec(combined);
    const status = await readPullRequest(input.workspace, env).catch(() => undefined);
    const url = status?.url ?? urlMatch?.[0];
    const number = status?.number ?? (urlMatch?.[1] ? Number(urlMatch[1]) : undefined);
    return {
      created: true,
      ...(url ? { url } : {}),
      ...(number !== undefined ? { number } : {}),
      message: url ? `已创建 Pull Request：${url}` : "Pull Request 已创建",
      ...(status ? { status } : {}),
    };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") throw new Error("未找到 GitHub CLI（gh）；请先安装并执行 gh auth login");
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`创建 Pull Request 失败：${detail.slice(0, 600)}`);
  }
}

function runGhWithStdin(
  args: string[],
  stdinText: string,
  options: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number },
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn("gh", args, {
      cwd: options.cwd,
      env: options.env,
      windowsHide: true,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, options.timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      if (stdout.length < 1024 * 1024) stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < 64 * 1024) stderr += chunk.toString("utf8");
    });
    child.stdin.on("error", () => undefined);
    child.stdin.end(stdinText, "utf8");
    child.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new Error("gh pr create 执行超时（60s）"));
        return;
      }
      if (code !== 0) {
        reject(new Error(stderr.trim() || stdout.trim() || `gh 退出代码 ${code ?? -1}`));
        return;
      }
      resolvePromise({ stdout, stderr });
    });
  });
}

export async function discoverPullRequestTemplates(repositoryRoot: string): Promise<PullRequestTemplate[]> {
  const templates: PullRequestTemplate[] = [];
  const seenPaths = new Set<string>();

  const tryAddFile = async (dirSegments: string[], fileName: string, isDefault: boolean): Promise<void> => {
    if (dirSegments.length) {
      let current = repositoryRoot;
      for (const seg of dirSegments) {
        current = join(current, seg);
        const dirInfo = await lstat(current).catch(() => undefined);
        if (!dirInfo || dirInfo.isSymbolicLink() || !dirInfo.isDirectory()) return;
      }
    }
    const fullPath = join(repositoryRoot, ...dirSegments, fileName);
    const info = await lstat(fullPath).catch(() => undefined);
    if (!info || info.isSymbolicLink() || !info.isFile() || info.size > MAX_TEMPLATE_BYTES) return;
    const rel = relative(repositoryRoot, fullPath).split(sep).join("/");
    const key = rel.toLowerCase();
    if (seenPaths.has(key)) return;
    seenPaths.add(key);
    const content = await readFile(fullPath, "utf8").catch(() => undefined);
    if (content === undefined || content.includes("\0")) return;
    const label = fileName.replace(/\.(?:md|markdown|txt)$/i, "").replace(/[-_]+/g, " ").trim() || "PR 模板";
    templates.push({
      id: createHash("sha256").update(key).digest("hex").slice(0, 16),
      name: isDefault ? `默认模板 (${rel})` : label,
      relativePath: rel,
      content,
      isDefault,
    });
  };

  const scanRootForDefault = async (dirSegments: string[]): Promise<void> => {
    const dirPath = join(repositoryRoot, ...dirSegments);
    const entries = await readdir(dirPath, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (/^pull_request_template\.(?:md|markdown|txt)$/i.test(entry.name)) {
        await tryAddFile(dirSegments, entry.name, true);
      }
    }
  };

  const scanTemplateDirectory = async (dirSegments: string[]): Promise<void> => {
    const parentPath = join(repositoryRoot, ...dirSegments);
    const parentEntries = await readdir(parentPath, { withFileTypes: true }).catch(() => []);
    const matchedDir = parentEntries.find((entry) => entry.isDirectory() && /^pull_request_template$/i.test(entry.name));
    if (!matchedDir) return;
    const fullDirSegments = [...dirSegments, matchedDir.name];
    const files = await readdir(join(repositoryRoot, ...fullDirSegments), { withFileTypes: true }).catch(() => []);
    for (const file of files) {
      if (file.isFile() && /\.(?:md|markdown|txt)$/i.test(file.name)) {
        await tryAddFile(fullDirSegments, file.name, false);
      }
    }
  };

  await scanRootForDefault([".github"]);
  await scanRootForDefault([]);
  await scanRootForDefault(["docs"]);
  await scanTemplateDirectory([".github"]);
  await scanTemplateDirectory([]);
  await scanTemplateDirectory(["docs"]);

  return templates;
}

export async function readPullRequestStack(workspace: string, env: NodeJS.ProcessEnv): Promise<PullRequestStackSnapshot> {
  let currentBranch = "";
  try {
    const branchRes = await execute("git", ["-C", workspace, "branch", "--show-current"], {
      env,
      windowsHide: true,
      timeout: 10_000,
    });
    currentBranch = branchRes.stdout.trim();
  } catch { /* non-git or detached */ }

  if (!currentBranch) {
    return { available: false, reason: "当前处于游离 HEAD 或不在 Git 分支上", items: [] };
  }

  try {
    const { stdout } = await execute(
      "gh",
      [
        "pr", "list", "--state", "all", "--limit", "100",
        "--json", "number,title,url,state,isDraft,headRefName,baseRefName,reviewDecision,statusCheckRollup",
      ],
      { cwd: workspace, env, windowsHide: true, timeout: 25_000, maxBuffer: 4 * 1024 * 1024 },
    );
    const rawList = JSON.parse(stdout) as Array<Record<string, unknown>>;
    const byHead = new Map<string, Record<string, unknown>>();
    const byBase = new Map<string, Array<Record<string, unknown>>>();

    for (const raw of rawList) {
      const head = typeof raw.headRefName === "string" ? raw.headRefName : "";
      const base = typeof raw.baseRefName === "string" ? raw.baseRefName : "";
      if (!head || !base) continue;
      const existing = byHead.get(head);
      if (!existing || (String(existing.state) !== "OPEN" && String(raw.state) === "OPEN")) {
        byHead.set(head, raw);
      }
    }
    for (const raw of byHead.values()) {
      const base = String(raw.baseRefName);
      const list = byBase.get(base) ?? [];
      list.push(raw);
      byBase.set(base, list);
    }

    const currentPr = byHead.get(currentBranch);
    if (!currentPr) {
      return { available: true, currentBranch, items: [] };
    }

    let rootPr = currentPr;
    const ancestorGuard = new Set<string>([String(currentPr.headRefName)]);
    while (true) {
      const parentHead = String(rootPr.baseRefName || "");
      const parentPr = byHead.get(parentHead);
      if (!parentPr || ancestorGuard.has(String(parentPr.headRefName))) break;
      ancestorGuard.add(String(parentPr.headRefName));
      rootPr = parentPr;
    }

    const trunkBranch = String(rootPr.baseRefName || "main");
    const items: PullRequestStackItem[] = [];
    const visited = new Set<string>();
    const queue: Array<{ raw: Record<string, unknown>; depth: number }> = [{ raw: rootPr, depth: 0 }];

    while (queue.length > 0) {
      const { raw, depth } = queue.shift()!;
      const head = String(raw.headRefName || "");
      if (!head || visited.has(head)) continue;
      visited.add(head);
      const parsed = parsePullRequest(raw);
      if (parsed.number !== undefined && parsed.url) {
        items.push({
          number: parsed.number,
          title: parsed.title ?? `PR #${parsed.number}`,
          url: parsed.url,
          state: parsed.state ?? "UNKNOWN",
          isDraft: Boolean(raw.isDraft),
          headRefName: head,
          baseRefName: String(raw.baseRefName || ""),
          ...(typeof raw.reviewDecision === "string" && raw.reviewDecision ? { reviewDecision: raw.reviewDecision } : {}),
          checks: parsed.checks,
          pending: parsed.pending,
          isCurrent: head === currentBranch,
          depth,
        });
      }
      for (const child of byBase.get(head) ?? []) {
        queue.push({ raw: child, depth: depth + 1 });
      }
    }

    return { available: true, currentBranch, trunkBranch, items };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return {
      available: false,
      currentBranch,
      reason: code === "ENOENT" ? "未找到 GitHub CLI（gh）" : "读取 PR Stack 失败，请检查 gh 登录状态与网络连接",
      items: [],
    };
  }
}

export async function listGitHubIssues(
  workspace: string,
  env: NodeJS.ProcessEnv,
  query: GitHubIssueListQuery = {},
): Promise<GitHubIssueListResult> {
  const state = query.state === "closed" || query.state === "all" ? query.state : "open";
  const limit = Math.max(1, Math.min(100, Math.trunc(query.limit ?? 30)));
  const args = [
    "issue", "list",
    "--state", state,
    "--limit", String(limit),
    "--json", "number,title,url,state,author,labels,assignees,updatedAt,body",
  ];
  const search = query.search?.trim();
  if (search) {
    if (search.length > 512 || search.includes("\0")) throw new Error("Issue 搜索词无效或过长");
    args.push(`--search=${search}`);
  }
  try {
    const { stdout } = await execute("gh", args, {
      cwd: workspace,
      env,
      windowsHide: true,
      timeout: 25_000,
      maxBuffer: 16 * 1024 * 1024,
    });
    const rows = JSON.parse(stdout) as Array<Record<string, unknown>>;
    return {
      available: true,
      issues: (Array.isArray(rows) ? rows : []).flatMap((row) => {
        const parsed = parseIssueSummary(row);
        return parsed ? [parsed] : [];
      }),
    };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return {
      available: false,
      reason: code === "ENOENT" ? "未找到 GitHub CLI（gh）；安装并执行 gh auth login 后可浏览 Issue。" : "无法读取 GitHub Issues，请检查仓库远程地址与 gh 登录状态。",
      issues: [],
    };
  }
}

export async function getGitHubIssue(
  workspace: string,
  issueNumber: number,
  env: NodeJS.ProcessEnv,
): Promise<GitHubIssueDetail> {
  if (!Number.isInteger(issueNumber) || issueNumber <= 0) throw new Error("Issue 编号无效");
  try {
    const { stdout } = await execute(
      "gh",
      ["issue", "view", String(issueNumber), "--json", "number,title,url,state,body,author,labels,assignees,comments,createdAt,updatedAt"],
      { cwd: workspace, env, windowsHide: true, timeout: 25_000, maxBuffer: 4 * 1024 * 1024 },
    );
    const raw = JSON.parse(stdout) as Record<string, unknown>;
    const summary = parseIssueSummary(raw);
    if (!summary) throw new Error("GitHub CLI 返回的 Issue 数据不完整");
    const comments = (Array.isArray(raw.comments) ? raw.comments : []).slice(-50).map((item) => {
      const c = item && typeof item === "object" ? item as Record<string, unknown> : {};
      const authorObj = c.author && typeof c.author === "object" ? c.author as Record<string, unknown> : undefined;
      return {
        author: typeof authorObj?.login === "string" ? authorObj.login : "unknown",
        body: typeof c.body === "string" ? c.body.slice(0, 16_384) : "",
        createdAt: typeof c.createdAt === "string" ? c.createdAt : "",
      };
    });
    return {
      ...summary,
      body: typeof raw.body === "string" ? raw.body.slice(0, 128 * 1024) : "",
      ...(typeof raw.createdAt === "string" ? { createdAt: raw.createdAt } : {}),
      comments,
    };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") throw new Error("未找到 GitHub CLI（gh）；请先安装并执行 gh auth login");
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`读取 Issue #${issueNumber} 失败：${detail.slice(0, 500)}`);
  }
}

export function parsePullRequest(raw: Record<string, unknown>): PullRequestStatus {
  const checks = (Array.isArray(raw.statusCheckRollup) ? raw.statusCheckRollup : []).map((row) => ({
    name: String((row as Record<string, unknown>).name || (row as Record<string, unknown>).context || "检查"),
    state: String((row as Record<string, unknown>).conclusion || (row as Record<string, unknown>).status || (row as Record<string, unknown>).state || "UNKNOWN"),
  }));
  const url = typeof raw.url === "string" && /^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+$/.test(raw.url) ? raw.url : undefined;
  return {
    available: true,
    number: typeof raw.number === "number" ? raw.number : undefined,
    title: typeof raw.title === "string" ? raw.title : undefined,
    url,
    state: String(raw.state || "UNKNOWN"),
    ...(typeof raw.isDraft === "boolean" ? { isDraft: raw.isDraft } : {}),
    ...(typeof raw.headRefName === "string" ? { headRefName: raw.headRefName } : {}),
    ...(typeof raw.baseRefName === "string" ? { baseRefName: raw.baseRefName } : {}),
    checks,
    pending: checks.some((check) => ["PENDING", "QUEUED", "IN_PROGRESS", "WAITING", "REQUESTED"].includes(check.state)),
  };
}

function parseIssueSummary(raw: Record<string, unknown>): GitHubIssueSummary | undefined {
  const number = typeof raw.number === "number" && Number.isInteger(raw.number) ? raw.number : undefined;
  const title = typeof raw.title === "string" ? raw.title.trim() : "";
  const url = typeof raw.url === "string" && /^https:\/\/github\.com\/[^/]+\/[^/]+\/issues\/\d+$/.test(raw.url) ? raw.url : undefined;
  if (!number || !title || !url) return undefined;
  const authorObj = raw.author && typeof raw.author === "object" ? raw.author as Record<string, unknown> : undefined;
  const labels = (Array.isArray(raw.labels) ? raw.labels : []).flatMap((item) => {
    const name = item && typeof item === "object" ? (item as Record<string, unknown>).name : undefined;
    return typeof name === "string" && name.trim() ? [name.trim()] : [];
  });
  const assignees = (Array.isArray(raw.assignees) ? raw.assignees : []).flatMap((item) => {
    const login = item && typeof item === "object" ? (item as Record<string, unknown>).login : undefined;
    return typeof login === "string" && login.trim() ? [login.trim()] : [];
  });
  const bodyPreview = typeof raw.body === "string" ? raw.body.replace(/\s+/g, " ").trim().slice(0, 240) : undefined;
  return {
    number,
    title,
    url,
    state: String(raw.state || "OPEN"),
    ...(typeof authorObj?.login === "string" ? { author: authorObj.login } : {}),
    labels,
    assignees,
    ...(typeof raw.updatedAt === "string" ? { updatedAt: raw.updatedAt } : {}),
    ...(bodyPreview ? { bodyPreview } : {}),
  };
}
