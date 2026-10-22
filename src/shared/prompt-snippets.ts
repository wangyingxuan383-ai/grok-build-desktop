/** Shared by Desktop and paired clients. Timestamps are server-owned revisions. */
export interface PromptSnippet {
  id: string;
  title: string;
  body: string;
  updatedAt: string;
}

export interface PromptSnippetInput {
  id?: string;
  title: string;
  body: string;
  /** Supply the previously read revision when editing. Omit for creation. */
  updatedAt?: string;
}

export interface PromptSnippetApi {
  listPromptSnippets(): Promise<PromptSnippet[]>;
  savePromptSnippet(input: PromptSnippetInput): Promise<PromptSnippet[]>;
  deletePromptSnippet(id: string, updatedAt?: string): Promise<PromptSnippet[]>;
}

const variablePattern = /\{\{([^{}\r\n]+)\}\}/gu;

export function promptSnippetVariables(body: string): string[] {
  return [...new Set(Array.from(body.matchAll(variablePattern), match => match[1]!.trim()).filter(Boolean))];
}

/** One pass: entered values are literal text and can never introduce new variables. */
export function fillPromptSnippet(body: string, values: Readonly<Record<string, string>>): { text: string; missing: string[] } {
  const missing = promptSnippetVariables(body).filter(name => !Object.hasOwn(values, name) || !values[name]?.trim());
  return {
    text: body.replace(variablePattern, (token, raw: string) => {
      const name = raw.trim();
      return name && Object.hasOwn(values, name) && values[name]?.trim() ? values[name]! : token;
    }),
    missing,
  };
}

/** Only an explicit picker selection may replace the entire slash query. */
export function insertPromptSnippet(draft: string, text: string, slashQuery?: string): string {
  if (slashQuery !== undefined && draft === `/${slashQuery}`) return text;
  return draft ? `${draft}\n\n${text}` : text;
}

export function searchPromptSnippets(snippets: readonly PromptSnippet[], query: string): PromptSnippet[] {
  const words = query.trim().toLocaleLowerCase().split(/\s+/u).filter(Boolean);
  return snippets.filter(snippet => words.every(word => `${snippet.title}\n${snippet.body}`.toLocaleLowerCase().includes(word)));
}
