import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { GlobalErrorToast } from "./GlobalErrorToast";

describe("GlobalErrorToast", () => {
  it("is an accessible bounded app error with copy, recovery and dismiss actions", () => {
    const html = renderToStaticMarkup(createElement(GlobalErrorToast, { message: "连接失败", onReload: vi.fn(), onDiagnostics: vi.fn(), onDismiss: vi.fn() }));
    expect(html).toContain('role="alert"');
    expect(html).toContain("复制诊断");
    expect(html).toContain("重新加载界面");
    expect(html).toContain("关闭错误提示");
  });
});
