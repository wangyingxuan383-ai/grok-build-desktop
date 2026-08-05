import type {
  ChatEvent,
  PlanDecisionReceipt,
  PromptQueueEntry,
  QueueOperationReceipt,
  TurnPresentation,
} from "../../shared/types";

/**
 * Session ids owned by the 0.7.0 installed-app UI fixture. They are deliberately
 * not valid Grok session ids and are never registered with the real CLI process
 * manager.
 */
export const OFFLINE_UI_SESSION_IDS = {
  conversation: "offline-ui-fixture-v070",
  waiting: "offline-ui-fixture-v070-waiting",
  background: "offline-ui-fixture-v070-background",
} as const;

/**
 * Three explicit switches are required so a normal offline launch or an older
 * static UI fixture cannot accidentally activate the interactive responder.
 * The responder is in-memory and does not write to AppData.
 */
export function isOfflineUiSessionResponderEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return env.GROK_DESKTOP_OFFLINE_SMOKE === "1"
    && env.GROK_DESKTOP_UI_FIXTURE === "1"
    && env.GROK_DESKTOP_UI_RESPONDER === "1";
}

type EventPublisher = (event: ChatEvent) => void | Promise<void>;

interface OfflineUiResponderState {
  waiting: {
    planPending: boolean;
    permissionPending: boolean;
    planReceipts: Map<string, PlanDecisionReceipt>;
    resolvedPermissions: Set<string>;
  };
  background: {
    stopped: boolean;
    queue: PromptQueueEntry[];
    presentation: TurnPresentation;
  };
}

/**
 * Main-process authority for the interactive part of the offline UI fixture.
 *
 * This is intentionally not a renderer mock: IPC calls are accepted here, state
 * is changed here, and only then are authoritative ChatEvents published. It also
 * deliberately bypasses ConversationProjectionStore because a UI smoke fixture
 * must not create fake user sessions in a real AppData directory.
 */
export class OfflineUiSessionResponder {
  private state!: OfflineUiResponderState;
  private operation = 0;

  constructor(
    private readonly publish: EventPublisher,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.reset();
  }

  reset(): void {
    const startedAt = this.now().toISOString();
    this.operation = 0;
    this.state = {
      waiting: {
        planPending: true,
        permissionPending: true,
        planReceipts: new Map(),
        resolvedPermissions: new Set(),
      },
      background: {
        stopped: false,
        queue: [{
          id: "fixture-background-queue",
          sessionId: OFFLINE_UI_SESSION_IDS.background,
          text: "后台排队消息",
          position: 0,
          createdAt: startedAt,
          state: "queued",
          clientMessageId: "fixture-background-queue",
        }],
        presentation: {
          turnId: "fixture-background-turn",
          clientMessageId: "fixture-background-user",
          ordinal: 0,
          startedAt,
        },
      },
    };
  }

  owns(sessionId: string): boolean {
    return Object.values(OFFLINE_UI_SESSION_IDS).includes(sessionId as typeof OFFLINE_UI_SESSION_IDS[keyof typeof OFFLINE_UI_SESSION_IDS]);
  }

  backgroundQueue(): PromptQueueEntry[] {
    return structuredClone(this.state.background.queue);
  }

  backgroundPresentation(): TurnPresentation {
    return structuredClone(this.state.background.presentation);
  }

  async respondPlan(
    sessionId: string,
    requestId: string | number | undefined,
    verdict: "approved" | "rejected" | "cancelled",
    _comment = "",
  ): Promise<PlanDecisionReceipt> {
    this.assertSession(sessionId, OFFLINE_UI_SESSION_IDS.waiting);
    const requested = String(requestId ?? "");
    if (!requested) throw new Error("计划请求已经结束或没有可响应的请求 ID");
    const duplicate = this.state.waiting.planReceipts.get(requested);
    if (duplicate) return { ...duplicate, state: "duplicate", message: "该计划决策已经提交，未重复执行" };
    if (!this.state.waiting.planPending || requested !== "fixture-plan-request") {
      throw new Error("计划请求已经结束或没有可响应的请求 ID");
    }

    const receipt: PlanDecisionReceipt = {
      requestId: requested,
      verdict,
      state: "accepted",
      message: verdict === "approved" ? "计划已批准，原回合将继续执行" : verdict === "rejected" ? "已要求继续规划" : "计划已取消",
    };
    this.state.waiting.planPending = false;
    this.state.waiting.planReceipts.set(requested, receipt);

    // The resolved event is deliberately first. Mode reconciliation is a later
    // lifecycle detail and must never keep the decision card mounted.
    await this.publish({
      type: "interaction-resolved",
      sessionId,
      interaction: "plan",
      requestId: requested,
      outcome: verdict,
    });
    if (verdict !== "rejected") await this.publish({ type: "mode", sessionId, mode: "agent" });
    await this.publishWaitingStatus();
    return receipt;
  }

  async respondPermission(sessionId: string, requestId: string | number, optionId: string): Promise<void> {
    this.assertSession(sessionId, OFFLINE_UI_SESSION_IDS.waiting);
    const requested = String(requestId);
    if (this.state.waiting.resolvedPermissions.has(requested)) return;
    if (!this.state.waiting.permissionPending || requested !== "fixture-permission-request") {
      throw new Error("权限请求已经结束或没有可响应的请求 ID");
    }
    if (optionId !== "allow" && optionId !== "deny") throw new Error("权限选项无效");
    this.state.waiting.permissionPending = false;
    this.state.waiting.resolvedPermissions.add(requested);
    await this.publish({
      type: "interaction-resolved",
      sessionId,
      interaction: "permission",
      requestId: requested,
      outcome: optionId,
    });
    await this.publishWaitingStatus();
  }

  async cancelSession(sessionId: string): Promise<void> {
    this.assertSession(sessionId, OFFLINE_UI_SESSION_IDS.background);
    if (this.state.background.stopped) return;
    this.state.background.stopped = true;
    this.state.background.queue = [];
    const completedAt = this.now();
    const startedAt = Date.parse(this.state.background.presentation.startedAt);
    const presentation: TurnPresentation = {
      ...this.state.background.presentation,
      completedAt: completedAt.toISOString(),
      durationMs: Math.max(0, completedAt.getTime() - startedAt),
      outcome: "cancelled",
    };
    this.state.background.presentation = presentation;

    // Clear queue ownership before publishing the sole terminal event. The
    // final idle status is what releases the Composer and sidebar running badge.
    await this.publish({ type: "prompt-queue", sessionId, entries: [] });
    await this.publish({ type: "turn-completed", sessionId, presentation });
    await this.publish({ type: "status", sessionId, status: "idle", text: "已停止" });
  }

  async clearPromptQueue(sessionId: string): Promise<QueueOperationReceipt> {
    this.assertSession(sessionId, OFFLINE_UI_SESSION_IDS.background);
    this.state.background.queue = [];
    await this.publish({ type: "prompt-queue", sessionId, entries: [] });
    this.operation += 1;
    return {
      operationId: `fixture-clear-${this.operation}`,
      state: "cleared",
      message: "队列已清空",
      acknowledgement: "cli",
    };
  }

  private async publishWaitingStatus(): Promise<void> {
    const pending = this.state.waiting.planPending || this.state.waiting.permissionPending;
    await this.publish({
      type: "status",
      sessionId: OFFLINE_UI_SESSION_IDS.waiting,
      status: pending ? "needs-user" : "idle",
      text: pending ? "等待剩余决定" : "离线交互已完成",
    });
  }

  private assertSession(actual: string, expected: string): void {
    if (actual !== expected) throw new Error("离线验收会话与操作不匹配");
  }
}
