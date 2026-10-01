/** Only main-issued UUID handles may become an HTML iframe source. */
export function trustedHtmlPreviewUrl(value: unknown): string | undefined {
 if(typeof value!=="string")return undefined;
 const match=/^grok-html:\/\/preview\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/.exec(value);
 return match?`grok-html://preview/${encodeURIComponent(match[1]!)}`:undefined;
}
