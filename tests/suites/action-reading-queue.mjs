import assert from "node:assert/strict";
import { createClientStateStore } from "../../extension/core/client-state.mjs";
import {
  READING_QUEUE_LIMIT,
  addCapturedPage,
  capturedPageRecord,
  normalizeCapturedPageUrl,
  removeSeenPage,
} from "../../extension/core/reading-queue.mjs";
import { createActionReadingQueueService } from "../../extension/runtime/action-reading-queue-service.mjs";

const now = new Date("2026-07-14T08:00:00.000Z");
const captured = capturedPageRecord({
  id: 7,
  title: "  Example   story  ",
  url: "https://www.example.com/story?edition=1#details",
}, now);
assert.equal(captured.url, "https://www.example.com/story?edition=1");
assert.equal(captured.title, "Example story");
assert.equal(captured.host, "example.com");
assert.equal(captured.source, "bookmark");
assert.equal(captured.addedAt, now.toISOString());
assert.equal(normalizeCapturedPageUrl("http://localhost:3000/story#part"), "http://localhost:3000/story");
assert.equal(normalizeCapturedPageUrl("http://127.0.0.1/story"), "http://127.0.0.1/story");
for (const value of [
  "http://example.com/story",
  "chrome://settings/",
  "file:///tmp/story.html",
  "https://user:password@example.com/story",
  `https://example.com/${"x".repeat(2050)}`,
]) assert.equal(normalizeCapturedPageUrl(value), "", `captured page must reject ${value.slice(0, 80)}`);

const existingFeedRecord = {
  key: "article-existing",
  source: "news",
  title: "Existing",
  url: "https://www.example.com/story?edition=1#old",
};
const duplicate = addCapturedPage([existingFeedRecord], captured);
assert.equal(duplicate.status, "already");
assert.deepEqual(duplicate.records, [existingFeedRecord]);

const overflow = addCapturedPage(Array.from({ length: READING_QUEUE_LIMIT }, (_, index) => ({
  key: `bookmark-${index}`,
  source: "bookmark",
  title: String(index),
  url: `https://example.com/${index}`,
})), captured);
assert.equal(overflow.records.length, READING_QUEUE_LIMIT);
assert(!overflow.records.some((record) => record.key === "bookmark-0"));
assert.equal(overflow.records.at(-1).key, captured.key);

const seenRemoval = removeSeenPage([
  { key: "article-seen", source: "news", url: "https://www.example.com/story?edition=1#section" },
  { key: "bookmark-other", source: "bookmark", url: "https://example.com/other" },
], captured);
assert.deepEqual(seenRemoval.removedKeys, ["article-seen"]);
assert.deepEqual(seenRemoval.records.map((record) => record.key), ["bookmark-other"]);

const queueState = {
  "dash.readingQueue": "[]",
  "dash.seen.2026-07-14": JSON.stringify([{ key: captured.key, source: "bookmark", url: captured.url }]),
  "dash.seen.retained": JSON.stringify([{ key: "article-seen", source: "news", url: `${captured.url}#old` }]),
};
const feedback = [];
const broadcasts = [];
const syncPatches = [];
const actionChrome = {
  action: {
    async setBadgeBackgroundColor(details) { feedback.push(["color", details]); },
    async setBadgeText(details) { feedback.push(["badge", details]); },
    async setTitle(details) { feedback.push(["title", details]); },
  },
  i18n: { getMessage: () => "Add current page to Read later" },
};
const actionStore = createClientStateStore({
  async getRecord() { return { ...queueState }; },
  async setRecord(key, value) { Object.assign(queueState, value); },
});
const service = createActionReadingQueueService({
  chrome: actionChrome,
  clientStateStore: actionStore,
  contentSyncService: {
    async initialize() {},
    async handleLocalPatch(values) { syncPatches.push(values); },
  },
  getSettings: async () => ({ uiLocale: "en" }),
  settingsLocale: (settings) => settings.uiLocale || "en",
  translate: (locale, key) => `${locale}:${key}`,
  localDateKey: () => "2026-07-14",
  broadcast: (type, payload) => broadcasts.push({ type, payload }),
  now: () => now,
});

const added = await service.handleActionClicked({ id: 7, title: captured.title, url: `${captured.url}#details` });
assert.equal(added.status, "added");
assert.deepEqual(added.reopenedKeys.sort(), [captured.key, "article-seen"].sort());
assert.equal(JSON.parse(queueState["dash.readingQueue"]).length, 1);
assert.deepEqual(JSON.parse(queueState["dash.seen.2026-07-14"]), []);
assert.deepEqual(JSON.parse(queueState["dash.seen.retained"]), []);
assert.equal(broadcasts.at(-1).type, "reading-queue.changed");
assert.deepEqual(syncPatches.at(-1), { "dash.readingQueue": queueState["dash.readingQueue"] });
assert(feedback.some(([type, details]) => type === "badge" && details.text === "✓" && details.tabId === 7));
assert(feedback.some(([type, details]) => type === "title" && details.title === "en:action.captureAdded"));

feedback.length = 0;
const already = await service.handleActionClicked({ id: 7, title: captured.title, url: captured.url });
assert.equal(already.status, "already");
assert.equal(JSON.parse(queueState["dash.readingQueue"]).length, 1);
assert(feedback.some(([type, details]) => type === "title" && details.title === "en:action.captureAlreadyQueued"));

feedback.length = 0;
const unsupported = await service.handleActionClicked({ id: 9, title: "Settings", url: "chrome://settings/" });
assert.equal(unsupported.status, "unsupported");
assert(feedback.some(([type, details]) => type === "badge" && details.text === "!" && details.tabId === 9));
assert(feedback.some(([type, details]) => type === "color" && details.color === "#F4C95D"));
assert(feedback.some(([type, details]) => type === "title" && details.title === "en:action.captureUnsupported"));

await service.resetActionFeedback(7);
assert(feedback.some(([type, details]) => type === "badge" && details.text === ""));
assert(feedback.some(([type, details]) => type === "title" && details.title === "Add current page to Read later"));

const failedFeedback = [];
const failedService = createActionReadingQueueService({
  chrome: {
    action: {
      async setBadgeBackgroundColor(details) { failedFeedback.push(["color", details]); },
      async setBadgeText(details) { failedFeedback.push(["badge", details]); },
      async setTitle(details) { failedFeedback.push(["title", details]); },
    },
    i18n: { getMessage: () => "Add current page to Read later" },
  },
  clientStateStore: { async mutate() { throw new Error("write failed"); } },
  getSettings: async () => ({ uiLocale: "en" }),
  settingsLocale: () => "en",
  translate: (locale, key) => key,
  localDateKey: () => "2026-07-14",
  broadcast: () => assert.fail("failed queue writes must not broadcast"),
  now: () => now,
});
assert.equal((await failedService.handleActionClicked({ id: 11, title: "Story", url: captured.url })).status, "failed");
assert(failedFeedback.some(([type, details]) => type === "badge" && details.text === "!"));
assert(failedFeedback.some(([type, details]) => type === "title" && details.title === "action.captureFailed"));

console.log("action reading queue tests passed");
