import { describe, expect, it } from "vitest";
import { isReadOnlyCommand, isWithinWorkspace, shouldBlockCommand, shouldBlockWrite } from "./plan-gate";

describe("Plan Gate", () => {
  const root = "C:\\work\\project";

  it("recognises paths inside and outside the workspace", () => {
    expect(isWithinWorkspace("C:\\work\\project\\src\\index.ts", root)).toBe(true);
    expect(isWithinWorkspace("C:\\work\\other\\index.ts", root)).toBe(false);
  });

  it("blocks workspace writes only while Plan mode is active", () => {
    expect(shouldBlockWrite("C:\\work\\project\\README.md", root, true)).toBe(true);
    expect(shouldBlockWrite("C:\\work\\project\\README.md", root, false)).toBe(false);
    expect(shouldBlockWrite("C:\\temp\\README.md", root, true)).toBe(false);
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
    "git status %DANGEROUS%",
    "git status !DANGEROUS!",
  ])("blocks composite or expanding shell syntax: %s", (command) => {
    expect(isReadOnlyCommand(command)).toBe(false);
    expect(shouldBlockCommand(command, true)).toBe(true);
  });

  it.each([
    "git diff --output=changes.txt",
    "git diff --ext-diff",
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
    "rg security src",
    "node --version",
    "npm view electron version",
    "grok models",
  ])("allows a single bounded read-only command: %s", (command) => {
    expect(isReadOnlyCommand(command)).toBe(true);
  });
});
