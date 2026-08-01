import type {
  ProviderModelDefinition,
  ProviderProtocol,
  ProviderReasoningTransport,
  ProviderUpstreamProtocol,
  ReasoningEffort,
} from "../../shared/types";
import { defaultUpstreamProtocol } from "../../shared/provider-compatibility";

type JsonRecord = Record<string, any>;

interface CanonicalPart {
  type: "text" | "image" | "tool_call" | "tool_result";
  text?: string;
  url?: string;
  mediaType?: string;
  data?: string;
  id?: string;
  name?: string;
  arguments?: string;
}

interface CanonicalMessage {
  role: "system" | "user" | "assistant";
  parts: CanonicalPart[];
}

interface CanonicalTool {
  name: string;
  description?: string;
  parameters: JsonRecord;
}

interface CanonicalRequest {
  model: string;
  messages: CanonicalMessage[];
  tools: CanonicalTool[];
  toolChoice?: string;
  maxTokens?: number;
  temperature?: number;
  stream: boolean;
  effort?: Exclude<ReasoningEffort, "">;
}

export interface ProviderRequestTranslation {
  clientProtocol: ProviderProtocol;
  upstreamProtocol: ProviderUpstreamProtocol;
  upstreamPath: string;
  body: JsonRecord;
  translated: boolean;
  stream: boolean;
}

export interface ProviderResponseTranslation {
  body: Uint8Array;
  contentType: string;
}

export function protocolFromGatewayPath(path: string): ProviderProtocol | undefined {
  const clean = path.split("?")[0]!.replace(/\/+$/, "");
  if (clean.endsWith("/responses")) return "responses";
  if (clean.endsWith("/chat/completions")) return "chat_completions";
  if (clean.endsWith("/messages")) return "messages";
  return undefined;
}

export function translateProviderRequest(input: {
  path: string;
  body: JsonRecord;
  providerProtocol: ProviderProtocol;
  providerUpstreamProtocol?: ProviderUpstreamProtocol;
  model?: ProviderModelDefinition;
}): ProviderRequestTranslation {
  const clientProtocol = protocolFromGatewayPath(input.path) ?? input.model?.protocol ?? input.providerProtocol;
  const upstreamProtocol = input.model?.upstreamProtocol ?? input.providerUpstreamProtocol ?? defaultUpstreamProtocol(clientProtocol);
  if (upstreamProtocol === "compatible_passthrough") {
    return {
      clientProtocol,
      upstreamProtocol,
      upstreamPath: input.path,
      body: input.body,
      translated: false,
      stream: Boolean(input.body.stream),
    };
  }
  const expected = defaultUpstreamProtocol(clientProtocol);
  if (upstreamProtocol === expected) {
    const canonical = parseRequest(clientProtocol, input.body);
    const body = applyReasoning(input.body, canonical, upstreamProtocol, input.model);
    return {
      clientProtocol,
      upstreamProtocol,
      upstreamPath: input.path,
      body,
      translated: false,
      stream: canonical.stream,
    };
  }
  const canonical = parseRequest(clientProtocol, input.body);
  const built = buildRequest(upstreamProtocol, canonical, input.model);
  const path = upstreamPath(upstreamProtocol, string(built.model), canonical.stream);
  if (upstreamProtocol === "gemini_generate_content") delete built.model;
  return {
    clientProtocol,
    upstreamProtocol,
    upstreamPath: path,
    body: built,
    translated: true,
    stream: canonical.stream,
  };
}

export function translateProviderResponse(input: {
  clientProtocol: ProviderProtocol;
  upstreamProtocol: ProviderUpstreamProtocol;
  body: Uint8Array;
  status: number;
  contentType: string;
}): ProviderResponseTranslation {
  const upstreamClient = upstreamClientProtocol(input.upstreamProtocol);
  if (input.upstreamProtocol === "compatible_passthrough" || upstreamClient === input.clientProtocol || input.status >= 400) {
    return { body: input.body, contentType: input.contentType };
  }
  const parsed = JSON.parse(new TextDecoder().decode(input.body)) as JsonRecord;
  const canonical = parseResponse(input.upstreamProtocol, parsed);
  const output = buildResponse(input.clientProtocol, canonical);
  return {
    body: new TextEncoder().encode(JSON.stringify(output)),
    contentType: "application/json; charset=utf-8",
  };
}

/**
 * Cross-protocol fallback for SSE. Same-protocol traffic is never buffered by
 * this helper. It normalizes an upstream event stream and emits a valid client
 * event stream while retaining tools, reasoning and usage.
 */
export function translateProviderSseResponse(input: {
  clientProtocol: ProviderProtocol;
  upstreamProtocol: ProviderUpstreamProtocol;
  body: Uint8Array;
  status: number;
}): ProviderResponseTranslation {
  const upstreamClient = upstreamClientProtocol(input.upstreamProtocol);
  if (input.upstreamProtocol === "compatible_passthrough" || upstreamClient === input.clientProtocol || input.status >= 400) {
    return { body: input.body, contentType: "text/event-stream; charset=utf-8" };
  }
  const canonical = parseSseResponse(input.upstreamProtocol, new TextDecoder().decode(input.body));
  return {
    body: new TextEncoder().encode(buildSseResponse(input.clientProtocol, canonical)),
    contentType: "text/event-stream; charset=utf-8",
  };
}

