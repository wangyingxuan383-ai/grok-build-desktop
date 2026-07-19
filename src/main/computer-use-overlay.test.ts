import { describe, expect, it } from "vitest";
import { isComputerTaskVisiblyActive, renderComputerOverlayHtml } from "./computer-use-overlay";

describe("Computer Use visible overlay", () => {
  it("is active only while control, pause or risk confirmation is live", () => {
    const base = { sessionId: "s", stepCount: 0, updatedAt: "now" } as const;
    expect(isComputerTaskVisiblyActive({ ...base, status: "running" })).toBe(true);
    expect(isComputerTaskVisiblyActive({ ...base, status: "paused" })).toBe(true);
    expect(isComputerTaskVisiblyActive({ ...base, status: "awaiting-risk-confirmation" })).toBe(true);
    expect(isComputerTaskVisiblyActive({ ...base, status: "completed" })).toBe(false);
  });

  it("renders the blue status frame, Esc affordance and escaped action text", () => {
    const html = renderComputerOverlayHtml({
      sessionId: "s", appName: "Fixture <App>", status: "running", stepCount: 2, updatedAt: "now",
      message: "正在点击 <Delete>", pointer: { x: 200, y: 150, action: "click" },
    }, { x: 100, y: 50, width: 1200, height: 800 }, true);
    expect(html).toContain("data-computer-overlay=\"active\"");
    expect(html).toContain("Esc 停止");
    expect(html).toContain("Fixture &lt;App&gt;");
    expect(html).toContain("正在点击 &lt;Delete&gt;");
    expect(html).toContain("left:100px;top:100px");
    expect(html).not.toContain("Fixture <App>");
  });
});
