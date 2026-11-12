import assert from "node:assert/strict";
import { createExtensionRuntime } from "../../extension/runtime/extension-runtime.mjs";

function event() {
  const listeners = new Set();
  return { listeners, addListener: listener => listeners.add(listener), emit: payload => {
    for (const listener of listeners) listener(payload);
  } };
}

function harness(historyAvailable) {
  const messages = [], removed = event();
  let historyQueries = 0;
  const history = { onVisitRemoved: removed, async search() { historyQueries += 1; return []; } };
  const storage = { async get() { return {}; }, async set() {}, async remove() {}, async clear() {} };
  const chrome = {
    storage: { local: storage, sync: storage, onChanged: event() },
    bookmarks: { async getTree() { return []; } },
    permissions: { onAdded: event(), onRemoved: event(), async getAll() { return { origins: [] }; }, async contains() { return false; } },
    runtime: {
      getURL: value => `chrome-extension://${"a".repeat(32)}/${value.replace(/^\//, "")}`,
      onInstalled: event(), onStartup: event(), onMessage: event(), onConnect: event(),
      async sendMessage(message) { messages.push(message); },
    },
    tabs: { onUpdated: event() },
    // Isolate event registration from unrelated cache/startup maintenance.
    alarms: { onAlarm: event(), async create() { throw new Error("Startup maintenance disabled in this fixture"); } },
    ...(historyAvailable ? { history } : {}),
  };
  const runtime = createExtensionRuntime({ chrome });
  runtime.start();
  return { chrome, runtime, messages, removed, history, historyQueries: () => historyQueries };
}

for (const initiallyGranted of [false, true]) {
  const h = harness(initiallyGranted);
  assert.equal(h.removed.listeners.size, Number(initiallyGranted), "startup registers history deletion only when its API exists");
  assert.doesNotThrow(() => h.chrome.permissions.onAdded.emit({ permissions: ["favicon"] }),
    "granting an unrelated permission must not throw or require the history API");
  assert(h.messages.some(message => message.type === "settings.changed" && message.payload.permissionsChanged),
    "permission processing must continue past history listener registration");
  h.chrome.history = h.history;
  h.chrome.permissions.onAdded.emit({ permissions: ["history"] });
  h.chrome.permissions.onAdded.emit({ permissions: ["history"] });
  h.runtime.start();
  assert.equal(h.removed.listeners.size, 1, "late grants and repeated events must register exactly one deletion listener");
  h.messages.length = 0;
  h.removed.emit({ allHistory: true });
  assert.equal(h.messages.length, 1);
  assert.equal(h.messages[0].type, "search.invalidated");
  assert.equal(h.messages[0].payload.reason, "history-removed", "history deletion must invalidate displayed search results");
  assert.equal(h.historyQueries(), 0, "permission/deletion events must never inspect browsing history");
}

console.log("History permission callback and invalidation tests passed");
