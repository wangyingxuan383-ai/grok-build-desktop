import { describe, expect, it } from "vitest";
import { isPlanSafeToolCall, isReadOnlyCommand, isWithinWorkspace, shouldBlockCommand, shouldBlockWrite } from "./plan-gate";

describe("Plan Gate", () => {
  const root = "C:\\work\\project";

  it("recognises paths inside and outside the workspace", () => {
    expect(isWithinWorkspace("C:\\work\\project\\src\\index.ts", root)).toBe(true);
    expect(isWithinWorkspace("C:\\work\\other\\index.ts", root)).toBe(false);
  });

  it("allows only the exact session plan file while Plan mode is active", () => {
    const planPath = "C:\\Users\\tester\\.grok\\sessions\\project\\session-1\\plan.md";
    expect(shouldBlockWrite("C:\\work\\project\\README.md", root, true)).toBe(true);
    expect(shouldBlockWrite("C:\\work\\project\\README.md", root, false)).toBe(false);
    expect(shouldBlockWrite("C:\\temp\\README.md", root, true, planPath)).toBe(true);
    expect(shouldBlockWrite(planPath, root, true, planPath)).toBe(false);
    expect(shouldBlockWrite("C:\\Users\\tester\\.grok\\sessions\\other\\plan.md", root, true, planPath)).toBe(true);
  });

  it("allows read-only commands and rejects mutating commands in Plan mode", () => {
    expect(shouldBlockCommand("git status", true)).toBe(false);
    expect(shouldBlockCommand("Get-Content package.json", true)).toBe(false);
    expect(shouldBlockCommand("npm install", true)).toBe(true);
    expect(shouldBlockCommand("Remove-Item file.txt", true)).toBe(true);
    expect(shouldBlockCommand("Remove-Item file.txt", false)).toBe(false);
  });

  it.each([
    "git status && Remove-Item important.txt",
    "git status & del important.txt",
    "git status || del important.txt",
    "Get-Content package.json | Set-Content stolen.txt",
    "git diff > changes.txt",
    "git show < input.txt",
    "git status\nRemove-Item important.txt",
    "git status\r\ndel important.txt",
    "Get-Content $(Remove-Item important.txt)",
    "Get-Content ${dangerous}",
    "Get-Content @(Remove-Item important.txt)",
    "Get-Content `Remove-Item important.txt`",
    "Get-ChildItem | Where-Object { Remove-Item important.txt }",
    "Get-ChildItem | Where-Object Name -eq (Remove-Item important.txt)",
    "git status %DANGEROUS%",
    "git status !DANGEROUS!",
  ])("blocks composite or expanding shell syntax: %s", (command) => {
    expect(isReadOnlyCommand(command)).toBe(false);
    expect(shouldBlockCommand(command, true)).toBe(true);
  });

  it.each([
    "git diff --output=changes.txt",
    "git diff --ext-diff",
    "git diff --textconv -- README.md",
    "git show --textconv HEAD:README.md",
    "git branch feature/new-branch",
    "npm test",
    "rg --pre malicious pattern",
    "find . -exec del {} ;",
  ])("blocks write-capable query forms: %s", (command) => {
    expect(shouldBlockCommand(command, true)).toBe(true);
  });

  it.each([
    "git status --short",
    "git diff -- src/main/index.ts",
    "git log -5 --oneline",
    "git branch --show-current",
    "git branch --list feature/*",
    "Get-ChildItem src -Recurse",
    "Get-Content package.json -Raw",
    "Get-Content package.json | Select-String version",
    "Get-ChildItem src -Recurse | Where-Object Name -like *.ts | Select-Object -First 20",
    "git status --short | Select-String modified",
    "rg security src",
    "node --version",
    "npm view electron version",
    "grok models",
  ])("allows a single bounded read-only command: %s", (command) => {
    expect(isReadOnlyCommand(command)).toBe(true);
  });

  it.each([
    "Get-Content package.json | Set-Content changed.json",
    "Get-ChildItem | Remove-Item",
    "git status | ForEach-Object { Remove-Item $_ }",
    "Get-Content package.json || Remove-Item package.json",
  ])("rejects mutating or executable pipeline stages: %s", (command) => {
    expect(isReadOnlyCommand(command)).toBe(false);
  });

  it("auto-approves only read-only ACP tool calls in Plan mode", () => {
    expect(isPlanSafeToolCall({ kind: "read", title: "Read package.json" })).toBe(true);
    expect(isPlanSafeToolCall({ kind: "read_file", title: "Read package.json" })).toBe(true);
    expect(isPlanSafeToolCall({ kind: "list_directory", title: "List src" })).toBe(true);
    expect(isPlanSafeToolCall({ kind: "search_files", title: "Search source" })).toBe(true);
    expect(isPlanSafeToolCall({ kind: "search_code", title: "Search source" })).toBe(true);
    expect(isPlanSafeToolCall({ kind: "read_many_files", title: "Read sources" })).toBe(true);
    expect(isPlanSafeToolCall({ kind: "list_files", title: "List sources" })).toBe(true);
    expect(isPlanSafeToolCall({ kind: "web_search", title: "Search documentation" })).toBe(true);
    expect(isPlanSafeToolCall({ kind: "search", title: "Search source" })).toBe(true);
    expect(isPlanSafeToolCall({ kind: "execute", rawInput: { command: "git status --short" } })).toBe(true);
    expect(isPlanSafeToolCall({ kind: "execute", content: [{ type: "content", content: { type: "text", text: "Get-Content README.md" } }] })).toBe(true);
    expect(isPlanSafeToolCall({ kind: "execute", rawInput: { command: "npm install" } })).toBe(false);
    expect(isPlanSafeToolCall({ kind: "execute", rawInput: { command: "Get-ChildItem | Where-Object { Remove-Item important.txt }" } })).toBe(false);
    expect(isPlanSafeToolCall({ kind: "edit", title: "Edit README" })).toBe(false);
    expect(isPlanSafeToolCall({ kind: "write_file", title: "Write README" })).toBe(false);
    expect(isPlanSafeToolCall({ kind: "apply_patch", title: "Patch README" })).toBe(false);
    expect(isPlanSafeToolCall({ kind: "other", title: "Unknown integration" })).toBe(false);
    expect(isPlanSafeToolCall({ kind: "other", title: "Read system state", rawInput: { command: "Remove-Item important.txt" } })).toBe(false);
    expect(isPlanSafeToolCall({ kind: "other", title: "Search project", rawInput: { tool: "fetch_remote" } })).toBe(false);
    expect(isPlanSafeToolCall({ kind: "read", title: "Read project", rawInput: { command: "Remove-Item important.txt" } })).toBe(false);
  });
});
