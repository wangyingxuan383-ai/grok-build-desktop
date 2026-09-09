import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ComposerRunActions } from "./Composer";

describe("ComposerRunActions", () => {
  it("keeps one queue primary action, one secondary menu and one fixed stop action", () => {
    const html = renderToStaticMarkup(createElement(ComposerRunActions, {
      canSubmit: true,
      canAskAside: true,
      btwAvailable: true,
      onQueue: vi.fn(), onInterject: vi.fn(), onBtw: vi.fn(), onStop: vi.fn(),
    }));
    expect(html).toContain("加入队列");
    expect(html).toContain("插入当前回合");
    expect(html).toContain("旁路提问");
    expect(html).toContain('aria-label="停止当前回合"');
    expect((html.match(/class="queue-send primary-action"/g) ?? [])).toHaveLength(1);
  });

  it("does not expose an unavailable aside action", () => {
    const html = renderToStaticMarkup(createElement(ComposerRunActions, {
      canSubmit: false,
      canAskAside: false,
      btwAvailable: false,
      onQueue: vi.fn(), onInterject: vi.fn(), onStop: vi.fn(),
    }));
    expect(html).not.toContain("旁路提问");
    expect(html).toContain("disabled");
  });
});