function parseRequest(protocol: ProviderProtocol, raw: JsonRecord): CanonicalRequest {
  if (protocol === "responses") return parseResponsesRequest(raw);
  if (protocol === "messages") return parseMessagesRequest(raw);
  return parseChatRequest(raw);
}

function parseChatRequest(raw: JsonRecord): CanonicalRequest {
  const messages: CanonicalMessage[] = [];
  for (const message of array(raw.messages)) {
    const role = message.role === "system" || message.role === "developer"
      ? "system"
      : message.role === "assistant"
        ? "assistant"
        : "user";
    const parts = parseOpenAiContent(message.content);
    if (message.role === "tool") {
      parts.push({ type: "tool_result", id: string(message.tool_call_id), text: contentText(message.content) });
    }
    for (const call of array(message.tool_calls)) {
      parts.push({
        type: "tool_call",
        id: string(call.id),
        name: string(call.function?.name),
        arguments: stringifyArguments(call.function?.arguments),
      });
    }
    messages.push({ role, parts });
  }
  return {
    model: string(raw.model),
    messages,
    tools: array(raw.tools).map((tool) => ({
      name: string(tool.function?.name ?? tool.name),
      description: optionalString(tool.function?.description ?? tool.description),
      parameters: record(tool.function?.parameters ?? tool.parameters),
    })).filter((tool) => tool.name),
    toolChoice: toolChoiceName(raw.tool_choice),
    maxTokens: number(raw.max_completion_tokens ?? raw.max_tokens),
    temperature: number(raw.temperature),
    stream: Boolean(raw.stream),
    effort: effort(raw.reasoning_effort),
  };
}

function parseResponsesRequest(raw: JsonRecord): CanonicalRequest {
  const messages: CanonicalMessage[] = [];
  if (typeof raw.instructions === "string" && raw.instructions) {
    messages.push({ role: "system", parts: [{ type: "text", text: raw.instructions }] });
  }
  if (typeof raw.input === "string") {
    messages.push({ role: "user", parts: [{ type: "text", text: raw.input }] });
  } else {
    for (const item of array(raw.input)) {
      if (item.type === "function_call") {
        messages.push({ role: "assistant", parts: [{
          type: "tool_call",
          id: string(item.call_id ?? item.id),
          name: string(item.name),
          arguments: stringifyArguments(item.arguments),
        }] });
        continue;
      }
      if (item.type === "function_call_output") {
        messages.push({ role: "user", parts: [{
          type: "tool_result",
          id: string(item.call_id),
          text: contentText(item.output),
        }] });
        continue;
      }
      const role = item.role === "assistant" ? "assistant" : item.role === "system" || item.role === "developer" ? "system" : "user";
      const parts = parseResponsesContent(item.content);
      messages.push({ role, parts });
    }
  }
  return {
    model: string(raw.model),
    messages,
    tools: array(raw.tools).map((tool) => ({
      name: string(tool.name ?? tool.function?.name),
      description: optionalString(tool.description ?? tool.function?.description),
      parameters: record(tool.parameters ?? tool.function?.parameters),
    })).filter((tool) => tool.name),
    toolChoice: toolChoiceName(raw.tool_choice),
    maxTokens: number(raw.max_output_tokens),
    temperature: number(raw.temperature),
    stream: Boolean(raw.stream),
    effort: effort(raw.reasoning?.effort),
  };
}

function parseMessagesRequest(raw: JsonRecord): CanonicalRequest {
  const messages: CanonicalMessage[] = [];
  const system = contentText(raw.system);
  if (system) messages.push({ role: "system", parts: [{ type: "text", text: system }] });
  for (const message of array(raw.messages)) {
    const parts: CanonicalPart[] = [];
    for (const block of normalizeContentBlocks(message.content)) {
      if (block.type === "text" || block.type === "thinking") parts.push({ type: "text", text: string(block.text ?? block.thinking) });
      else if (block.type === "image") {
        if (block.source?.type === "base64") parts.push({ type: "image", data: string(block.source.data), mediaType: string(block.source.media_type) });
        else if (block.source?.url) parts.push({ type: "image", url: string(block.source.url) });
      } else if (block.type === "tool_use") {
        parts.push({ type: "tool_call", id: string(block.id), name: string(block.name), arguments: JSON.stringify(block.input ?? {}) });
      } else if (block.type === "tool_result") {
        parts.push({ type: "tool_result", id: string(block.tool_use_id), text: contentText(block.content) });
      }
    }
    messages.push({ role: message.role === "assistant" ? "assistant" : "user", parts });
  }
  const configuredEffort = raw.output_config?.effort;
  return {
    model: string(raw.model),
    messages,
    tools: array(raw.tools).map((tool) => ({
      name: string(tool.name),
      description: optionalString(tool.description),
      parameters: record(tool.input_schema),
    })).filter((tool) => tool.name),
    toolChoice: toolChoiceName(raw.tool_choice),
    maxTokens: number(raw.max_tokens),
    temperature: number(raw.temperature),
    stream: Boolean(raw.stream),
    effort: effort(configuredEffort),
  };
}

function buildRequest(protocol: ProviderUpstreamProtocol, request: CanonicalRequest, model?: ProviderModelDefinition): JsonRecord {
  if (protocol === "openai_responses") return buildResponsesRequest(request, model);
  if (protocol === "anthropic_messages") return buildMessagesRequest(request, model);
  if (protocol === "gemini_generate_content") return buildGeminiRequest(request, model);
  return buildChatRequest(request, model);
}

