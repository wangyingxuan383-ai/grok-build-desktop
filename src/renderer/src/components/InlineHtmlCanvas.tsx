import { useEffect, useMemo, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Check, Code, Copy, Eye, Maximize2, Monitor, Moon, Sun, X } from "lucide-react";
import { DARK_COLORS, LIGHT_COLORS } from "../theme";
import "../styles/t3-panels.css";

export type InlineCanvasMode = "preview" | "source";
export type SimulatedAppearance = "system" | "light" | "dark";

export interface InlineHtmlCanvasProps {
  source: string;
  language: "html" | "svg";
  autoRender?: boolean;
  renderSourceFallback?: (source: string, language: string) => React.JSX.Element;
}

const MIN_CANVAS_HEIGHT = 80;
const MAX_CANVAS_HEIGHT = 1600;

const DARK_CHART_PALETTE = ["#6ea8fe", "#22d3ee", "#4cc38a", "#e5b454", "#c084fc", "#f06a6a"] as const;
const LIGHT_CHART_PALETTE = ["#2563eb", "#0891b2", "#16a34a", "#d97706", "#9333ea", "#dc2626"] as const;

interface HostThemeTokens {
  resolvedLight: boolean;
  vars: Record<string, string>;
}

const TOKEN_NAMES = [
  "--color-window",
  "--color-frame",
  "--color-card",
  "--color-card-selected",
  "--color-popover",
  "--color-input",
  "--color-border",
  "--color-border-strong",
  "--color-fg",
  "--color-fg-subtle",
  "--color-fg-subtlest",
  "--color-primary",
  "--color-primary-fg",
  "--color-accent",
  "--color-success",
  "--color-warning",
  "--color-danger",
  "--chart-1",
  "--chart-2",
  "--chart-3",
  "--chart-4",
  "--chart-5",
  "--chart-6",
  "--font-sans",
  "--font-mono",
  "--radius-lg",
  "--radius-md",
] as const;

function readHostThemeTokens(): HostThemeTokens {
  if (typeof document === "undefined") {
    return { resolvedLight: false, vars: {} };
  }
  const root = document.documentElement;
  const computed = getComputedStyle(root);
  const vars: Record<string, string> = {};
  for (const name of TOKEN_NAMES) {
    const val = computed.getPropertyValue(name).trim();
    if (val) vars[name] = val;
  }
  return {
    resolvedLight: root.dataset.themeResolved === "light",
    vars,
  };
}

/**
 * Rewrites viewport-dependent CSS (`100vh`, `100dvh`, `min-height: 100%`) and
 * strips navigation-inducing tags (`<base>`, meta refresh) so `ResizeObserver`
 * never enters an infinite height growth loop.
 */
