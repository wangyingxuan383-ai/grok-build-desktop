import { memo, useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

export const MarkdownView = memo(function MarkdownView({ text }: { text: string }): React.JSX.Element {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeSanitize, rehypeKatex]}
      components={{
        a: ({ href, children }) => <a href={href} onClick={(event) => { event.preventDefault(); if (href) void window.grokDesktop.openExternal(href); }}>{children}</a>,
        code: ({ className, children, ...props }) => {
          const language = /language-([^ ]+)/.exec(className || "")?.[1];
          const value = String(children).replace(/\n$/, "");
          if (language === "mermaid") return <Mermaid source={value} />;
          if (language) return <HighlightedCode language={language} source={value} />;
          return <code {...props} className={className}>{children}</code>;
        },
      }}
    >{text}</ReactMarkdown>
  );
});

function HighlightedCode({ language, source }: { language: string; source: string }): React.JSX.Element {
  const [html, setHtml] = useState("");
  const light = useLightTheme();
  useEffect(() => {
    let active = true;
    void import("./syntax-highlighter").then((module) => module.highlightCode(source, language, light))
      .then((value) => { if (active) setHtml(value); })
      .catch(() => setHtml(""));
    return () => { active = false; };
  }, [language, light, source]);
  return <div className="code-wrap"><button onClick={() => void navigator.clipboard.writeText(source)}>复制</button>{html ? <div dangerouslySetInnerHTML={{ __html: html }} /> : <pre><code>{source}</code></pre>}</div>;
}

function Mermaid({ source }: { source: string }): React.JSX.Element {
  const id = useMemo(() => `mermaid-${crypto.randomUUID()}`, []);
  const [svg, setSvg] = useState("");
  const [error, setError] = useState("");
  const light = useLightTheme();
  useEffect(() => {
    let active = true;
    setError("");
    setSvg("");
    const timer = window.setTimeout(() => {
      void import("mermaid").then(({ default: mermaid }) => {
        mermaid.initialize({ startOnLoad: false, theme: light ? "default" : "dark", securityLevel: "strict" });
        return mermaid.render(id, source);
      }).then((result) => { if (active) { setError(""); setSvg(result.svg); } }).catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : String(reason)); });
    }, 120);
    return () => { active = false; window.clearTimeout(timer); };
  }, [id, light, source]);
  if (error) return <pre className="mermaid-error">{source}</pre>;
  return <div className="mermaid" dangerouslySetInnerHTML={{ __html: svg }} />;
}

function useLightTheme(): boolean {
  const read = (): boolean => document.documentElement.dataset.themeResolved === "light";
  const [light, setLight] = useState(read);
  useEffect(() => {
    const update = (): void => setLight(read());
    document.documentElement.addEventListener("grok-theme-change", update);
    return () => document.documentElement.removeEventListener("grok-theme-change", update);
  }, []);
  return light;
}