function buildChatRequest(request: CanonicalRequest, model?: ProviderModelDefinition): JsonRecord {
  const messages: JsonRecord[] = [];
  for (const message of request.messages) {
    const ordinary = message.parts.filter((part) => part.type === "text" || part.type === "image");
    const toolCalls = message.parts.filter((part) => part.type === "tool_call");
    const toolResults = message.parts.filter((part) => part.type === "tool_result");
    if (ordinary.length || toolCalls.length || (!toolResults.length && !message.parts.length)) {
      const item: JsonRecord = {
        role: message.role,
        content: openAiContent(ordinary),
      };
      if (toolCalls.length) item.tool_calls = toolCalls.map((part) => ({
        id: part.id,
        type: "function",
        function: { name: part.name, arguments: part.arguments ?? "{}" },
      }));
      messages.push(item);
    }
    for (const part of toolResults) messages.push({ role: "tool", tool_call_id: part.id, content: part.text ?? "" });
  }
  const raw: JsonRecord = {
    model: request.model,
    messages,
    stream: request.stream,
  };
  if (request.stream) raw.stream_options = { include_usage: true };
  if (request.maxTokens) raw.max_completion_tokens = request.maxTokens;
  if (request.temperature !== undefined) raw.temperature = request.temperature;
  if (request.tools.length) raw.tools = request.tools.map((tool) => ({ type: "function", function: { name: tool.name, description: tool.description, parameters: tool.parameters } }));
  if (request.toolChoice) raw.tool_choice = { type: "function", function: { name: request.toolChoice } };
  return applyReasoning(raw, request, "openai_chat", model);
}

function buildResponsesRequest(request: CanonicalRequest, model?: ProviderModelDefinition): JsonRecord {
  const input: JsonRecord[] = [];
  const system = request.messages.filter((message) => message.role === "system").flatMap((message) => message.parts).map((part) => part.text).filter(Boolean).join("\n");
  for (const message of request.messages.filter((value) => value.role !== "system")) {
    const ordinary = message.parts.filter((part) => part.type === "text" || part.type === "image");
    if (ordinary.length) input.push({ role: message.role, content: responsesContent(ordinary, message.role) });
    for (const part of message.parts) {
      if (part.type === "tool_call") input.push({ type: "function_call", call_id: part.id, name: part.name, arguments: part.arguments ?? "{}" });
      else if (part.type === "tool_result") input.push({ type: "function_call_output", call_id: part.id, output: part.text ?? "" });
    }
  }
  const raw: JsonRecord = { model: request.model, input, stream: request.stream };
  if (system) raw.instructions = system;
  if (request.maxTokens) raw.max_output_tokens = request.maxTokens;
  if (request.temperature !== undefined) raw.temperature = request.temperature;
  if (request.tools.length) raw.tools = request.tools.map((tool) => ({ type: "function", name: tool.name, description: tool.description, parameters: tool.parameters, strict: true }));
  if (request.toolChoice) raw.tool_choice = { type: "function", name: request.toolChoice };
  return applyReasoning(raw, request, "openai_responses", model);
}

function buildMessagesRequest(request: CanonicalRequest, model?: ProviderModelDefinition): JsonRecord {
  const system = request.messages.filter((message) => message.role === "system").flatMap((message) => message.parts).map((part) => part.text).filter(Boolean).join("\n");
  const messages = request.messages.filter((message) => message.role !== "system").map((message) => ({
    role: message.role,
    content: message.parts.map((part) => {
      if (part.type === "text") return { type: "text", text: part.text ?? "" };
      if (part.type === "image" && part.data) return { type: "image", source: { type: "base64", media_type: part.mediaType ?? "image/png", data: part.data } };
      if (part.type === "image") return { type: "image", source: { type: "url", url: part.url } };
      if (part.type === "tool_call") return { type: "tool_use", id: part.id, name: part.name, input: parseArguments(part.arguments) };
      return { type: "tool_result", tool_use_id: part.id, content: part.text ?? "" };
    }),
  }));
  const raw: JsonRecord = { model: request.model, max_tokens: request.maxTokens ?? 4096, messages, stream: request.stream };
  if (system) raw.system = system;
  if (request.temperature !== undefined) raw.temperature = request.temperature;
  if (request.tools.length) raw.tools = request.tools.map((tool) => ({ name: tool.name, description: tool.description, input_schema: tool.parameters }));
  if (request.toolChoice) raw.tool_choice = { type: "tool", name: request.toolChoice };
  return applyReasoning(raw, request, "anthropic_messages", model);
}

