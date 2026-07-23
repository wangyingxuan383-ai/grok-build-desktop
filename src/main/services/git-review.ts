import { createHash } from "node:crypto";
import type { GitFileChange, GitFileChangeKind, GitReviewFile, GitReviewHunk, GitReviewLine, GitReviewScope, GitReviewSnapshot } from "../../shared/types";

export interface ParsedReviewFile extends GitReviewFile {
  patchHeader: string;
  hunks: ParsedReviewHunk[];
}

export interface ParsedReviewHunk extends GitReviewHunk {
  patch: string;
}

export function buildGitReviewSnapshot(input: {
  repositoryRoot: string;
  scope: GitReviewScope;
  patch: string;
  changes: GitFileChange[];
  readOnly?: boolean;
  createdAt?: string;
}): GitReviewSnapshot & { files: ParsedReviewFile[] } {
  const normalizedPatch = input.patch.replace(/\r\n/g, "\n");
  const files = parseUnifiedPatch(normalizedPatch, input.changes, input.scope.kind === "unstaged" || input.scope.kind === "staged");
  const scopedChanges = input.scope.kind === "unstaged" ? input.changes.filter((change) => change.workingTree)
    : input.scope.kind === "staged" ? input.changes.filter((change) => change.staged)
      : input.scope.kind === "last-turn" ? input.changes.filter((change) => input.scope.kind === "last-turn" && input.scope.paths.includes(change.path)) : [];
  for (const change of scopedChanges) {
    if (files.some((file) => file.path === change.path || file.oldPath === change.oldPath)) continue;
    files.push({ id: digest(change.path, change.oldPath ?? "", change.kind), path: change.path, ...(change.oldPath ? { oldPath: change.oldPath } : {}), kind: change.kind, staged: change.staged, workingTree: change.workingTree, binary: false, additions: 0, deletions: 0, hunks: [], patchHeader: "" });
  }
  const id = digest(JSON.stringify(input.scope), normalizedPatch);
  return {
    id,
    repositoryRoot: input.repositoryRoot,
    scope: input.scope,
    readOnly: input.readOnly ?? !["unstaged", "staged"].includes(input.scope.kind),
    files,
    additions: files.reduce((sum, file) => sum + file.additions, 0),
    deletions: files.reduce((sum, file) => sum + file.deletions, 0),
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
}

export function parseUnifiedPatch(patch: string, changes: GitFileChange[], mutable: boolean): ParsedReviewFile[] {
  const normalizedPatch = patch.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (!normalizedPatch.trim()) return [];
  const sections = normalizedPatch.split(/(?=^diff --git )/m).filter((section) => section.startsWith("diff --git "));
  return sections.map((section) => parseFile(section, changes, mutable));
}

function parseFile(section: string, changes: GitFileChange[], mutable: boolean): ParsedReviewFile {
  const lines = section.replace(/\n$/, "").split("\n");
  const diffMatch = parseDiffHeader(lines[0] ?? "");
  const renameFrom = lines.find((line) => line.startsWith("rename from "))?.slice("rename from ".length);
  const renameTo = lines.find((line) => line.startsWith("rename to "))?.slice("rename to ".length);
  const oldHeader = lines.find((line) => line.startsWith("--- "))?.slice(4);
  const newHeader = lines.find((line) => line.startsWith("+++ "))?.slice(4);
  const oldPath = normalizePatchPath(renameFrom || oldHeader || diffMatch?.oldPath || "");
  const path = normalizePatchPath(renameTo || newHeader || diffMatch?.path || oldPath) || oldPath;
  const change = changes.find((value) => value.path === path || value.oldPath === oldPath);
  const firstHunk = lines.findIndex((line) => line.startsWith("@@ "));
  const patchHeader = `${lines.slice(0, firstHunk < 0 ? lines.length : firstHunk).join("\n")}\n`;
  const binary = lines.some((line) => /^(?:Binary files .* differ|GIT binary patch)$/.test(line));
  const hunks = firstHunk < 0 || binary ? [] : parseHunks(lines.slice(firstHunk), patchHeader, mutable && !renameFrom && !binary);
  const inferredKind: GitFileChangeKind = renameFrom ? "renamed" : oldHeader === "/dev/null" ? "added" : newHeader === "/dev/null" ? "deleted" : "modified";
  const kind = change?.kind ?? inferredKind;
  return {
    id: digest(path, oldPath, section),
    path,
    ...(oldPath && oldPath !== path ? { oldPath } : change?.oldPath ? { oldPath: change.oldPath } : {}),
    kind,
    staged: change?.staged ?? false,
    workingTree: change?.workingTree ?? true,
    binary,
    additions: hunks.reduce((sum, hunk) => sum + hunk.additions, 0),
    deletions: hunks.reduce((sum, hunk) => sum + hunk.deletions, 0),
    hunks,
    patchHeader,
  };
}

function parseHunks(lines: string[], patchHeader: string, mutable: boolean): ParsedReviewHunk[] {
  const starts: number[] = [];
  lines.forEach((line, index) => { if (line.startsWith("@@ ")) starts.push(index); });
  return starts.map((start, index) => {
    const rawLines = lines.slice(start, starts[index + 1] ?? lines.length);
    const header = rawLines[0] ?? "";
    const match = header.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    const oldStart = Number(match?.[1] ?? 0);
    const oldLines = Number(match?.[2] ?? (match ? 1 : 0));
    const newStart = Number(match?.[3] ?? 0);
    const newLines = Number(match?.[4] ?? (match ? 1 : 0));
    let oldLine = oldStart;
    let newLine = newStart;
    const reviewLines: GitReviewLine[] = rawLines.slice(1).map((line) => {
      if (line.startsWith("+")) return { kind: "addition", text: line.slice(1), newLine: newLine++ };
      if (line.startsWith("-")) return { kind: "deletion", text: line.slice(1), oldLine: oldLine++ };
      if (line.startsWith(" ")) return { kind: "context", text: line.slice(1), oldLine: oldLine++, newLine: newLine++ };
      return { kind: "meta", text: line };
    });
    const patch = `${patchHeader}${rawLines.join("\n")}\n`;
    return {
      id: digest(header, patch),
      header,
      oldStart,
      oldLines,
      newStart,
      newLines,
      additions: reviewLines.filter((line) => line.kind === "addition").length,
      deletions: reviewLines.filter((line) => line.kind === "deletion").length,
      lines: reviewLines,
      mutable,
      patch,
    };
  });
}

function normalizePatchPath(value: string): string {
  const trimmed = value.trim().replace(/^"|"$/g, "");
  if (!trimmed || trimmed === "/dev/null") return "";
  return trimmed.replace(/^[ab]\//, "").replace(/\\([0-7]{3})/g, (_match, octal: string) => String.fromCharCode(Number.parseInt(octal, 8))).replace(/\\"/g, "\"").replace(/\\\\/g, "\\");
}

function readQuotedGitPath(value: string, start: number, prefix: "a" | "b"): { path: string; next: number } | undefined {
  if (!value.startsWith(`"${prefix}/`, start)) return undefined;
  let cursor = start + 3;
  let path = "";
  while (cursor < value.length) {
    const character = value[cursor] ?? "";
    if (character === "\"") return { path, next: cursor + 1 };
    if (character === "\\") {
      const escaped = value[cursor + 1];
      if (escaped === undefined) return undefined;
      path += `\\${escaped}`;
      cursor += 2;
      continue;
    }
    path += character;
    cursor += 1;
  }
  return undefined;
}

function parseDiffHeader(line: string): { oldPath: string; path: string } | undefined {
  const value = line.replace(/^diff --git\s+/, "");
  const oldQuoted = readQuotedGitPath(value, 0, "a");
  if (oldQuoted) {
    let cursor = oldQuoted.next;
    const separatorStart = cursor;
    while (value[cursor] === " " || value[cursor] === "\t") cursor += 1;
    const newQuoted = cursor > separatorStart ? readQuotedGitPath(value, cursor, "b") : undefined;
    if (newQuoted?.next === value.length) return { oldPath: oldQuoted.path, path: newQuoted.path };
  }
  const divider = value.lastIndexOf(" b/");
  if (!value.startsWith("a/") || divider < 0) return undefined;
  return { oldPath: value.slice(2, divider), path: value.slice(divider + 3) };
}

function digest(...values: string[]): string {
  return createHash("sha256").update(values.join("\0")).digest("hex").slice(0, 24);
}
