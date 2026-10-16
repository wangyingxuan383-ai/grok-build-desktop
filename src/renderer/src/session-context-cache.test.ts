import { expect, it, vi } from "vitest";
import { SessionContextCache } from "./session-context-cache";
import type { CliSessionInfo } from "../../shared/types";
const value = (sessionId: string, used: number): CliSessionInfo => ({ sessionId, supported: true, source: "acp", contextUsedTokens: used, contextWindowTokens: 100 });
it("shares a request and rejects a late response from a previous connection/configuration", async () => {
  const cache = new SessionContextCache();
  let finish!: (info: CliSessionInfo) => void;
  const old = vi.fn(() => new Promise<CliSessionInfo>(resolve => { finish = resolve; }));
  const first = cache.read("a", "old", old);
  expect(cache.read("a", "old", old)).toBe(first);
  await Promise.resolve();
  await cache.read("a", "new", async () => value("a", 5));
  finish(value("a", 95)); await first;
  expect(old).toHaveBeenCalledTimes(1);
  expect(cache.get("a", "new")?.contextUsedTokens).toBe(5);
  expect(cache.get("a", "old")).toBeUndefined();
});
it("refreshes after compaction without accepting a foreign session or retaining a failed stale read", async () => {
  const cache = new SessionContextCache();
  await cache.read("a", "v1", async () => value("a", 80));
  await cache.read("a", "v1", async () => value("a", 10), true);
  expect(cache.get("a", "v1")?.contextUsedTokens).toBe(10);
  await cache.read("a", "v2", async () => value("b", 99));
  expect(cache.get("a", "v2")).toBeUndefined();
  await cache.read("a", "v3", async () => { throw Error("disconnected"); });
  expect(cache.get("a", "v3")).toBeUndefined();
});
