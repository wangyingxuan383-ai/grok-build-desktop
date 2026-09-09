import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SessionListRow, sessionStatusPresentation } from "./SessionListRow";

describe("SessionListRow", () => {
  it("uses one keyboard-operable open surface and keeps secondary actions in one menu", () => {
    const html = renderToStaticMarkup(createElement(SessionListRow, {
      session: { id: "s1", cwd: "C:\\repo", title: "修复登录", preview: "继续检查设备码流程", status: "needs-user", updatedAt: new Date().toISOString(), messageCount: 8 } as never,
      active: true,
      menuOpen: false,
      onOpen: vi.fn(), onMenu: vi.fn(), onPin: vi.fn(), onArchive: vi.fn(), onExport: vi.fn(), onRename: vi.fn(), onDelete: vi.fn(),
    }));
    expect(html).toContain('class="session-open"');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain("等待操作");
    expect(html).toContain("导出 Markdown");
    expect(html).toContain("重命名");
    expect(html).not.toContain("session-quick-actions");
  });

  it("maps each non-idle state to one authoritative label", () => {
    expect(sessionStatusPresentation("working").label).toBe("运行中");
    expect(sessionStatusPresentation("queued").label).toBe("等待处理");
    expect(sessionStatusPresentation("unread").label).toBe("后台已完成");
    expect(sessionStatusPresentation("error").label).toBe("运行失败");
  });
});
