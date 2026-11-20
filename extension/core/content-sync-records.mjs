import { normalizeReadingQueueRecords } from "./reading-queue.mjs";
import { normalizeTodoItems } from "./todo.mjs";
import { normalizeWeatherLocation } from "./weather.mjs";
import { STOCK_LIMIT, STOCK_WATCHLIST_KEY, normalizeStockWatchlist } from "./stocks.mjs";
import { COUNTDOWN_ITEM_LIMIT, COUNTDOWN_ITEMS_KEY, normalizeCountdownItems } from "./countdown.mjs";
import { TOPIC_LIMIT, TRACKED_TOPICS_KEY, normalizeTrackedTopics } from "./tracked-topics.mjs";
import { CALENDAR_EVENT_LIMIT, CALENDAR_STATE_KEY, normalizeCalendarState } from "./calendar.mjs";
import { NOTE_LIMIT, NOTES_STATE_KEY, normalizeNotesState } from "./notes.mjs";
import { WORLD_CLOCK_LIMIT, WORLD_CLOCK_STATE_KEY, normalizeWorldClockState } from "./world-clock.mjs";

import { MAX_SYNC_RECORD_BYTES, syncError, syncValueBytes as jsonBytes } from "./sync-values.mjs";

export const CONTENT_SYNC_META_KEY = "content-sync-meta";
export const CONTENT_SYNC_TOMBSTONE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

const SYNC_RECORD_VERSION = 1;
export const MAX_TOMBSTONES_PER_DATASET = 150;

export const CONTENT_SYNC_DATASETS = Object.freeze({
  readingQueue: Object.freeze({
    label: "settings.sync.readingQueue",
    flag: "syncReadingQueueEnabled",
    localKey: "dash.readingQueue",
    prefix: "ampira.content.reading.v1.",
    maxItems: 40,
    maxBytes: 30 * 1024,
  }),
  todos: Object.freeze({
    label: "settings.sync.todos",
    flag: "syncTodosEnabled",
    localKey: "dash.utility.todos.v1",
    prefix: "ampira.content.todos.v1.",
    maxItems: 50,
    maxBytes: 24 * 1024,
  }),
  weatherLocation: Object.freeze({
    label: "settings.sync.weather",
    flag: "syncWeatherLocationEnabled",
    localKey: "dash.utility.weather.location.v1",
    prefix: "ampira.content.weather.v1.",
    maxItems: 1,
    maxBytes: 3 * 1024,
  }),
  stockWatchlist: Object.freeze({
    label: "settings.sync.stocks",
    flag: "syncStockWatchlistEnabled",
    localKey: STOCK_WATCHLIST_KEY,
    prefix: "ampira.content.stocks.v1.",
    maxItems: STOCK_LIMIT,
    maxBytes: 4 * 1024,
  }),
  countdowns: Object.freeze({
    label: "settings.sync.countdowns",
    flag: "syncCountdownsEnabled",
    localKey: COUNTDOWN_ITEMS_KEY,
    prefix: "ampira.content.countdowns.v1.",
    maxItems: COUNTDOWN_ITEM_LIMIT,
    maxBytes: 12 * 1024,
  }),
  trackedTopics: Object.freeze({
    label: "settings.sync.topics",
    flag: "syncTrackedTopicsEnabled",
    localKey: TRACKED_TOPICS_KEY,
    prefix: "ampira.content.topics.v1.",
    maxItems: TOPIC_LIMIT,
    maxBytes: 24 * 1024,
  }),
  calendar: Object.freeze({
    label: "settings.sync.calendar",
    flag: "syncCalendarEnabled",
    localKey: CALENDAR_STATE_KEY,
    prefix: "ampira.content.calendar.v1.",
    maxItems: CALENDAR_EVENT_LIMIT,
    // Select every bounded event; the shared storage guard rejects oversized uploads
    // instead of silently synchronizing only part of a calendar.
    maxBytes: 256 * 1024,
  }),
  notes: Object.freeze({
    label: "settings.sync.notes",
    flag: "syncNotesEnabled", localKey: NOTES_STATE_KEY, prefix: "ampira.content.notes.v1.",
    maxItems: NOTE_LIMIT, maxBytes: 512 * 1024,
  }),
  worldClock: Object.freeze({
    label: "settings.sync.worldClock",
    flag: "syncWorldClockEnabled", localKey: WORLD_CLOCK_STATE_KEY, prefix: "ampira.content.worldClock.v1.",
    maxItems: WORLD_CLOCK_LIMIT, maxBytes: 8 * 1024,
  }),
});

export async function contentSyncStorageKey(name, id) {
  const definition = CONTENT_SYNC_DATASETS[name];
  if (!definition) throw new TypeError("Unknown content sync dataset");
  const bytes = new TextEncoder().encode(String(id));
  if (globalThis.crypto?.subtle) {
    const digest = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes));
    return `${definition.prefix}${Array.from(digest.slice(0, 20), (value) => value.toString(16).padStart(2, "0")).join("")}`;
  }
  let first = 2166136261;
  let second = 2246822519;
  for (const value of bytes) {
    first = Math.imul(first ^ value, 16777619) >>> 0;
    second = Math.imul(second ^ value, 3266489917) >>> 0;
  }
  return `${definition.prefix}${first.toString(16).padStart(8, "0")}${second.toString(16).padStart(8, "0")}`;
}

