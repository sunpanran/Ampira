import assert from "node:assert/strict";
import {
  createAiSseParser,
  nativeWebSearchCapability,
  requestAiCompletionResult,
  requestAiCompletionStream,
} from "../../extension/core/ai.mjs";

const responsesParser = createAiSseParser();
assert.deepEqual(responsesParser.push('data: {"type":"response.output_text.de'), []);
assert.deepEqual(responsesParser.push('lta","delta":"Hello "}\n\ndata: {"type":"response.output_text.delta","delta":"world"}\n\n'), [
  { delta: "Hello " },
  { delta: "world" },
]);
responsesParser.push('data: {"type":"response.completed","response":{"status":"completed"}}\n\n', true);
assert.deepEqual(responsesParser.result(), { text: "Hello world", incomplete: false, finishReason: "stop" });

const chatParser = createAiSseParser({ chat: true });
chatParser.push('data: {"choices":[{"delta":{"content":"A "},"finish_reason":null}]}\n\n');
chatParser.push('data: {"choices":[{"delta":{"content":"B"},"finish_reason":"length"}]}\n\ndata: [DONE]\n\n', true);
assert.deepEqual(chatParser.result(), { text: "A B", incomplete: true, finishReason: "length" });

const settings = {
  openaiBaseUrl: "https://api.openai.com/v1",
  openaiApiStyle: "responses",
  openaiSummaryModel: "gpt-5.4-mini",
};
const grokSettings = {
  openaiBaseUrl: "https://api.x.ai/v1",
  openaiApiStyle: "responses",
  openaiSummaryModel: "grok-4.7",
};
const kimiSettings = {
  openaiBaseUrl: "https://api.moonshot.cn/v1",
  openaiApiStyle: "chat_completions",
  openaiSummaryModel: "kimi-k3.1-pro",
};
const common = {
  apiKey: "fixture-key",
  system: "System",
  messages: [
    { role: "user", content: "First" },
    { role: "assistant", content: "Answer" },
    { role: "user", content: "Follow-up" },
  ],
  maxTokens: 4096,
  hasOriginPermissions: async () => true,
};

