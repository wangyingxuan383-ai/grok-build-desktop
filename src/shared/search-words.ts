/**
 * Session search follows the CLI resume picker (1.0.61): every typed word must match, in any order.
 * A single word behaves exactly like a plain substring match.
 */
export function searchWords(query: string): string[] {
  return [...new Set(query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean))];
}

export function matchesAllWords(text: string, query: string | readonly string[]): boolean {
  const words = typeof query === "string" ? searchWords(query) : query;
  if (!words.length) return true;
  const haystack = text.toLocaleLowerCase();
  return words.every((word) => haystack.includes(word));
}
