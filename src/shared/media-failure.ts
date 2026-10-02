export function explainMediaFailure(raw: string): { summary: string; detail: string; action: "providers" | "accounts" | "network" | "usage" | "wait" | "none" } {
  const detail = raw.replace(/\u001b\[[0-9;]*m/g, "").replace(/\\n/g, "\n").trim().slice(-8000);
  if (/用户环境读取|凭据.*读取|无法读取.*凭据/.test(detail)) return { summary: "无法读取 Provider 凭据，请检查提供商设置；这不是 Grok 登录失效。", detail, action: "providers" };
  if (/提供商.{0,80}凭据不可用|provider.{0,40}credential.{0,20}(missing|unavailable)/is.test(detail)) return { summary: "所选 Provider 的凭据不可用，请补充或更新提供商密钥。", detail, action: "providers" };
  if (/authentication is temporarily unavailable|session is still signed in|no need to run\s*\/?login|暂时无法验证订阅/i.test(detail)) return { summary: "认证服务暂时不可用，账号可能仍已登录。请检查网络后稍后手动重试，无需因此重新登录。", detail, action: "network" };
  if (/authentication required|unauthorized|not signed in|token.{0,30}expired|credentials expired|\b401\b/i.test(detail)) return { summary: "当前认证已失效或需要登录，请检查账号状态。", detail, action: "accounts" };
  if (/rate.?limit|too many requests|\b429\b|quota|usage limit|额度|限流/i.test(detail)) return { summary: "生成服务报告限流或额度不足，请查看官方用量后手动重试。", detail, action: "usage" };
  if (/没有输出|停止等待|远端.*未确认/.test(detail)) return { summary: "已停止本机等待，远端是否完成尚未确认。请先检查已有结果，再决定是否重试。", detail, action: "wait" };
  if (/ECONN|ENOTFOUND|error sending request|request error stream|reqwest error stream|network|connect.{0,20}timeout|连接失败/i.test(detail)) return { summary: "生成请求连接失败，请检查实际代理路线与网络。", detail, action: "network" };
  return { summary: detail.split(/\r?\n/).filter(Boolean).at(-1)?.slice(0, 300) || "生成失败，请展开详情。", detail, action: "none" };
}
