import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AboutUpdateCenter } from "./AppAuxiliaryPanels";

describe("AboutUpdateCenter", () => {
  it("separates application and CLI update status into explicit regions", () => {
    const html = renderToStaticMarkup(createElement(AboutUpdateCenter, {
      cliChecking: false,
      cliCheckMessage: "",
      onCheckCli: vi.fn(), onDiagnostics: vi.fn(), onOnboarding: vi.fn(),
    }));
    expect(html).toContain("桌面应用");
    expect(html).toContain("Grok CLI");
    expect(html).toContain("当前版本");
    expect(html).toContain("检查时间");
    expect(html).toContain("检查 CLI 更新");
    expect(html).toContain('aria-live="polite"');
  });
});
