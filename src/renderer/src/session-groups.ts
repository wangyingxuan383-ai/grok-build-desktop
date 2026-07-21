import type { SessionOriginKind, SessionSummary } from "../../shared/types";

export interface SessionDisplayGroup {
  kind: SessionOriginKind;
  label: string;
  sessions: SessionSummary[];
}

export function groupSessionsByOrigin(sessions: SessionSummary[]): SessionDisplayGroup[] {
  return [
    { kind: "normal", label: "Grok 会话", sessions: sessions.filter((session) => !session.originKind || session.originKind === "normal" || session.originKind === "fork") },
    { kind: "automation", label: "任务会话", sessions: sessions.filter((session) => session.originKind === "automation") },
    { kind: "codex-continuation", label: "Codex 接力", sessions: sessions.filter((session) => session.originKind === "codex-continuation") },
    { kind: "other", label: "其他来源", sessions: sessions.filter((session) => session.originKind === "other") },
  ];
}

export function sessionSourceLabel(session: SessionSummary): string {
  if (session.originKind === "automation") return "任务";
  if (session.originKind === "codex-continuation") return "Codex 接力";
  if (session.originKind === "fork") return "分叉";
  return "";
}
