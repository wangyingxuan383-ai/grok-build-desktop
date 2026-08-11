import type { ProviderScanJob, ProviderScanProgress } from "../../../../shared/types";

export type ProviderScanJobsByProvider = Record<string, ProviderScanJob | undefined>;

export function withProviderValue<T>(current: Record<string, T | undefined>, providerId: string, value: T | undefined): Record<string, T | undefined> {
  return { ...current, [providerId]: value };
}

/**
 * Scan list responses can arrive after a newer scan was started. Prefer the
 * highest provider generation and, within that generation, the newest update.
 */
export function latestProviderScanJob(providerId: string, jobs: ProviderScanJob[]): ProviderScanJob | undefined {
  return jobs
    .filter((job) => job.providerId === providerId)
    .sort(compareScanJobs)[0];
}

export function acceptListedProviderScanJob(
  current: ProviderScanJob | undefined,
  providerId: string,
  jobs: ProviderScanJob[],
): ProviderScanJob | undefined {
  const incoming = latestProviderScanJob(providerId, jobs);
  if (!incoming) return current;
  if (!current || current.providerId !== providerId) return incoming;
  return compareScanJobs(incoming, current) <= 0 ? incoming : current;
}

/**
 * Progress is only allowed to update the exact job already associated with a
 * provider. Job ids are generation-scoped in the main process, so a late
 * event from a cancelled generation cannot replace a newer job.
 */
export function mergeProviderScanProgress(
  current: ProviderScanJob | undefined,
  progress: ProviderScanProgress,
): ProviderScanJob | undefined {
  if (!current || current.providerId !== progress.providerId || current.jobId !== progress.jobId) return current;
  if (compareIso(progress.updatedAt, current.updatedAt) < 0) return current;
  return { ...current, ...progress };
}

export function beginProviderScanCancellation(job: ProviderScanJob, updatedAt: string): ProviderScanJob {
  if (isProviderScanTerminal(job.status) || job.status === "cancelling") return job;
  return {
    ...job,
    status: "cancelling",
    updatedAt,
    message: "正在取消扫描；已完成结果将保留",
  };
}

export function rollbackProviderScanCancellation(
  current: ProviderScanJob | undefined,
  optimistic: ProviderScanJob,
  previous: ProviderScanJob,
): ProviderScanJob | undefined {
  if (!current || current.jobId !== optimistic.jobId || current.providerId !== optimistic.providerId) return current;
  if (current.status !== "cancelling" || current.updatedAt !== optimistic.updatedAt) return current;
  return previous;
}

export function isProviderScanTerminal(status: ProviderScanJob["status"]): boolean {
  return status === "completed" || status === "cancelled" || status === "failed";
}

function compareScanJobs(left: ProviderScanJob, right: ProviderScanJob): number {
  if (left.generation !== right.generation) return right.generation - left.generation;
  const updateOrder = compareIso(right.updatedAt, left.updatedAt);
  if (updateOrder !== 0) return updateOrder;
  return right.startedAt.localeCompare(left.startedAt);
}

function compareIso(left: string, right: string): number {
  return left.localeCompare(right);
}