const originalFetch = globalThis.fetch;
try {
  let requestBody = null;
  globalThis.fetch = async (_url, init) => {
    requestBody = JSON.parse(init.body);
    return jsonResponse({ status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, output_text: "Partial answer" });
  };
  const incomplete = await requestAiCompletionResult(settings, common);
  assert.deepEqual(incomplete, { text: "Partial answer", incomplete: true, finishReason: "length" });
  assert.equal(requestBody.store, false, "official Responses requests must disable provider storage");
  assert.deepEqual(requestBody.input.map(({ role }) => role), ["user", "assistant", "user"], "Responses must receive native conversation roles");
  assert.equal(requestBody.max_output_tokens, 4096);

  globalThis.fetch = async (_url, init) => {
    requestBody = JSON.parse(init.body);
    return jsonResponse({ choices: [{ message: { content: "Kimi answer", reasoning_content: "Private reasoning" }, finish_reason: "stop" }] });
  };
  for (const baseUrl of ["https://api.moonshot.cn/v1", "https://api.moonshot.ai/v1"]) {
    const result = await requestAiCompletionResult({ ...kimiSettings, openaiBaseUrl: baseUrl }, { ...common, maxTokens: 1200 });
    assert.deepEqual(result, { text: "Kimi answer", incomplete: false, finishReason: "stop" });
    assert.equal(requestBody.max_completion_tokens, 1200, "Kimi K3.1 must retain the caller's bounded output allowance");
    assert.equal(requestBody.max_tokens, undefined, "Kimi K3.1 must use the current completion-token parameter");
    assert.equal(requestBody.reasoning_effort, "low", "short text tasks must not default to maximum reasoning effort");
    assert.deepEqual(requestBody.messages, [{ role: "system", content: "System" }, ...common.messages]);
    assert.equal(requestBody.temperature, undefined, "Kimi fixed sampling parameters must remain provider defaults");
    assert.equal(requestBody.thinking, undefined, "Kimi K3.1 does not support disabling thinking");
  }
  for (const baseUrl of ["https://api.moonshot.cn.example.com/v1", "https://api.moonshot.ai:8443/v1", "https://compatible.example/v1"]) {
    await requestAiCompletionResult({ ...kimiSettings, openaiBaseUrl: baseUrl }, common);
    assert.equal(requestBody.max_tokens, 4096);
    assert.equal(requestBody.max_completion_tokens, undefined, "Kimi-specific fields must not leak to custom origins");
    assert.equal(requestBody.reasoning_effort, undefined);
  }
  await requestAiCompletionResult({ ...kimiSettings, openaiSummaryModel: "kimi-k2.6" }, common);
  assert.equal(requestBody.max_tokens, 4096, "saved Kimi models must retain their existing request contract");
  assert.equal(requestBody.reasoning_effort, undefined);
  await requestAiCompletionResult({ ...kimiSettings, openaiApiStyle: "responses" }, common);
  assert.equal(requestBody.max_output_tokens, 4096);
  assert.equal(requestBody.max_completion_tokens, undefined);
  assert.equal(requestBody.reasoning_effort, undefined);
  const kimiDeltas = [];
  globalThis.fetch = async (_url, init) => {
    requestBody = JSON.parse(init.body);
    return eventStreamResponse([
      'data: {"choices":[{"delta":{"reasoning_content":"Private reasoning"},"finish_reason":null}]}\n\n',
      'data: {"choices":[{"delta":{"content":"Kimi stream"},"finish_reason":"stop"}]}\n\n',
      'data: {"choices":[],"usage":{"completion_tokens":42}}\n\ndata: [DONE]\n\n',
    ]);
  };
  assert.equal((await requestAiCompletionStream(kimiSettings, { ...common, onDelta: (delta) => kimiDeltas.push(delta) })).text, "Kimi stream");
  assert.equal(requestBody.stream, true);
  assert.equal(requestBody.max_completion_tokens, 4096);
  assert.equal(requestBody.reasoning_effort, "low");
  assert.deepEqual(kimiDeltas, ["Kimi stream"], "Kimi reasoning and usage-only events must not appear as visible output");

  let requestUrl = "";
  let requestHeaders = null;
  const grokResponse = {
    status: "completed",
    output: [
      { type: "reasoning", encrypted_content: "fixture-ciphertext", summary: [{ type: "summary_text", text: "Private reasoning" }] },
      { type: "message", role: "assistant", content: [{ type: "output_text", text: "Grok answer" }] },
    ],
  };
  globalThis.fetch = async (url, init) => {
    requestUrl = String(url);
    requestHeaders = init.headers;
    requestBody = JSON.parse(init.body);
    return jsonResponse(grokResponse);
  };
  const grokResult = await requestAiCompletionResult(grokSettings, {
    ...common,
    hasOriginPermissions: async (origins) => {
      assert.deepEqual(origins, ["https://api.x.ai/v1/responses"]);
      return true;
    },
  });
  assert.deepEqual(grokResult, { text: "Grok answer", incomplete: false, finishReason: "stop" });
  assert.equal(requestUrl, "https://api.x.ai/v1/responses");
  assert.equal(requestHeaders.authorization, "Bearer fixture-key");
  assert.equal(requestBody.model, "grok-4.7");
  assert.deepEqual(requestBody.input, [{ role: "system", content: "System" }, ...common.messages]);
  assert.equal(requestBody.instructions, undefined, "xAI must receive the system prompt as an input message");
  assert.equal(requestBody.store, false);
  assert.deepEqual(requestBody.reasoning, { effort: "low" });
  assert.equal(requestBody.max_output_tokens, 4096);
  assert.equal(requestBody.previous_response_id, undefined, "Grok must use the existing local text history");
  assert.equal(requestBody.tools, undefined);

  await requestAiCompletionResult(grokSettings, { ...common, messages: undefined, input: "Connection test", maxTokens: 900 });
  assert.deepEqual(requestBody.input, [
    { role: "system", content: "System" },
    { role: "user", content: "Connection test" },
  ], "single-input summary and connection-test calls must retain their prompt");
  assert.equal(requestBody.max_output_tokens, 900, "Grok must preserve the caller's output budget");
  await requestAiCompletionResult(grokSettings, { ...common, system: "" });
  assert.deepEqual(requestBody.input, common.messages, "an absent system prompt must not create an empty message");

  await requestAiCompletionResult({ ...grokSettings, openaiSummaryModel: "fixture-custom-model" }, common);
  assert.equal(requestBody.reasoning, undefined, "manually selected models must not inherit unverified reasoning parameters");
  assert.equal(requestBody.store, false);
  for (const baseUrl of ["https://api.x.ai.example.com/v1", "https://compatible.example/v1", "https://api.x.ai:8443/v1"]) {
    await requestAiCompletionResult({ ...grokSettings, openaiBaseUrl: baseUrl }, common);
    assert.equal(requestBody.instructions, "System");
    assert.deepEqual(requestBody.input, common.messages);
    assert.equal(requestBody.reasoning, undefined, "xAI-specific parameters must be bound to its exact official origin");
    assert.equal(requestBody.store, undefined);
  }
  await requestAiCompletionResult({ ...grokSettings, openaiApiStyle: "chat_completions" }, common);
  assert.deepEqual(requestBody.messages, [{ role: "system", content: "System" }, ...common.messages]);
  assert.equal(requestBody.input, undefined, "the Responses adaptation must not change custom Chat Completions requests");
  assert.equal(requestBody.reasoning, undefined);

  let forbiddenCalls = 0;
  globalThis.fetch = async () => { forbiddenCalls += 1; return jsonResponse(grokResponse); };
  assert.equal(nativeWebSearchCapability(grokSettings), "");
  await assert.rejects(() => requestAiCompletionResult(grokSettings, { ...common, webSearch: true }),
    (error) => error.code === "AI_WEB_SEARCH_UNSUPPORTED");
  await assert.rejects(() => requestAiCompletionResult(grokSettings, { ...common, hasOriginPermissions: async () => false }),
    (error) => error.code === "ORIGIN_PERMISSION_REQUIRED");
  await assert.rejects(() => requestAiCompletionStream(grokSettings, { ...common, apiKey: "" }),
    (error) => error.code === "AI_KEY_MISSING");
  assert.equal(forbiddenCalls, 0, "missing access, credentials, or unsupported web search must fail before contacting xAI");

  globalThis.fetch = async (url, init) => {
    requestUrl = String(url);
    requestHeaders = init.headers;
    requestBody = JSON.parse(init.body);
    return jsonResponse({
      status: "completed",
      output: [{
        type: "message",
        content: [{
          type: "output_text",
          text: "Current fact.",
          annotations: [{
            type: "url_citation",
            start_index: 0,
            end_index: 13,
            url: "https://source.example/current?utm_source=test",
            title: "Current source",
          }],
        }],
      }],
    });
  };
  const openAiWeb = await requestAiCompletionResult(settings, { ...common, webSearch: true });
  assert.equal(nativeWebSearchCapability(settings), "openai_responses");
  assert.deepEqual(requestBody.tools, [{ type: "web_search" }]);
  assert.equal(openAiWeb.sources[0].url, "https://source.example/current?utm_source=test");
  assert.equal(openAiWeb.sources[0].snippet, "Current fact.");

  const geminiSettings = {
    openaiBaseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    openaiApiStyle: "chat_completions",
    openaiSummaryModel: "gemini-3.5-flash",
  };
  globalThis.fetch = async (url, init) => {
    requestUrl = String(url);
    requestHeaders = init.headers;
    requestBody = JSON.parse(init.body);
    return jsonResponse({
      steps: [{
        type: "model_output",
        content: [{
          type: "text",
          text: "Gemini current fact.",
          annotations: [{
            type: "url_citation",
            start_index: 0,
            end_index: 20,
            url: "https://gemini-source.example/current",
            title: "Gemini source",
          }],
        }],
      }],
    });
  };
  const geminiWeb = await requestAiCompletionResult(geminiSettings, { ...common, webSearch: true });
  assert.equal(nativeWebSearchCapability(geminiSettings), "gemini_interactions");
  assert.equal(requestUrl, "https://generativelanguage.googleapis.com/v1beta/interactions");
  assert.equal(requestHeaders["x-goog-api-key"], "fixture-key");
  assert.equal(requestHeaders.authorization, undefined);
  assert.deepEqual(requestBody.tools, [{ type: "google_search" }]);
  assert.equal(geminiWeb.sources[0].url, "https://gemini-source.example/current");
  assert.equal(nativeWebSearchCapability({
    ...geminiSettings,
    openaiSummaryModel: "gemini-embedding-001",
  }), "", "non-generative Gemini models must not expose the search control");

  await assert.rejects(() => requestAiCompletionResult({
    openaiBaseUrl: "https://api.deepseek.com",
    openaiApiStyle: "chat_completions",
    openaiSummaryModel: "deepseek-chat",
  }, { ...common, webSearch: true }), (error) => error.code === "AI_WEB_SEARCH_UNSUPPORTED");
  assert.equal(nativeWebSearchCapability({
    openaiBaseUrl: "https://api.deepseek.com",
    openaiApiStyle: "responses",
    openaiSummaryModel: "deepseek-v4-pro",
  }), "", "DeepSeek Responses compatibility must not be mistaken for provider-hosted web search");
  assert.equal(nativeWebSearchCapability({
    openaiBaseUrl: "https://compatible.example/v1",
    openaiApiStyle: "responses",
    openaiSummaryModel: "gpt-5.4-mini",
  }), "", "unknown Responses-compatible providers must fail closed for hosted web search");
  assert.equal(nativeWebSearchCapability({
    openaiBaseUrl: "https://api.openai.com/v1",
    openaiApiStyle: "responses",
    openaiSummaryModel: "fixture-model",
  }), "", "unknown OpenAI models must not expose web search by default");

  const deltas = [];
  globalThis.fetch = async () => eventStreamResponse([
    'data: {"type":"response.output_text.delta","delta":"Stream "}\n\n',
    'data: {"type":"response.output_text.delta","delta":"answer"}\n\n',
    'data: {"type":"response.completed","response":{"status":"completed"}}\n\n',
  ]);
  const streamed = await requestAiCompletionStream(settings, { ...common, onDelta: (text) => deltas.push(text) });
  assert.deepEqual(streamed, { text: "Stream answer", incomplete: false, finishReason: "stop" });
  assert.deepEqual(deltas, ["Stream ", "answer"]);

  const grokDeltas = [];
  globalThis.fetch = async (_url, init) => {
    requestBody = JSON.parse(init.body);
    return eventStreamResponse([
      'data: {"type":"response.reasoning_summary_text.delta","delta":"Private reasoning"}\n\n',
      'data: {"type":"response.output_text.de',
      'lta","delta":"Grok "}\n\ndata: {"type":"response.output_text.delta","delta":"answer"}\n\n',
      `data: ${JSON.stringify({ type: "response.completed", response: grokResponse })}\n\n`,
    ]);
  };
  assert.deepEqual(await requestAiCompletionStream(grokSettings, { ...common, onDelta: (text) => grokDeltas.push(text) }), grokResult);
  assert.deepEqual(grokDeltas, ["Grok ", "answer"], "streamed reasoning and completed output must not leak or duplicate text");
  assert.equal(requestBody.stream, true);
  assert.equal(requestBody.store, false);
  assert.deepEqual(requestBody.reasoning, { effort: "low" });
  assert.deepEqual(requestBody.input, [{ role: "system", content: "System" }, ...common.messages]);

  globalThis.fetch = async () => eventStreamResponse([
    'data: {"type":"response.output_text.delta","delta":"Partial Grok answer"}\n\n',
    'data: {"type":"response.incomplete","response":{"status":"incomplete","incomplete_details":{"reason":"max_output_tokens"}}}\n\n',
  ]);
  assert.deepEqual(await requestAiCompletionStream(grokSettings, common), {
    text: "Partial Grok answer", incomplete: true, finishReason: "length",
  });
  globalThis.fetch = async () => eventStreamResponse([
    'data: {"type":"response.failed","response":{"error":{"code":"fixture_failure","message":"Generation failed"}}}\n\n',
  ]);
  await assert.rejects(() => requestAiCompletionStream(grokSettings, common), (error) => error.code === "AI_STREAM_ERROR");

  const chatSettings = { ...settings, openaiApiStyle: "chat_completions" };
  globalThis.fetch = async (_url, init) => {
    requestBody = JSON.parse(init.body);
    return eventStreamResponse([
      'data: {"choices":[{"delta":{"content":"Chat"},"finish_reason":null}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
    ]);
  };
  assert.equal((await requestAiCompletionStream(chatSettings, common)).text, "Chat");
  assert.deepEqual(requestBody.messages.map(({ role }) => role), ["system", "user", "assistant", "user"], "Chat Completions must receive native role order");

  globalThis.fetch = async () => jsonResponse({ output_text: "JSON compatibility", status: "completed" });
  assert.equal((await requestAiCompletionStream(settings, common)).text, "JSON compatibility", "a JSON response to a streaming request must complete without replaying the request");
  const grokJsonDeltas = [];
  globalThis.fetch = async () => jsonResponse(grokResponse);
  assert.deepEqual(await requestAiCompletionStream(grokSettings, { ...common, onDelta: (text) => grokJsonDeltas.push(text) }), grokResult);
  assert.deepEqual(grokJsonDeltas, ["Grok answer"]);

  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return calls === 1
      ? jsonResponse({ error: { message: "Streaming is not supported" } }, 400)
      : jsonResponse({ output_text: "Non-stream fallback", status: "completed" });
  };
  assert.equal((await requestAiCompletionStream(settings, common)).text, "Non-stream fallback");
  assert.equal(calls, 2, "a provider that explicitly rejects streaming may retry once without stream mode before any delta");

  for (const providerSettings of [settings, grokSettings, kimiSettings]) {
    for (const status of [401, 429]) {
      globalThis.fetch = async () => jsonResponse({ error: { message: "Provider error" } }, status);
      await assert.rejects(() => requestAiCompletionStream(providerSettings, common),
        (error) => error.code === "AI_HTTP_ERROR" && error.retryable === (status === 429));
    }
    const controller = new AbortController();
    globalThis.fetch = async (_url, init) => new Promise((_resolve, reject) => {
      if (init.signal.aborted) {
        reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        return;
      }
      init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true });
    });
    const cancelled = requestAiCompletionStream(providerSettings, { ...common, signal: controller.signal });
    controller.abort();
    await assert.rejects(cancelled, (error) => error.name === "AbortError");
  }
} finally {
  globalThis.fetch = originalFetch;
}

console.log("AI stream tests passed");

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function eventStreamResponse(chunks) {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  }), { headers: { "content-type": "text/event-stream" } });
}
