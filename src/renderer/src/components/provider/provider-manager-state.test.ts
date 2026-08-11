import { describe, expect, it } from "vitest";
import type { ProviderScanJob, ProviderScanProgress } from "../../../../shared/types";
import {
  acceptListedProviderScanJob,
  beginProviderScanCancellation,
  latestProviderScanJob,
  mergeProviderScanProgress,
  rollbackProviderScanCancellation,
  withProviderValue,
} from "./provider-manager-state";

function job(overrides: Partial<ProviderScanJob> = {}): ProviderScanJob {
  const providerId = overrides.providerId ?? "provider-a";
  return {
    jobId: "job-a-1",
    providerId,
    generation: 1,
    status: "running",
    stage: "baseline",
    completed: 1,
    total: 10,
    succeeded: 1,
    failed: 0,
    message: "running",
    startedAt: "2026-08-05T00:00:00.000Z",
    updatedAt: "2026-08-05T00:00:01.000Z",
    scope: { providerId, context: { mode: "off" } },
    ...overrides,
  };
}

function progress(overrides: Partial<ProviderScanProgress> = {}): ProviderScanProgress {
  return {
    jobId: "job-a-1",
    providerId: "provider-a",
    status: "running",
    stage: "stream",
    completed: 2,
    total: 10,
    succeeded: 2,
    failed: 0,
    message: "streaming",
    startedAt: "2026-08-05T00:00:00.000Z",
    updatedAt: "2026-08-05T00:00:02.000Z",
    ...overrides,
  };
}

describe("provider scan UI isolation", () => {
  it("keeps provider-scoped probe values independent", () => {
    const first = withProviderValue({}, "provider-a", { ok: true, message: "A" });
    const second = withProviderValue(first, "provider-b", { ok: false, message: "B" });

    expect(second["provider-a"]).toEqual({ ok: true, message: "A" });
    expect(second["provider-b"]).toEqual({ ok: false, message: "B" });
  });

  it("selects only the requested provider and prefers its newest generation", () => {
    const oldA = job();
    const providerB = job({ providerId: "provider-b", jobId: "job-b-8", generation: 8 });
    const newA = job({ jobId: "job-a-2", generation: 2, updatedAt: "2026-08-05T00:00:03.000Z" });

    expect(latestProviderScanJob("provider-a", [providerB, oldA, newA])).toEqual(newA);
    expect(latestProviderScanJob("provider-b", [oldA, providerB])).toEqual(providerB);
  });

  it("does not let a stale list response replace a newer provider generation", () => {
    const current = job({ jobId: "job-a-3", generation: 3, updatedAt: "2026-08-05T00:00:05.000Z" });
    const stale = job({ jobId: "job-a-2", generation: 2, status: "cancelled", updatedAt: "2026-08-05T00:00:06.000Z" });

    expect(acceptListedProviderScanJob(current, "provider-a", [stale])).toBe(current);
  });

  it("merges only progress for the exact provider job and ignores late or cross-provider events", () => {
    const current = job();
    expect(mergeProviderScanProgress(current, progress())?.completed).toBe(2);
    expect(mergeProviderScanProgress(current, progress({ providerId: "provider-b" }))).toBe(current);
    expect(mergeProviderScanProgress(current, progress({ jobId: "job-a-old" }))).toBe(current);
    expect(mergeProviderScanProgress(current, progress({ updatedAt: "2026-08-04T23:59:59.000Z" }))).toBe(current);
  });
});

describe("provider scan optimistic cancellation", () => {
  it("moves to cancelling immediately and restores the original job after an IPC failure", () => {
    const current = job();
    const optimistic = beginProviderScanCancellation(current, "2026-08-05T00:00:02.500Z");

    expect(optimistic.status).toBe("cancelling");
    expect(optimistic.message).toContain("正在取消");
    expect(rollbackProviderScanCancellation(optimistic, optimistic, current)).toBe(current);
    expect(beginProviderScanCancellation(optimistic, "2026-08-05T00:00:04.000Z")).toBe(optimistic);
  });

  it("does not roll back a newer progress update or a replacement generation", () => {
    const current = job();
    const optimistic = beginProviderScanCancellation(current, "2026-08-05T00:00:02.500Z");
    const acknowledged = { ...optimistic, updatedAt: "2026-08-05T00:00:03.000Z" };
    const replacement = job({ jobId: "job-a-2", generation: 2 });

    expect(rollbackProviderScanCancellation(acknowledged, optimistic, current)).toBe(acknowledged);
    expect(rollbackProviderScanCancellation(replacement, optimistic, current)).toBe(replacement);
  });
});
