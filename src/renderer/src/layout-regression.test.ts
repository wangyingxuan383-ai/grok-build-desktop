import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

describe("renderer layout regression guards", () => {
  it("keeps the main grid within the window so nested content can scroll", () => {
    expect(css).toMatch(/\.main-pane\s*\{[^}]*min-height:\s*0;[^}]*overflow:\s*hidden;/s);
  });

  it("gives the Codex mirror a bounded internal vertical scroller", () => {
    expect(css).toMatch(/\.codex-mirror\s*\{[^}]*height:\s*100%;[^}]*min-height:\s*0;[^}]*overflow:\s*hidden;/s);
    expect(css).toMatch(/\.codex-turns\s*\{[^}]*min-height:\s*0;[^}]*overflow-y:\s*auto;/s);
  });

  it("keeps the lazy extension center and Computer picker internally scrollable", () => {
    expect(css).toMatch(/\.extensions-panel\s*\{[^}]*height:\s*min\(780px,\s*94vh\);/s);
    expect(css).toMatch(/\.extensions-content\s*\{[^}]*overflow:\s*auto;/s);
    expect(css).toMatch(/\.computer-picker-grid\s*\{[^}]*max-height:\s*52vh;/s);
  });
});
