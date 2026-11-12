import assert from "node:assert/strict";

const names = ["chrome", "location", "document", "window", "navigator"];
const previous = names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]);
const define = (name, value) => Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
try {
  const sent = [];
  define("location", { protocol: "chrome-extension:" });
  define("document", { documentElement: { dataset: {} }, querySelectorAll: () => [], dispatchEvent() {}, addEventListener() {} });
  define("window", { dispatchEvent() {}, addEventListener() {} });
  define("navigator", { languages: ["en"], language: "en" });
  define("chrome", { runtime: { id: "synthetic", sendMessage: async request => { sent.push(request); return { ok: true, data: {} }; } } });
  const { apiPost } = await import("../../assets/client/api.mjs");
  await apiPost("/api/refresh?force=1");
  assert.equal(sent[0].type, "refresh:start");
  assert.equal(sent[0].payload.force, true, "explicit refresh must retain the parsed force flag at the runtime boundary");
  await apiPost("/api/refresh?force=1", { force: false });
  assert.equal(sent[1].payload.force, false, "an explicit body may override a route default");
  await apiPost("/api/bot/organization", { enabled: true });
  assert.equal(sent[2].type, "bot:organization");
  assert.deepEqual(sent[2].payload, { enabled: true });
} finally {
  for (const [name, descriptor] of previous) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name];
  }
}
console.log("API routing tests passed");
