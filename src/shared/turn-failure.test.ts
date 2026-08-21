import { describe, expect, it } from "vitest";
import type { TurnFailure } from "./types";
import { classifyProviderFailureStage, classifyTurnFailure, summarizeTurnFailure, turnFailureActions, turnFailureLabel } from "./turn-failure";

describe("turn failure classification", () => {
  it("classifies the real Gemini empty-enum rejection as a schema problem, not an outage", () => {
    // Verbatim from a live run against a Gemini-family endpoint.
    const message = '{ "error": { "code": 400, "message": "* GenerateContentRequest.tools[0].function_declarations[0].parameters.properties[todos].items.properties[status].enum[4]: cannot be empty", "status": "INVALID_ARGUMENT" } }';
    expect(classifyTurnFailure({ message, httpStatus: 400 })).toBe("schema-rejected");
    expect(turnFailureActions("schema-rejected")[0]).toContain("Gemini");
  });

  it("prefers an explicit status code over prose", () => {
    expect(classifyTurnFailure({ message: "something went wrong", httpStatus: 401 })).toBe("auth-expired");
    expect(classifyTurnFailure({ message: "something went wrong", httpStatus: 429 })).toBe("quota-exhausted");
    expect(classifyTurnFailure({ message: "something went wrong", httpStatus: 503 })).toBe("provider-error");
  });

  it("recognises quota, auth and network wording in both languages", () => {
    expect(classifyTurnFailure({ message: "rolling 24-hour window, actual/limit: 1056458/1000000" })).toBe("quota-exhausted");
    expect(classifyTurnFailure({ message: "本周额度已用完" })).toBe("quota-exhausted");
    expect(classifyTurnFailure({ message: "invalid api key" })).toBe("auth-expired");
    expect(classifyTurnFailure({ message: "fetch failed: ECONNREFUSED 127.0.0.1:8080" })).toBe("network");
    expect(classifyTurnFailure({ message: "无法连接到上游" })).toBe("network");
  });

  it("treats a process exit and an explicit cancel as their own classes", () => {
    expect(classifyTurnFailure({ message: "Grok 进程已退出（代码 1）", processExitCode: 1 })).toBe("cli-crashed");
    expect(classifyTurnFailure({ message: "Grok 进程已退出（代码 0）", cancelled: true })).toBe("cancelled");
  });

  it("stays unknown rather than forcing an unmatched failure into a bucket", () => {
    expect(classifyTurnFailure({ message: "unexpected condition in adapter" })).toBe("unknown");
    expect(turnFailureActions("cancelled")).toEqual([]);
  });

  it("maps gateway evidence to a secret-free provider failure stage", () => {
    expect(classifyProviderFailureStage({})).toBe("route");
    expect(classifyProviderFailureStage({ observed: { status: 401, phase: "upstream" } })).toBe("authentication");
    expect(classifyProviderFailureStage({ observed: { status: 403, phase: "response" } })).toBe("authentication");
    expect(classifyProviderFailureStage({ observed: { reason: "request-validation", phase: "upstream" } })).toBe("translation");
    expect(classifyProviderFailureStage({ observed: { phase: "upstream" }, classification: "schema-rejected" })).toBe("translation");
    expect(classifyProviderFailureStage({ observed: { phase: "pre-send" } })).toBe("route");
    expect(classifyProviderFailureStage({ observed: { phase: "upstream", status: 500 } })).toBe("upstream");
    expect(classifyProviderFailureStage({ observed: { phase: "response", status: 502 } })).toBe("downstream");
  });

  it("summarizes only the fields that are present", () => {
    const failure: TurnFailure = {
      failureId: "f1", at: "2026-07-26T00:00:00.000Z", classification: "schema-rejected",
      message: "…", httpStatus: 400, providerId: "antigravity", modelId: "gemini-3-flash",
    };
    expect(summarizeTurnFailure(failure)).toBe("工具 Schema 被拒绝 · HTTP 400 · Provider antigravity · gemini-3-flash");
    expect(summarizeTurnFailure({ failureId: "f2", at: failure.at, classification: "unknown", message: "…" })).toBe(turnFailureLabel("unknown"));
  });
});