export function parseLocalEntries(name, serialized) {
  let value;
  try {
    value = typeof serialized === "string" ? JSON.parse(serialized) : serialized;
  } catch {
    value = null;
  }
  if (name === "readingQueue") {
    return normalizeReadingQueueRecords(value).map((item) => ({ id: item.key, value: item }));
  }
  if (name === "todos") {
    return normalizeTodoItems(value).map((item) => ({ id: item.id, value: item }));
  }
  if (name === "stockWatchlist") {
    return normalizeStockWatchlist(value).map((symbol) => ({ id: symbol, value: symbol }));
  }
  if (name === "countdowns") {
    return normalizeCountdownItems(value).map((item) => ({ id: item.id, value: item }));
  }
  if (name === "trackedTopics") {
    return normalizeTrackedTopics(value).topics.map(({ id, name, words, source }) => ({ id, value: { id, name, words, source } }));
  }
  if (name === "calendar") {
    return normalizeCalendarState(value).items.map(({ id, title, date, time }) => ({ id, value: { id, title, date, time } }));
  }
  if (name === "notes") {
    return normalizeNotesState(value).items.map(({ id, text, pinned, createdAt, updatedAt }) => ({ id, value: { id, text, pinned, createdAt, updatedAt } }));
  }
  if (name === "worldClock") return normalizeWorldClockState(value).items.map(({ id }) => ({ id, value: { id } }));
  if (name === "weatherLocation") {
    const location = normalizeWeatherLocation(value);
    return location ? [{ id: "selected", value: location }] : [];
  }
  return [];
}

export function readLocalSyncEntries(name, serialized) {
  const { entries, error } = inspectLocalSyncEntries(name, serialized);
  if (error) throw syncError(error);
  return entries;
}

export function inspectLocalSyncEntries(name, serialized) {
  let value;
  try { value = typeof serialized === "string" ? serialized ? JSON.parse(serialized) : null : serialized ?? null; }
  catch { return { entries: [], error: "invalid" }; }
  const entries = parseLocalEntries(name, value);
  const structured = ["trackedTopics", "calendar", "notes", "worldClock"].includes(name);
  const field = name === "trackedTopics" ? "topics" : "items";
  if (value !== null && (name === "weatherLocation" ? typeof value !== "object" || Array.isArray(value)
    : structured ? !value || typeof value !== "object" || !Array.isArray(value[field]) : !Array.isArray(value))) return { entries, error: "invalid" };
  const rawItems = value === null ? [] : name === "weatherLocation" ? [value] : structured ? value[field] : value;
  if (rawItems.length !== entries.length) return { entries, error: "invalid" };
  if (entries.some(entry => syncEntryBytes(entry) > MAX_SYNC_RECORD_BYTES)) return { entries, error: "tooLarge" };
  return { entries, error: "" };
}

export function serializeLocalEntries(name, entries, previousValue) {
  if (name === "weatherLocation") return JSON.stringify(entries[0]?.value || null);
  const values = entries.map((entry) => entry.value);
  if (name === "readingQueue") {
    values.sort((left, right) => timestamp(left.addedAt) - timestamp(right.addedAt));
    return JSON.stringify(normalizeReadingQueueRecords(values));
  }
  if (name === "todos") {
    values.sort((left, right) => timestamp(right.createdAt) - timestamp(left.createdAt));
    return JSON.stringify(normalizeTodoItems(values));
  }
  if (name === "stockWatchlist") return JSON.stringify(normalizeStockWatchlist(values));
  if (name === "countdowns") return JSON.stringify(normalizeCountdownItems(values));
  if (["trackedTopics", "calendar", "notes", "worldClock"].includes(name)) {
    const normalize = name === "notes" ? normalizeNotesState : name === "worldClock" ? normalizeWorldClockState
      : name === "calendar" ? normalizeCalendarState : normalizeTrackedTopics;
    const field = name === "trackedTopics" ? "topics" : "items";
    let previous;
    try { previous = typeof previousValue === "string" ? JSON.parse(previousValue) : previousValue; } catch { previous = null; }
    const state = normalize(previous);
    const previousEntries = new Map(parseLocalEntries(name, state).map(entry => [entry.id, entry.value]));
    const items = normalize({ [field]: values })[field].map(item => {
      const old = state[field].find(previousItem => previousItem.id === item.id);
      const changed = stableValue(previousEntries.get(item.id)) !== stableValue(values.find(value => value.id === item.id));
      return { ...item, revision: (old?.revision || 0) + Number(changed) };
    });
    const changed = stableValue(items) !== stableValue(state[field]);
    return JSON.stringify({ ...state, revision: state.revision + Number(changed), [field]: items });
  }
  return "[]";
}

