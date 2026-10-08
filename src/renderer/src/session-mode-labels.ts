import type { SessionMode } from "../../shared/types";

/**
 * One wording for the three execution modes everywhere a picker shows them
 * (composer, new-session draft, settings defaults, execution profiles).
 * Plan auto-approves tool calls after planning, so its label says so.
 */
export const SESSION_MODE_OPTIONS: ReadonlyArray<{ value: SessionMode; label: string; description: string }> = [
  { value: "agent", label: "Agent（逐项询问）", description: "每次需要权限的工具调用都先询问" },
  { value: "plan", label: "Plan（规划·自动批准）", description: "先给出计划，可编辑；执行时自动批准工具调用" },
  { value: "auto", label: "Auto（自动批准）", description: "直接执行，自动批准工具调用" },
];
