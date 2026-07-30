import type { ModelInfo, ReasoningEffort } from "../../shared/types";

export interface EffortControlState {
  supported: boolean;
  options: Array<{ value: Exclude<ReasoningEffort, "">; label: string; description?: string }>;
  reason: string;
}

export function effortControlState(models: ModelInfo[], currentModelId: string | undefined, currentEffort: ReasoningEffort): EffortControlState {
  const model = models.find((item) => item.modelId === currentModelId);
  const options = (model?.reasoningEfforts ?? []).map((item) => ({
    value: item.value,
    label: item.label || item.value,
    ...(item.description ? { description: item.description } : {}),
  }));
  if (currentEffort && !options.some((item) => item.value === currentEffort)) {
    options.unshift({ value: currentEffort, label: `${currentEffort}（当前启动值）` });
  }
  const supported = model?.supportsReasoningEffort === true && (model.reasoningEfforts?.length ?? 0) > 0;
  return {
    supported,
    options,
    reason: supported
      ? "推理强度（模型声明支持热切换）"
      : model
        ? "当前模型未声明可热切换的推理强度；请在提供商模型配置中填写上游实际支持的档位"
        : "当前模型能力尚未加载",
  };
}
