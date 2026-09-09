import { useState } from "react";
import type { McpElicitationPrimitive } from "../../../shared/types";
import type { UiMessage } from "../store";
import { isExpiredInteractionError } from "./interaction-utils";

export function McpElicitationCard({ message, sessionId, onResolved }: { message: Extract<UiMessage, { kind: "mcp-elicitation" }>; sessionId: string; onResolved?: (id: string) => void }): React.JSX.Element {
  const schema = message.request.requestedSchema;
  const [values, setValues] = useState<Record<string, McpElicitationPrimitive>>(() => Object.fromEntries(
    Object.entries(schema?.properties ?? {}).flatMap(([name, property]) => property.default !== undefined ? [[name, property.default]] : property.type === "boolean" ? [[name, false]] : []),
  ));
  const [state, setState] = useState<{ value: "idle" | "submitting" | "failed"; message?: string }>({ value: "idle" });
  const respond = async (outcome: "accept" | "decline" | "cancel"): Promise<void> => {
    if (state.value === "submitting") return;
    if (outcome === "accept" && message.request.mode === "form") {
      const missing = (schema?.required ?? []).find((name) => !Object.hasOwn(values, name) || values[name] === "");
      if (missing) { setState({ value: "failed", message: `请先填写：${schema?.properties[missing]?.title || missing}` }); return; }
    }
    setState({ value: "submitting", message: "正在提交 MCP 决定…" });
    try {
      await window.grokDesktop.respondMcpElicitation(sessionId, message.request.requestId, outcome, outcome === "accept" ? values : undefined);
      onResolved?.(message.id);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      if (isExpiredInteractionError(detail)) { onResolved?.(message.id); return; }
      setState({ value: "failed", message: detail });
    }
  };
  const host = message.request.url ? (() => { try { return new URL(message.request.url).host; } catch { return "授权页面"; } })() : undefined;
  return <section className="action-card decision-card codex-request-card mcp-elicitation-card" aria-label="MCP 输入请求">
    <header><span className="decision-icon" aria-hidden="true">M</span><div><strong>{message.request.serverName} 需要你的输入</strong><p>{message.request.message}</p></div></header>
    {message.request.mode === "url" && message.request.url && <div className="mcp-elicitation-url"><span>将通过系统浏览器打开：<strong>{host}</strong></span><button type="button" disabled={state.value === "submitting"} onClick={() => void window.grokDesktop.openExternal(message.request.url!)}>打开授权页面</button></div>}
    {message.request.mode === "form" && schema && <div className="mcp-elicitation-fields">{Object.entries(schema.properties).map(([name, property]) => {
      const required = schema.required?.includes(name) === true;
      const label = property.title || name;
      if (property.type === "boolean") return <label className="check" key={name}><input type="checkbox" disabled={state.value === "submitting" || !message.request.schemaSupported} checked={values[name] === true} onChange={(event) => setValues({ ...values, [name]: event.target.checked })}/>{label}{required ? " *" : ""}</label>;
      if (property.enum?.length) return <label key={name}><span>{label}{required ? " *" : ""}</span>{property.description && <small>{property.description}</small>}<select disabled={state.value === "submitting" || !message.request.schemaSupported} value={property.enum.findIndex((candidate) => candidate === values[name])} onChange={(event) => { const selected = property.enum?.[Number(event.target.value)]; if (selected !== undefined) setValues({ ...values, [name]: selected }); }}><option value={-1}>请选择</option>{property.enum.map((candidate, index) => <option value={index} key={`${typeof candidate}-${String(candidate)}`}>{String(candidate)}</option>)}</select></label>;
      return <label key={name}><span>{label}{required ? " *" : ""}</span>{property.description && <small>{property.description}</small>}<input disabled={state.value === "submitting" || !message.request.schemaSupported} type={property.type === "string" ? "text" : "number"} step={property.type === "integer" ? 1 : "any"} value={values[name] === undefined ? "" : String(values[name])} onChange={(event) => setValues((current) => {
        if (property.type !== "string" && event.target.value === "") { const next = { ...current }; delete next[name]; return next; }
        return { ...current, [name]: property.type === "string" ? event.target.value : Number(event.target.value) };
      })}/></label>;
    })}</div>}
    {!message.request.schemaSupported && <div className="decision-status failed">{message.request.unsupportedReason || "该 MCP 表单结构暂不支持；可拒绝或取消，不会猜测提交内容。"}</div>}
    {state.message && <div className={`decision-status ${state.value}`}>{state.message}</div>}
    <footer className="request-card-actions"><div className="request-leading-actions"><button type="button" disabled={state.value === "submitting"} onClick={() => void respond("cancel")}>取消</button><button type="button" disabled={state.value === "submitting"} onClick={() => void respond("decline")}>拒绝</button></div><div className="request-primary-actions"><button className="primary" type="button" disabled={state.value === "submitting" || !message.request.schemaSupported} onClick={() => void respond("accept")}>{message.request.mode === "url" ? "已完成，继续" : "提交并继续"}</button></div></footer>
  </section>;
}
