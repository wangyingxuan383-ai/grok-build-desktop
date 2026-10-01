import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ToolCallState } from "../../../shared/types";
import { SubagentOpenContext } from "../subagent-context";
import { SubagentCard } from "./SubagentCard";

const tool = (patch: Partial<ToolCallState> & { raw?: Record<string, unknown> }): ToolCallState => ({
  toolCallId: "subagent-child-1",
  title: "子 Agent",
  kind: "subagent",
  source: "subagent-lifecycle",
  status: "completed",
  rawInput: { sessionUpdate: "subagent_finished", subagent_id:"native-child", child_session_id:"child-session", description: "Review scheduling", subagent_type: "explore", model: "grok-4.5", tool_calls: 7, turns: 2, duration_ms: 84_000, tokens_used: 12_345, capability_mode: "read-only", output: "All good.", ...patch.raw },
  ...patch,
});
const render = (value: ToolCallState, open?: (id: string) => void) => renderToStaticMarkup(createElement(SubagentOpenContext.Provider, { value: open }, createElement(SubagentCard, { tool: value, sessionId: "parent" })));

describe("SubagentCard", () => {
  it("shows what was delegated, the run facts and the returned result", () => {
    const html = render(tool({}));
    expect(html).toContain("Review scheduling");
    expect(html).toContain("explore");
    expect(html).toContain("只读");
    expect(html).toContain("已完成");
    expect(html).toContain("7 次工具");
    expect(html).toContain("2 回合");
    expect(html).toContain("1 分 24 秒");
    expect(html).toContain("12,345 Token");
    expect(html).toContain("All good.");
  });

  it("offers the child session only when a host can open it", () => {
    expect(render(tool({}))).not.toContain("查看会话");
    expect(render(tool({}), () => undefined)).toContain("查看会话");
  });

  it("marks a running child, and a child the turn ended without hearing back from", () => {
    const running = render(tool({ status: "in_progress", raw: { sessionUpdate: "subagent_progress", output: undefined } }));
    expect(running).toContain("运行中");
    expect(running).toContain("正在执行委派的任务");
    const settled = render(tool({ status: "completed", raw: { sessionUpdate: "subagent_progress", output: undefined } }));
    expect(settled).toContain("已结束");
    expect(settled).not.toContain("已完成");
    expect(settled).toContain("没有收到这个子 Agent 的结果回报");
  });

  it("surfaces a failure instead of the partial output", () => {
    const html = render(tool({ status: "failed", error: "网络中断", raw: { sessionUpdate: "subagent_finished" } }));
    expect(html).toContain("失败");
    expect(html).toContain("网络中断");
  });
});

it("does not turn a lifecycle call ID into a child-session identity",()=>{
 const value=tool({raw:{subagent_id:undefined,child_session_id:undefined}});
 expect(render(value,()=>undefined)).not.toContain("查看会话");
});
