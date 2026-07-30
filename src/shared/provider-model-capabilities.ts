import type { ReasoningEffort } from "./types";

/** Match Grok CLI's native default for temporarily silent inference streams. */
export const DEFAULT_PROVIDER_INFERENCE_IDLE_TIMEOUT_SECONDS = 600;

export const PROVIDER_REASONING_EFFORTS: Exclude<ReasoningEffort, "">[] = [
  "xhigh",
  "high",
  "medium",
  "low",
  "minimal",
  "none",
];

const KNOWN_REASONING_EFFORTS: Record<string, Exclude<ReasoningEffort, "">[]> = {
  // Grok CLI's bundled model catalog declares exactly these three values for
  // grok-4.5. CPA's OpenAI-compatible /models response exposes only the ID, so
  // this conservative exact-ID fallback restores the same capability without
  // guessing for unrelated or future model names.
  "grok-4.5": ["high", "medium", "low"],
};

export function providerReasoningEfforts(
  modelId: string,
  declared?: ReasoningEffort[],
): Exclude<ReasoningEffort, "">[] {
  const normalized = uniqueEfforts(declared);
  // `undefined` means the service did not publish capability metadata, while
  // an explicit empty array is a valid user override (for example, a gateway
  // that accepts a model ID but rejects every reasoning parameter).
  if (declared !== undefined) return normalized;
  return [...(KNOWN_REASONING_EFFORTS[modelId.trim().toLocaleLowerCase()] ?? [])];
}

export function uniqueEfforts(values: ReasoningEffort[] | undefined): Exclude<ReasoningEffort, "">[] {
  const supported = new Set<Exclude<ReasoningEffort, "">>(PROVIDER_REASONING_EFFORTS);
  return Array.from(new Set((values ?? []).filter((value): value is Exclude<ReasoningEffort, ""> => Boolean(value) && supported.has(value as Exclude<ReasoningEffort, "">))));
}
