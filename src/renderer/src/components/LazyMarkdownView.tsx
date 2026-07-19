import { lazy, Suspense } from "react";

const MarkdownView = lazy(async () => {
  const module = await import("./MarkdownView");
  return { default: module.MarkdownView };
});

export function LazyMarkdownView({ text }: { text: string }): React.JSX.Element {
  return <Suspense fallback={<div className="markdown-loading">正在排版内容…</div>}><MarkdownView text={text} /></Suspense>;
}
