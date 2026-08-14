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
  let efficiencyRenderCount = 0;
  let activityRenderCount = 0;
  const controller = createActivityController({
    state,
    itemUrl: (item) => item.url,
    openExternalWindow() {},
    openExternal() {},
    renderAll() { renderCount += 1; },
    renderEfficiencyPanel() { efficiencyRenderCount += 1; },
    renderActivitySurfaces() { activityRenderCount += 1; },
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
    createThemedIcon: (name) => createFakeThemedIcon(name),
    srOnly: (label) => ({ className: "sr-only", textContent: label }),
    writeJson,
    readJson,
    apiPost: async () => ({}),
  });
  const item = { key: "news-1", cardType: "news", title: "Item", url: "https://example.com/item" };
  state.opened.add(item.key);
  const queueButton = createQueueButton(item.key);
  const seenSurface = createStateSurface(["link-row", "opened"]);
  const seenButton = createSeenButton(item.key, seenSurface);
  const summaryThumb = { tagName: "IMG" };
  const summarySurface = createStateSurface(["summary-card", "opened"], summaryThumb);
  const summarySeenButton = createSeenButton(item.key, summarySurface);

  const previousDocument = globalThis.document;
  globalThis.document = {
    querySelectorAll(selector) {
      if (selector === "[data-reading-queue-key]") return [queueButton];
      if (selector === "[data-seen-key]") return [seenButton, summarySeenButton];
      return [];
    },
  };
  try {
    controller.toggleReadingQueue(item);
    assert(createActivityStore({ readJson, day }).readingQueue.has(item.key), "reading queue changes must survive hydration");
    assert.equal(queueButton.replaceCount, 0, "queue state changes must update the existing icon instead of rebuilding the button");
    const renderCountBeforeEcho = renderCount;
    const efficiencyCountBeforeEcho = efficiencyRenderCount;
    controller.applyReadingQueueUpdate([{
      key: item.key,
      ...(state.readingQueueMeta.get(item.key) || {}),
    }]);
    assert.equal(renderCount, renderCountBeforeEcho, "the local persistence echo must not redraw image cards");
    assert.equal(efficiencyRenderCount, efficiencyCountBeforeEcho, "an identical persistence echo must be a complete no-op");
    controller.toggleSeen(item, true, "news");
    assert.equal(seenButton.getAttribute("aria-pressed"), "true", "archive state must update the existing action control before any surface reconciliation");
    assert(seenButton.classList.contains("is-seen"), "bookmark seen controls must immediately reflect their active visual state");
    assert.equal(seenButton.replaceCount, 0, "archive state must not rebuild the live icon node");
    assert(seenSurface.classList.contains("seen"), "marking an item seen must immediately update its existing bookmark row");
    assert(!seenSurface.classList.contains("opened"), "seen styling must take precedence over opened styling without a full redraw");
    assert(summarySurface.classList.contains("seen"), "marking an item seen must update the existing SIGNAL FEED card");
    assert(!summarySurface.classList.contains("opened"), "SIGNAL FEED seen styling must replace opened styling in place");
    assert.equal(summarySurface.thumb, summaryThumb, "marking an item seen must retain the decoded SIGNAL FEED thumbnail node");
    const hydrated = createActivityStore({ readJson, day });
    assert(hydrated.seen.has(item.key), "seen changes must survive hydration");
    assert(!hydrated.readingQueue.has(item.key), "marking an item seen must persistently remove it from the reading queue");
    controller.applyReadingQueueUpdate([{ ...item, source: "news" }], [item.key]);
    assert(state.readingQueue.has(item.key), "runtime queue updates must replace the live reading queue");
    assert.equal(state.readingQueueMeta.get(item.key)?.url, item.url);
    assert(!state.seen.has(item.key), "reopened runtime queue items must leave the live seen set");
    assert(!seenButton.classList.contains("is-seen"), "reopened bookmark controls must immediately clear their active visual state");
    assert(!seenSurface.classList.contains("seen"), "reopened items must immediately clear stale seen styling");
    assert(seenSurface.classList.contains("opened"), "reopened items must restore their existing opened styling");
    assert(!summarySurface.classList.contains("seen"), "reopened SIGNAL FEED cards must immediately clear stale seen styling");
    assert(summarySurface.classList.contains("opened"), "reopened SIGNAL FEED cards must restore opened styling in place");
    assert.equal(summarySurface.thumb, summaryThumb, "reopening an item must retain the decoded SIGNAL FEED thumbnail node");
    assert(activityRenderCount > 0, "runtime queue updates must redraw the affected activity surfaces");
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
}

function createQueueButton(key, initialClasses = ["action-toggle"]) {
  const classes = new Set(initialClasses);
  const attributes = new Map();
  const icon = createFakeThemedIcon("bookmark-ribbon");
  const label = { className: "sr-only", textContent: "action.addReadingQueue" };
  return {
    dataset: { readingQueueKey: key },
    icon,
    label,
    replaceCount: 0,
    classList: {
      contains(name) { return classes.has(name); },
      toggle(name, active) {
        if (active) classes.add(name);
        else classes.delete(name);
      },
    },
    querySelector(selector) {
      if (selector.includes("action-toggle-icon")) return icon;
      if (selector.includes("sr-only")) return label;
      return null;
    },
    replaceChildren() { this.replaceCount += 1; },
    getAttribute(name) { return attributes.get(name) ?? null; },
    setAttribute(name, value) { attributes.set(name, String(value)); },
  };
}

function createSeenButton(key, surface) {
  const button = createQueueButton(key, ["seen-toggle"]);
  button.dataset = {
    seenKey: key,
    seenUncheckedLabel: "action.markRead",
    seenCheckedLabel: "action.unmarkRead",
  };
  button.closest = (selector) => surface.matches(selector) ? surface : null;
  return button;
}

function createStateSurface(initialClasses = [], thumb = null) {
  const classes = new Set(initialClasses);
  return {
    thumb,
    classList: {
      contains(name) { return classes.has(name); },
      toggle(name, active) {
        if (active) classes.add(name);
        else classes.delete(name);
      },
    },
    matches(selector) {
      return [...classes].some((name) => selector.includes(`.${name}`));
    },
  };
}

function createFakeThemedIcon(name) {
  const properties = new Map([["--themed-icon-mask", `url(${name})`]]);
  return {
    className: `action-toggle-icon themed-icon icon-${name}`,
    style: {
      getPropertyValue(property) { return properties.get(property) || ""; },
      setProperty(property, value) { properties.set(property, value); },
    },
  };
}