function buildGeminiRequest(request: CanonicalRequest, model?: ProviderModelDefinition): JsonRecord {
  const system = request.messages.filter((message) => message.role === "system").flatMap((message) => message.parts).map((part) => part.text).filter(Boolean).join("\n");
  const contents = request.messages.filter((message) => message.role !== "system").map((message) => ({
    role: message.role === "assistant" ? "model" : "user",
    parts: message.parts.map((part) => {
      if (part.type === "text") return { text: part.text ?? "" };
      if (part.type === "image" && part.data) return { inlineData: { mimeType: part.mediaType ?? "image/png", data: part.data } };
      if (part.type === "image") return { fileData: { fileUri: part.url } };
      if (part.type === "tool_call") return { functionCall: { name: part.name, args: parseArguments(part.arguments) } };
      return { functionResponse: { name: part.name ?? "tool", response: { result: part.text ?? "" } } };
    }),
  }));
  const raw: JsonRecord = { model: request.model, contents };
  if (system) raw.systemInstruction = { parts: [{ text: system }] };
  if (request.tools.length) raw.tools = [{ functionDeclarations: request.tools.map((tool) => ({ name: tool.name, description: tool.description, parameters: tool.parameters })) }];
  if (request.toolChoice) raw.toolConfig = { functionCallingConfig: { mode: "ANY", allowedFunctionNames: [request.toolChoice] } };
  raw.generationConfig = {};
  if (request.maxTokens) raw.generationConfig.maxOutputTokens = request.maxTokens;
  if (request.temperature !== undefined) raw.generationConfig.temperature = request.temperature;
  return applyReasoning(raw, request, "gemini_generate_content", model);
}

function applyReasoning(raw: JsonRecord, request: Pick<CanonicalRequest, "effort" | "model">, protocol: ProviderUpstreamProtocol, model?: ProviderModelDefinition): JsonRecord {
  if (!request.effort) return raw;
  const configured = model?.reasoning?.[protocol] ?? model?.reasoning?.[upstreamClientProtocol(protocol) ?? "chat_completions"];
  const transport = configured ?? defaultReasoningTransport(protocol, request.effort);
  if (configured) clearReasoningFields(raw, protocol);
  if (!transport || transport.mode === "unsupported") return raw;
  const selected = transport.fixedEffort ?? request.effort;
  if (transport.mode === "model_suffix") {
    const suffix = transport.suffixByEffort?.[selected];
    if (suffix) raw.model = `${request.model}${suffix}`;
    return raw;
  }
  if (protocol === "openai_chat") raw.reasoning_effort = selected;
  else if (protocol === "openai_responses") raw.reasoning = { ...(record(raw.reasoning)), effort: selected };
  else if (protocol === "anthropic_messages") {
    if (selected === "none") {
      raw.thinking = { type: "disabled" };
    } else if (transport.mode === "budget_tokens") {
      raw.thinking = { type: "enabled", budget_tokens: transport.budgetByEffort?.[selected] ?? defaultBudget(selected) };
    } else {
      raw.thinking = { type: "adaptive" };
      raw.output_config = { ...(record(raw.output_config)), effort: selected === "xhigh" ? "max" : selected };
    }
  } else if (protocol === "gemini_generate_content") {
    const generation = record(raw.generationConfig);
    if (transport.mode === "budget_tokens") {
      generation.thinkingConfig = { thinkingBudget: transport.budgetByEffort?.[selected] ?? defaultBudget(selected), includeThoughts: true };
    } else {
      generation.thinkingConfig = { thinkingLevel: selected, includeThoughts: selected !== "none" };
    }
    raw.generationConfig = generation;
  }
  return raw;
}

function clearReasoningFields(raw: JsonRecord, protocol: ProviderUpstreamProtocol): void {
  if (protocol === "openai_chat") delete raw.reasoning_effort;
  else if (protocol === "openai_responses") delete raw.reasoning;
  else if (protocol === "anthropic_messages") {
    delete raw.thinking;
    const output = record(raw.output_config);
    delete output.effort;
    if (Object.keys(output).length) raw.output_config = output;
    else delete raw.output_config;
  } else if (protocol === "gemini_generate_content") {
    const generation = record(raw.generationConfig);
    delete generation.thinkingConfig;
    raw.generationConfig = generation;
  }
}

function defaultReasoningTransport(protocol: ProviderUpstreamProtocol, effortValue: Exclude<ReasoningEffort, "">): ProviderReasoningTransport {
  return {
    mode: protocol === "anthropic_messages" ? "adaptive" : "effort_enum",
    efforts: [effortValue],
    source: "compatibility_profile",
  };
}

function defaultBudget(value: Exclude<ReasoningEffort, "">): number {
  return value === "none" ? 0
    : value === "minimal" ? 512
      : value === "low" ? 1024
        : value === "medium" ? 8192
          : value === "high" ? 24576
            : value === "xhigh" ? 32768
              : value === "max" ? 128000
                : -1;
}

interface CanonicalResponse {
  id: string;
  model?: string;
  text: string;
  reasoning?: string;
  toolCalls: Array<{ id: string; name: string; arguments: string }>;
  finishReason?: string;
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number; cachedTokens?: number; reasoningTokens?: number };
}

