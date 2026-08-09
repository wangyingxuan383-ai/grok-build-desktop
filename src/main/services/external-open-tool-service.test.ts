import { describe, expect, it, vi } from "vitest";
import { ExternalOpenToolService, type ExternalOpenToolRuntime } from "./external-open-tool-service";

function runtime(existing: string[]): ExternalOpenToolRuntime & { launch: ReturnType<typeof vi.fn> } {
  const launch = vi.fn(async () => undefined);
  return {
    platform: "win32",
    env: { LOCALAPPDATA: "C:\\Users\\test\\AppData\\Local", ProgramFiles: "C:\\Program Files", WINDIR: "C:\\Windows" },
    exists: async (path) => existing.some((suffix) => path.toLowerCase().endsWith(suffix.toLowerCase())),
    launch,
  };
}

describe("ExternalOpenToolService", () => {
  it("只公布具有确定打开契约的已安装工具", async () => {
    const host = runtime(["explorer.exe", "Microsoft VS Code\\Code.exe", "System32\\notepad.exe"]);
    const service = new ExternalOpenToolService(host);
    expect((await service.list()).map((tool) => tool.id)).toEqual(["explorer", "vscode", "notepad"]);
  });

  it("VS Code 使用固定参数定位文件行列", async () => {
    const host = runtime(["Microsoft VS Code\\Code.exe"]);
    const service = new ExternalOpenToolService(host);
    await service.open("vscode", "C:\\repo\\src\\main.ts", "file", 12, 4);
    expect(host.launch).toHaveBeenCalledWith(expect.stringMatching(/Code\.exe$/i), ["--goto", "C:\\repo\\src\\main.ts:12:4"], "C:\\repo\\src");
  });

  it("Codex 仅在 CLI 与可见终端同时存在时公布", async () => {
    const noTerminal = new ExternalOpenToolService(runtime(["codex.exe"]));
    expect((await noTerminal.list()).some((tool) => tool.id === "codex-cli")).toBe(false);
    const withTerminal = new ExternalOpenToolService(runtime(["codex.exe", "wt.exe"]));
    expect((await withTerminal.list()).find((tool) => tool.id === "codex-cli")?.targetKinds).toEqual(["directory"]);
  });

  it("拒绝使用工具不支持的目标类型", async () => {
    const service = new ExternalOpenToolService(runtime(["System32\\notepad.exe"]));
    await expect(service.open("notepad", "C:\\repo", "directory")).rejects.toThrow("不支持打开目录");
  });
});
