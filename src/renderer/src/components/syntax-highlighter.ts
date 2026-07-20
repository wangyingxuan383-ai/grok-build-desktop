import githubDarkDefault from "@shikijs/themes/github-dark-default";
import githubLightDefault from "@shikijs/themes/github-light-default";
import bash from "@shikijs/langs/bash";
import css from "@shikijs/langs/css";
import diff from "@shikijs/langs/diff";
import html from "@shikijs/langs/html";
import javascript from "@shikijs/langs/javascript";
import json from "@shikijs/langs/json";
import markdown from "@shikijs/langs/markdown";
import powershell from "@shikijs/langs/powershell";
import python from "@shikijs/langs/python";
import sql from "@shikijs/langs/sql";
import tsx from "@shikijs/langs/tsx";
import typescript from "@shikijs/langs/typescript";
import yaml from "@shikijs/langs/yaml";
import { createHighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";

const highlighter = createHighlighterCore({
  themes: [githubDarkDefault, githubLightDefault],
  langs: [bash, css, diff, html, javascript, json, markdown, powershell, python, sql, tsx, typescript, yaml],
  engine: createJavaScriptRegexEngine(),
});

export async function highlightCode(source: string, language: string, light = false): Promise<string> {
  const instance = await highlighter;
  return instance.codeToHtml(source, { lang: language, theme: light ? "github-light-default" : "github-dark-default" });
}
