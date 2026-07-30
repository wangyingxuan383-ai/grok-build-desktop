import { describe, expect, it } from "vitest";
import { effortControlState } from "./model-capabilities";

describe("effortControlState", () => {
  it("uses only the effort values declared by the active model", () => {
    expect(effortControlState([{
      modelId: "provider-model",
      name: "Provider model",
      supportsReasoningEffort: true,
      reasoningEfforts: [
        { value: "low", label: "Low" },
        { value: "high", label: "High" },
      ],
    }], "provider-model", "high")).toMatchObject({
      supported: true,
      options: [{ value: "low" }, { value: "high" }],
    });
  });

  it("keeps the current startup value visible but disables undeclared switching", () => {
    expect(effortControlState([{
      modelId: "openai-compatible-grok-4.5",
      name: "CPA compatible",
      supportsReasoningEffort: false,
      reasoningEfforts: [],
    }], "openai-compatible-grok-4.5", "high")).toEqual({
      supported: false,
      options: [{ value: "high", label: "high（当前启动值）" }],
      reason: "当前模型未声明可热切换的推理强度；请在提供商模型配置中填写上游实际支持的档位",
    });
  });
});
