import { describe, expect, it } from "vitest";
import {
  translateProviderRequest,
  translateProviderResponse,
  translateProviderSseResponse,
} from "./provider-protocol-translator";

describe("provider protocol translator", () => {
  it("converts Chat Completions tools and effort to Responses", () => {
    const translated = translateProviderRequest({
      path: "/chat/completions",
      providerProtocol: "chat_completions",
      providerUpstreamProtocol: "openai_responses",
      model: { id: "local-grok", model: "grok-4.5", name: "Grok 4.5" },
      body: {
        model: "grok-4.5",
        messages: [
          { role: "system", content: "Be concise." },
          { role: "user", content: "Use the tool." },
        ],
        tools: [{ type: "function", function: { name: "lookup", parameters: { type: "object" } } }],
        tool_choice: { type: "function", function: { name: "lookup" } },
        reasoning_effort: "xhigh",
        stream: true,
      },
    });
    expect(translated.upstreamPath).toBe("/responses");
    expect(translated.translated).toBe(true);
    expect(translated.body.instructions).toBe("Be concise.");
    expect(translated.body.tools[0]).toMatchObject({ type: "function", name: "lookup" });
    expect(translated.body.tool_choice).toEqual({ type: "function", name: "lookup" });
    expect(translated.body.reasoning).toEqual({ effort: "xhigh" });
  });

  it("removes an unsupported reasoning field instead of forwarding a stale CLI selection", () => {
    const translated = translateProviderRequest({
      path: "/responses",
      providerProtocol: "responses",
      providerUpstreamProtocol: "openai_responses",
      model: {
        id: "fixed-model",
        model: "no-reasoning",
        name: "No reasoning",
        reasoning: {
          openai_responses: { mode: "unsupported", efforts: [], source: "manual" },
        },
      },
      body: {
        model: "no-reasoning",
        input: "Hi",
        reasoning: { effort: "high" },
      },
    });
    expect(translated.body.reasoning).toBeUndefined();
  });

  it("converts Responses tool history to Chat Completions", () => {
    const translated = translateProviderRequest({
      path: "/responses",
      providerProtocol: "responses",
      providerUpstreamProtocol: "openai_chat",
      body: {
        model: "model-a",
        input: [
          { role: "user", content: [{ type: "input_text", text: "Call it" }] },
          { type: "function_call", call_id: "call_1", name: "lookup", arguments: "{\"key\":\"a\"}" },
          { type: "function_call_output", call_id: "call_1", output: "42" },
        ],
        stream: false,
      },
    });
    expect(translated.upstreamPath).toBe("/chat/completions");
    expect(translated.body.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: "assistant", tool_calls: [expect.objectContaining({ id: "call_1" })] }),
      { role: "tool", tool_call_id: "call_1", content: "42" },
    ]));
  });

  it("converts Anthropic image and tool input to Gemini", () => {
    const translated = translateProviderRequest({
      path: "/messages",
      providerProtocol: "messages",
      providerUpstreamProtocol: "gemini_generate_content",
      body: {
        model: "gemini-3.6-flash",
        system: "System",
        messages: [{ role: "user", content: [
          { type: "image", source: { type: "base64", media_type: "image/png", data: "AA==" } },
          { type: "text", text: "Describe" },
        ] }],
        tools: [{ name: "lookup", input_schema: { type: "object" } }],
        max_tokens: 64,
        stream: true,
      },
    });
    expect(translated.upstreamPath).toBe("/models/gemini-3.6-flash:streamGenerateContent?alt=sse");
    expect(translated.body.model).toBeUndefined();
    expect(translated.body.contents[0].parts[0]).toEqual({ inlineData: { mimeType: "image/png", data: "AA==" } });
    expect(translated.body.tools[0].functionDeclarations[0].name).toBe("lookup");
  });

  it("maps a Responses effort to Anthropic adaptive effort", () => {
    const translated = translateProviderRequest({
      path: "/responses",
      providerProtocol: "responses",
      providerUpstreamProtocol: "anthropic_messages",
      model: {
        id: "claude",
        model: "claude-opus-4.8",
        name: "Claude",
        reasoning: {
          anthropic_messages: {
            mode: "adaptive",
            efforts: ["low", "medium", "high", "max"],
            source: "manual",
          },
        },
      },
      body: {
        model: "claude-opus-4.8",
        input: "Hi",
        reasoning: { effort: "xhigh" },
      },
    });
    expect(translated.body.thinking).toEqual({ type: "adaptive" });
    expect(translated.body.output_config).toEqual({ effort: "max" });
  });

  it("normalizes a Responses JSON answer for a Chat client", () => {
    const result = translateProviderResponse({
      clientProtocol: "chat_completions",
      upstreamProtocol: "openai_responses",
      status: 200,
      contentType: "application/json",
      body: new TextEncoder().encode(JSON.stringify({
        id: "resp_1",
        object: "response",
        status: "completed",
        model: "grok-4.5",
        output: [{ type: "message", content: [{ type: "output_text", text: "OK" }] }],
        usage: { input_tokens: 5, output_tokens: 1, total_tokens: 6 },
      })),
    });
    const parsed = JSON.parse(new TextDecoder().decode(result.body));
    expect(parsed.object).toBe("chat.completion");
    expect(parsed.choices[0].message.content).toBe("OK");
    expect(parsed.usage.total_tokens).toBe(6);
  });

  it("normalizes a Gemini answer and usage for a Responses client", () => {
    const result = translateProviderResponse({
      clientProtocol: "responses",
      upstreamProtocol: "gemini_generate_content",
      status: 200,
      contentType: "application/json",
      body: new TextEncoder().encode(JSON.stringify({
        modelVersion: "gemini-3.6-flash",
        candidates: [{ content: { parts: [{ text: "thinking", thought: true }, { text: "OK" }] }, finishReason: "STOP" }],
        usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 2, totalTokenCount: 6, thoughtsTokenCount: 1 },
      })),
    });
    const parsed = JSON.parse(new TextDecoder().decode(result.body));
    expect(parsed.object).toBe("response");
    expect(parsed.model).toBe("gemini-3.6-flash");
    expect(parsed.output).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "reasoning" }),
      expect.objectContaining({ type: "message" }),
    ]));
    expect(parsed.usage).toMatchObject({ input_tokens: 4, output_tokens: 2, total_tokens: 6 });
  });

  it("normalizes a Chat tool SSE stream for a Responses client", () => {
    const source = [
      `data: ${JSON.stringify({ id: "chat_1", model: "grok-4.5", choices: [{ delta: { role: "assistant" }, finish_reason: null }] })}\n\n`,
      `data: ${JSON.stringify({ id: "chat_1", model: "grok-4.5", choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "lookup", arguments: "{\"key\":\"a\"}" } }] }, finish_reason: null }] })}\n\n`,
      `data: ${JSON.stringify({ id: "chat_1", model: "grok-4.5", choices: [{ delta: {}, finish_reason: "tool_calls" }], usage: { prompt_tokens: 5, completion_tokens: 4, total_tokens: 9 } })}\n\n`,
      "data: [DONE]\n\n",
    ].join("");
    const result = translateProviderSseResponse({
      clientProtocol: "responses",
      upstreamProtocol: "openai_chat",
      status: 200,
      body: new TextEncoder().encode(source),
    });
    const output = new TextDecoder().decode(result.body);
    expect(output).toContain("response.function_call_arguments.delta");
    expect(output).toContain("\"name\":\"lookup\"");
    expect(output).toContain("response.completed");
    expect(output).toContain("\"total_tokens\":9");
  });
});
