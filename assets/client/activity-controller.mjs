import { normalizeReadingQueueRecords } from "../../extension/core/reading-queue.mjs";

const READING_QUEUE_STORAGE_KEY = "dash.readingQueue";
const OPENED_STORAGE_KEY = "dash.opened";
const DISMISSED_STORAGE_KEY = "dash.dismissed";
const RETAINED_SEEN_STORAGE_KEY = "dash.seen.retained";
const ACTION_RECORD_LIMIT = 150;

export function createActivityController(options) {
  let seenRetentionMode = null;
  const {
    state, itemUrl, openExternalWindow, openExternal, renderAll, renderEfficiencyPanel,
    newsSummaryItems, hostFromUrl, t, newsSectionName, newsCardType, findNewsItemReference,
    isNewsCard, displaySummaryTitle, displayTitle, displayBookmarkTitle, createThemedIcon,
    summaryText, srOnly, writeJson, readJson, apiPost,
  } = options;
  return {
    readingQueueItems, openAndMarkReadingQueue, findNewsItemByReference, isQueued,
    actionKey, toggleReadingQueue, openDailyItem, openSummaryItem, matchesQuery, toggleSeen,
    markOpenedItem, dismissItem, sendFeedback, retainSeenArchiveEnabled,
    syncSeenArchiveRetention, defaultSeenSource, seenKey, readSeenRecords,
    replaceSeenRecords, applyReadingQueueUpdate,
  };
function readingQueueItems() {
  const byKey = actionItemsByKey();
  return Array.from(state.readingQueue)
    .map((key) => actionItemForKey(key, byKey.get(key), state.readingQueueMeta.get(key)))
    .filter((item) => item && !state.seen.has(item.key));
}

function openAndMarkReadingQueue(items) {
  if (!items.length) return;
  if (readingQueueOpenOnReadAll()) {
    for (const item of items) {
      const url = itemUrl(item);
      if (url) openExternalWindow(url);
    }
  }
  for (const item of items) {
    const key = seenKey(item);
    if (!key) continue;
    state.seen.add(key);
    upsertSeenMeta(key, seenDetailsForItem(item, defaultSeenSource(item)));
    state.readingQueue.delete(key);
    state.readingQueueMeta.delete(key);
    sendFeedback(item, "read");
  }
  persistSeen();
  persistReadingQueue();
  renderAll();
}

function readingQueueOpenOnReadAll() {
  return state.settings?.readingQueueOpenOnReadAll !== false;
}

function applyReadingQueueUpdate(records, reopenedKeys = []) {
  const normalized = normalizeReadingQueueRecords(records);
  state.readingQueue = new Set(normalized.map((record) => record.key));
  state.readingQueueMeta = new Map(normalized.map((record) => [record.key, record]));
  for (const key of reopenedKeys) {
    state.seen.delete(key);
    state.seenMeta.delete(key);
  }
  renderAll();
}

function actionItemsByKey() {
  const items = [
    ...(state.data?.bookmarks || []),
    ...newsSummaryItems(false),
  ];
  return new Map(items.map((item) => [item.key, item]));
}

function actionItemForKey(key, item, meta = {}) {
  if (item) return item;
  if (!meta.title && !meta.url) return null;
  const source = normalizeSeenSource(meta.source || "news");
  return {
    key,
    title: meta.title || meta.host || meta.url || key,
    url: meta.url || "",
    host: meta.host || hostFromUrl(meta.url || ""),
    category: meta.category || (source === "news" ? t("category.news") : t("category.website")),
    section: source === "news" ? newsSectionName() : t("nav.bookmarks"),
    cardType: source === "news" ? newsCardType : "",
    sourceKey: source === "news" ? key : "",
  };
}

function findNewsItemByReference(reference = {}) {
  return findNewsItemReference(newsSummaryItems(false), reference);
}

function isQueued(item) {
  return state.readingQueue.has(actionKey(item));
}

function actionKey(item) {
  return seenKey(item);
}

function toggleReadingQueue(item) {
  const key = actionKey(item);
  if (!key) return;
  if (state.readingQueue.has(key)) {
    state.readingQueue.delete(key);
    state.readingQueueMeta.delete(key);
  } else {
    state.readingQueue.add(key);
    state.readingQueueMeta.set(key, actionDetailsForItem(item));
    sendFeedback(item, "queued");
  }
  persistReadingQueue();
  syncReadingQueueButtons(key);
  renderEfficiencyPanel();
}

function syncReadingQueueButtons(key) {
  const active = state.readingQueue.has(key);
  const label = t(active ? "action.removeReadingQueue" : "action.addReadingQueue");
  document.querySelectorAll("[data-reading-queue-key]").forEach((button) => {
    if (button.dataset.readingQueueKey !== key) return;
    button.classList.toggle("is-active", active);
    button.title = label;
    button.setAttribute("aria-label", label);
    button.setAttribute("aria-pressed", String(active));
    button.replaceChildren(
      createThemedIcon(active ? "bookmark-filled" : "bookmark-ribbon", "action-toggle-icon"),
      srOnly(label),
    );
  });
}

function actionDetailsForItem(item) {
  const source = defaultSeenSource(item);
  const url = source === "news" ? itemUrl(item) : (item.url || itemUrl(item));
  return {
    key: actionKey(item),
    source,
    title: String(source === "news" ? displaySummaryTitle(item) : displayBookmarkTitle(item)).slice(0, 300),
    url: String(url || "").slice(0, 2048),
    host: String(item.host || hostFromUrl(url) || "").slice(0, 255),
    category: String(item.category || "").slice(0, 200),
    addedAt: new Date().toISOString(),
  };
}

function persistReadingQueue() {
  writeJson(READING_QUEUE_STORAGE_KEY, Array.from(state.readingQueue).slice(-ACTION_RECORD_LIMIT).map((key) => ({
    key,
    ...(state.readingQueueMeta.get(key) || {}),
  })));
}

function openDailyItem(item) {
  openExternal(itemUrl(item), isNewsCard(item) ? displaySummaryTitle(item) : displayTitle(item), item);
  renderEfficiencyPanel();
}

function openSummaryItem(item) {
  openExternal(itemUrl(item), displaySummaryTitle(item), item);
  renderEfficiencyPanel();
}

function matchesQuery(item) {
  if (!state.query) return true;
  return `${item.title} ${item.host} ${item.url} ${item.section} ${item.category} ${summaryText(item)}`.toLowerCase().includes(state.query);
}

function toggleSeen(item, checked, source = defaultSeenSource(item)) {
  const key = seenKey(item);
  if (!key) return;
  if (checked) {
    state.seen.add(key);
    upsertSeenMeta(key, seenDetailsForItem(item, source));
    removeFromReadingQueue(key);
    sendFeedback(item, "read");
  } else {
    state.seen.delete(key);
    state.seenMeta.delete(key);
  }
  persistSeen();
  renderAll();
}

function markOpenedItem(item) {
  const key = actionKey(item);
  if (!key || state.opened.has(key) || state.seen.has(key)) return false;
  state.opened.add(key);
  state.openedMeta.set(key, actionDetailsForItem(item));
  persistActionRecords(OPENED_STORAGE_KEY, state.opened, state.openedMeta);
  sendFeedback(item, "opened");
  return true;
}

function dismissItem(item) {
  const key = actionKey(item);
  if (!key) return;
  state.dismissed.add(key);
  state.dismissedMeta.set(key, actionDetailsForItem(item));
  removeFromReadingQueue(key);
  persistActionRecords(DISMISSED_STORAGE_KEY, state.dismissed, state.dismissedMeta);
  sendFeedback(item, "dismissed");
  renderAll();
}

function sendFeedback(item, action) {
  const article = item?.feedItem;
  if (!article?.articleId) return;
  if (action === "opened" && state.settings?.personalizedRankingEnabled === false) return;
  apiPost("/api/feedback", {
    articleId: article.articleId,
    action,
    source: article.publisher || article.source || item.title || "",
    category: article.category || item.category || "",
    topics: article.topics || [],
  }).catch(() => {});
}

function persistActionRecords(storageKey, keys, meta) {
  writeJson(storageKey, Array.from(keys).slice(-ACTION_RECORD_LIMIT).map((key) => ({ key, ...(meta.get(key) || {}) })));
}

function removeFromReadingQueue(key) {
  if (!state.readingQueue.has(key)) return;
  state.readingQueue.delete(key);
  state.readingQueueMeta.delete(key);
  persistReadingQueue();
}

function retainSeenArchiveEnabled() {
  return state.settings?.retainSeenArchive === true;
}

function syncSeenArchiveRetention({ render = true } = {}) {
  const enabled = retainSeenArchiveEnabled();
  if (seenRetentionMode === enabled) return false;
  seenRetentionMode = enabled;
  if (enabled) {
    replaceSeenRecords(mergeSeenRecords(
      readSeenRecords(RETAINED_SEEN_STORAGE_KEY),
      currentSeenRecords(),
    ));
  } else {
    const todayRecords = mergeSeenRecords(
      readSeenRecords(`dash.seen.${state.day}`),
      currentSeenRecords().filter((record) => seenRecordDay(record) === state.day),
    );
    writeJson(RETAINED_SEEN_STORAGE_KEY, []);
    replaceSeenRecords(todayRecords);
  }
  persistSeen();
  if (state.data && render) renderAll();
  return true;
}

function readSeenRecords(key) {
  const value = readJson(key, []);
  if (!Array.isArray(value)) return [];
  return mergeSeenRecords(value.map((item) => typeof item === "string" ? { key: item } : item));
}

function mergeSeenRecords(...groups) {
  const records = new Map();
  for (const item of groups.flat()) {
    const key = String(item?.key || "").trim();
    if (!key) continue;
    const previous = records.get(key) || {};
    const source = item?.source || previous.source || "";
    records.set(key, {
      ...previous,
      ...item,
      key,
      ...(source ? { source: normalizeSeenSource(source) } : {}),
    });
  }
  return Array.from(records.values());
}

function currentSeenRecords() {
  return Array.from(state.seen).map((key) => ({
    key,
    ...(state.seenMeta.get(key) || {}),
  }));
}

function replaceSeenRecords(records) {
  state.seen = new Set(records.map((record) => record.key));
  state.seenMeta = new Map(records.map((record) => [record.key, record]));
}

function seenRecordDay(record) {
  const date = new Date(record?.addedAt || "");
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function persistSeen() {
  writeJson(
    retainSeenArchiveEnabled() ? RETAINED_SEEN_STORAGE_KEY : `dash.seen.${state.day}`,
    currentSeenRecords().slice(-ACTION_RECORD_LIMIT),
  );
}

function upsertSeenMeta(key, details = {}) {
  const previous = state.seenMeta.get(key) || {};
  const source = normalizeSeenSource(details.source || previous.source);
  state.seenMeta.set(key, {
    ...previous,
    ...details,
    key,
    source,
    addedAt: previous.addedAt || details.addedAt || new Date().toISOString(),
  });
}

function seenDetailsForItem(item, source = defaultSeenSource(item)) {
  const normalizedSource = normalizeSeenSource(source);
  return {
    source: normalizedSource,
    title: String(normalizedSource === "news" ? displaySummaryTitle(item) : displayBookmarkTitle(item)).slice(0, 300),
    url: String(normalizedSource === "news" ? itemUrl(item) : (item.url || itemUrl(item)) || "").slice(0, 2048),
    addedAt: new Date().toISOString(),
  };
}

function defaultSeenSource(item) {
  return item?.sourceKey ? "news" : "bookmark";
}

function normalizeSeenSource(source) {
  return source === "news" ? "news" : "bookmark";
}

function seenKey(item) {
  return typeof item === "string" ? item : item?.key;
}
}
