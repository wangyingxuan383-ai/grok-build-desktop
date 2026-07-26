import type { TurnFailure, TurnFailureClass } from "./types";

export interface TurnFailureSignals {
  message: string;
  httpStatus?: number;
  jsonRpcCode?: number;
  processExitCode?: number;
  cancelled?: boolean;
}

/**
 * Classifies a failure from the signals the main process actually has. Every
 * rule is evidence-driven: the status code, the exit code, or a phrase the
 * upstream itself produced. Nothing here guesses from tone, and an unmatched
 * failure stays "unknown" rather than being forced into a bucket.
 */
export function classifyTurnFailure(signals: TurnFailureSignals): TurnFailureClass {
  const text = signals.message || "";
  if (signals.cancelled) return "cancelled";
  if (signals.processExitCode !== undefined) return "cli-crashed";

  if (signals.httpStatus === 401 || signals.httpStatus === 403) return "auth-expired";
  if (signals.httpStatus === 429) return "quota-exhausted";

  // Gemini/Vertex reject malformed tool declarations with INVALID_ARGUMENT and
  // name the offending schema path; that is a compatibility problem, not a
  // provider outage, and the remedy is a schema profile rather than a retry.
  if (/INVALID_ARGUMENT|cannot be empty|function_declarations|GenerateContentRequest|tool.{0,20}schema|invalid tool/i.test(text)) return "schema-rejected";

  // `actual/limit` and the rolling-window phrasing are how the Grok CLI reports
  // its own token ceiling; GrokQuotaService parses the same shape.
  if (/rate.?limit|quota|too many requests|actual\s*\/\s*limit|rolling.{0,40}24|额度|限额|用量超出/i.test(text)) return "quota-exhausted";
  if (/unauthorized|forbidden|invalid api key|expired token|credential|未授权|凭据|登录已过期/i.test(text)) return "auth-expired";
  if (/ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ECONNRESET|EAI_AGAIN|socket hang up|network|fetch failed|超时|无法连接|网络/i.test(text)) return "network";
  if (/exited|crash|进程已退出|已崩溃/i.test(text)) return "cli-crashed";

  if (signals.httpStatus !== undefined && signals.httpStatus >= 400) return "provider-error";
  return "unknown";
}

const ACTIONS: Record<TurnFailureClass, string[]> = {
  "quota-exhausted": [
    "在账号面板查看剩余额度与重置时间",
    "改用其他模型或提供商继续当前任务",
  ],
  "schema-rejected": [
    "在提供商管理中把「工具 Schema」改为 Gemini / Antigravity 档",
    "改档后重试本回合；应用会在转发前清理不被接受的枚举与类型",
  ],
  "auth-expired": [
    "重新登录账号，或检查提供商密钥所在的环境变量",
    "确认该密钥仍对所选模型有权限",
  ],
  "provider-error": [
    "展开详情核对状态码与 Trace，据此联系提供商",
    "换一个模型确认是否为该模型独有的问题",
  ],
  network: [
    "检查网络与代理设置",
    "确认上游地址可达后重试",
  ],
  "cli-crashed": [
    "打开诊断中心检查 Grok CLI 版本与 ACP 握手",
    "在设置中确认 CLI 路径，必要时重新安装",
  ],
  cancelled: [],
  unknown: [
    "展开详情查看完整脱敏错误",
    "打开诊断中心确认本机环境是否正常",
  ],
};

export function turnFailureActions(classification: TurnFailureClass): string[] {
  return [...(ACTIONS[classification] ?? [])];
}

const LABELS: Record<TurnFailureClass, string> = {
  "quota-exhausted": "额度已用尽",
  "schema-rejected": "工具 Schema 被拒绝",
  "auth-expired": "凭据无效或已过期",
  "provider-error": "提供商返回错误",
  network: "网络不可达",
  "cli-crashed": "Grok CLI 异常退出",
  cancelled: "已取消",
  unknown: "未分类失败",
};

export function turnFailureLabel(classification: TurnFailureClass): string {
  return LABELS[classification] ?? LABELS.unknown;
}

/** One-line summary built from the fields that are actually present. */
export function summarizeTurnFailure(failure: TurnFailure): string {
  return [
    turnFailureLabel(failure.classification),
    failure.httpStatus === undefined ? "" : `HTTP ${failure.httpStatus}`,
    failure.providerId ? `Provider ${failure.providerId}` : "",
    failure.modelId ?? "",
  ].filter(Boolean).join(" · ");
}
