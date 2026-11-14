import { normalizeReadingQueueRecords } from "./reading-queue.mjs";
import { normalizeTodoItems } from "./todo.mjs";
import { normalizeWeatherLocation } from "./weather.mjs";
import { STOCK_LIMIT, STOCK_WATCHLIST_KEY, normalizeStockWatchlist } from "./stocks.mjs";
import { COUNTDOWN_ITEM_LIMIT, COUNTDOWN_ITEMS_KEY, normalizeCountdownItems } from "./countdown.mjs";
import { TOPIC_LIMIT, TRACKED_TOPICS_KEY, normalizeTrackedTopics } from "./tracked-topics.mjs";
import { CALENDAR_EVENT_LIMIT, CALENDAR_STATE_KEY, normalizeCalendarState } from "./calendar.mjs";
import { NOTE_LIMIT, NOTES_STATE_KEY, normalizeNotesState } from "./notes.mjs";
import { WORLD_CLOCK_LIMIT, WORLD_CLOCK_STATE_KEY, normalizeWorldClockState } from "./world-clock.mjs";
import { assertSyncStorageBudget } from "./sync-budget.mjs";

export const CONTENT_SYNC_META_KEY = "content-sync-meta";
export const CONTENT_SYNC_TOMBSTONE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

const SYNC_RECORD_VERSION = 1;
const MAX_SYNC_RECORD_BYTES = 7000;
const MAX_TOMBSTONES_PER_DATASET = 150;

export const CONTENT_SYNC_DATASETS = Object.freeze({
  readingQueue: Object.freeze({
    flag: "syncReadingQueueEnabled",
    localKey: "dash.readingQueue",
    prefix: "ampira.content.reading.v1.",
    maxItems: 40,
    maxBytes: 30 * 1024,
  }),
  todos: Object.freeze({
    flag: "syncTodosEnabled",
    localKey: "dash.utility.todos.v1",
    prefix: "ampira.content.todos.v1.",
    maxItems: 50,
    maxBytes: 24 * 1024,
  }),
  weatherLocation: Object.freeze({
    flag: "syncWeatherLocationEnabled",
    localKey: "dash.utility.weather.location.v1",
    prefix: "ampira.content.weather.v1.",
    maxItems: 1,
    maxBytes: 3 * 1024,
  }),
  stockWatchlist: Object.freeze({
    flag: "syncStockWatchlistEnabled",
    localKey: STOCK_WATCHLIST_KEY,
    prefix: "ampira.content.stocks.v1.",
    maxItems: STOCK_LIMIT,
    maxBytes: 4 * 1024,
  }),
  countdowns: Object.freeze({
    flag: "syncCountdownsEnabled",
    localKey: COUNTDOWN_ITEMS_KEY,
    prefix: "ampira.content.countdowns.v1.",
    maxItems: COUNTDOWN_ITEM_LIMIT,
    maxBytes: 12 * 1024,
  }),
  trackedTopics: Object.freeze({
    flag: "syncTrackedTopicsEnabled",
    localKey: TRACKED_TOPICS_KEY,
    prefix: "ampira.content.topics.v1.",
    maxItems: TOPIC_LIMIT,
    maxBytes: 24 * 1024,
  }),
  calendar: Object.freeze({
    flag: "syncCalendarEnabled",
    localKey: CALENDAR_STATE_KEY,
    prefix: "ampira.content.calendar.v1.",
    maxItems: CALENDAR_EVENT_LIMIT,
    // Select every bounded event; the shared storage guard rejects oversized uploads
    // instead of silently synchronizing only part of a calendar.
    maxBytes: 256 * 1024,
  }),
  notes: Object.freeze({
    flag: "syncNotesEnabled", localKey: NOTES_STATE_KEY, prefix: "ampira.content.notes.v1.",
    maxItems: NOTE_LIMIT, maxBytes: 512 * 1024,
  }),
  worldClock: Object.freeze({
    flag: "syncWorldClockEnabled", localKey: WORLD_CLOCK_STATE_KEY, prefix: "ampira.content.worldClock.v1.",
    maxItems: WORLD_CLOCK_LIMIT, maxBytes: 8 * 1024,
  }),
});

