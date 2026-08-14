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

  let requestUrl = "";
  let requestHeaders = null;
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

  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return calls === 1
      ? jsonResponse({ error: { message: "Streaming is not supported" } }, 400)
      : jsonResponse({ output_text: "Non-stream fallback", status: "completed" });
  };
  assert.equal((await requestAiCompletionStream(settings, common)).text, "Non-stream fallback");
  assert.equal(calls, 2, "a provider that explicitly rejects streaming may retry once without stream mode before any delta");

  globalThis.fetch = async () => jsonResponse({ error: { message: "Rate limited" } }, 429);
  await assert.rejects(() => requestAiCompletionStream(settings, common), (error) => error.code === "AI_HTTP_ERROR" && error.retryable === true);

  const controller = new AbortController();
  globalThis.fetch = async (_url, init) => new Promise((_resolve, reject) => {
    if (init.signal.aborted) {
      reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
      return;
    }
    init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true });
  });
  const cancelled = requestAiCompletionStream(settings, { ...common, signal: controller.signal });
  controller.abort();
  await assert.rejects(cancelled, (error) => error.name === "AbortError");
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
