import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { isPackaged: true }, Menu: { setApplicationMenu: vi.fn(), buildFromTemplate: vi.fn((value) => value) }, shell: { openExternal: vi.fn() } }));

let module: typeof import("./app-menu");
beforeAll(async () => { module = await import("./app-menu"); });

describe("Chinese application menu", () => {
  it("uses only the six Chinese top-level labels", () => {
    expect(module.CHINESE_MENU_LABELS).toEqual(["文件", "编辑", "会话", "视图", "功能", "帮助"]);
  });

  it("installs the Chinese template and routes UI actions through typed commands", async () => {
    const send = vi.fn();
    module.installApplicationMenu({ isDestroyed: () => false, webContents: { send } } as never, false);
    const { Menu } = await import("electron");
    const template = vi.mocked(Menu.buildFromTemplate).mock.calls.at(-1)?.[0] as Array<{ label?: string; submenu?: Array<{ label?: string; click?: () => void }> }>;
    expect(template.map((item) => item.label)).toEqual(module.CHINESE_MENU_LABELS);
    expect(template.map((item) => item.label)).not.toContain("File");
    template[0]?.submenu?.find((item) => item.label === "新建会话")?.click?.();
    expect(send).toHaveBeenCalledWith("grok:menu-command", "new-session");
  });

  it("hardcodes all repository destinations to the owner's repository", () => {
    expect(module.PUBLIC_REPOSITORY_URLS.repository).toBe("https://github.com/wangyingxuan383-ai/grok-build-desktop");
    expect(module.PUBLIC_REPOSITORY_URLS.releases).toBe(`${module.PUBLIC_REPOSITORY_URLS.repository}/releases`);
    expect(module.PUBLIC_REPOSITORY_URLS.issues).toBe(`${module.PUBLIC_REPOSITORY_URLS.repository}/issues`);
    expect(module.isAllowedApplicationMenuUrl(module.PUBLIC_REPOSITORY_URLS.repository)).toBe(true);
    expect(module.isAllowedApplicationMenuUrl("https://github.com/another/fork")).toBe(false);
    expect(module.isAllowedApplicationMenuUrl("file:///C:/Windows/System32/calc.exe")).toBe(false);
  });
});
