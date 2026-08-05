import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function readCssGraph(url: URL, visited = new Set<string>()): string {
  if (visited.has(url.href)) return "";
  visited.add(url.href);
  const source = readFileSync(url, "utf8");
  const imports = [...source.matchAll(/@import\s+["']([^"']+)["'];/g)]
    .map((match) => readCssGraph(new URL(match[1]!, url), visited));
  return `${source}\n${imports.join("\n")}`;
}

const css = readCssGraph(new URL("./styles.css", import.meta.url));
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const app = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
const auxiliaryPanels = readFileSync(new URL("./components/AppAuxiliaryPanels.tsx", import.meta.url), "utf8");
const overlayFocusTrap = readFileSync(new URL("./hooks/use-overlay-focus-trap.ts", import.meta.url), "utf8");
const messageCard = readFileSync(new URL("./components/MessageCard.tsx", import.meta.url), "utf8");
const turnCard = readFileSync(new URL("./components/TurnCard.tsx", import.meta.url), "utf8");
const composer = readFileSync(new URL("./components/Composer.tsx", import.meta.url), "utf8");
const rightUtilityPane = readFileSync(new URL("./components/RightUtilityPane.tsx", import.meta.url), "utf8");
const providerManager = readFileSync(new URL("./components/ProviderManagerDialog.tsx", import.meta.url), "utf8");
const mediaStudio = readFileSync(new URL("./components/MediaStudioPanel.tsx", import.meta.url), "utf8");
const agentChangePane = readFileSync(new URL("./components/AgentChangePane.tsx", import.meta.url), "utf8");
const sidebar = readFileSync(new URL("./components/Sidebar.tsx", import.meta.url), "utf8");

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
    const portalStart = app.indexOf("{createPortal(<Suspense");
    const portalEnd = app.indexOf('document.getElementById("overlay-root")!', portalStart);
    expect(portalStart).toBeGreaterThan(0);
    expect(portalEnd).toBeGreaterThan(portalStart);
    const portal = app.slice(portalStart, portalEnd);
    expect(portal).toContain("<ControlPanel");
    expect(portal).toContain("<ComputerPermissionDialog");
    expect(portal).toContain("<ActionDialog");
    expect(overlayFocusTrap).toContain("element.getClientRects().length > 0");
    expect(overlayFocusTrap).toContain("new MutationObserver");
    expect(overlayFocusTrap).toContain("root?.contains(document.activeElement)");
    expect(overlayFocusTrap).not.toContain("element.offsetParent !== null");
  });

  it("keeps media actions in document flow and renders a missing-cache fallback", () => {
    expect(messageCard).toContain('className="media-inline-actions"');
    expect(messageCard).toContain("图片文件不可用");
    expect(messageCard).not.toContain("image-hover-actions");
    expect(css).toMatch(/\.media-inline-actions\s*\{[^}]*display:\s*flex;/s);
    expect(css).not.toMatch(/\.image-hover-actions\s*\{[^}]*position:\s*absolute;/s);
  });

  it("bounds multiple media results in one foldable gallery", () => {
    expect(messageCard).toContain("messages.slice(0, 4)");
    expect(messageCard).toContain("media-result-grid");
    expect(messageCard).toContain("收起媒体结果");
    expect(css).toMatch(/\.media-result-grid\s*\{[^}]*max-height:[^;}]+;[^}]*overflow:\s*auto;/s);
  });

  it("separates a live empty turn from terminal history recovery", () => {
    expect(turnCard).toContain("正在生成回答");
    expect(turnCard).toContain("等待你的操作");
    expect(turnCard).toContain("Token 将在回合结算后更新");
  });

  it("makes composer operation notices dismissible", () => {
    expect(composer).toContain('aria-label="关闭提示"');
    expect(app).toContain('onDismissNotice={() => setComposerNotice("")}');
  });

  it("isolates prompt submission state per conversation and exposes background activity", () => {
    expect(app).toContain("sendingSessionIdsRef");
    expect(app).toContain("hasSessionSubmission(sendingSessionIdsRef.current");
    expect(app).toContain("updateSendingSessions([event.sessionId], false)");
    expect(app).not.toContain("const [sending, setSending]");
    expect(sidebar).toContain('session.status === "working" ? "运行中"');
    expect(sidebar).toContain("liveSessionCount");
  });

  it("keeps recent-file preview inside the right pane and offers wrapping", () => {
    expect(rightUtilityPane).toContain('className={wrap ? "wrap" : ""}');
    expect(css).toMatch(/\.right-files-tool pre\s*\{[^}]*min-width:\s*0;[^}]*max-width:\s*100%;[^}]*overflow:\s*auto;/s);
    expect(css).not.toMatch(/\.right-files-tool pre\s*\{[^}]*min-width:\s*max-content;/s);
  });

  it("uses a readable unified Agent diff in the bounded right dock", () => {
    expect(agentChangePane).toContain("renderSideBySide: false");
    expect(agentChangePane).toContain('wordWrap: wrap ? "on" : "off"');
    expect(css).toMatch(/\.agent-change-pane \.review-selected-file\s*\{[^}]*display:\s*flex;[^}]*overflow:\s*hidden;/s);
    expect(css).toContain("@container (max-width: 620px)");
  });

  it("uses Codex-like compact approval surfaces rather than a permanent form card", () => {
    expect(messageCard).toContain('className="action-card decision-card codex-request-card"');
    expect(messageCard).toContain('className="request-card-actions"');
    expect(messageCard).toContain("实施计划");
    expect(css).toMatch(/\.codex-request-card\s*\{[^}]*border-radius:\s*22px;[^}]*background:\s*var\(--input-bg\);/s);
  });

  it("keeps long plan/code content scrollable instead of clipping the card", () => {
    expect(css).toMatch(/\.plan-content\s*\{[^}]*max-width:\s*100%;[^}]*overflow:\s*auto;/s);
    expect(css).toMatch(/\.code-wrap > div\s*\{[^}]*max-width:\s*100%;[^}]*overflow:\s*auto;/s);
    expect(css).toMatch(/\.plan-content table\s*\{[^}]*display:\s*block;[^}]*overflow:\s*auto;/s);
  });

  it("bounds large account collections and keeps the active account first", () => {
    expect(css).toMatch(/\.account-list\s*\{[^}]*max-height:[^;}]+;[^}]*overflow:\s*auto;/s);
    expect(auxiliaryPanels).toContain("const displayAccounts = [...store.accounts].sort");
    expect(auxiliaryPanels).toContain("displayAccounts.map((account)");
  });

  it("uses manual media configuration without requiring a slow context scan", () => {
    expect(providerManager).toContain("仅检测媒体");
    expect(providerManager).toContain('context: { mode: "off" }');
    expect(providerManager).not.toContain("精确极限（仅单模型）");
    expect(mediaStudio).toContain("手工配置（未验证）");
    expect(mediaStudio).toContain("无需先完成深度扫描");
  });
});
