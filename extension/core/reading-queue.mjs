import { hashText } from "./bookmarks.mjs";
import { normalizeUserUrl } from "./search.mjs";

export const READING_QUEUE_STORAGE_KEY = "dash.readingQueue";
export const RETAINED_SEEN_STORAGE_KEY = "dash.seen.retained";
export const READING_QUEUE_LIMIT = 150;

export function capturedPageRecord(tab = {}, now = new Date()) {
  const url = normalizeCapturedPageUrl(tab.url);
  if (!url) return null;
  const host = hostFromUrl(url);
  const title = cleanText(tab.title, 300) || host || url;
  return {
    key: `bookmark-${hashText(url)}`,
    source: "bookmark",
    title,
    url,
    host,
    addedAt: validDate(now).toISOString(),
  };
}

export function normalizeCapturedPageUrl(value) {
  const normalized = normalizeUserUrl(value);
  if (!normalized) return "";
  try {
    const url = new URL(normalized);
    if (url.username || url.password) return "";
    url.hash = "";
    const result = url.href;
    return result.length <= 2048 ? result : "";
  } catch {
    return "";
  }
}

export function normalizeReadingQueueRecords(value) {
  const input = parseStoredArray(value).slice(-READING_QUEUE_LIMIT);
  const records = [];
  const keys = new Set();
  for (const item of input) {
    const record = normalizeRecord(item);
    if (!record.key || keys.has(record.key)) continue;
    keys.add(record.key);
    records.push(record);
  }
  return records;
}

export function addCapturedPage(records, record) {
  const normalized = normalizeReadingQueueRecords(records);
  const existing = normalized.find((item) => item.key === record.key
    || Boolean(item.url && normalizeCapturedPageUrl(item.url) === record.url));
  if (existing) return { status: "already", records: normalized, record: existing };
  const next = [...normalized, record].slice(-READING_QUEUE_LIMIT);
  return { status: "added", records: next, record };
}

export function removeSeenPage(value, record) {
  const records = parseStoredArray(value).map(normalizeSeenRecord).filter((item) => item.key);
  const removedKeys = [];
  const kept = records.filter((item) => {
    const matches = item.key === record.key
      || Boolean(item.url && normalizeCapturedPageUrl(item.url) === record.url);
    if (matches) removedKeys.push(item.key);
    return !matches;
  });
  return { records: kept.slice(-READING_QUEUE_LIMIT), removedKeys };
}

function normalizeRecord(item) {
  const source = item?.source === "news" ? "news" : (item?.source ? "bookmark" : "");
  const key = cleanText(typeof item === "string" ? item : item?.key, 2200);
  if (!key) return { key: "" };
  return {
    key,
    ...(source ? { source } : {}),
    ...(item?.title ? { title: cleanText(item.title, 300) } : {}),
    ...(item?.url ? { url: cleanText(item.url, 2048) } : {}),
    ...(item?.host ? { host: cleanText(item.host, 255) } : {}),
    ...(item?.category ? { category: cleanText(item.category, 200) } : {}),
    ...(item?.addedAt ? { addedAt: cleanText(item.addedAt, 100) } : {}),
  };
}

function normalizeSeenRecord(item) {
  const key = cleanText(typeof item === "string" ? item : item?.key, 2200);
  if (!key) return { key: "" };
  return {
    key,
    ...(item?.source ? { source: item.source === "news" ? "news" : "bookmark" } : {}),
    ...(item?.title ? { title: cleanText(item.title, 300) } : {}),
    ...(item?.url ? { url: cleanText(item.url, 2048) } : {}),
    ...(item?.addedAt ? { addedAt: cleanText(item.addedAt, 100) } : {}),
  };
}

function parseStoredArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string" || !value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function cleanText(value, limit) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function hostFromUrl(value) {
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, "").slice(0, 255);
  } catch {
    return "";
  }
}

function validDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}
