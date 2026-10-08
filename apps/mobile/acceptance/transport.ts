import type { HostConnection } from "../src/transport";
export type { HostConnection };
const session = (id: string, title: string, status = "idle", extra = {}) => ({
  id,
  title,
  projectName: "Demo project",
  cwd: "C:/demo",
  updatedAt: new Date().toISOString(),
  status,
  canSend: true,
  ...extra,
});
let sessions = [
  session("one", "实现项目功能", "working"),
  session("two", "检查文档", "idle", {
    cwd: "C:/worktrees/demo",
    preview: "检查当前文档与变更",
  }),
  session("archived", "上周记录", "cold", { archived: true }),
  session("child", "审查子会话", "idle", {
    parentSessionId: "one",
    canSend: false,
  }),
];
const events: any[] = [
  {
    type: "user-message",
    sessionId: "one",
    id: "message",
    text: "帮我实现这个功能",
    remoteIndex: 0,
  },
  {
    type: "thought-chunk",
    sessionId: "one",
    text: "先检查项目。",
    remoteIndex: 1,
  },
  {
    type: "tool-call",
    sessionId: "one",
    tool: {
      toolCallId: "tool",
      title: "Read project",
      status: "completed",
      output: "Reviewed",
    },
    remoteIndex: 2,
  },
  {
    type: "subagent",
    sessionId: "one",
    update: {
      subagent_id: "agent",
      child_session_id: "child",
      description: "检查实现",
      status: "completed",
    },
    remoteIndex: 3,
  },
  {
    type: "message-chunk",
    sessionId: "one",
    text: "## 功能已完成\n\n- 支持分组\n- 保留草稿\n\n```ts\nconst ready = true;\n```",
    remoteIndex: 4,
  },
];
const histories = new Map<string, any[]>([
  ["one", events],
  [
    "child",
    [
      {
        type: "message-chunk",
        remoteIndex: 0,
        text: "这是子会话的实际检查内容。",
      },
    ],
  ],
]);
const receipts = new Map<string, any>();
let receive: ((signal: any) => void) | undefined,
  fail: ((error: Error) => void) | undefined;
let cursor = 10;
function signal(type: string, sessionId = "one") {
  receive?.({ type, cursor: ++cursor, epoch: "fixture", sessionId });
}
async function fixtureApi<T>(_host: any, path: string, body?: any): Promise<T> {
  await new Promise((r) => setTimeout(r, 25));
  if (path === "/v1/info") return { protocol: 1 } as T;
  if (path === "/v1/sessions")
    return { sessions, cursor, epoch: "fixture", serverTime: Date.now() } as T;
  if (path === "/v1/options")
    return {
      capabilities: [
        "session.create",
        "session.rename",
        "session.archive",
        "queue.remove",
      ],
      workspaces: [
        {
          id: "workspace",
          name: "Demo project",
          path: "C:/demo",
          profiles: [],
        },
      ],
    } as T;
  if (path.startsWith("/v1/sessions/")) {
    const id = decodeURIComponent(path.split("/")[3]!.split("?")[0]!);
    const records = histories.get(id) ?? [];
    return {
      session: sessions.find((s) => s.id === id),
      events: records,
      totalEvents: records.length,
      pending: records.filter((e) => e.type === "permission"),
      truncated: false,
      cursor,
      epoch: "fixture",
    } as T;
  }
  if (path === "/v1/operations") {
    let receipt = receipts.get(body.operationId);
    if (!receipt) {
      receipt = {
        ...body,
        state: "completed",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      if (body.action === "send" && body.text === "fail-request") {
        receipt.state = "failed";
        receipt.message = "模型暂时不可用，请稍后重试";
      } else if (body.action === "send") {
        const records = histories.get(body.sessionId) ?? [];
        histories.set(body.sessionId, records);
        records.push(
          {
            type: "user-message",
            id: body.operationId,
            text: body.text,
            remoteIndex: records.length,
          },
          {
            type: "message-chunk",
            text: "已收到消息。",
            remoteIndex: records.length + 1,
          },
        );
        signal("turn-completed", body.sessionId);
      }
      if (body.action === "rename")
        sessions = sessions.map((s) =>
          s.id === body.sessionId ? { ...s, title: body.title } : s,
        );
      if (body.action === "archive")
        sessions = sessions.map((s) =>
          s.id === body.sessionId ? { ...s, archived: body.archived } : s,
        );
      if (body.action === "create") {
        receipt.state = "accepted";
        setTimeout(() => {
          receipt.resultSessionId = "created";
          receipt.state = "completed";
          sessions.unshift(session("created", "新会话"));
          signal("operation", "created");
        }, 4000);
      }
      receipts.set(body.operationId, receipt);
    }
    return receipt as T;
  }
  if (path.startsWith("/v1/operations/"))
    return receipts.get(path.split("/").at(-1)!) as T;
  throw Error("Unsupported fixture operation");
}
export async function api<T>(host: any, path: string, body?: any): Promise<T> {
  return structuredClone(await fixtureApi<T>(host, path, body));
}
export function listen(
  _host: any,
  _cursor: number,
  _epoch: string,
  data: (signal: any) => void,
  error: (error: Error) => void,
) {
  receive = data;
  fail = error;
  queueMicrotask(() => data({ type: "connected", cursor, epoch: "fixture" }));
  return () => {
    if (receive === data) receive = undefined;
    if (fail === error) fail = undefined;
  };
}
Object.assign(globalThis, {
  grokFixture: {
    stream: () => {
      events.push({
        type: "message-chunk",
        text: "\n新的进度。",
        remoteIndex: events.length,
      });
      signal("message-chunk");
    },
    heartbeat: () => signal("heartbeat"),
    disconnect: () => fail?.(Error("stream closed")),
    revoke: () => {},
    events: () => events,
    receipts: () => [...receipts.values()],
    complete: () => {
      sessions = sessions.map((s) =>
        s.id === "one" ? { ...s, status: "idle" } : s,
      );
      signal("turn-completed");
    },
    permission: () => {
      events.push({
        type: "permission",
        sessionId: "one",
        remoteIndex: events.length,
        request: {
          requestId: "permission",
          toolCall: {
            summary: JSON.stringify({
              title: "运行项目命令",
              rawInput: { command: "git status" },
            }),
          },
          options: [
            { optionId: "allow", name: "允许本次", kind: "allow_once" },
          ],
        },
      });
      signal("permission");
    },
  },
});
