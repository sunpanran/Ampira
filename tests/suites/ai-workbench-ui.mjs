import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import en from "../../assets/client/locales/en.mjs";
import zhCN from "../../assets/client/locales/zh-CN.mjs";
import zhHant from "../../assets/client/locales/zh-Hant.mjs";
import { requestAiSearchWithStreamFallback } from "../../assets/client/ai-search-ui.mjs";

const ui = readFileSync(new URL("../../assets/client/ai-search-ui.mjs", import.meta.url), "utf8");
const streamClient = readFileSync(new URL("../../assets/client/ai-stream-client.mjs", import.meta.url), "utf8");
const html = readFileSync(new URL("../../dashboard.html", import.meta.url), "utf8");
const css = readFileSync(new URL("../../assets/styles/overlays.css", import.meta.url), "utf8");

assert(html.includes('maxlength="8000"'));
assert(html.includes('id="aiSearchEditState"') && html.includes('id="cancelAiSearchEdit"'));
assert(ui.includes("options.streamClient.start(payload") && ui.includes("options.streamClient?.cancel(activeStreamRequestId)"));
assert(ui.includes('text: ""') && ui.includes("pendingAnswer.hasStreamedText"), "loading copy must never become the failed answer body");
assert(ui.includes('status: "stopped"') && ui.includes('cachePolicy: "bypass"'));
assert(ui.includes("truncateConversationForEdit(editingMessageId)") && ui.includes("session.messages.splice(index)"));
assert(ui.includes('t("aiSearch.continueGeneration"') || ui.includes('"aiSearch.continueGeneration"'));
assert(ui.includes("replaceAnswer: model"), "research authorization and continuation must refresh the existing answer in place");
assert(ui.includes("transcriptIsNearEnd()") && ui.includes("if (stickToEnd) scrollTranscriptToEnd()"), "stream updates must follow only when the reader was already near the end");
assert(streamClient.includes('name: "ampira:ai-stream"') && streamClient.includes('type: "cancel"'));
assert(css.includes(".ai-markdown-code") && css.includes(".ai-markdown-table-wrap"));
assert(css.includes("overflow-x: auto") && css.includes("max-width: 100%"));
assert(css.includes("scrollbar-gutter: stable;") && !css.includes("scrollbar-gutter: stable both-edges;"));
assert(html.includes('class="ai-search-form is-plain-composer"')
  && css.includes(".ai-search-form.is-plain-composer .ai-search-composer-foot")
  && css.includes("align-self: center;")
  && ui.includes("syncComposerToolsLayout();"),
"the composer must have a compact no-tools state while preserving the same textarea and submit DOM");

const requiredKeys = [
  "aiSearch.stop", "aiSearch.retry", "aiSearch.regenerate", "aiSearch.editMessage",
  "aiSearch.cancelEdit", "aiSearch.continueGeneration", "aiSearch.copyCode",
  "aiSearch.codeCopied", "aiSearch.message.stopped", "aiSearch.message.incomplete",
];
for (const key of requiredKeys) {
  assert.equal(typeof zhCN[key], "string", `zh-CN must include ${key}`);
  assert.equal(typeof zhHant[key], "string", `zh-Hant must include ${key}`);
  assert.equal(typeof en[key], "string", `en must include ${key}`);
}

let fallbackCalls = 0;
const disconnectedResult = await requestAiSearchWithStreamFallback({ query: "hello" }, {
  streamClient: fakeStreamClient({ errorCode: "AI_STREAM_DISCONNECTED" }),
  fallbackRequest: async (payload) => {
    fallbackCalls += 1;
    assert.equal(payload.query, "hello");
    return { ok: true, answer: "fallback" };
  },
});
assert.equal(disconnectedResult.answer, "fallback");
assert.equal(fallbackCalls, 1, "a disconnected stream before output must retry once through the compatible request path");

fallbackCalls = 0;
await assert.rejects(() => requestAiSearchWithStreamFallback({ query: "hello" }, {
  streamClient: fakeStreamClient({ errorCode: "AI_STREAM_DISCONNECTED", delta: "partial" }),
  fallbackRequest: async () => { fallbackCalls += 1; },
}), (error) => error.code === "AI_STREAM_DISCONNECTED");
assert.equal(fallbackCalls, 0, "a disconnected stream after output must not replay the request");

fallbackCalls = 0;
await assert.rejects(() => requestAiSearchWithStreamFallback({ query: "hello" }, {
  streamClient: fakeStreamClient({ errorCode: "AI_HTTP_ERROR" }),
  fallbackRequest: async () => { fallbackCalls += 1; },
}), (error) => error.code === "AI_HTTP_ERROR");
assert.equal(fallbackCalls, 0, "provider errors must remain visible instead of being retried as transport failures");

console.log("AI workbench UI tests passed");

function fakeStreamClient({ errorCode, delta = "" }) {
  return {
    start(_payload, callbacks) {
      if (delta) callbacks.onDelta?.(delta);
      return {
        requestId: "stream-test",
        result: Promise.reject(Object.assign(new Error(errorCode), { code: errorCode })),
      };
    },
  };
}
