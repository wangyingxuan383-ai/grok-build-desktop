/** The opaque handle remains the authority; session is an expected-owner assertion. */
export function scopedMediaUrl(source: string, sessionId?: string): string {
  if (!source.startsWith("grok-media://access/") || !sessionId) return source;
  const url = new URL(source);
  url.searchParams.set("session", sessionId);
  return url.href;
}

export function mediaRequestSession(source: string, fallback: string): string {
  const url = new URL(source);
  const values = url.searchParams.getAll("session");
  const sessionId = values.length ? values[0]! : fallback;
  if (values.length > 1 || !sessionId || sessionId.length > 512 || sessionId.includes("\0")) throw Error("媒体请求缺少有效的所属会话");
  return sessionId;
}