function parseSseResponse(protocol: ProviderUpstreamProtocol, source: string): CanonicalResponse {
  const result: CanonicalResponse = { id: responseId(), text: "", reasoning: "", toolCalls: [] };
  const toolByKey = new Map<string, { id: string; name: string; arguments: string }>();
  for (const frame of source.split(/\r?\n\r?\n/)) {
    const data = frame.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
    if (!data || data === "[DONE]") continue;
    let event: JsonRecord;
    try { event = JSON.parse(data) as JsonRecord; } catch { continue; }
    if (protocol === "openai_chat") {
      result.id = string(event.id) || result.id;
      result.model = optionalString(event.model) ?? result.model;
      const choice = array(event.choices)[0] ?? {};
      const delta = record(choice.delta);
      if (typeof delta.content === "string") result.text += delta.content;
      if (typeof delta.reasoning_content === "string") result.reasoning = (result.reasoning ?? "") + delta.reasoning_content;
      for (const call of array(delta.tool_calls)) {
        const key = string(call.index ?? call.id);
        const current = toolByKey.get(key) ?? { id: string(call.id) || `call_${key}`, name: "", arguments: "" };
        if (call.id) current.id = string(call.id);
        if (call.function?.name) current.name += string(call.function.name);
        if (call.function?.arguments) current.arguments += string(call.function.arguments);
        toolByKey.set(key, current);
      }
      result.finishReason = optionalString(choice.finish_reason) ?? result.finishReason;
      if (event.usage) result.usage = openAiUsage(event.usage);
    } else if (protocol === "openai_responses") {
      result.id = string(event.response?.id ?? event.item_id ?? event.id) || result.id;
      result.model = optionalString(event.response?.model) ?? result.model;
      if (event.type === "response.output_text.delta") result.text += string(event.delta);
      else if (event.type === "response.reasoning_summary_text.delta" || event.type === "response.reasoning_text.delta") result.reasoning = (result.reasoning ?? "") + string(event.delta);
      else if (event.type === "response.output_item.added" && event.item?.type === "function_call") {
        const call = { id: string(event.item.call_id ?? event.item.id), name: string(event.item.name), arguments: string(event.item.arguments) };
        toolByKey.set(string(event.output_index ?? event.item.id), call);
      } else if (event.type === "response.function_call_arguments.delta") {
        const key = string(event.output_index ?? event.item_id);
        const current = toolByKey.get(key) ?? { id: string(event.item_id) || `call_${key}`, name: "", arguments: "" };
        current.arguments += string(event.delta);
        toolByKey.set(key, current);
      } else if (event.type === "response.completed") {
        result.usage = openAiUsage(event.response?.usage);
        result.finishReason = "stop";
      }
    } else if (protocol === "anthropic_messages") {
      if (event.type === "message_start") {
        result.id = string(event.message?.id) || result.id;
        result.model = optionalString(event.message?.model);
        result.usage = anthropicUsage(event.message?.usage);
      } else if (event.type === "content_block_start") {
        const block = record(event.content_block);
        if (block.type === "tool_use") toolByKey.set(string(event.index), { id: string(block.id), name: string(block.name), arguments: JSON.stringify(block.input ?? {}).replace(/^\{\}$/, "") });
        else if (block.type === "text") result.text += string(block.text);
        else if (block.type === "thinking") result.reasoning = (result.reasoning ?? "") + string(block.thinking);
      } else if (event.type === "content_block_delta") {
        const delta = record(event.delta);
        if (delta.type === "text_delta") result.text += string(delta.text);
        else if (delta.type === "thinking_delta") result.reasoning = (result.reasoning ?? "") + string(delta.thinking);
        else if (delta.type === "input_json_delta") {
          const key = string(event.index);
          const current = toolByKey.get(key) ?? { id: `call_${key}`, name: "", arguments: "" };
          current.arguments += string(delta.partial_json);
          toolByKey.set(key, current);
        }
      } else if (event.type === "message_delta") {
        result.finishReason = optionalString(event.delta?.stop_reason);
        result.usage = { ...(result.usage ?? {}), ...anthropicUsage(event.usage) };
      }
    } else if (protocol === "gemini_generate_content") {
      result.model = optionalString(event.modelVersion) ?? result.model;
      const candidate = array(event.candidates)[0] ?? {};
      for (const part of array(candidate.content?.parts)) {
        if (typeof part.text === "string" && part.thought) result.reasoning = (result.reasoning ?? "") + part.text;
        else if (typeof part.text === "string") result.text += part.text;
        else if (part.functionCall) {
          const key = String(toolByKey.size);
          toolByKey.set(key, { id: `call_${key}`, name: string(part.functionCall.name), arguments: JSON.stringify(part.functionCall.args ?? {}) });
        }
      }
      result.finishReason = optionalString(candidate.finishReason) ?? result.finishReason;
      if (event.usageMetadata) result.usage = geminiUsage(event.usageMetadata);
    }
  }
  result.toolCalls = [...toolByKey.values()];
  if (!result.reasoning) delete result.reasoning;
  return result;
}