export function sanitizeInlineHtmlForAutoHeight(raw: string, language: "html" | "svg"): string {
  let cleaned = raw
    .replace(/<base\b[^>]*>/gi, "")
    .replace(/<meta\b[^>]*http-equiv\s*=\s*["']?refresh["']?[^>]*>/gi, "");

  cleaned = cleaned
    .replace(/min-height\s*:\s*100(?:\.0+)?(?:[dls]?vh|%)\b/gi, "min-height: 0")
    .replace(/height\s*:\s*100(?:\.0+)?[dls]?vh\b/gi, "height: auto")
    .replace(/(?:min-)?height\s*:\s*calc\(\s*100[dls]?vh[^)]*\)/gi, "height: auto")
    .replace(/(\d+(?:\.\d+)?)[dls]?vh\b/gi, (_match, rawNum: string) => {
      const n = Number(rawNum);
      if (!Number.isFinite(n)) return "240px";
      const px = Math.max(32, Math.min(960, Math.round(n * 5.4)));
      return `${px}px`;
    });

  if (language === "svg" && !/^\s*<!doctype/i.test(cleaned) && !/<html[\s>]/i.test(cleaned)) {
    return `<div class="__grok_svg_stage">${cleaned}</div>`;
  }
  return cleaned;
}

function buildRootCssVariables(host: HostThemeTokens, appearance: SimulatedAppearance): { isLight: boolean; cssText: string } {
  const isLight = appearance === "system" ? host.resolvedLight : appearance === "light";
  const followHost = appearance === "system" || isLight === host.resolvedLight;

  const palette = isLight ? LIGHT_COLORS : DARK_COLORS;
  const charts = isLight ? LIGHT_CHART_PALETTE : DARK_CHART_PALETTE;

  const entries: Record<string, string> = {
    "--color-window": followHost && host.vars["--color-window"] ? host.vars["--color-window"] : palette.background,
    "--color-frame": followHost && host.vars["--color-frame"] ? host.vars["--color-frame"] : palette.surface,
    "--color-card": followHost && host.vars["--color-card"] ? host.vars["--color-card"] : palette.surface,
    "--color-card-selected":
      followHost && host.vars["--color-card-selected"]
        ? host.vars["--color-card-selected"]
        : isLight
          ? "#f3f4f6"
          : "#262626",
    "--color-popover": followHost && host.vars["--color-popover"] ? host.vars["--color-popover"] : palette.surface,
    "--color-input": followHost && host.vars["--color-input"] ? host.vars["--color-input"] : palette.background,
    "--color-border": followHost && host.vars["--color-border"] ? host.vars["--color-border"] : palette.border,
    "--color-border-strong":
      followHost && host.vars["--color-border-strong"]
        ? host.vars["--color-border-strong"]
        : isLight
          ? "#cbd5e1"
          : "#3f3f46",
    "--color-fg": followHost && host.vars["--color-fg"] ? host.vars["--color-fg"] : palette.text,
    "--color-fg-subtle": followHost && host.vars["--color-fg-subtle"] ? host.vars["--color-fg-subtle"] : palette.muted,
    "--color-fg-subtlest":
      followHost && host.vars["--color-fg-subtlest"]
        ? host.vars["--color-fg-subtlest"]
        : isLight
          ? "#94a3b8"
          : "#71717a",
    "--color-accent": followHost && host.vars["--color-accent"] ? host.vars["--color-accent"] : palette.accent,
    "--color-primary": followHost && host.vars["--color-primary"] ? host.vars["--color-primary"] : palette.accent,
    "--color-primary-fg":
      followHost && host.vars["--color-primary-fg"] ? host.vars["--color-primary-fg"] : "#ffffff",
    "--color-success": followHost && host.vars["--color-success"] ? host.vars["--color-success"] : isLight ? "#16a34a" : "#4cc38a",
    "--color-warning": followHost && host.vars["--color-warning"] ? host.vars["--color-warning"] : isLight ? "#d97706" : "#e5b454",
    "--color-danger": followHost && host.vars["--color-danger"] ? host.vars["--color-danger"] : isLight ? "#dc2626" : "#f06a6a",
    "--chart-1": followHost && host.vars["--chart-1"] ? host.vars["--chart-1"] : charts[0],
    "--chart-2": followHost && host.vars["--chart-2"] ? host.vars["--chart-2"] : charts[1],
    "--chart-3": followHost && host.vars["--chart-3"] ? host.vars["--chart-3"] : charts[2],
    "--chart-4": followHost && host.vars["--chart-4"] ? host.vars["--chart-4"] : charts[3],
    "--chart-5": followHost && host.vars["--chart-5"] ? host.vars["--chart-5"] : charts[4],
    "--chart-6": followHost && host.vars["--chart-6"] ? host.vars["--chart-6"] : charts[5],
    "--font-sans":
      host.vars["--font-sans"] ||
      '"Segoe UI Variable Text", "Segoe UI", "Microsoft YaHei UI", system-ui, sans-serif',
    "--font-mono": host.vars["--font-mono"] || '"Cascadia Code", Consolas, monospace',
    "--radius-lg": host.vars["--radius-lg"] || "8px",
    "--radius-md": host.vars["--radius-md"] || "6px",
  };

  entries["--bg"] = entries["--color-card"]!;
  entries["--surface"] = entries["--color-frame"]!;
  entries["--panel"] = entries["--color-frame"]!;
  entries["--text"] = entries["--color-fg"]!;
  entries["--muted"] = entries["--color-fg-subtle"]!;
  entries["--accent"] = entries["--color-accent"]!;
  entries["--border"] = entries["--color-border"]!;

  const declarations = Object.entries(entries)
    .map(([k, v]) => `  ${k}: ${v.replace(/[;<>{}]/g, "")};`)
    .join("\n");

  return { isLight, cssText: `:root {\n  color-scheme: ${isLight ? "light" : "dark"};\n${declarations}\n}` };
}

function extractFullHtmlParts(markup: string): {
  headExtra: string;
  bodyContent: string;
  bodyClass: string;
  bodyStyle: string;
} {
  const headMatch = /<head[^>]*>([\s\S]*?)<\/head>/i.exec(markup);
  const bodyMatch = /<body([^>]*)>([\s\S]*?)<\/body>/i.exec(markup);
  const hasHtmlWrapper = /<html[\s>]/i.test(markup) || /<!doctype[^>]*>/i.test(markup);
  if (headMatch || bodyMatch || hasHtmlWrapper) {
    const bodyAttrs = bodyMatch?.[1] ?? "";
    const bodyClass = /\bclass\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(bodyAttrs)?.slice(1).find(Boolean) ?? "";
    const bodyStyle = /\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(bodyAttrs)?.slice(1).find(Boolean) ?? "";
    const stripped = markup
      .replace(/<!doctype[^>]*>/gi, "")
      .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, "")
      .replace(/<\/?(?:html|body)[^>]*>/gi, "");
    return {
      headExtra: headMatch?.[1] ?? "",
      bodyContent: bodyMatch?.[2] ?? stripped,
      bodyClass: bodyClass.replace(/["<>]/g, ""),
      bodyStyle: bodyStyle.replace(/["<>]/g, ""),
    };
  }
  return { headExtra: "", bodyContent: markup, bodyClass: "", bodyStyle: "" };
}

function buildSandboxedDataUrl(
  rawSource: string,
  language: "html" | "svg",
  host: HostThemeTokens,
  appearance: SimulatedAppearance,
  token: string,
): string {
  const sanitized = sanitizeInlineHtmlForAutoHeight(rawSource, language);
  const { headExtra, bodyContent, bodyClass, bodyStyle } = extractFullHtmlParts(sanitized);
  const { isLight, cssText } = buildRootCssVariables(host, appearance);

  const csp = [
    "default-src 'none'",
    "script-src 'unsafe-inline'",
    "style-src 'unsafe-inline'",
    "img-src data: blob:",
    "font-src data:",
    "media-src data: blob:",
    "connect-src 'none'",
    "form-action 'none'",
    "frame-src 'none'",
    "object-src 'none'",
  ].join("; ");

  const doc = `<!DOCTYPE html>
<html lang="zh-CN" data-theme="${isLight ? "light" : "dark"}">
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style id="__grok_theme_vars">
${cssText}
*, *::before, *::after { box-sizing: border-box; }
html, body {
  margin: 0;
  padding: 0;
  width: 100%;
  height: auto !important;
  min-height: 0 !important;
  max-height: none !important;
  background: var(--color-card);
  color: var(--color-fg);
  font-family: var(--font-sans);
  font-size: 13px;
  line-height: 1.55;
  overflow-x: auto;
  overflow-y: auto;
}
#__grok_canvas_root {
  width: 100%;
  height: auto !important;
  min-height: 0 !important;
  padding: 12px;
  overflow-x: auto;
}
.__grok_svg_stage {
  display: flex;
  justify-content: center;
  align-items: center;
  width: 100%;
}
#__grok_canvas_root svg {
  max-width: 100%;
  height: auto;
}
</style>
${headExtra}
</head>
<body>
<div id="__grok_canvas_root"${bodyClass ? ` class="${bodyClass}"` : ""}${bodyStyle ? ` style="${bodyStyle}"` : ""}>${bodyContent}</div>
<script>
(function () {
  var TOKEN = ${JSON.stringify(token)};
  var root = document.getElementById("__grok_canvas_root");
  var lastSent = 0;
  var rafId = 0;
  function measure() {
    if (!root) return;
    var rect = root.getBoundingClientRect();
    var h = Math.ceil(Math.max(root.scrollHeight || 0, rect.height || 0));
    if (h > 0 && Math.abs(h - lastSent) >= 2) {
      lastSent = h;
      parent.postMessage({ __grokInlineCanvas: true, token: TOKEN, height: h }, "*");
    }
  }
  function schedule() {
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(measure);
  }
  if (typeof ResizeObserver === "function" && root) {
    new ResizeObserver(schedule).observe(root);
  }
  if (typeof MutationObserver === "function" && root) {
    new MutationObserver(schedule).observe(root, { childList: true, subtree: true, attributes: true });
  }
  window.addEventListener("load", schedule);
  setTimeout(schedule, 30);
  setTimeout(schedule, 180);
})();
</script>
</body>
</html>`;

  return `data:text/html;charset=utf-8,${encodeURIComponent(doc)}`;
}

function SandboxedCanvasFrame({
  dataUrl,
  token,
  title,
  expanded = false,
}: {
  dataUrl: string;
  token: string;
  title: string;
  expanded?: boolean;
}): React.JSX.Element {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(220);

  useEffect(() => {
    const onMessage = (event: MessageEvent): void => {
      if (event.origin !== "null") return;
      if (!iframeRef.current || event.source !== iframeRef.current.contentWindow) return;
      const payload = event.data as { __grokInlineCanvas?: unknown; token?: unknown; height?: unknown } | null;
      if (!payload || payload.__grokInlineCanvas !== true || payload.token !== token) return;
      const raw = Number(payload.height);
      if (!Number.isFinite(raw) || raw <= 0) return;
      const clamped = Math.max(MIN_CANVAS_HEIGHT, Math.min(MAX_CANVAS_HEIGHT, Math.ceil(raw)));
      setHeight((prev) => (Math.abs(prev - clamped) >= 2 ? clamped : prev));
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [token]);

  return (
    <iframe
      ref={iframeRef}
      className={`inline-html-frame${expanded ? " is-expanded" : ""}`}
      title={title}
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      src={dataUrl}
      style={expanded ? undefined : { height: `${height}px` }}
    />
  );
}

export function InlineHtmlCanvas({
  source,
  language,
  autoRender = false,
  renderSourceFallback,
}: InlineHtmlCanvasProps): React.JSX.Element {
  const [mode, setMode] = useState<InlineCanvasMode>(autoRender ? "preview" : "source");
  const [appearance, setAppearance] = useState<SimulatedAppearance>("system");
  const [settledSource, setSettledSource] = useState(source);
  const [hostTheme, setHostTheme] = useState<HostThemeTokens>(readHostThemeTokens);
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const inlineToken = useMemo(() => `canvas-${crypto.randomUUID()}`, []);
  const expandedToken = useMemo(() => `canvas-exp-${crypto.randomUUID()}`, []);

  useEffect(() => {
    if (mode !== "preview") {
      setSettledSource(source);
      return;
    }
    const timer = window.setTimeout(() => {
      setSettledSource(source);
    }, 180);
    return () => window.clearTimeout(timer);
  }, [mode, source]);

  useEffect(() => {
    const syncTheme = (): void => setHostTheme(readHostThemeTokens());
    document.documentElement.addEventListener("grok-theme-change", syncTheme);
    return () => document.documentElement.removeEventListener("grok-theme-change", syncTheme);
  }, []);

  const inlineDataUrl = useMemo(() => {
    if (mode !== "preview") return "";
    return buildSandboxedDataUrl(settledSource, language, hostTheme, appearance, inlineToken);
  }, [appearance, hostTheme, inlineToken, language, mode, settledSource]);

  const expandedDataUrl = useMemo(() => {
    if (!expanded) return "";
    return buildSandboxedDataUrl(settledSource, language, hostTheme, appearance, expandedToken);
  }, [appearance, expanded, expandedToken, hostTheme, language, settledSource]);

  const handleCopy = (): void => {
    void navigator.clipboard
      .writeText(source)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => undefined);
  };

  const badgeLabel = language === "svg" ? "SVG 画布" : autoRender ? "HTML 实时画布" : "HTML";

  return (
    <Dialog.Root open={expanded} onOpenChange={setExpanded}>
      <div className={`inline-html-canvas mode-${mode}`}>
        <header className="inline-html-toolbar" role="toolbar" aria-label={`${badgeLabel}工具栏`}>
          <div className="inline-html-tabs" role="group" aria-label="预览与源码切换">
            <button
              type="button"
              className={mode === "preview" ? "active" : ""}
              aria-pressed={mode === "preview"}
              onClick={() => setMode("preview")}
            >
              <Eye size={12} />
              <span>📊 预览</span>
            </button>
            <button
              type="button"
              className={mode === "source" ? "active" : ""}
              aria-pressed={mode === "source"}
              onClick={() => setMode("source")}
            >
              <Code size={12} />
              <span>源码</span>
            </button>
          </div>

          <span className="inline-html-lang">{badgeLabel}</span>

          <div className="inline-html-actions">
            {mode === "preview" && (
              <div className="inline-html-appearance" role="group" aria-label="画布外观模拟">
                <button
                  type="button"
                  className={appearance === "system" ? "active" : ""}
                  aria-pressed={appearance === "system"}
                  title="跟随应用主题"
                  onClick={() => setAppearance("system")}
                >
                  <Monitor size={11} />
                </button>
                <button
                  type="button"
                  className={appearance === "light" ? "active" : ""}
                  aria-pressed={appearance === "light"}
                  title="模拟浅色外观"
                  onClick={() => setAppearance("light")}
                >
                  <Sun size={11} />
                </button>
                <button
                  type="button"
                  className={appearance === "dark" ? "active" : ""}
                  aria-pressed={appearance === "dark"}
                  title="模拟深色外观"
                  onClick={() => setAppearance("dark")}
                >
                  <Moon size={11} />
                </button>
              </div>
            )}

            <button type="button" className="inline-html-btn" onClick={handleCopy} title="复制源码">
              {copied ? <Check size={12} /> : <Copy size={12} />}
              <span>{copied ? "已复制" : "复制"}</span>
            </button>

            {mode === "preview" && (
              <Dialog.Trigger asChild>
                <button type="button" className="inline-html-btn" title="放大查看画布" aria-label="放大查看画布">
                  <Maximize2 size={12} />
                </button>
              </Dialog.Trigger>
            )}
          </div>
        </header>

        {mode === "preview" ? (
          <div className="inline-html-stage">
            <SandboxedCanvasFrame
              dataUrl={inlineDataUrl}
              token={inlineToken}
              title={`${badgeLabel}沙箱预览`}
            />
          </div>
        ) : renderSourceFallback ? (
          renderSourceFallback(source, language)
        ) : (
          <pre className="inline-html-raw">
            <code>{source}</code>
          </pre>
        )}
      </div>

      <Dialog.Portal>
        <Dialog.Overlay className="ui-dialog-overlay" />
        <Dialog.Content className="ui-dialog inline-html-expanded-dialog">
          <header className="inline-html-expanded-head">
            <div>
              <Dialog.Title>{badgeLabel} · 独立沙箱视图</Dialog.Title>
              <Dialog.Description>
                隔离运行 (sandbox=&quot;allow-scripts&quot;)，禁用外部网络与表单提交。
              </Dialog.Description>
            </div>
            <div className="inline-html-actions">
              <div className="inline-html-appearance" role="group" aria-label="画布外观模拟">
                <button
                  type="button"
                  className={appearance === "system" ? "active" : ""}
                  aria-pressed={appearance === "system"}
                  onClick={() => setAppearance("system")}
                  title="跟随应用主题"
                >
                  <Monitor size={12} />
                </button>
                <button
                  type="button"
                  className={appearance === "light" ? "active" : ""}
                  aria-pressed={appearance === "light"}
                  onClick={() => setAppearance("light")}
                  title="浅色模式"
                >
                  <Sun size={12} />
                </button>
                <button
                  type="button"
                  className={appearance === "dark" ? "active" : ""}
                  aria-pressed={appearance === "dark"}
                  onClick={() => setAppearance("dark")}
                  title="深色模式"
                >
                  <Moon size={12} />
                </button>
              </div>
              <button type="button" className="inline-html-btn" onClick={handleCopy}>
                {copied ? <Check size={12} /> : <Copy size={12} />}
                <span>{copied ? "已复制" : "复制源码"}</span>
              </button>
              <Dialog.Close asChild>
                <button type="button" className="inline-html-btn" aria-label="关闭放大预览">
                  <X size={14} />
                </button>
              </Dialog.Close>
            </div>
          </header>
          <div className="inline-html-expanded-body">
            {expanded && (
              <SandboxedCanvasFrame
                dataUrl={expandedDataUrl}
                token={expandedToken}
                title={`${badgeLabel}全屏沙箱预览`}
                expanded
              />
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
