import assert from "node:assert/strict";
import { requestAiCompletion, requestAiCompletionStream } from "../../extension/core/ai.mjs";
import { DEFAULT_SETTINGS } from "../../extension/core/constants.mjs";

const oldFetch = globalThis.fetch;
try {
  for (const providerError of [
    { code: "unsupported_country_region_territory" },
    { type: "unsupported_country_region_territory" },
    { code: "unknown-provider-code", message: "Do not display synthetic-private-response" },
  ]) {
    globalThis.fetch = async () => new Response(JSON.stringify({ error: providerError }), {
      status: 403, headers: { "content-type": "application/json" },
    });
    for (const send of [requestAiCompletion, requestAiCompletionStream]) {
      await assert.rejects(send(DEFAULT_SETTINGS, {
        apiKey: "synthetic-ai-key", input: "synthetic input", maxTokens: 40, hasOriginPermission: async () => true,
      }), error => {
        assert.equal(error.code, "AI_HTTP_ERROR");
        assert.equal(error.retryable, false);
        assert.equal(error.messageKey, Object.values(providerError).includes("unsupported_country_region_territory")
          ? "background.error.aiRegionUnsupported" : "background.error.aiForbidden");
        assert.equal(error.message.includes("synthetic-private-response"), false);
        assert.deepEqual(error.messageParams, { status: 403 });
        return true;
      });
    }
  }
} finally { globalThis.fetch = oldFetch; }
console.log("AI forbidden response diagnosis tests passed");
