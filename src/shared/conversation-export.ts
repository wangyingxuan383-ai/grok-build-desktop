import type { PromptMeta, ToolCallState, TurnPresentation } from "./types";

export type SessionExportFormat = "markdown" | "html";

/** Defaults are applied in main, including when older callers omit options. */
export interface ConversationExportOptions {
  format?: SessionExportFormat;
  /** Only the literal "original" disables redaction; the UI must require an explicit switch. */
  redaction?: "redacted" | "original";
  includeTools?: boolean;
  includeThinking?: boolean;
  /** Counts of distinct tools, referenced files and recorded failures, without tool payloads. */
  includeTurnSummary?: boolean;
}

export type SessionExportOptions = ConversationExportOptions;

export const DEFAULT_SESSION_EXPORT_OPTIONS: Readonly<Required<SessionExportOptions>> = Object.freeze({
  format: "markdown", redaction: "redacted", includeTools: false, includeThinking: false, includeTurnSummary: true,
});

export interface SessionExportPreview {
  content: string;
  fileName: string;
  format: SessionExportFormat;
  /** Whether the redaction policy was applied, even if it found no matches. */
  redacted: boolean;
  /** Newly inserted replacement markers in included source text; excluded details are not counted. */
  redactionCount: number;
}

/** The parent supplies bridge callbacks; this contract adds no global/preload dependency. */
export interface SessionExportApi {
  previewSessionExport(sessionId: string, options: SessionExportOptions): Promise<SessionExportPreview>;
  saveSessionExport(sessionId: string, options: SessionExportOptions): Promise<string | undefined>;
}

/** A complete stored projection, never an active-session/CLI handle or a viewport window. */
export interface SessionExportSource {
  readonly sessionId: string;
  readonly title: string;
  readonly projection: {
    readonly sessionId: string;
    readonly events: readonly Readonly<Record<string, unknown>>[];
  };
  readonly presentations?: readonly Readonly<TurnPresentation>[];
}

export type SessionExportRedactor = (text: string) => { content: string; redactionCount: number };

export function normalizeSessionExportOptions(options: SessionExportOptions = {}): Required<SessionExportOptions> {
  if (!options || typeof options !== "object" || Array.isArray(options)) throw new Error("Invalid export options");
  if (options.format !== undefined && options.format !== "markdown" && options.format !== "html") throw new Error("Invalid export format");
  if (options.redaction !== undefined && options.redaction !== "redacted" && options.redaction !== "original") throw new Error("Invalid export redaction policy");
  for (const key of ["includeTools", "includeThinking", "includeTurnSummary"] as const) {
    if (options[key] !== undefined && typeof options[key] !== "boolean") throw new Error(`Invalid export option: ${key}`);
  }
  return {
    format: options.format ?? DEFAULT_SESSION_EXPORT_OPTIONS.format,
    redaction: options.redaction ?? DEFAULT_SESSION_EXPORT_OPTIONS.redaction,
    includeTools: options.includeTools ?? DEFAULT_SESSION_EXPORT_OPTIONS.includeTools,
    includeThinking: options.includeThinking ?? DEFAULT_SESSION_EXPORT_OPTIONS.includeThinking,
    includeTurnSummary: options.includeTurnSummary ?? DEFAULT_SESSION_EXPORT_OPTIONS.includeTurnSummary,
  };
}

