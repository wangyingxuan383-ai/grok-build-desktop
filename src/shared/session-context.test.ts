import { describe, expect, it } from "vitest";
import { sessionContextDisplay } from "./session-context";
import type { CliSessionInfo } from "./types";
const info = (patch: Partial<CliSessionInfo>): CliSessionInfo => ({ sessionId: "s", supported: true, source: "acp", ...patch });
describe("current context display", () => {
  it("uses current context rather than usage totals, including an exact zero", () => {
    expect(sessionContextDisplay(info({ contextUsedTokens: 25000, contextWindowTokens: 100000, contextUsagePercent: 75 }))).toMatchObject({ percent: 25 });
    expect(sessionContextDisplay(info({ contextUsedTokens: 0, contextWindowTokens: 100000 }))).toMatchObject({ percent: 0 });
  });
  it("retains a standalone reported percent and rejects invented or invalid occupancy", () => {
    expect(sessionContextDisplay(info({ contextUsagePercent: 31.5 }))).toMatchObject({ percent: 31.5 });
    expect(sessionContextDisplay(info({ contextUsedTokens: -1, contextWindowTokens: 0, contextUsagePercent: NaN })).percent).toBeUndefined();
    expect(sessionContextDisplay(info({ supported: false, contextUsagePercent: 10 }))).toEqual({});
    expect(sessionContextDisplay(undefined)).toEqual({});
  });
});
