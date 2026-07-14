import assert from "node:assert/strict";
import { createClientStateStore } from "../../extension/core/client-state.mjs";
import {
  READING_QUEUE_LIMIT,
  normalizeReadingQueueRecords,
} from "../../extension/core/reading-queue.mjs";

const normalized = normalizeReadingQueueRecords(Array.from({ length: READING_QUEUE_LIMIT + 1 }, (_, index) => ({
  key: `bookmark-${index}`,
  source: "bookmark",
  title: `  Item   ${index}  `,
  url: `https://example.com/${index}`,
})));
assert.equal(normalized.length, READING_QUEUE_LIMIT);
assert.equal(normalized[0].key, "bookmark-1");
assert.equal(normalized[0].title, "Item 1");
assert.deepEqual(normalizeReadingQueueRecords("not-json"), []);

let serializedState = { "dash.counter": "0" };
const serializedStore = createClientStateStore({
  async getRecord() { return { ...serializedState }; },
  async setRecord(key, value) {
    assert.equal(key, "client-state");
    serializedState = value;
  },
});
await Promise.all([1, 2, 3].map(() => serializedStore.mutate((state) => {
  const next = Number(state["dash.counter"] || 0) + 1;
  return { values: { "dash.counter": String(next) }, result: next };
})));
assert.equal(serializedState["dash.counter"], "3", "client-state mutations must serialize read-modify-write operations");

console.log("reading queue tests passed");
