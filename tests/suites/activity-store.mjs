import assert from "node:assert/strict";
import { createActivityStore } from "../../assets/client/activity-store.mjs";
import { createActivityController } from "../../assets/client/activity-controller.mjs";

export function runActivityStoreTests() {
  const values = new Map();
  const readJson = (key, fallback) => {
    try { return values.has(key) ? JSON.parse(values.get(key)) : fallback; } catch { return fallback; }
  };
  const writeJson = (key, value) => values.set(key, JSON.stringify(value));
  const day = "2026-07-13";
  const state = {
    ...createActivityStore({ readJson, day }),
    day,
    query: "",
    data: { bookmarks: [], feed: { items: [] } },
    settings: {},
  };
  let renderCount = 0;
  const controller = createActivityController({
    state,
    itemUrl: (item) => item.url,
    openExternalWindow() {},
    openExternal() {},
    renderAll() { renderCount += 1; },
    renderEfficiencyPanel() {},
    newsSummaryItems: () => [],
    hostFromUrl: () => "example.com",
    t: (key) => key,
    newsSectionName: () => "News",
    newsCardType: "news",
    findNewsItemReference: () => null,
    isNewsCard: (item) => item.cardType === "news",
    displaySummaryTitle: (item) => item.title,
    displayTitle: (item) => item.title,
    displayBookmarkTitle: (item) => item.title,
    summaryText: () => "",
    createThemedIcon: () => ({}),
    srOnly: () => ({}),
    writeJson,
    readJson,
    apiPost: async () => ({}),
  });
  const item = { key: "news-1", cardType: "news", title: "Item", url: "https://example.com/item" };

  const previousDocument = globalThis.document;
  globalThis.document = { querySelectorAll: () => [] };
  try {
    controller.toggleReadingQueue(item);
    assert(createActivityStore({ readJson, day }).readingQueue.has(item.key), "reading queue changes must survive hydration");
    controller.toggleSeen(item, true, "news");
    const hydrated = createActivityStore({ readJson, day });
    assert(hydrated.seen.has(item.key), "seen changes must survive hydration");
    assert(!hydrated.readingQueue.has(item.key), "marking an item seen must persistently remove it from the reading queue");
    controller.applyReadingQueueUpdate([{ ...item, source: "news" }], [item.key]);
    assert(state.readingQueue.has(item.key), "runtime queue updates must replace the live reading queue");
    assert.equal(state.readingQueueMeta.get(item.key)?.url, item.url);
    assert(!state.seen.has(item.key), "reopened runtime queue items must leave the live seen set");
    assert(renderCount > 0, "runtime queue updates must redraw the dashboard");
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
}