interface ExportBlock { label: string; text: string; detail?: boolean }
interface ExportTurn {
  blocks: ExportBlock[];
  tools: Map<string, Partial<ToolCallState>>;
  presentation?: Partial<TurnPresentation>;
  clientMessageId?: string;
  usage?: PromptMeta;
  ended: boolean;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
function string(value: unknown): string { return typeof value === "string" ? value : ""; }
function serialize(value: unknown): string {
  if (typeof value === "string") return value;
  try { return JSON.stringify(value, null, 2) ?? ""; } catch { return "[Unserializable tool detail]"; }
}

/** Export-only projection: keeps text in event order and coalesces tool updates by identity. */
function collectTurns(source: SessionExportSource): ExportTurn[] {
  const turns: ExportTurn[] = [];
  const presentations = new Map<string, Partial<TurnPresentation>>();
  const users = new Map<string, ExportTurn>();
  const tools = new Map<string, ExportTurn>();
  let current: ExportTurn | undefined;
  const fresh = (): ExportTurn => {
    current = { blocks: [], tools: new Map(), ended: false };
    turns.push(current);
    return current;
  };
  const active = (): ExportTurn => current ?? fresh();
  const remember = (value: unknown): Partial<TurnPresentation> | undefined => {
    const p = record(value) as Partial<TurnPresentation> | undefined;
    if (!p || typeof p.turnId !== "string") return undefined;
    const merged = { ...presentations.get(p.turnId), ...p };
    presentations.set(p.turnId, merged);
    return merged;
  };
  for (const event of source.projection.events) {
    if (event.sessionId !== undefined && event.sessionId !== source.sessionId) continue;
    switch (event.type) {
      case "user-message": {
        if (event.delivery === "queued") break;
        const id = string(event.clientMessageId) || string(event.id);
        if (id && users.has(id)) break;
        if (current && (current.ended || current.blocks.length > 0 || current.tools.size > 0)) fresh();
        const turn = active();
        turn.clientMessageId = id || undefined;
        if (id) users.set(id, turn);
        turn.blocks.push({ label: "User", text: string(event.text) });
        if (Array.isArray(event.attachments)) {
          const names = event.attachments.map(value => string(record(value)?.name)).filter(Boolean);
          if (names.length) turn.blocks.push({ label: "Attachments (names only)", text: names.join("\n") });
        }
        break;
      }
      case "turn-started": {
        const p = remember(event.presentation);
        if (current?.ended || (current?.presentation?.turnId && current.presentation.turnId !== p?.turnId)) fresh();
        if (p) active().presentation = p;
        break;
      }
      case "turn-completed": {
        const p = remember(event.presentation);
        const owner = p ? turns.find(turn => turn.presentation?.turnId === p.turnId || (p.clientMessageId && turn.clientMessageId === p.clientMessageId)) : undefined;
        const turn = owner ?? active();
        if (p) turn.presentation = p;
        turn.ended = true;
        break;
      }
      case "turn-presentations-restore":
        if (Array.isArray(event.presentations)) event.presentations.forEach(remember);
        break;
      case "message-chunk":
      case "thought-chunk": {
        const turn = active();
        const label = event.type === "thought-chunk" ? "Thinking" : "Assistant";
        const previous = turn.blocks.at(-1);
        if (previous?.label === label) previous.text += string(event.text);
        else turn.blocks.push({ label, text: string(event.text), detail: label === "Thinking" });
        break;
      }
      case "interjection": active().blocks.push({ label: "User (interjection)", text: string(event.text) }); break;
      case "plan": active().blocks.push({ label: "Plan", text: string(event.text) }); break;
      case "error": active().blocks.push({ label: "Failure", text: string(event.message) }); break;
      case "status":
        if (event.status === "error" && event.text) active().blocks.push({ label: "Failure", text: string(event.text) });
        break;
      case "media": active().blocks.push({ label: "Media", text: "[Media omitted; no images or external resources are embedded]" }); break;
      case "meta": active().usage = { ...active().usage, ...record(event.meta) }; break;
      case "tool-call": {
        const tool = record(event.tool) as Partial<ToolCallState> | undefined;
        if (!tool || typeof tool.toolCallId !== "string") break;
        const owner = tools.get(tool.toolCallId) ?? active();
        owner.tools.set(tool.toolCallId, { ...owner.tools.get(tool.toolCallId), ...tool });
        tools.set(tool.toolCallId, owner);
        break;
      }
      case "command-output": {
        const turn = active();
        const match = [...turn.tools.entries()].reverse().find(([, tool]) => tool.command === event.command || (typeof tool.title === "string" && tool.title.includes(string(event.command).slice(0, 20))));
        const id = match?.[0] ?? `command-${turn.tools.size}`;
        const exitCode = typeof event.exitCode === "number" ? event.exitCode : null;
        turn.tools.set(id, { ...match?.[1], title: string(event.command), command: string(event.command), output: string(event.output), exitCode, status: exitCode === null ? "pending" : exitCode === 0 ? "completed" : "failed" });
        break;
      }
    }
  }
  source.presentations?.forEach(remember);
  for (const turn of turns) {
    const p = (turn.presentation?.turnId ? presentations.get(turn.presentation.turnId) : undefined)
      ?? [...presentations.values()].find(value => value.clientMessageId && value.clientMessageId === turn.clientMessageId);
    if (p) turn.presentation = p;
  }
  return turns.filter(turn => turn.blocks.length || turn.tools.size || turn.presentation);
}

function usageText(turn: ExportTurn): string {
  const usage = turn.presentation?.usage ?? turn.usage;
  const fields = [
    ["Input", usage?.inputTokens], ["Output", usage?.outputTokens], ["Total", usage?.totalTokens],
    ["Cached read", usage?.cachedReadTokens], ["Reasoning", usage?.reasoningTokens],
  ] as const;
  const parts = fields.map(([label, value]) => `${label}: ${typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : "unknown"}`);
  if (turn.presentation?.usage?.usageIsIncomplete) parts.push("Incomplete usage report");
  if (turn.presentation?.usage?.source) parts.push(`Source: ${turn.presentation.usage.source}`);
  if (usage?.modelId) parts.push(`Model: ${usage.modelId}`);
  return parts.join(" · ");
}

function toolText(tool: Partial<ToolCallState>): string {
  const parts = [`${tool.title || tool.toolName || "Tool"} (${tool.status || "unknown"})`];
  for (const [label, value] of [
    ["Command", tool.command], ["Input", tool.rawInput], ["Content", tool.content],
    ["Structured result", tool.structuredContent], ["Output", tool.output], ["Error", tool.error],
    ["Locations", tool.locations], ["Before", tool.oldText], ["After", tool.newText],
  ] as const) if (value !== undefined) parts.push(`${label}: ${serialize(value)}`);
  if (tool.exitCode !== undefined && tool.exitCode !== null) parts.push(`Exit code: ${tool.exitCode}`);
  if (tool.truncated || tool.contentTruncated || tool.structuredContentTruncated) parts.push("[Tool detail was truncated by the source]");
  return parts.join("\n");
}

function summaryText(turn: ExportTurn): string {
  const files = new Set<string>();
  let failed = 0;
  for (const tool of turn.tools.values()) {
    if (tool.status === "failed" || tool.error || (typeof tool.exitCode === "number" && tool.exitCode !== 0)) failed++;
    if (Array.isArray(tool.locations)) for (const location of tool.locations) if (typeof location?.path === "string") files.add(location.path);
  }
  const failures = turn.blocks.filter(block => block.label === "Failure").length;
  return `Tools: ${turn.tools.size} · Referenced files: ${files.size} · Failed tools: ${failed} · Failure records: ${failures}${turn.presentation?.outcome ? ` · Outcome: ${turn.presentation.outcome}` : ""}`;
}

export function escapeExportHtml(text: string): string {
  return text.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}

/** Text remains literal in HTML: Markdown/HTML/images/URLs never become active resources. */
export const SESSION_EXPORT_HTML_CSP = "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src 'none'; media-src 'none'; font-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";

const HTML_STYLE = "body{max-width:900px;margin:32px auto;padding:0 24px;font:16px/1.65 system-ui,sans-serif;color:#202124;background:#fff}h1,h2,h3{line-height:1.3}article{border-top:1px solid #ccc;margin-top:24px;padding-top:12px}.text{white-space:pre-wrap;overflow-wrap:anywhere;font-family:inherit}details{padding:12px;background:#f5f5f5;margin:12px 0}.meta{font-size:13px;color:#50545a}summary{cursor:pointer}@media print{body{margin:0;max-width:none}details{break-inside:avoid}}";

/** Redactor is mandatory so shared code never imports Node/credentials into the renderer. */
export function buildSessionExport(source: SessionExportSource, options: SessionExportOptions, redactText: SessionExportRedactor): SessionExportPreview {
  const normalized = normalizeSessionExportOptions(options);
  if (source.projection.sessionId !== source.sessionId) throw new Error("Export projection belongs to another session");
  let redactionCount = 0;
  const safe = (text: string): string => {
    if (normalized.redaction === "original") return text;
    const result = redactText(text);
    redactionCount += result.redactionCount;
    return result.content;
  };
  const title = safe(source.title || "Conversation");
  const turns = collectTurns(source).map(turn => {
    const blocks = turn.blocks.filter(block => normalized.includeThinking || block.label !== "Thinking")
      .map(block => ({ ...block, text: safe(block.text) }));
    if (normalized.includeTools) for (const tool of turn.tools.values()) blocks.push({ label: "Tool", text: safe(toolText(tool)), detail: true });
    return { blocks, summary: normalized.includeTurnSummary ? safe(summaryText(turn)) : "", usage: safe(usageText(turn)) };
  });
  const policy = normalized.redaction === "original" ? "Original content — sensitive data may be included" : "Sensitive data redacted";
  let content: string;
  if (normalized.format === "markdown") {
    // This is Markdown source, not rendered HTML. The preview displays it as text.
    const lines = [`# ${title.replace(/[\r\n]+/g, " ")}`, "", policy, ""];
    for (const [index, turn] of turns.entries()) {
      lines.push(`## Turn ${index + 1}`, "");
      if (turn.summary) lines.push(turn.summary, "");
      for (const block of turn.blocks) lines.push(`### ${block.label}`, "", block.text, "");
      lines.push(`Usage (tokens): ${turn.usage}`, "");
    }
    if (!turns.length) lines.push("No conversation content in the stored projection.", "");
    content = lines.join("\n");
  } else {
    const e = escapeExportHtml;
    const body = turns.map((turn, index) => `<article><h2>Turn ${index + 1}</h2>${turn.summary ? `<p class="meta">${e(turn.summary)}</p>` : ""}${turn.blocks.map(block => block.detail
      ? `<details><summary>${e(block.label)}</summary><div class="text">${e(block.text)}</div></details>`
      : `<section><h3>${e(block.label)}</h3><div class="text">${e(block.text)}</div></section>`).join("")}<p class="meta">Usage (tokens): ${e(turn.usage)}</p></article>`).join("\n");
    content = `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${e(SESSION_EXPORT_HTML_CSP)}"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${e(title)}</title><style>${HTML_STYLE}</style></head><body><h1>${e(title)}</h1><p class="meta">${e(policy)}</p>${body || "<p>No conversation content in the stored projection.</p>"}</body></html>`;
  }
  // Never put a title, user path or credential in a suggested filename.
  const id = source.sessionId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 8) || "export";
  return { content, fileName: `grok-session-${id}.${normalized.format === "html" ? "html" : "md"}`, format: normalized.format, redacted: normalized.redaction === "redacted", redactionCount };
}