export function createContentSyncService(options) {
  const {
    storage,
    clientStateStore,
    getSettings,
    getRecord,
    setRecord,
    broadcast = () => {},
    now = () => Date.now(),
    randomUUID = () => globalThis.crypto.randomUUID(),
  } = options;
  let initialized = false;
  let initializePromise = null;
  let operationQueue = Promise.resolve();
  let activeFlags = emptyFlags();
  let settingsRefreshTimer = 0;
  const localPatches = new Map();
  const readMetadata = () => readMetadataFrom(getRecord);

  return {
    initialize,
    reset,
    applySettings,
    handleLocalPatch,
    handleStorageChanged,
    isContentSyncKey,
  };

  async function reset() {
    if (settingsRefreshTimer) clearTimeout(settingsRefreshTimer);
    settingsRefreshTimer = 0;
    if (initializePromise) await initializePromise.catch(() => {});
    return enqueue(async () => {
      activeFlags = emptyFlags();
      initialized = true;
    });
  }

  async function initialize() {
    if (initialized) return;
    if (initializePromise) return initializePromise;
    initializePromise = (async () => {
      const settings = await getSettings();
      activeFlags = flagsFromSettings(settings);
      for (const [name, definition] of Object.entries(CONTENT_SYNC_DATASETS)) {
        if (activeFlags[definition.flag]) await reconcileDataset(name);
      }
      initialized = true;
    })().finally(() => {
      initializePromise = null;
    });
    return initializePromise;
  }

  async function applySettings(previous, next) {
    await initialize();
    return enqueue(async () => {
      const previousFlags = flagsFromSettings(previous);
      const nextFlags = flagsFromSettings(next);
      for (const [name, definition] of Object.entries(CONTENT_SYNC_DATASETS)) {
        const wasEnabled = previousFlags[definition.flag] === true;
        const enabled = nextFlags[definition.flag] === true;
        if (!wasEnabled && enabled) await reconcileDataset(name);
        if (wasEnabled && !enabled) await clearDataset(name);
      }
      activeFlags = nextFlags;
    });
  }

  async function handleLocalPatch(values = {}) {
    const relevant = Object.entries(CONTENT_SYNC_DATASETS)
      .filter(([, definition]) => Object.hasOwn(values, definition.localKey));
    if (!relevant.length) return;
    const patch = {};
    for (const [name] of relevant) localPatches.set(name, patch);
    try {
      await initialize();
      const publicPatch = Object.fromEntries(relevant.map(([, definition]) => [definition.localKey, values[definition.localKey]]));
      broadcast("content-sync.changed", { values: publicPatch });
      return await enqueue(async () => {
        for (const [name, definition] of relevant) {
          if (activeFlags[definition.flag]) await reconcileDataset(name);
        }
      });
    } finally {
      for (const [name] of relevant) {
        if (localPatches.get(name) === patch) localPatches.delete(name);
      }
    }
  }

  function handleStorageChanged(changes = {}, areaName = "") {
    if (areaName !== "sync") return;
    const keys = Object.keys(changes);
    if (keys.some((key) => key === "ampira.settings.v1" || key.startsWith("ampira.settings.v1.chunk."))) {
      scheduleSettingsRefresh();
    }
    const changedDatasets = Object.entries(CONTENT_SYNC_DATASETS)
      .filter(([, definition]) => keys.some((key) => key.startsWith(definition.prefix)));
    if (!changedDatasets.length) return;
    initialize().then(() => enqueue(async () => {
      for (const [name, definition] of changedDatasets) {
        if (activeFlags[definition.flag]) await reconcileDataset(name);
      }
    })).catch(() => {});
  }

  function scheduleSettingsRefresh() {
    if (settingsRefreshTimer) clearTimeout(settingsRefreshTimer);
    settingsRefreshTimer = setTimeout(() => {
      settingsRefreshTimer = 0;
      initialize().then(async () => {
        const next = await getSettings();
        await applySettings(activeFlags, next);
        broadcast("settings.changed", { syncSettingsChanged: true });
      }).catch(() => {});
    }, 100);
  }

  async function reconcileDataset(name) {
    const definition = CONTENT_SYNC_DATASETS[name];
    if (!definition) return;
    const [allSyncRecords, metadata] = await Promise.all([
      storage.get(null),
      readMetadata(),
    ]);
    const datasetMeta = { ...(metadata.datasets[name] || {}) };
    const remoteRecords = normalizedRemoteRecords(name, definition, allSyncRecords);
    const writes = {};
    const currentTime = now();
    let operationTime = currentTime;
    for (const record of [...Object.values(datasetMeta), ...remoteRecords]) {
      operationTime = Math.max(operationTime, Number(record.updatedAt || 0) + 1);
    }
    // Read and merge under the same queue as local saves, after the remote read.
    const localChanged = await clientStateStore.mutate(async (clientState) => {
      const localEntries = parseLocalEntries(name, clientState[definition.localKey]);
      const localMap = new Map(localEntries.map((entry) => [entry.id, entry.value]));
      const dirty = new Set();
      for (const { id, value } of selectSyncEntries(name, localEntries, definition)) {
        const previous = datasetMeta[id];
        if (previous ? previous.deleted || previous.valueHash !== stableValue(value) : localPatches.has(name)) dirty.add(id);
      }
      for (const [id, previous] of Object.entries(datasetMeta)) {
        if (!previous.deleted && !localMap.has(id)) dirty.add(id);
      }
      let remoteChanged = false;
      for (const remote of remoteRecords) {
        const localVersion = datasetMeta[remote.id];
        // A value differing from the last synced snapshot is a pending local edit.
        if (dirty.has(remote.id) || localVersion && compareVersions(remote, localVersion) <= 0) continue;
        if (remote.deleted) localMap.delete(remote.id);
        else localMap.set(remote.id, remote.value);
        datasetMeta[remote.id] = metadataFromSyncRecord(remote);
        remoteChanged = true;
      }
      let mergedEntries = Array.from(localMap, ([id, value]) => ({ id, value }));
      if (["calendar", "notes", "worldClock"].includes(name) && mergedEntries.length > definition.maxItems) {
        const error = new Error(name === "calendar" ? "CALENDAR_SYNC_LIMIT_EXCEEDED" : "PERSONAL_CARD_SYNC_LIMIT_EXCEEDED");
        error.code = error.message;
        error.messageKey = `background.error.${name}SyncLimit`;
        error.messageParams = { count: definition.maxItems };
        error.retryable = false;
        throw error;
      }
      if (["calendar", "notes", "worldClock"].includes(name)) mergedEntries.sort((left, right) => left.id.localeCompare(right.id));
      if (name === "trackedTopics") {
        // Resolve duplicate names and the eight-topic limit identically on every device.
        mergedEntries.sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
        mergedEntries = parseLocalEntries(name, { topics: mergedEntries.map(entry => entry.value) });
      }
      const selectedMap = new Map(selectSyncEntries(name, mergedEntries, definition).map(entry => [entry.id, entry.value]));
      const writeMetadata = [];
      for (const [id, value] of selectedMap) {
        const current = datasetMeta[id];
        if (current && !current.deleted && current.valueHash === stableValue(value)) continue;
        const record = syncRecord(name, id, value, operationTime, randomUUID());
        if (jsonBytes(record) > MAX_SYNC_RECORD_BYTES) continue;
        writes[await contentSyncStorageKey(name, id)] = record;
        writeMetadata.push([id, metadataFromSyncRecord(record)]);
      }
      for (const [id, current] of Object.entries(datasetMeta)) {
        if (current.deleted || selectedMap.has(id)) continue;
        const record = tombstoneRecord(name, id, operationTime, randomUUID());
        writes[await contentSyncStorageKey(name, id)] = record;
        writeMetadata.push([id, metadataFromSyncRecord(record)]);
      }
      if (Object.keys(writes).length) {
        assertSyncStorageBudget(allSyncRecords, writes);
        await storage.set(writes);
        for (const [id, value] of writeMetadata) datasetMeta[id] = value;
      }
      const serialized = serializeLocalEntries(name, mergedEntries, clientState[definition.localKey]);
      const changed = remoteChanged && serialized !== String(clientState[definition.localKey] ?? "");
      return { values: changed ? { [definition.localKey]: serialized } : {}, result: changed };
    });
    metadata.datasets[name] = datasetMeta;
    await pruneRemoteTombstones(name, definition, remoteRecords.filter(record => !Object.hasOwn(writes, record.storageKey)), currentTime);
    pruneLocalMetadata(metadata, currentTime);
    await setRecord(CONTENT_SYNC_META_KEY, metadata, "state");
    if (localChanged) {
      const latest = await clientStateStore.read();
      broadcast("content-sync.changed", { values: { [definition.localKey]: latest[definition.localKey] } });
    }
  }

  async function clearDataset(name) {
    const definition = CONTENT_SYNC_DATASETS[name];
    const records = await storage.get(null);
    const keys = Object.keys(records).filter((key) => key.startsWith(definition.prefix));
    if (keys.length) await storage.remove(keys);
    const metadata = await readMetadata();
    delete metadata.datasets[name];
    await setRecord(CONTENT_SYNC_META_KEY, metadata, "state");
  }

  async function pruneRemoteTombstones(name, definition, records, currentTime) {
    const tombstones = records.filter((record) => record.deleted === true)
      .sort((left, right) => right.updatedAt - left.updatedAt);
    const staleBefore = currentTime - CONTENT_SYNC_TOMBSTONE_RETENTION_MS;
    const keys = tombstones
      .filter((record, index) => record.updatedAt < staleBefore || index >= MAX_TOMBSTONES_PER_DATASET)
      .map((record) => record.storageKey)
      .filter((key) => key.startsWith(definition.prefix));
    if (keys.length) await storage.remove(keys);
  }

  function enqueue(action) {
    const operation = operationQueue.then(action);
    operationQueue = operation.catch(() => {});
    return operation;
  }
}

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
    const bytes = jsonBytes(entry.value) + jsonBytes(entry.id) + 180;
    if (bytes > MAX_SYNC_RECORD_BYTES || usedBytes + bytes > definition.maxBytes) continue;
    selected.push(entry);
    usedBytes += bytes;
  }
  return selected;
}