function buildSseResponse(protocol: ProviderProtocol, response: CanonicalResponse): string {
  if (protocol === "chat_completions") {
    const events: JsonRecord[] = [{
      id: response.id,
      object: "chat.completion.chunk",
      model: response.model,
      choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
    }];
    if (response.reasoning) events.push({ id: response.id, object: "chat.completion.chunk", model: response.model, choices: [{ index: 0, delta: { reasoning_content: response.reasoning }, finish_reason: null }] });
    if (response.text) events.push({ id: response.id, object: "chat.completion.chunk", model: response.model, choices: [{ index: 0, delta: { content: response.text }, finish_reason: null }] });
    response.toolCalls.forEach((call, index) => events.push({ id: response.id, object: "chat.completion.chunk", model: response.model, choices: [{ index: 0, delta: { tool_calls: [{ index, id: call.id, type: "function", function: { name: call.name, arguments: call.arguments } }] }, finish_reason: null }] }));
    events.push({ id: response.id, object: "chat.completion.chunk", model: response.model, choices: [{ index: 0, delta: {}, finish_reason: response.toolCalls.length ? "tool_calls" : "stop" }], usage: chatUsage(response.usage) });
    return `${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("")}data: [DONE]\n\n`;
  }
  if (protocol === "messages") {
    const frames: JsonRecord[] = [{
      type: "message_start",
      message: { id: response.id, type: "message", role: "assistant", model: response.model, content: [], stop_reason: null, usage: { input_tokens: response.usage?.inputTokens ?? 0, output_tokens: 0 } },
    }];
    let index = 0;
    if (response.reasoning) {
      frames.push({ type: "content_block_start", index, content_block: { type: "thinking", thinking: "", signature: "" } });
      frames.push({ type: "content_block_delta", index, delta: { type: "thinking_delta", thinking: response.reasoning } });
      frames.push({ type: "content_block_stop", index: index++ });
    }
    if (response.text) {
      frames.push({ type: "content_block_start", index, content_block: { type: "text", text: "" } });
      frames.push({ type: "content_block_delta", index, delta: { type: "text_delta", text: response.text } });
      frames.push({ type: "content_block_stop", index: index++ });
    }
    for (const call of response.toolCalls) {
      frames.push({ type: "content_block_start", index, content_block: { type: "tool_use", id: call.id, name: call.name, input: {} } });
      frames.push({ type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: call.arguments } });
      frames.push({ type: "content_block_stop", index: index++ });
    }
    frames.push({ type: "message_delta", delta: { stop_reason: response.toolCalls.length ? "tool_use" : "end_turn", stop_sequence: null }, usage: { output_tokens: response.usage?.outputTokens ?? 0 } });
    frames.push({ type: "message_stop" });
    return frames.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join("");
  }
  const id = response.id;
  const responseBase = { id, object: "response", status: "in_progress", model: response.model, output: [] };
  const frames: JsonRecord[] = [{ type: "response.created", response: responseBase }, { type: "response.in_progress", response: responseBase }];
  let outputIndex = 0;
  if (response.reasoning) {
    const itemId = `${id}_reasoning`;
    frames.push({ type: "response.output_item.added", output_index: outputIndex, item: { id: itemId, type: "reasoning", summary: [] } });
    frames.push({ type: "response.reasoning_summary_part.added", item_id: itemId, output_index: outputIndex, summary_index: 0, part: { type: "summary_text", text: "" } });
    frames.push({ type: "response.reasoning_summary_text.delta", item_id: itemId, output_index: outputIndex, summary_index: 0, delta: response.reasoning });
    frames.push({ type: "response.reasoning_summary_text.done", item_id: itemId, output_index: outputIndex, summary_index: 0, text: response.reasoning });
    frames.push({ type: "response.output_item.done", output_index: outputIndex++, item: { id: itemId, type: "reasoning", summary: [{ type: "summary_text", text: response.reasoning }] } });
  }
  if (response.text) {
    const itemId = `${id}_message`;
    frames.push({ type: "response.output_item.added", output_index: outputIndex, item: { id: itemId, type: "message", role: "assistant", status: "in_progress", content: [] } });
    frames.push({ type: "response.content_part.added", item_id: itemId, output_index: outputIndex, content_index: 0, part: { type: "output_text", text: "", annotations: [] } });
    frames.push({ type: "response.output_text.delta", item_id: itemId, output_index: outputIndex, content_index: 0, delta: response.text });
    frames.push({ type: "response.output_text.done", item_id: itemId, output_index: outputIndex, content_index: 0, text: response.text });
    frames.push({ type: "response.content_part.done", item_id: itemId, output_index: outputIndex, content_index: 0, part: { type: "output_text", text: response.text, annotations: [] } });
    frames.push({ type: "response.output_item.done", output_index: outputIndex++, item: { id: itemId, type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: response.text, annotations: [] }] } });
  }
  for (const call of response.toolCalls) {
    frames.push({ type: "response.output_item.added", output_index: outputIndex, item: { type: "function_call", id: call.id, call_id: call.id, name: call.name, arguments: "", status: "in_progress" } });
    frames.push({ type: "response.function_call_arguments.delta", item_id: call.id, output_index: outputIndex, delta: call.arguments });
    frames.push({ type: "response.function_call_arguments.done", item_id: call.id, output_index: outputIndex, arguments: call.arguments });
    frames.push({ type: "response.output_item.done", output_index: outputIndex++, item: { type: "function_call", id: call.id, call_id: call.id, name: call.name, arguments: call.arguments, status: "completed" } });
  }
  const completed = buildResponse("responses", response);
  frames.push({ type: "response.completed", response: completed });
  return frames.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join("");
}

