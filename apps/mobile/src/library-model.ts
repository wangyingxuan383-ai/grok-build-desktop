/**
 * Pure rules for recipes, prompt snippets and bookmarks. Kept free of React Native so they run
 * under Node tests.
 */
export interface Recipe { id: string; name: string; modelId?: string; providerId?: string; effort?: string; mode?: string }
export interface Snippet { id: string; title: string; text: string }
export interface Bookmark { id: string; sessionId: string; sessionTitle: string; messageId: string; remoteIndex: number; excerpt: string; at: number }

/** Saving a recipe with an existing name replaces it; at most 12 are kept, newest first. */
export function rememberRecipe(list: Recipe[], recipe: Omit<Recipe, "id">): Recipe[] {
    const id = "r" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    return [{ ...recipe, id }, ...list.filter(item => item.name !== recipe.name)].slice(0, 12);
}

export function removeById<T extends { id: string }>(list: T[], id: string) { return list.filter(item => item.id !== id); }

export function snippetMatches(snippet: Snippet, query: string) {
    const q = query.trim().toLowerCase();
    return !q || snippet.title.toLowerCase().includes(q) || snippet.text.toLowerCase().includes(q);
}

/** One bookmark per message; the latest add wins and the list stays bounded. */
export function toggleBookmark(list: Bookmark[], bookmark: Omit<Bookmark, "id" | "at">, now = Date.now()): { list: Bookmark[]; added: boolean } {
    const existing = list.find(item => item.sessionId === bookmark.sessionId && item.messageId === bookmark.messageId);
    if (existing) return { list: list.filter(item => item !== existing), added: false };
    return { list: [{ ...bookmark, id: "b" + now.toString(36), at: now }, ...list].slice(0, 300), added: true };
}

/** Inserting a snippet keeps what is already typed and separates it with a blank line. */
export function insertSnippet(draft: string, text: string) {
    return draft.trim() ? `${draft.replace(/\s+$/, "")}\n\n${text}` : text;
}
