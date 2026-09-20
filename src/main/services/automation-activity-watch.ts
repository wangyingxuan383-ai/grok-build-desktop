/** Both relay turns and cold workers use the same optional inactivity policy. */
export function watchAutomationInactivity(
  minutes: number,
  lastActivity: () => number,
  onTimeout: () => Promise<unknown>,
): () => void {
  const limit = Math.max(0, minutes) * 60_000;
  if (!limit) return () => undefined;
  const timer = setInterval(() => {
    if (Date.now() - lastActivity() < limit) return;
    clearInterval(timer);
    void onTimeout().catch(() => undefined);
  }, Math.max(1_000, Math.min(15_000, Math.floor(limit / 4))));
  timer.unref?.();
  return () => clearInterval(timer);
}
