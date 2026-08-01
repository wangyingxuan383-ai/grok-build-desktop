import type { ReasoningEffort } from "./types";

/** Match Grok CLI's native default for temporarily silent inference streams. */
export const DEFAULT_PROVIDER_INFERENCE_IDLE_TIMEOUT_SECONDS = 600;

export const PROVIDER_REASONING_EFFORTS: Exclude<ReasoningEffort, "">[] = [
  "auto",
  "xhigh",
  "max",
  "high",
  "medium",
  "low",
  "minimal",
  "none",
];

const KNOWN_REASONING_EFFORTS: Record<string, Exclude<ReasoningEffort, "">[]> = {
  // Both the Responses-compatible CPA route and the locally verified
  // grok2api route accept these five levels for grok-4.5. Keep this an
  // exact-ID fallback: unrelated/future model names are still driven by
  // metadata, a live capability scan or an explicit user override.
  "grok-4.5": ["xhigh", "high", "medium", "low", "minimal"],
};

export function providerReasoningEfforts(
  modelId: string,
  declared?: ReasoningEffort[],
): Exclude<ReasoningEffort, "">[] {
  const normalized = uniqueEfforts(declared);
  const known = KNOWN_REASONING_EFFORTS[modelId.trim().toLocaleLowerCase()];
  // 0.6.13/0.6.14 wrote this three-level fallback into providers.json. Treat
  // that exact legacy value as generated metadata and upgrade it when the
  // managed TOML block is next refreshed; other explicit subsets stay intact.
  if (known && normalized.length === 3 && ["high", "medium", "low"].every((value) => normalized.includes(value as Exclude<ReasoningEffort, "">))) {
    return [...known];
  }
  // `undefined` means the service did not publish capability metadata, while
  // an explicit empty array is a valid user override (for example, a gateway
  // that accepts a model ID but rejects every reasoning parameter).
  if (declared !== undefined) return normalized;
  return [...(known ?? [])];
}

export function uniqueEfforts(values: ReasoningEffort[] | undefined): Exclude<ReasoningEffort, "">[] {
  const supported = new Set<Exclude<ReasoningEffort, "">>(PROVIDER_REASONING_EFFORTS);
  return Array.from(new Set((values ?? []).filter((value): value is Exclude<ReasoningEffort, ""> => Boolean(value) && supported.has(value as Exclude<ReasoningEffort, "">))));
}