export function selectSyncEntries(name, entries, definition = CONTENT_SYNC_DATASETS[name]) {
  const sorted = [...entries].sort((left, right) => entryTimestamp(name, right.value) - entryTimestamp(name, left.value));
  const selected = [];
  let usedBytes = 0;
  for (const entry of sorted) {
    if (selected.length >= definition.maxItems) break;
    const bytes = syncEntryBytes(entry);
    if (bytes > MAX_SYNC_RECORD_BYTES || usedBytes + bytes > definition.maxBytes) continue;
    selected.push(entry);
    usedBytes += bytes;
  }
  return selected;
}

export async function readRemoteSyncRecords(name, values, { strict = false } = {}) {
  const definition = CONTENT_SYNC_DATASETS[name];
  const records = [];
  for (const [storageKey, value] of Object.entries(values || {})) {
    if (!storageKey.startsWith(definition.prefix)) continue;
    const record = normalizeSyncRecord(name, value);
    if (!record || strict && storageKey !== await contentSyncStorageKey(name, record.id)) {
      if (strict) throw syncError("invalid");
      continue;
    }
    records.push({ ...record, storageKey });
  }
  return records;
}

export function nextSyncTime(metadata, remote, now) {
  return Math.max(now, ...[...Object.values(metadata || {}), ...remote].map(record => (Number(record?.updatedAt) || 0) + 1));
}

function syncEntryBytes(entry) {
  return jsonBytes(entry.value) + jsonBytes(entry.id) + 180;
}

export function normalizeSyncRecord(name, value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (value.version !== SYNC_RECORD_VERSION || value.dataset !== name) return null;
  const id = cleanText(value.id, 2200);
  const updatedAt = Number(value.updatedAt);
  const revision = cleanText(value.revision, 120);
  if (!id || !Number.isFinite(updatedAt) || updatedAt <= 0 || !revision) return null;
  if (value.deleted === true) return { version: 1, dataset: name, id, updatedAt, revision, deleted: true };
  const entries = parseLocalEntries(name, name === "weatherLocation" ? value.value
    : name === "trackedTopics" ? { topics: [value.value] } : ["calendar", "notes", "worldClock"].includes(name) ? { items: [value.value] } : [value.value]);
  const normalized = entries.find((entry) => entry.id === id);
  if (!normalized) return null;
  return { version: 1, dataset: name, id, value: normalized.value, updatedAt, revision, deleted: false };
}

export function syncRecord(dataset, id, value, updatedAt, nonce) {
  return {
    version: SYNC_RECORD_VERSION,
    dataset,
    id,
    value,
    updatedAt,
    revision: `${updatedAt}:${String(nonce || "").slice(0, 80)}`,
  };
}

export function tombstoneRecord(dataset, id, updatedAt, nonce) {
  return {
    version: SYNC_RECORD_VERSION,
    dataset,
    id,
    deleted: true,
    updatedAt,
    revision: `${updatedAt}:${String(nonce || "").slice(0, 80)}`,
  };
}

export function metadataFromSyncRecord(record) {
  return {
    updatedAt: record.updatedAt,
    revision: record.revision,
    deleted: record.deleted === true,
    valueHash: record.deleted === true ? "" : stableValue(record.value),
  };
}

export function compareVersions(left, right) {
  const timeDifference = Number(left.updatedAt || 0) - Number(right.updatedAt || 0);
  if (timeDifference) return timeDifference;
  return String(left.revision || "").localeCompare(String(right.revision || ""));
}

export function flagsFromSettings(settings = {}) {
  return Object.fromEntries(Object.values(CONTENT_SYNC_DATASETS).map((definition) => [definition.flag, settings[definition.flag] === true]));
}

export function emptyFlags() {
  return flagsFromSettings({});
}

export function isContentSyncKey(key) {
  return Object.values(CONTENT_SYNC_DATASETS).some((definition) => String(key || "").startsWith(definition.prefix));
}

export function pruneLocalMetadata(metadata, currentTime) {
  const staleBefore = currentTime - 2 * CONTENT_SYNC_TOMBSTONE_RETENTION_MS;
  for (const [name, records] of Object.entries(metadata.datasets)) {
    if (!records || typeof records !== "object" || Array.isArray(records)) {
      delete metadata.datasets[name];
      continue;
    }
    const tombstones = Object.entries(records)
      .filter(([, value]) => value?.deleted === true)
      .sort((left, right) => Number(right[1].updatedAt || 0) - Number(left[1].updatedAt || 0));
    for (const [index, [id, value]] of tombstones.entries()) {
      if (index >= MAX_TOMBSTONES_PER_DATASET && Number(value.updatedAt || 0) < staleBefore) delete records[id];
    }
  }
}

function entryTimestamp(name, value) {
  if (name === "todos") return Math.max(timestamp(value.completedAt), timestamp(value.createdAt));
  if (name === "readingQueue") return timestamp(value.addedAt);
  return 0;
}

function timestamp(value) {
  const result = Date.parse(String(value || ""));
  return Number.isFinite(result) ? result : 0;
}

function cleanText(value, limit) {
  return Array.from(String(value || "").replace(/\s+/g, " ").trim()).slice(0, limit).join("");
}

export function stableValue(value) {
  return JSON.stringify(value);
}
