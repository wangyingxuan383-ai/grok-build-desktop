import { isValidElement, memo, useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { InlineHtmlCanvas } from "./InlineHtmlCanvas";
import "katex/dist/katex.min.css";

interface MdastNode {
  type?: string;
  lang?: string | null;
  meta?: string | null;
  children?: MdastNode[];
}

function remarkCodeRenderMeta() {
  return (tree: MdastNode): void => {
    const walk = (node: MdastNode): void => {
      if (node.type === "code" && typeof node.lang === "string") {
        const normalizedLang = node.lang.trim().toLowerCase();
        const meta = (node.meta || "").trim();
        if (
          (normalizedLang === "html" || normalizedLang === "svg") &&
          /\b(?:render|preview|live)\b/i.test(meta)
        ) {
          node.lang = `${normalizedLang}-render`;
        }
      }
      if (Array.isArray(node.children)) {
        for (const child of node.children) walk(child);
      }
    };
    walk(tree);
  };
}

export const MarkdownView = memo(function MarkdownView({ text }: { text: string }): React.JSX.Element {
  return (
    <div className="markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath, remarkCodeRenderMeta]}
        rehypePlugins={[rehypeSanitize, rehypeKatex]}
        components={{
          a: ({ href, children }) => (
            <a
              href={href}
              onClick={(event) => {
                event.preventDefault();
                if (href) void window.grokDesktop.openExternal(href);
              }}
            >
              {children}
            </a>
          ),
          pre: ({ children }) => {
            if (isValidElement<{ className?: string }>(children)) {
              const childClass = children.props?.className || "";
              if (/\blanguage-/.test(childClass)) {
                return <>{children}</>;
              }
            }
            return <pre>{children}</pre>;
          },
          code: ({ className, children, ...props }) => {
            const rawLang = /language-([^\s]+)/.exec(className || "")?.[1]?.toLowerCase();
            const value = String(children).replace(/\n$/, "");

            if (rawLang === "mermaid") {
              return <Mermaid source={value} />;
            }
            if (rawLang === "html-render" || rawLang === "html-preview") {
              return (
                <InlineHtmlCanvas
                  language="html"
                  source={value}
                  autoRender
                  renderSourceFallback={(src) => <HighlightedCode language="html" source={src} bare />}
                />
              );
            }
            if (rawLang === "svg-render" || rawLang === "svg-preview") {
              return (
                <InlineHtmlCanvas
                  language="svg"
                  source={value}
                  autoRender
                  renderSourceFallback={(src) => <HighlightedCode language="xml" source={src} bare />}
                />
              );
            }
            if (rawLang === "html") {
              return (
                <InlineHtmlCanvas
                  language="html"
                  source={value}
                  autoRender={false}
                  renderSourceFallback={(src) => <HighlightedCode language="html" source={src} bare />}
                />
              );
            }
            if (rawLang === "svg" || (rawLang === "xml" && /^\s*<svg[\s>]/i.test(value))) {
              return (
                <InlineHtmlCanvas
                  language="svg"
                  source={value}
                  autoRender={false}
                  renderSourceFallback={(src) => <HighlightedCode language="xml" source={src} bare />}
                />
              );
            }
            if (rawLang) {
              return <HighlightedCode language={rawLang} source={value} />;
            }
            return (
              <code {...props} className={className}>
                {children}
              </code>
            );
          },
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});

export function HighlightedCode({
  language,
  source,
  bare = false,
}: {
  language: string;
  source: string;
  bare?: boolean;
}): React.JSX.Element {
  const [html, setHtml] = useState("");
  const { light } = useThemeSnapshot();
  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      void import("./syntax-highlighter")
        .then((module) => module.highlightCode(source, language, light))
        .then((value) => {
          if (active) setHtml(value);
        })
        .catch(() => {
          if (active) setHtml("");
        });
    }, 120);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [language, light, source]);

  if (bare) {
    return (
      <div className="code-wrap is-bare">
        {html ? (
          <div dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <pre>
            <code>{source}</code>
          </pre>
        )}
      </div>
    );
  }

  return (
    <div className="code-wrap">
      <button type="button" onClick={() => void navigator.clipboard.writeText(source)}>
        复制
      </button>
      {html ? (
        <div dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <pre>
          <code>{source}</code>
        </pre>
      )}
    </div>
  );
}

function readMermaidThemeVariables(light: boolean): { fontFamily: string; themeVariables: Record<string, string | boolean> } {
  const style = getComputedStyle(document.documentElement);
  const pick = (name: string, fallback: string): string => style.getPropertyValue(name).trim() || fallback;

  const windowBg = pick("--color-window", light ? "#f3f3f2" : "#121212");
  const frameBg = pick("--color-frame", light ? "#ffffff" : "#191919");
  const cardBg = pick("--color-card", light ? "#ffffff" : "#212121");
  const cardSelected = pick("--color-card-selected", light ? "#eef2f6" : "#292929");
  const fg = pick("--color-fg", light ? "#1c1c1c" : "#ececec");
  const fgSubtle = pick("--color-fg-subtle", light ? "#5f5f5f" : "#a1a1a1");
  const border = pick("--color-border", light ? "#e0e0de" : "#2a2a2a");
  const borderStrong = pick("--color-border-strong", light ? "#cbd5e1" : "#3a3a3a");
  const accent = pick("--color-accent", light ? "#2a6fdb" : "#6ea8fe");
  const fontFamily = pick("--font-sans", '"Segoe UI", system-ui, sans-serif');

  return {
    fontFamily,
    themeVariables: {
      darkMode: !light,
      background: cardBg,
      fontFamily,
      primaryColor: cardSelected,
      primaryTextColor: fg,
      primaryBorderColor: accent,
      lineColor: fgSubtle,
      secondaryColor: frameBg,
      secondaryTextColor: fg,
      secondaryBorderColor: borderStrong,
      tertiaryColor: windowBg,
      tertiaryTextColor: fg,
      tertiaryBorderColor: border,
      mainBkg: cardSelected,
      nodeBorder: accent,
      clusterBkg: frameBg,
      clusterBorder: borderStrong,
      titleColor: fg,
      edgeLabelBackground: cardBg,
      actorBkg: cardSelected,
      actorBorder: accent,
      actorTextColor: fg,
      actorLineColor: fgSubtle,
      signalColor: fg,
      signalTextColor: fg,
      labelBoxBkgColor: cardBg,
      labelBoxBorderColor: borderStrong,
      labelTextColor: fg,
      noteBkgColor: frameBg,
      noteBorderColor: borderStrong,
      noteTextColor: fg,
      pie1: pick("--chart-1", "#6ea8fe"),
      pie2: pick("--chart-2", "#22d3ee"),
      pie3: pick("--chart-3", "#4cc38a"),
      pie4: pick("--chart-4", "#e5b454"),
      pie5: pick("--chart-5", "#c084fc"),
      pie6: pick("--chart-6", "#f06a6a"),
    },
  };
}

function Mermaid({ source }: { source: string }): React.JSX.Element {
  const baseId = useMemo(() => `mermaid-${crypto.randomUUID()}`, []);
  const [svg, setSvg] = useState("");
  const [error, setError] = useState("");
  const { light, revision } = useThemeSnapshot();

  useEffect(() => {
    let active = true;
    setError("");
    setSvg("");
    const renderId = `${baseId}-r${revision}`;
    const timer = window.setTimeout(() => {
      void import("mermaid")
        .then(({ default: mermaid }) => {
          const { fontFamily, themeVariables } = readMermaidThemeVariables(light);
          mermaid.initialize({
            startOnLoad: false,
            theme: "base",
            securityLevel: "strict",
            fontFamily,
            themeVariables,
          });
          return mermaid.render(renderId, source);
        })
        .then((result) => {
          if (active) {
            setError("");
            setSvg(result.svg);
          }
        })
        .catch((reason) => {
          if (active) setError(reason instanceof Error ? reason.message : String(reason));
        });
    }, 120);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [baseId, light, revision, source]);

  if (error) return <pre className="mermaid-error">{source}</pre>;
  const copySource = (): void => {
    void navigator.clipboard.writeText(source);
  };
  const copyImage = (): void => {
    if (!svg) return;
    const encoded = btoa(unescape(encodeURIComponent(svg)));
    void window.grokDesktop.copyImage(`data:image/svg+xml;base64,${encoded}`);
  };
  const openImage = (): void => {
    if (!svg) return;
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    const popup = window.open(url, "_blank", "noopener,noreferrer");
    if (!popup) URL.revokeObjectURL(url);
    else window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };
  return (
    <div className="mermaid-wrap">
      <div className="mermaid-toolbar" role="toolbar" aria-label="Mermaid 图表操作">
        <button type="button" onClick={copySource}>
          复制源码
        </button>
        <button type="button" disabled={!svg} onClick={copyImage}>
          复制图像
        </button>
        <button type="button" disabled={!svg} onClick={openImage}>
          打开图像
        </button>
      </div>
      <div className="mermaid" dangerouslySetInnerHTML={{ __html: svg }} />
    </div>
  );
}

function useThemeSnapshot(): { light: boolean; revision: number } {
  const readLight = (): boolean => document.documentElement.dataset.themeResolved === "light";
  const [snapshot, setSnapshot] = useState(() => ({ light: readLight(), revision: 0 }));
  useEffect(() => {
    const update = (): void =>
      setSnapshot((prev) => ({ light: readLight(), revision: prev.revision + 1 }));
    document.documentElement.addEventListener("grok-theme-change", update);
    return () => document.documentElement.removeEventListener("grok-theme-change", update);
  }, []);
  return snapshot;
}
