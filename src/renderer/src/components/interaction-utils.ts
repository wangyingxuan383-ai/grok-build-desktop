export function isExpiredInteractionError(value: string): boolean {
  return /已经结束|已被响应|已被回答|没有可响应|request.*(?:ended|closed|expired|not found)|invalid request/i.test(value);
}