function normalizedRemoteRecords(name, definition, values) {
  const records = [];
  for (const [storageKey, value] of Object.entries(values || {})) {
    if (!storageKey.startsWith(definition.prefix)) continue;
    const record = normalizeSyncRecord(name, value);
    if (record) records.push({ ...record, storageKey });
  }
  return records;
}

function normalizeSyncRecord(name, value) {
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

function syncRecord(dataset, id, value, updatedAt, nonce) {
  return {
    version: SYNC_RECORD_VERSION,
    dataset,
    id,
    value,
    updatedAt,
    revision: `${updatedAt}:${String(nonce || "").slice(0, 80)}`,
  };
}

function tombstoneRecord(dataset, id, updatedAt, nonce) {
  return {
    version: SYNC_RECORD_VERSION,
    dataset,
    id,
    deleted: true,
    updatedAt,
    revision: `${updatedAt}:${String(nonce || "").slice(0, 80)}`,
  };
}

function metadataFromSyncRecord(record) {
  return {
    updatedAt: record.updatedAt,
    revision: record.revision,
    deleted: record.deleted === true,
    valueHash: record.deleted === true ? "" : stableValue(record.value),
  };
}

function compareVersions(left, right) {
  const timeDifference = Number(left.updatedAt || 0) - Number(right.updatedAt || 0);
  if (timeDifference) return timeDifference;
  return String(left.revision || "").localeCompare(String(right.revision || ""));
}

async function readMetadataFrom(getRecord) {
  const value = await getRecord(CONTENT_SYNC_META_KEY, null);
  if (!value || value.version !== 1 || typeof value.datasets !== "object" || Array.isArray(value.datasets)) {
    return { version: 1, datasets: {} };
  }
  return { version: 1, datasets: { ...value.datasets } };
}

function flagsFromSettings(settings = {}) {
  return Object.fromEntries(Object.values(CONTENT_SYNC_DATASETS).map((definition) => [definition.flag, settings[definition.flag] === true]));
}

function emptyFlags() {
  return flagsFromSettings({});
}

function isContentSyncKey(key) {
  return Object.values(CONTENT_SYNC_DATASETS).some((definition) => String(key || "").startsWith(definition.prefix));
}

function pruneLocalMetadata(metadata, currentTime) {
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

function stableValue(value) {
  return JSON.stringify(value);
}

function jsonBytes(value) {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}
