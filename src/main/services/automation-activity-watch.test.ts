import { afterEach, expect, it, vi } from "vitest";
import { watchAutomationInactivity } from "./automation-activity-watch";

afterEach(() => vi.useRealTimers());
it("uses activity to extend the deadline and cancels exactly once when silent", async () => {
  vi.useFakeTimers(); vi.setSystemTime(0);
  let activity = 0; const cancel = vi.fn(async () => undefined);
  const stop = watchAutomationInactivity(1, () => activity, cancel);
  await vi.advanceTimersByTimeAsync(45_000); activity = Date.now();
  await vi.advanceTimersByTimeAsync(45_000); expect(cancel).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(15_000); expect(cancel).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(120_000); expect(cancel).toHaveBeenCalledTimes(1); stop();
});
it("does not leave a watcher after completion or when the policy is disabled", async () => {
  vi.useFakeTimers(); const cancel = vi.fn(async () => undefined);
  watchAutomationInactivity(0, () => 0, cancel)();
  const stop = watchAutomationInactivity(1, () => 0, cancel); stop();
  await vi.advanceTimersByTimeAsync(120_000); expect(cancel).not.toHaveBeenCalled();
});