function parseResponse(protocol: ProviderUpstreamProtocol, raw: JsonRecord): CanonicalResponse {
  if (protocol === "openai_responses") {
    const output = array(raw.output);
    return {
      id: string(raw.id) || responseId(),
      model: optionalString(raw.model),
      text: output.flatMap((item) => array(item.content)).filter((item) => item.type === "output_text" || item.type === "text").map((item) => string(item.text)).join(""),
      reasoning: output.filter((item) => item.type === "reasoning").flatMap((item) => array(item.summary)).map((item) => string(item.text)).join(""),
      toolCalls: output.filter((item) => item.type === "function_call").map((item) => ({ id: string(item.call_id ?? item.id), name: string(item.name), arguments: stringifyArguments(item.arguments) })),
      finishReason: string(raw.status) === "completed" ? "stop" : string(raw.status),
      usage: openAiUsage(raw.usage),
    };
  }
  if (protocol === "anthropic_messages") {
    const content = array(raw.content);
    return {
      id: string(raw.id) || responseId(),
      model: optionalString(raw.model),
      text: content.filter((item) => item.type === "text").map((item) => string(item.text)).join(""),
      reasoning: content.filter((item) => item.type === "thinking").map((item) => string(item.thinking)).join(""),
      toolCalls: content.filter((item) => item.type === "tool_use").map((item) => ({ id: string(item.id), name: string(item.name), arguments: JSON.stringify(item.input ?? {}) })),
      finishReason: optionalString(raw.stop_reason),
      usage: anthropicUsage(raw.usage),
    };
  }
  if (protocol === "gemini_generate_content") {
    const candidate = array(raw.candidates)[0] ?? {};
    const parts = array(candidate.content?.parts);
    return {
      id: responseId(),
      model: optionalString(raw.modelVersion),
      text: parts.filter((part) => typeof part.text === "string" && !part.thought).map((part) => part.text).join(""),
      reasoning: parts.filter((part) => typeof part.text === "string" && part.thought).map((part) => part.text).join(""),
      toolCalls: parts.filter((part) => part.functionCall).map((part, index) => ({ id: `call_${index}`, name: string(part.functionCall.name), arguments: JSON.stringify(part.functionCall.args ?? {}) })),
      finishReason: optionalString(candidate.finishReason),
      usage: geminiUsage(raw.usageMetadata),
    };
  }
  const message = array(raw.choices)[0]?.message ?? {};
  return {
    id: string(raw.id) || responseId(),
    model: optionalString(raw.model),
    text: contentText(message.content),
    reasoning: optionalString(message.reasoning_content ?? message.reasoning),
    toolCalls: array(message.tool_calls).map((call) => ({ id: string(call.id), name: string(call.function?.name), arguments: stringifyArguments(call.function?.arguments) })),
    finishReason: optionalString(array(raw.choices)[0]?.finish_reason),
    usage: openAiUsage(raw.usage),
  };
}

function buildResponse(protocol: ProviderProtocol, response: CanonicalResponse): JsonRecord {
  if (protocol === "responses") {
    const output: JsonRecord[] = [];
    if (response.reasoning) output.push({ id: `${response.id}_reasoning`, type: "reasoning", summary: [{ type: "summary_text", text: response.reasoning }] });
    if (response.text) output.push({ id: `${response.id}_message`, type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: response.text, annotations: [] }] });
    output.push(...response.toolCalls.map((call) => ({ type: "function_call", id: call.id, call_id: call.id, name: call.name, arguments: call.arguments, status: "completed" })));
    return { id: response.id, object: "response", status: "completed", model: response.model, output, usage: responsesUsage(response.usage) };
  }
  if (protocol === "messages") {
    const content: JsonRecord[] = [];
    if (response.reasoning) content.push({ type: "thinking", thinking: response.reasoning, signature: "" });
    if (response.text) content.push({ type: "text", text: response.text });
    content.push(...response.toolCalls.map((call) => ({ type: "tool_use", id: call.id, name: call.name, input: parseArguments(call.arguments) })));
    return {
      id: response.id,
      type: "message",
      role: "assistant",
      model: response.model,
      content,
      stop_reason: response.toolCalls.length ? "tool_use" : "end_turn",
      usage: messagesUsage(response.usage),
    };
  }
  return {
    id: response.id,
    object: "chat.completion",
    model: response.model,
    choices: [{
      index: 0,
      message: {
        role: "assistant",
        content: response.text || null,
        reasoning_content: response.reasoning,
        tool_calls: response.toolCalls.length ? response.toolCalls.map((call) => ({ id: call.id, type: "function", function: { name: call.name, arguments: call.arguments } })) : undefined,
      },
      finish_reason: response.toolCalls.length ? "tool_calls" : response.finishReason ?? "stop",
    }],
    usage: chatUsage(response.usage),
  };
}

function upstreamPath(protocol: ProviderUpstreamProtocol, model: string, stream: boolean): string {
  if (protocol === "openai_responses") return "/responses";
  if (protocol === "anthropic_messages") return "/messages";
  if (protocol === "gemini_generate_content") return `/models/${encodeURIComponent(model)}:${stream ? "streamGenerateContent?alt=sse" : "generateContent"}`;
  return "/chat/completions";
}

function upstreamClientProtocol(protocol: ProviderUpstreamProtocol): ProviderProtocol | undefined {
  return protocol === "openai_responses" ? "responses" : protocol === "anthropic_messages" ? "messages" : protocol === "openai_chat" ? "chat_completions" : undefined;
}

function parseOpenAiContent(value: unknown): CanonicalPart[] {
  if (typeof value === "string") return [{ type: "text", text: value }];
  return array(value).flatMap((part): CanonicalPart[] => {
    if (part.type === "text" || part.type === "input_text" || part.type === "output_text") return [{ type: "text", text: string(part.text) }];
    const url = part.image_url?.url ?? part.url;
    if ((part.type === "image_url" || part.type === "input_image") && typeof url === "string") return [imagePart(url)];
    return [];
  });
}

function parseResponsesContent(value: unknown): CanonicalPart[] {
  return parseOpenAiContent(value);
}

