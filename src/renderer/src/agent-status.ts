import type { AgentDashboardStatus } from "../../shared/types";

export function statusText(status: AgentDashboardStatus): string {
  return ({ queued: "排队", running: "运行中", waiting: "等待", completed: "已完成", failed: "失败", stopped: "已停止", unknown: "历史/未知" })[status];
}
