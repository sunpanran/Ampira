import assert from "node:assert/strict";
import { createBrowserSearchService } from "../../extension/runtime/browser-search-service.mjs";

const calls = [];
let granted = true;
let queryError = null;
const service = createBrowserSearchService({
  chrome: {
    permissions: {
      async contains(details) {
        assert.deepEqual(details, { permissions: ["search"] });
        return granted;
      },
    },
    search: {
      async query(details) {
        if (queryError) throw queryError;
        calls.push(details);
      },
    },
  },
  typedError(code, messageKey, messageParams = {}, retryable = false) {
    return Object.assign(new Error(code), { code, messageKey, messageParams, retryable });
  },
});

assert.equal(await service.enabled(), true);
assert.deepEqual(await service.search({ query: "  Ampira browser search  " }, { tab: { id: 42 } }), { submitted: true });
assert.deepEqual(calls, [{ text: "Ampira browser search", tabId: 42 }], "browser search must use the exact calling tab and trimmed query");

await assert.rejects(service.search({ query: "" }, { tab: { id: 42 } }), (error) => error.code === "BROWSER_SEARCH_REQUIRED");
await assert.rejects(
  service.search({ query: "Ampira" }, {}),
  (error) => error.code === "BROWSER_SEARCH_UNAVAILABLE",
  "background search must not replace an unrelated active tab when the sender has no tab",
);

granted = false;
assert.equal(await service.enabled(), false);
await assert.rejects(
  service.search({ query: "Ampira" }, { tab: { id: 42 } }),
  (error) => error.code === "BROWSER_SEARCH_PERMISSION_REQUIRED",
);

granted = true;
queryError = new Error("provider unavailable");
await assert.rejects(
  service.search({ query: "Ampira" }, { tab: { id: 42 } }),
  (error) => error.code === "BROWSER_SEARCH_FAILED"
    && error.retryable === true
    && error.messageParams.message === "provider unavailable",
);
