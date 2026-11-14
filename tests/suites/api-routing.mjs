import assert from "node:assert/strict";

const names = ["chrome", "location", "document", "window", "navigator", "fetch"];
const previous = names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]);
const define = (name, value) => Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
try {
  const sent = [], events = [];
  let listener, result = { ok: true, data: { saved: true } };
  define("location", { protocol: "chrome-extension:" });
  define("document", { documentElement: { dataset: {} }, querySelectorAll: () => [], dispatchEvent() {}, addEventListener() {} });
  define("window", { dispatchEvent: event => events.push(event), addEventListener() {} });
  define("navigator", { languages: ["en"], language: "en" });
  define("fetch", () => assert.fail("message requests must never fall back to HTTP"));
  define("chrome", { runtime: {
    id: "synthetic",
    sendMessage: async message => { sent.push(message); return result; },
    onMessage: { addListener: handler => { listener = handler; }, removeListener() {} },
  } });
  const { sendExtensionRequest: request } = await import("../../assets/client/api.mjs");
  for (const message of [
    { type: "settings:save", payload: { colorMode: "dark" } },
    { type: "refresh:start", payload: { force: true, automatic: false } },
    { type: "refresh:start", payload: { force: false, automatic: true } },
    { type: "search:query", payload: { query: "TCP & UDP" } },
    { type: "reader:get", payload: { url: "https://example.com/article?a=1&b=中文" } },
    { type: "preview:get", payload: { url: "https://example.com/", profile: "article", mode: "brave-only" } },
    { type: "bot:organization", payload: { enabled: true } },
    { type: "header-cover:get" },
    { type: "settings:export" },
    { type: "settings:import", payload: { config: { formatVersion: 1 } } },
    { type: "personal-cards:get", payload: { kind: "focus" } },
    { type: "personal-cards:change", payload: { kind: "topics", action: { type: "read", keys: ["fixture"] } } },
  ]) {
    assert.deepEqual(await request(message), { saved: true });
    const { requestId, ...actual } = sent.at(-1);
    assert.match(requestId, /^[0-9a-f-]{36}$/i);
    assert.deepEqual(actual, message);
  }
  assert.equal(new Set(sent.map(message => message.requestId)).size, sent.length);
  result = { ok: false, error: { code: "RETRY", messageKey: "api.noResponse", retryable: true, details: { retryAfter: 10 } } };
  await assert.rejects(request({ type: "settings:get" }), error =>
    error.code === "RETRY" && error.retryable && error.messageKey === "api.noResponse"
    && error.message !== error.messageKey && error.details.retryAfter === 10);
  result = undefined;
  await assert.rejects(request({ type: "settings:get" }), { code: "EXTENSION_ERROR" });
  listener({ type: "settings.changed", payload: { changed: true } });
  listener({ type: "personal-cards.changed", payload: { values: { "dash.focus.state.v1": "{}" } } });
  listener({ type: "unrelated.message" });
  assert.equal(events.length, 2);
  assert.equal(events[0].type, "ampira:runtime-message");
  assert.deepEqual(events[0].detail, { type: "settings.changed", payload: { changed: true } });
  assert.equal(events[1].detail.type, "personal-cards.changed");
  globalThis.location.protocol = "file:";
  await assert.rejects(request({ type: "settings:get" }));
} finally {
  for (const [name, descriptor] of previous) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name];
  }
}
console.log("Runtime client request tests passed");
