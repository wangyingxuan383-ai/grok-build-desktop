import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const app = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");

describe("renderer layout regression guards", () => {
  it("keeps the main grid within the window so nested content can scroll", () => {
    expect(css).toMatch(/\.main-pane\s*\{[^}]*min-height:\s*0;[^}]*overflow:\s*hidden;/s);
  });

  it("gives the Codex mirror a bounded internal vertical scroller", () => {
    expect(css).toMatch(/\.codex-mirror\s*\{[^}]*height:\s*100%;[^}]*min-height:\s*0;[^}]*overflow:\s*hidden;/s);
    expect(css).toMatch(/\.codex-turns\s*\{[^}]*min-height:\s*0;[^}]*overflow-y:\s*auto;/s);
  });

  it("keeps the lazy extension center and add palette internally scrollable", () => {
    expect(css).toMatch(/\.extensions-panel\s*\{[^}]*height:\s*min\(780px,\s*94vh\);/s);
    expect(css).toMatch(/\.extensions-content\s*\{[^}]*overflow:\s*auto;/s);
    expect(css).toMatch(/\.add-palette\s*\{[^}]*position:\s*absolute;[^}]*max-height:\s*min\(590px,/s);
    expect(css).toMatch(/\.add-palette-scroll\s*\{[^}]*overflow-y:\s*auto;/s);
  });

  it("keeps conversation-only and whole-window background layers isolated", () => {
    expect(css).toMatch(/\.app-shell\.background-conversation \.conversation-wrap::before/);
    expect(css).toMatch(/\.app-shell\.background-window \.sidebar, \.app-shell\.background-window \.main-pane/);
    expect(css).not.toMatch(/\.app-shell\.background-window\s*>\s*\*/);
  });

  it("mounts all root dialogs in a fixed overlay portal outside the application grid", () => {
    expect(html).toContain('<div id="overlay-root"></div>');
    expect(css).toMatch(/#overlay-root\s*\{[^}]*position:\s*fixed;[^}]*inset:\s*0;/s);
    expect(app).toContain('document.getElementById("overlay-root")!');
    const portalStart = app.indexOf("{createPortal(<>");
    const portalEnd = app.indexOf('document.getElementById("overlay-root")!', portalStart);
    expect(portalStart).toBeGreaterThan(0);
    expect(portalEnd).toBeGreaterThan(portalStart);
    const portal = app.slice(portalStart, portalEnd);
    expect(portal).toContain("<ControlPanel");
    expect(portal).toContain("<ComputerPermissionDialog");
    expect(portal).toContain("<ActionDialog");
    expect(app).toContain("element.getClientRects().length > 0");
    expect(app).not.toContain("element.offsetParent !== null");
  });
});
