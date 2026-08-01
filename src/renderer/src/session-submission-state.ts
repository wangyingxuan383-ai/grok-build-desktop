export function sessionSubmissionKeys(sessionId: string, draftKey: string): string[] {
  return Array.from(new Set([sessionId, draftKey].filter(Boolean)));
}

export function hasSessionSubmission(
  pending: ReadonlySet<string>,
  sessionId: string,
  draftKey: string,
): boolean {
  return sessionSubmissionKeys(sessionId, draftKey).some((key) => pending.has(key));
}

export function updateSessionSubmissions(
  pending: ReadonlySet<string>,
  keys: Iterable<string>,
  active: boolean,
): Set<string> {
  const next = new Set(pending);
  for (const key of keys) {
    if (!key) continue;
    if (active) next.add(key);
    else next.delete(key);
  }
  return next;
}
