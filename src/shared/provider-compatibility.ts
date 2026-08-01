import type {
  ProviderCompatibilityFlavor,
  ProviderProtocol,
  ProviderReasoningTransport,
  ProviderUpstreamProtocol,
  ReasoningEffort,
} from "./types";

export const PROVIDER_PROTOCOLS: ProviderProtocol[] = ["responses", "chat_completions", "messages"];
export const PROVIDER_REASONING_LEVELS: Exclude<ReasoningEffort, "">[] = [
  "auto",
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

const GROK2API_GROK45 = ["minimal", "low", "medium", "high", "xhigh"] satisfies Exclude<ReasoningEffort, "">[];

export function inferCompatibilityFlavor(input: {
  configured?: ProviderCompatibilityFlavor;
  ownedBy?: string[];
  baseUrl?: string;
}): ProviderCompatibilityFlavor {
  if (input.configured && input.configured !== "auto") return input.configured;
  const owners = (input.ownedBy ?? []).join(" ").toLocaleLowerCase();
  const base = input.baseUrl?.toLocaleLowerCase() ?? "";
  if (owners.includes("grok2api") || base.includes("grok2api")) return "grok2api";
  if (owners.includes("new-api") || owners.includes("newapi")) return "new-api";
  if (owners.includes("sub2api")) return "sub2api";
  if (owners.includes("cliproxy") || owners.includes("cli-proxy")) return "cliproxyapi";
  return input.configured && input.configured !== "auto" ? input.configured : "generic";
}

export function compatibilityReasoningTransport(
  flavor: ProviderCompatibilityFlavor,
  modelId: string,
  protocol: ProviderProtocol | ProviderUpstreamProtocol,
): ProviderReasoningTransport | undefined {
  const model = modelId.trim().toLocaleLowerCase();
  if (flavor === "grok2api" && model === "grok-4.5") {
    return { mode: "effort_enum", efforts: [...GROK2API_GROK45], source: "compatibility_profile" };
  }
  if (flavor === "grok2api" && model === "grok-4.3") {
    return { mode: "effort_enum", efforts: ["none", "low", "medium", "high"], source: "compatibility_profile" };
  }
  if (flavor === "grok2api" && /grok-4\.20.*multi-agent/.test(model)) {
    return { mode: "effort_enum", efforts: ["low", "medium", "high", "xhigh"], source: "compatibility_profile" };
  }
  if (protocol === "anthropic_messages" || protocol === "messages") {
    if (/claude-(?:opus|sonnet|haiku|fable)-?(?:4[.-]?[6-9]|5)/.test(model)) {
      return {
        mode: "adaptive",
        efforts: ["low", "medium", "high", "max"],
        source: "compatibility_profile",
      };
    }
  }
  return undefined;
}

export function defaultUpstreamProtocol(protocol: ProviderProtocol): ProviderUpstreamProtocol {
  return protocol === "responses"
    ? "openai_responses"
    : protocol === "messages"
      ? "anthropic_messages"
      : "openai_chat";
}

export function upstreamProtocolClient(protocol: ProviderUpstreamProtocol): ProviderProtocol | undefined {
  return protocol === "openai_responses"
    ? "responses"
    : protocol === "anthropic_messages"
      ? "messages"
      : protocol === "openai_chat"
        ? "chat_completions"
        : undefined;
}
