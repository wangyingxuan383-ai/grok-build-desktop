import type { AccountProfile, AutomationHealthReport, AutomationTask, CustomProviderProfile } from "../../shared/types";

export interface AutomationHealthDependencies {
  tasks: AutomationTask[];
  accounts: AccountProfile[];
  providers: CustomProviderProfile[];
  workspaceExists(path: string): Promise<boolean>;
  sessionExists(task: AutomationTask): Promise<boolean>;
  executableExists(): Promise<boolean>;
  executionProfileExists(task: AutomationTask): Promise<boolean>;
  clearSessionMapping(taskId: string): Promise<void>;
  repairRegistrations(): Promise<AutomationTask[]>;
}

/** Checks only public metadata. It never decrypts or sends an automation prompt. */
export async function checkAutomationHealth(deps: AutomationHealthDependencies, repair = false): Promise<AutomationHealthReport> {
  const issues: AutomationHealthReport["issues"] = [];
  const accountIds = new Set(deps.accounts.map((value) => value.id));
  const providers = new Map(deps.providers.map((value) => [value.id, value]));
  const executableExists = await deps.executableExists();
  let registrationRepairNeeded = false;

  for (const task of deps.tasks) {
    if (!await deps.workspaceExists(task.workspace)) issues.push(issue(task.id, "workspace", false, "任务工作区已不存在，需要重新配置"));
    if (task.profile.accountId && !accountIds.has(task.profile.accountId)) issues.push(issue(task.id, "account", false, "固定账号已不存在，需要重新配置"));
    if (task.profile.providerId) {
      const provider = providers.get(task.profile.providerId);
      if (!provider) issues.push(issue(task.id, "provider", false, "固定提供商已不存在，需要重新配置"));
      else if (!provider.models.some((value) => value.id === task.profile.modelId)) issues.push(issue(task.id, "model", false, "固定模型已不存在，需要重新配置"));
    } else if (!task.profile.modelId.trim()) issues.push(issue(task.id, "model", false, "任务模型为空，需要重新配置"));
    if (task.executionProfileId && !await deps.executionProfileExists(task)) issues.push(issue(task.id, "metadata", false, "执行配置档已不存在，需要重新选择"));
    if (task.sessionId && !await deps.sessionExists(task)) {
      const row = issue(task.id, "session-mapping", true, "专属会话映射已失效");
      if (repair) { await deps.clearSessionMapping(task.id); row.repaired = true; }
      issues.push(row);
    }
    if (!executableExists) issues.push(issue(task.id, "executable-path", false, "当前桌面程序路径不存在，无法修复计划任务"));
    else if (task.enabled && task.registrationStatus !== "registered") {
      const kind = /path|路径|executable|command/i.test(task.registrationError ?? "") ? "executable-path" : "registration";
      issues.push(issue(task.id, kind, true, task.registrationError || "Windows 任务计划注册需要修复"));
      registrationRepairNeeded = true;
    }
  }

  if (repair && registrationRepairNeeded && executableExists) {
    const repairedTasks = await deps.repairRegistrations();
    const byId = new Map(repairedTasks.map((value) => [value.id, value]));
    for (const row of issues) if ((row.kind === "registration" || row.kind === "executable-path") && row.repairable) row.repaired = byId.get(row.taskId)?.registrationStatus === "registered";
  }
  return {
    checkedAt: new Date().toISOString(),
    healthy: issues.every((value) => value.repaired),
    taskCount: deps.tasks.length,
    repaired: issues.filter((value) => value.repaired).length,
    needsConfiguration: new Set(issues.filter((value) => !value.repairable).map((value) => value.taskId)).size,
    issues,
  };
}

function issue(taskId: string, kind: AutomationHealthReport["issues"][number]["kind"], repairable: boolean, summary: string): AutomationHealthReport["issues"][number] {
  return { taskId, kind, repairable, repaired: false, summary };
}
