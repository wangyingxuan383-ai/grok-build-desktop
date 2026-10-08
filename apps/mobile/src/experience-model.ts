import type { RemoteSession } from "../../../src/shared/remote";
export function rememberSession(previous: string[], id: string): string[] {
  return [id, ...previous.filter((value) => value !== id)].slice(0, 30);
}
export function projectLabel(
  session: Pick<RemoteSession, "cwd" | "projectName">,
  all: RemoteSession[],
): string {
  return all.some(
    (row) => row.projectName === session.projectName && row.cwd !== session.cwd,
  )
    ? `${session.projectName} · ${session.cwd}`
    : session.projectName;
}
export function permissionDescription(raw: unknown): {
  title: string;
  detail: string;
} {
  let value: Record<string, unknown> =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  if (typeof value.summary === "string" && typeof value.title !== "string") {
    const summary = value.summary;
    try {
      const parsed = JSON.parse(summary);
      if (parsed && typeof parsed === "object") value = parsed;
    } catch {
      return { title: summary.slice(0, 180), detail: summary };
    }
  }
  const input = (value.rawInput ?? value.input ?? value.arguments) as unknown;
  const data =
    input && typeof input === "object"
      ? (input as Record<string, unknown>)
      : {};
  const title =
    typeof value.title === "string"
      ? value.title
      : typeof value.description === "string"
        ? value.description
        : "电脑请求执行操作";
  const command = data.command ?? data.cmd ?? data.path ?? data.file_path;
  const detail =
    typeof command === "string"
      ? command
      : typeof input === "string"
        ? input
        : JSON.stringify(input ?? value, null, 2);
  return { title: title.slice(0, 180), detail: detail.slice(0, 4096) };
}
export function restoreFailedDraft(current:string,failed:string):string {
  if(!failed||current===failed||current.endsWith(`\n\n${failed}`))return current;
  return current?`${current}\n\n${failed}`:failed;
}

export function mobileVersionIsNewer(candidate:string,current:string){const parse=(s:string)=>/^v?(\d+)\.(\d+)\.(\d+)$/.exec(s)?.slice(1).map(Number);const next=parse(candidate),now=parse(current);if(!next||!now)return false;for(let index=0;index<3;index++){if(next[index]!==now[index])return next[index]!>now[index]!;}return false;}
