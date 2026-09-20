import { withCrossProcessFileLock } from "./json-store";

/** Holds the existing dead-owner-recoverable file lock across a process resource lifetime. */
export async function acquireProcessResource(path: string, timeoutMs = 100): Promise<{ release(): Promise<void> }> {
  let release!: () => void;
  let acquired!: () => void;
  let failed!: (error: unknown) => void;
  const ready = new Promise<void>((resolve, reject) => { acquired = resolve; failed = reject; });
  const hold = new Promise<void>(resolve => { release = resolve; });
  const completion = withCrossProcessFileLock(path, async () => { acquired(); await hold; }, { timeoutMs });
  void completion.catch(failed);
  await ready;
  return { release: async () => { release(); await completion; } };
}