function openAiContent(parts: CanonicalPart[]): string | JsonRecord[] {
  if (parts.every((part) => part.type === "text")) return parts.map((part) => part.text ?? "").join("");
  return parts.map((part) => part.type === "image"
    ? { type: "image_url", image_url: { url: part.url ?? `data:${part.mediaType ?? "image/png"};base64,${part.data ?? ""}` } }
    : { type: "text", text: part.text ?? "" });
}

function responsesContent(parts: CanonicalPart[], role: CanonicalMessage["role"]): JsonRecord[] {
  return parts.map((part) => part.type === "image"
    ? { type: "input_image", image_url: part.url ?? `data:${part.mediaType ?? "image/png"};base64,${part.data ?? ""}` }
    : { type: role === "assistant" ? "output_text" : "input_text", text: part.text ?? "" });
}

function imagePart(url: string): CanonicalPart {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(url);
  return match ? { type: "image", mediaType: match[1], data: match[2] } : { type: "image", url };
}

function normalizeContentBlocks(value: unknown): JsonRecord[] {
  return typeof value === "string" ? [{ type: "text", text: value }] : array(value);
}

function toolChoiceName(value: unknown): string | undefined {
  if (typeof value === "string") return ["auto", "none", "required", "any"].includes(value) ? undefined : value;
  const item = record(value);
  return optionalString(item.name ?? item.function?.name);
}

function effort(value: unknown): Exclude<ReasoningEffort, ""> | undefined {
  return typeof value === "string" && ["auto", "none", "minimal", "low", "medium", "high", "xhigh", "max"].includes(value)
    ? value as Exclude<ReasoningEffort, "">
    : undefined;
}

function parseArguments(value: unknown): JsonRecord {
  if (value && typeof value === "object") return record(value);
  try { return JSON.parse(typeof value === "string" ? value : "{}") as JsonRecord; } catch { return {}; }
}
function stringifyArguments(value: unknown): string { return typeof value === "string" ? value : JSON.stringify(value ?? {}); }
function contentText(value: unknown): string {
  if (typeof value === "string") return value;
  return array(value).map((part) => typeof part === "string" ? part : string(part.text ?? part.output_text ?? part.content)).join("");
}
function array(value: unknown): any[] { return Array.isArray(value) ? value : []; }
function record(value: unknown): JsonRecord { return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {}; }
function string(value: unknown): string { return typeof value === "string" ? value : value === undefined || value === null ? "" : String(value); }
function optionalString(value: unknown): string | undefined { const result = string(value); return result || undefined; }
function number(value: unknown): number | undefined { const result = Number(value); return Number.isFinite(result) ? result : undefined; }
function responseId(): string { return `resp_${Date.now().toString(36)}`; }
function openAiUsage(value: unknown): CanonicalResponse["usage"] {
  const usage = record(value);
  return {
    inputTokens: number(usage.input_tokens ?? usage.prompt_tokens),
    outputTokens: number(usage.output_tokens ?? usage.completion_tokens),
    totalTokens: number(usage.total_tokens),
    cachedTokens: number(usage.input_tokens_details?.cached_tokens ?? usage.prompt_tokens_details?.cached_tokens),
    reasoningTokens: number(usage.output_tokens_details?.reasoning_tokens ?? usage.completion_tokens_details?.reasoning_tokens),
  };
}
function anthropicUsage(value: unknown): CanonicalResponse["usage"] {
  const usage = record(value);
  const input = number(usage.input_tokens);
  const cached = number(usage.cache_read_input_tokens);
  const output = number(usage.output_tokens);
  return { inputTokens: input, outputTokens: output, cachedTokens: cached, totalTokens: (input ?? 0) + (output ?? 0) };
}
function geminiUsage(value: unknown): CanonicalResponse["usage"] {
  const usage = record(value);
  return {
    inputTokens: number(usage.promptTokenCount),
    outputTokens: number(usage.candidatesTokenCount),
    totalTokens: number(usage.totalTokenCount),
    cachedTokens: number(usage.cachedContentTokenCount),
    reasoningTokens: number(usage.thoughtsTokenCount),
  };
}
function chatUsage(usage?: CanonicalResponse["usage"]): JsonRecord | undefined {
  return usage ? {
    prompt_tokens: usage.inputTokens,
    completion_tokens: usage.outputTokens,
    total_tokens: usage.totalTokens,
    prompt_tokens_details: usage.cachedTokens === undefined ? undefined : { cached_tokens: usage.cachedTokens },
    completion_tokens_details: usage.reasoningTokens === undefined ? undefined : { reasoning_tokens: usage.reasoningTokens },
  } : undefined;
}
function responsesUsage(usage?: CanonicalResponse["usage"]): JsonRecord | undefined {
  return usage ? {
    input_tokens: usage.inputTokens,
    output_tokens: usage.outputTokens,
    total_tokens: usage.totalTokens,
    input_tokens_details: usage.cachedTokens === undefined ? undefined : { cached_tokens: usage.cachedTokens },
    output_tokens_details: usage.reasoningTokens === undefined ? undefined : { reasoning_tokens: usage.reasoningTokens },
  } : undefined;
}
function messagesUsage(usage?: CanonicalResponse["usage"]): JsonRecord | undefined {
  return usage ? { input_tokens: usage.inputTokens, output_tokens: usage.outputTokens, cache_read_input_tokens: usage.cachedTokens } : undefined;
}
