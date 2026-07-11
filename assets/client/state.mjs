import { readJson, readNumber, readValue } from "./storage.mjs";
import { getTodayKey } from "./time.mjs";

const ACTION_RECORD_LIMIT = 150;

export function createInitialState() {
  const day = getTodayKey();
  const seenRecords = normalizeSeenRecords(readJson(`dash.seen.${day}`, []));
  const queueRecords = normalizeActionRecords(readJson("dash.readingQueue", []));
  const openedRecords = normalizeActionRecords(readJson("dash.opened", []));
  const dismissedRecords = normalizeActionRecords(readJson("dash.dismissed", []));
  return {
    data: null,
    settings: null,
    filter: "all",
    categoryFilter: "all",
    query: "",
    summaryOrder: readValue("dash.summary.order") || "importance",
    day,
    variants: {
      news: readNumber(`dash.variant.${day}.news`, 0),
      inspiration: readNumber(`dash.variant.${day}.inspiration`, readNumber(`dash.variant.${day}`, 0)),
      summary: readNumber(`dash.variant.${day}.summary`, 0)
    },
    seen: new Set(seenRecords.map((record) => record.key)),
    seenMeta: new Map(seenRecords.map((record) => [record.key, record])),
    readingQueue: new Set(queueRecords.map((record) => record.key)),
    readingQueueMeta: new Map(queueRecords.map((record) => [record.key, record])),
    opened: new Set(openedRecords.map((record) => record.key)),
    openedMeta: new Map(openedRecords.map((record) => [record.key, record])),
    dismissed: new Set(dismissedRecords.map((record) => record.key)),
    dismissedMeta: new Map(dismissedRecords.map((record) => [record.key, record])),
    manualRefreshKeys: new Set(),
    dailyDigestRefreshing: false,
    aiSearchBusy: false,
    aiSearchTypeTimer: null,
    pollTimer: null,
    navSyncFrame: 0,
    webFrameUrl: "",
    webFrameItem: null,
    webFrameResult: null,
    webFrameHistory: [],
    webFrameActiveMs: 0,
    webFrameLastActiveAt: 0,
    webFrameReadTimer: 0,
    webFrameProgressTimer: 0,
    contextMenu: null
  }
}

function normalizeActionRecords(value) {
  if (!Array.isArray(value)) return [];
  const records = [];
  const keys = new Set();
  for (const item of value.slice(-ACTION_RECORD_LIMIT)) {
    const record = typeof item === "string"
      ? { key: item }
      : normalizeActionRecord(item);
    if (!record.key || keys.has(record.key)) continue;
    keys.add(record.key);
    records.push(record);
  }
  return records;
}

function normalizeActionRecord(item) {
  const key = String(item?.key || "").trim();
  if (!key) return { key: "" };
  return {
    key,
    ...(item?.source ? { source: String(item.source) } : {}),
    ...(item?.title ? { title: String(item.title) } : {}),
    ...(item?.url ? { url: String(item.url) } : {}),
    ...(item?.host ? { host: String(item.host) } : {}),
    ...(item?.category ? { category: String(item.category) } : {}),
    ...(item?.addedAt ? { addedAt: String(item.addedAt) } : {}),
  };
}

function normalizeSeenRecords(value) {
  if (!Array.isArray(value)) return [];
  const records = [];
  const keys = new Set();
  for (const item of value.slice(-ACTION_RECORD_LIMIT)) {
    const record = typeof item === "string"
      ? { key: item }
      : normalizeSeenRecord(item);
    if (!record.key || keys.has(record.key)) continue;
    keys.add(record.key);
    records.push(record);
  }
  return records;
}

function normalizeSeenRecord(item) {
  const key = String(item?.key || "").trim();
  if (!key) return { key: "" };
  const source = item.source === "news" || item.source === "bookmark" ? item.source : "";
  return {
    key,
    ...(source ? { source } : {}),
    ...(item?.title ? { title: String(item.title) } : {}),
    ...(item?.url ? { url: String(item.url) } : {}),
    ...(item?.addedAt ? { addedAt: String(item.addedAt) } : {}),
  };
}
