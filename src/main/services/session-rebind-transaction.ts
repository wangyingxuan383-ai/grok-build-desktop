export interface SessionRebindTransactionStep {
  name: string;
  apply(): void | Promise<void>;
  rollback(): void | Promise<void>;
}

export interface AppliedSessionRebindState {
  name: string;
  rollback(): void | Promise<void>;
}

export class SessionRebindTransactionError extends Error {
  constructor(
    message: string,
    readonly primaryError: unknown,
    readonly rollbackErrors: string[],
  ) {
    super(message, { cause: primaryError });
    this.name = "SessionRebindTransactionError";
  }
}

/**
 * Applies Desktop metadata as one logical rebind transaction. `alreadyApplied`
 * represents side effects made by successfully opening the copied session
 * (notably ProcessManager's runtime cwd write) before metadata commit begins.
 */
export async function runSessionRebindTransaction(
  steps: SessionRebindTransactionStep[],
  alreadyApplied: AppliedSessionRebindState[] = [],
): Promise<void> {
  const applied: AppliedSessionRebindState[] = [...alreadyApplied];
  try {
    for (const step of steps) {
      await step.apply();
      applied.push({ name: step.name, rollback: step.rollback });
    }
  } catch (primaryError) {
    const rollbackErrors: string[] = [];
    for (const step of applied.reverse()) {
      try { await step.rollback(); }
      catch (error) { rollbackErrors.push(`${step.name}: ${error instanceof Error ? error.message : String(error)}`); }
    }
    const primary = primaryError instanceof Error ? primaryError.message : String(primaryError);
    const suffix = rollbackErrors.length ? `；回滚未完全成功：${rollbackErrors.join("；")}` : "；已恢复原绑定";
    throw new SessionRebindTransactionError(`项目重新绑定元数据失败：${primary}${suffix}`, primaryError, rollbackErrors);
  }
}
