import { describe, expect, it } from "vitest";
import type { ChatEvent } from "../../shared/types";
import {
  isOfflineUiSessionResponderEnabled,
  OFFLINE_UI_SESSION_IDS,
  OfflineUiSessionResponder,
} from "./offline-ui-session-responder";

function createResponder() {
  const events: ChatEvent[] = [];
  let tick = 0;
  const responder = new OfflineUiSessionResponder(
    (event) => { events.push(structuredClone(event)); },
    () => new Date(Date.UTC(2026, 7, 5, 0, 0, tick++)),
  );
  return { responder, events };
}

describe("OfflineUiSessionResponder", () => {
  it("requires all explicit offline fixture switches", () => {
    expect(isOfflineUiSessionResponderEnabled({})).toBe(false);
    expect(isOfflineUiSessionResponderEnabled({ GROK_DESKTOP_OFFLINE_SMOKE: "1", GROK_DESKTOP_UI_FIXTURE: "1" })).toBe(false);
    expect(isOfflineUiSessionResponderEnabled({ GROK_DESKTOP_OFFLINE_SMOKE: "1", GROK_DESKTOP_UI_FIXTURE: "1", GROK_DESKTOP_UI_RESPONDER: "1" })).toBe(true);
  });

  for (const verdict of ["approved", "rejected", "cancelled"] as const) {
    it(`acknowledges ${verdict} once, resolves Plan first and never creates a synthetic user message`, async () => {
      const { responder, events } = createResponder();
      const receipt = await responder.respondPlan(OFFLINE_UI_SESSION_IDS.waiting, "fixture-plan-request", verdict, "fixture note");
      expect(receipt).toMatchObject({ state: "accepted", verdict });
      expect(events[0]).toMatchObject({ type: "interaction-resolved", interaction: "plan", requestId: "fixture-plan-request", outcome: verdict });
      expect(events.some((event) => event.type === "user-message")).toBe(false);
      expect(events.at(-1)).toMatchObject({ type: "status", status: "needs-user" });

      const beforeDuplicate = events.length;
      const duplicate = await responder.respondPlan(OFFLINE_UI_SESSION_IDS.waiting, "fixture-plan-request", verdict);
      expect(duplicate.state).toBe("duplicate");
      expect(events).toHaveLength(beforeDuplicate);
    });
  }

  for (const optionId of ["allow", "deny"] as const) {
    it(`settles the remaining permission with ${optionId} and releases the Composer`, async () => {
      const { responder, events } = createResponder();
      await responder.respondPlan(OFFLINE_UI_SESSION_IDS.waiting, "fixture-plan-request", "rejected");
      events.length = 0;
      await responder.respondPermission(OFFLINE_UI_SESSION_IDS.waiting, "fixture-permission-request", optionId);
      expect(events).toEqual([
        expect.objectContaining({ type: "interaction-resolved", interaction: "permission", requestId: "fixture-permission-request", outcome: optionId }),
        expect.objectContaining({ type: "status", status: "idle" }),
      ]);

      const beforeDuplicate = events.length;
      await responder.respondPermission(OFFLINE_UI_SESSION_IDS.waiting, "fixture-permission-request", optionId);
      expect(events).toHaveLength(beforeDuplicate);
    });
  }

  it("clears the queue, publishes one cancelled terminal and becomes idle on Stop", async () => {
    const { responder, events } = createResponder();
    expect(responder.backgroundQueue()).toHaveLength(1);
    await responder.cancelSession(OFFLINE_UI_SESSION_IDS.background);
    expect(events.map((event) => event.type)).toEqual(["prompt-queue", "turn-completed", "status"]);
    expect(events[0]).toMatchObject({ type: "prompt-queue", entries: [] });
    expect(events[1]).toMatchObject({
      type: "turn-completed",
      presentation: { turnId: "fixture-background-turn", clientMessageId: "fixture-background-user", outcome: "cancelled" },
    });
    expect(events[2]).toMatchObject({ type: "status", status: "idle" });

    await responder.cancelSession(OFFLINE_UI_SESSION_IDS.background);
    expect(events.filter((event) => event.type === "turn-completed")).toHaveLength(1);
  });

  it("supports an authoritative queue clear receipt independently of Stop", async () => {
    const { responder, events } = createResponder();
    const receipt = await responder.clearPromptQueue(OFFLINE_UI_SESSION_IDS.background);
    expect(receipt).toMatchObject({ state: "cleared", acknowledgement: "cli" });
    expect(responder.backgroundQueue()).toEqual([]);
    expect(events).toEqual([expect.objectContaining({ type: "prompt-queue", entries: [] })]);
  });

  it("reset restores pending interactions and the background queue for a page reload", async () => {
    const { responder } = createResponder();
    await responder.respondPlan(OFFLINE_UI_SESSION_IDS.waiting, "fixture-plan-request", "approved");
    await responder.respondPermission(OFFLINE_UI_SESSION_IDS.waiting, "fixture-permission-request", "allow");
    await responder.cancelSession(OFFLINE_UI_SESSION_IDS.background);
    responder.reset();
    expect(responder.backgroundQueue()).toHaveLength(1);
    await expect(responder.respondPlan(OFFLINE_UI_SESSION_IDS.waiting, "fixture-plan-request", "approved")).resolves.toMatchObject({ state: "accepted" });
  });

  it("rejects fixture operations aimed at a different session", async () => {
    const { responder } = createResponder();
    await expect(responder.respondPlan(OFFLINE_UI_SESSION_IDS.background, "fixture-plan-request", "approved")).rejects.toThrow("会话与操作不匹配");
    await expect(responder.cancelSession(OFFLINE_UI_SESSION_IDS.waiting)).rejects.toThrow("会话与操作不匹配");
  });
});
