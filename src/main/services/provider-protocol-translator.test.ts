import { describe, expect, it } from "vitest";
import {
  translateProviderRequest,
  translateProviderResponse,
  translateProviderSseResponse,
  ProviderSseIncrementalBridge,
} from "./provider-protocol-translator";
import { PROVIDER_THINKING_END, PROVIDER_THINKING_START } from "../../shared/provider-gateway-markers";

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

  it("does not forge an Anthropic signature for a non-stream cross-protocol reasoning answer", () => {
    const result = translateProviderResponse({
      clientProtocol: "messages",
      upstreamProtocol: "gemini_generate_content",
      status: 200,
      contentType: "application/json",
      body: new TextEncoder().encode(JSON.stringify({
        modelVersion: "gemini-test",
        candidates: [{ content: { parts: [{ text: "reason", thought: true }, { text: "answer" }] }, finishReason: "STOP" }],
        usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 2, totalTokenCount: 4 },
      })),
    });
    const parsed = JSON.parse(new TextDecoder().decode(result.body));
    expect(parsed.content[0]).toEqual({ type: "text", text: `${PROVIDER_THINKING_START}reason${PROVIDER_THINKING_END}` });
    expect(JSON.stringify(parsed)).not.toContain('"signature":""');
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

  it("incrementally bridges UTF-8 text, multiple tools and terminal usage without buffering the stream", () => {
    const bridge = new ProviderSseIncrementalBridge("responses", "openai_chat");
    const source = [
      `data: ${JSON.stringify({ id: "chat_2", model: "grok", choices: [{ delta: { role: "assistant" }, finish_reason: null }] })}\n\n`,
      `data: ${JSON.stringify({ id: "chat_2", model: "grok", choices: [{ delta: { content: "你好" }, finish_reason: null }] })}\n\n`,
      `data: ${JSON.stringify({ id: "chat_2", choices: [{ delta: { tool_calls: [
        { index: 0, id: "call_a", function: { name: "one", arguments: "{\"a\":" } },
        { index: 1, id: "call_b", function: { name: "two", arguments: "{\"b\":" } },
      ] }, finish_reason: null }] })}\n\n`,
      `data: ${JSON.stringify({ id: "chat_2", choices: [{ delta: { tool_calls: [
        { index: 0, function: { arguments: "1}" } },
        { index: 1, function: { arguments: "2}" } },
      ] }, finish_reason: null }] })}\n\n`,
      `data: ${JSON.stringify({ id: "chat_2", choices: [{ delta: {}, finish_reason: "tool_calls" }], usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 } })}\n\n`,
      "data: [DONE]\n\n",
    ].join("");
    const bytes = new TextEncoder().encode(source);
    const chinese = new TextEncoder().encode("你");
    const splitAt = bytes.findIndex((value, index) => value === chinese[0] && bytes[index + 1] === chinese[1]) + 1;
    const toolAt = Buffer.from(bytes).indexOf(Buffer.from("call_a"));
    const first = bridge.push(bytes.slice(0, splitAt));
    const second = bridge.push(bytes.slice(splitAt, toolAt));
    const rest = bridge.push(bytes.slice(toolAt), true);
    const early = new TextDecoder().decode(Buffer.concat([...first, ...second].map((value) => Buffer.from(value))));
    const output = new TextDecoder().decode(Buffer.concat(rest.map((value) => Buffer.from(value))));
    expect(early).toContain("response.output_text.delta");
    expect(early).toContain("你好");
    expect(output.match(/response\.function_call_arguments\.delta/g)?.length).toBeGreaterThanOrEqual(4);
    expect(output).toContain("call_a");
    expect(output).toContain("call_b");
    expect(output).toContain("response.completed");
    expect(output).toContain("\"total_tokens\":10");
  });

  it("carries unsigned cross-protocol reasoning to Messages as marker text instead of forging a signature", () => {
    const bridge = new ProviderSseIncrementalBridge("messages", "openai_chat");
    const source = [
      `data: ${JSON.stringify({ id: "chat_reason", model: "grok", choices: [{ delta: { reasoning_content: "先想" }, finish_reason: null }] })}\n\n`,
      `data: ${JSON.stringify({ id: "chat_reason", model: "grok", choices: [{ delta: { content: "答案" }, finish_reason: "stop" }], usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } })}\n\n`,
    ].join("");
    const frames = bridge.push(new TextEncoder().encode(source), true);
    const output = new TextDecoder().decode(Buffer.concat(frames.map((value) => Buffer.from(value))));
    expect(output).toContain(PROVIDER_THINKING_START);
    expect(output).toContain(PROVIDER_THINKING_END);
    expect(output).toContain("先想");
    expect(output).toContain("答案");
    expect(output).not.toContain('"type":"thinking"');
    expect(output).not.toContain('"signature":""');
    expect(output).toContain("message_stop");
  });

  it("uses a Chat-specific zero-based tool index after reasoning and text items", () => {
    const bridge = new ProviderSseIncrementalBridge("chat_completions", "gemini_generate_content");
    const source = `data: ${JSON.stringify({
      modelVersion: "gemini-test",
      candidates: [{
        content: { parts: [
          { text: "思考", thought: true },
          { text: "调用" },
          { functionCall: { id: "call_lookup", name: "lookup", args: { key: "a" } } },
        ] },
        finishReason: "STOP",
      }],
      usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 3, totalTokenCount: 7, thoughtsTokenCount: 1 },
    })}\n\n`;
    const frames = bridge.push(new TextEncoder().encode(source), true);
    const output = new TextDecoder().decode(Buffer.concat(frames.map((value) => Buffer.from(value))));
    const toolFrame = output.split(/\r?\n/).find((line) => line.includes("tool_calls"));
    expect(toolFrame).toBeTruthy();
    expect(JSON.parse(toolFrame!.slice(6)).choices[0].delta.tool_calls[0].index).toBe(0);
    expect(output).toContain("reasoning_content");
    expect(output).toContain('"total_tokens":7');
    expect(output).toContain("data: [DONE]");
  });

  it("preserves a Responses call_id across later item-id argument deltas", () => {
    const bridge = new ProviderSseIncrementalBridge("chat_completions", "openai_responses");
    const source = [
      `event: response.output_item.added\ndata: ${JSON.stringify({ type: "response.output_item.added", output_index: 0, item: { type: "function_call", id: "item_1", call_id: "call_1", name: "lookup", arguments: "" } })}\n\n`,
      `event: response.function_call_arguments.delta\ndata: ${JSON.stringify({ type: "response.function_call_arguments.delta", output_index: 0, item_id: "item_1", delta: "{\"key\":1}" })}\n\n`,
      `event: response.completed\ndata: ${JSON.stringify({ type: "response.completed", response: { id: "resp_1", model: "grok", usage: { input_tokens: 3, output_tokens: 1, total_tokens: 4 } } })}\n\n`,
    ].join("");
    const decoded = new TextDecoder().decode(Buffer.concat(bridge.push(new TextEncoder().encode(source), true).map((value) => Buffer.from(value))));
    expect(decoded).toContain('"id":"call_1"');
    expect(decoded).not.toContain('"id":"item_1","type":"function"');
  });

  it("incrementally bridges Messages UTF-8, tools and usage to Responses", () => {
    const bridge = new ProviderSseIncrementalBridge("responses", "anthropic_messages");
    const source = [
      `event: message_start\ndata: ${JSON.stringify({ type: "message_start", message: { id: "msg_1", model: "claude", usage: { input_tokens: 8 } } })}\n\n`,
      `event: content_block_start\ndata: ${JSON.stringify({ type: "content_block_start", index: 0, content_block: { type: "text", text: "你" } })}\n\n`,
      `event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "好" } })}\n\n`,
      `event: content_block_start\ndata: ${JSON.stringify({ type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "tool_1", name: "lookup", input: {} } })}\n\n`,
      `event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: "{\"id\":1}" } })}\n\n`,
      `event: message_delta\ndata: ${JSON.stringify({ type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 5 } })}\n\n`,
      `event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`,
    ].join("");
    const bytes = new TextEncoder().encode(source);
    const split = Buffer.from(bytes).indexOf(Buffer.from("你")) + 1;
    const output = [...bridge.push(bytes.slice(0, split)), ...bridge.push(bytes.slice(split), true)];
    const decoded = new TextDecoder().decode(Buffer.concat(output.map((value) => Buffer.from(value))));
    expect(decoded).toContain("你好");
    expect(decoded).toContain("response.function_call_arguments.delta");
    expect(decoded).toContain('"input_tokens":8');
    expect(decoded).toContain('"output_tokens":5');
    expect(decoded).toContain("response.completed");
  });

  it("keeps a separate Chat usage tail before closing the translated stream", () => {
    const bridge = new ProviderSseIncrementalBridge("responses", "openai_chat");
    const source = [
      `data: ${JSON.stringify({ id: "chat_usage", model: "grok", choices: [{ delta: { content: "OK" }, finish_reason: null }] })}\n\n`,
      `data: ${JSON.stringify({ id: "chat_usage", model: "grok", choices: [{ delta: {}, finish_reason: "stop" }] })}\n\n`,
      `data: ${JSON.stringify({ id: "chat_usage", model: "grok", choices: [], usage: { prompt_tokens: 11, completion_tokens: 2, total_tokens: 13 } })}\n\n`,
      "data: [DONE]\n\n",
    ].join("");

    const decoded = new TextDecoder().decode(Buffer.concat(
      bridge.push(new TextEncoder().encode(source), true).map((value) => Buffer.from(value)),
    ));
    expect(decoded).toContain('"total_tokens":13');
    expect(decoded.match(/event: response\.completed/g)).toHaveLength(1);
    expect(bridge.outcome).toBe("completed");
  });

  it("preserves required, none, auto and named tool-choice semantics across protocols", () => {
    const tool = { type: "function", function: { name: "lookup", parameters: { type: "object" } } };
    const base = { model: "model-a", messages: [{ role: "user", content: "Hi" }], tools: [tool] };

    const requiredToMessages = translateProviderRequest({
      path: "/chat/completions",
      providerProtocol: "chat_completions",
      providerUpstreamProtocol: "anthropic_messages",
      body: { ...base, tool_choice: "required" },
    });
    expect(requiredToMessages.body.tool_choice).toEqual({ type: "any" });

    const anyToChat = translateProviderRequest({
      path: "/messages",
      providerProtocol: "messages",
      providerUpstreamProtocol: "openai_chat",
      body: {
        model: "model-a",
        messages: [{ role: "user", content: "Hi" }],
        tools: [{ name: "lookup", input_schema: { type: "object" } }],
        tool_choice: { type: "any" },
      },
    });
    expect(anyToChat.body.tool_choice).toBe("required");

    const noneToGemini = translateProviderRequest({
      path: "/chat/completions",
      providerProtocol: "chat_completions",
      providerUpstreamProtocol: "gemini_generate_content",
      body: { ...base, tool_choice: "none" },
    });
    expect(noneToGemini.body.toolConfig.functionCallingConfig).toEqual({ mode: "NONE" });

    const autoToGemini = translateProviderRequest({
      path: "/chat/completions",
      providerProtocol: "chat_completions",
      providerUpstreamProtocol: "gemini_generate_content",
      body: { ...base, tool_choice: "auto" },
    });
    expect(autoToGemini.body.toolConfig.functionCallingConfig).toEqual({ mode: "AUTO" });

    const namedToGemini = translateProviderRequest({
      path: "/chat/completions",
      providerProtocol: "chat_completions",
      providerUpstreamProtocol: "gemini_generate_content",
      body: { ...base, tool_choice: { type: "function", function: { name: "lookup" } } },
    });
    expect(namedToGemini.body.toolConfig.functionCallingConfig).toEqual({ mode: "ANY", allowedFunctionNames: ["lookup"] });
  });

  it("uses the originating tool-call name for a Gemini function response", () => {
    const translated = translateProviderRequest({
      path: "/chat/completions",
      providerProtocol: "chat_completions",
      providerUpstreamProtocol: "gemini_generate_content",
      body: {
        model: "gemini-test",
        messages: [
          { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "lookup", arguments: "{\"id\":1}" } }] },
          { role: "tool", tool_call_id: "call_1", content: "42" },
        ],
      },
    });
    const responsePart = translated.body.contents
      .flatMap((message: any) => message.parts)
      .find((part: any) => part.functionResponse);
    expect(responsePart.functionResponse).toMatchObject({ name: "lookup", response: { result: "42" } });
  });

  it("marks an explicit SSE error as failed and leaves a premature EOF incomplete", () => {
    const failed = new ProviderSseIncrementalBridge("responses", "openai_chat");
    const errorOutput = new TextDecoder().decode(Buffer.concat(failed.push(
      new TextEncoder().encode(`data: ${JSON.stringify({ error: { message: "upstream failed" } })}\n\n`),
      true,
    ).map((value) => Buffer.from(value))));
    expect(failed.outcome).toBe("failed");
    expect(errorOutput).toContain("response.failed");
    expect(errorOutput).not.toContain("response.completed");

    const truncated = new ProviderSseIncrementalBridge("responses", "openai_chat");
    const partialOutput = new TextDecoder().decode(Buffer.concat(truncated.push(
      new TextEncoder().encode(`data: ${JSON.stringify({ id: "partial", choices: [{ delta: { content: "half" }, finish_reason: null }] })}\n\n`),
      true,
    ).map((value) => Buffer.from(value))));
    expect(truncated.outcome).toBeUndefined();
    expect(partialOutput).toContain("response.output_text.delta");
    expect(partialOutput).not.toContain("response.completed");
  });

  it("fails closed when retained cross-protocol semantic state exceeds its bound", () => {
    const bridge = new ProviderSseIncrementalBridge("responses", "openai_chat", 4);
    const first = Buffer.from(`data: ${JSON.stringify({ id: "chat-1", choices: [{ delta: { content: "你好" }, finish_reason: null }] })}\n\n`);
    expect(() => bridge.push(first)).toThrow(/增量语义状态超过 4 字节上限/);
  });
});
