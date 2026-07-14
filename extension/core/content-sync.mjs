import { normalizeReadingQueueRecords } from "./reading-queue.mjs";
import { normalizeWeatherCoordinates } from "./weather.mjs";
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
  const readMetadata = () => readMetadataFrom(getRecord);

  return {
    initialize,
    applySettings,
    handleLocalPatch,
    handleStorageChanged,
    isContentSyncKey,
  };

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
    await initialize();
    const relevant = Object.entries(CONTENT_SYNC_DATASETS)
      .filter(([, definition]) => Object.hasOwn(values, definition.localKey));
    if (!relevant.length) return;
    const publicPatch = Object.fromEntries(relevant.map(([, definition]) => [definition.localKey, values[definition.localKey]]));
    broadcast("content-sync.changed", { values: publicPatch });
    return enqueue(async () => {
      for (const [name, definition] of relevant) {
        if (activeFlags[definition.flag]) await reconcileDataset(name);
      }
    });
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
    const [clientState, allSyncRecords, metadata] = await Promise.all([
      clientStateStore.read(),
      storage.get(null),
      readMetadata(),
    ]);
    const datasetMeta = metadata.datasets[name] || {};
    const localEntries = parseLocalEntries(name, clientState[definition.localKey]);
    const localMap = new Map(localEntries.map((entry) => [entry.id, entry.value]));
    const remoteRecords = normalizedRemoteRecords(name, definition, allSyncRecords);
    let localChanged = false;

    for (const remote of remoteRecords) {
      const localVersion = datasetMeta[remote.id];
      if (localVersion && compareVersions(remote, localVersion) <= 0) continue;
      if (remote.deleted) localMap.delete(remote.id);
      else localMap.set(remote.id, remote.value);
      datasetMeta[remote.id] = metadataFromSyncRecord(remote);
      localChanged = true;
    }

    const mergedEntries = Array.from(localMap, ([id, value]) => ({ id, value }));
    const mergedSerialized = serializeLocalEntries(name, mergedEntries);
    if (localChanged && mergedSerialized !== String(clientState[definition.localKey] ?? "")) {
      await clientStateStore.save({ values: { [definition.localKey]: mergedSerialized } });
      broadcast("content-sync.changed", { values: { [definition.localKey]: mergedSerialized } });
    }

    const selectedEntries = selectSyncEntries(name, mergedEntries, definition);
    const selectedMap = new Map(selectedEntries.map((entry) => [entry.id, entry.value]));
    const writes = {};
    const writeMetadata = [];
    const operationTime = now();

    for (const [id, value] of selectedMap) {
      const valueHash = stableValue(value);
      const current = datasetMeta[id];
      if (current && current.deleted !== true && current.valueHash === valueHash) continue;
      const record = syncRecord(name, id, value, operationTime, randomUUID());
      const key = await contentSyncStorageKey(name, id);
      if (jsonBytes(record) > MAX_SYNC_RECORD_BYTES) continue;
      writes[key] = record;
      writeMetadata.push([id, metadataFromSyncRecord(record)]);
    }

    for (const [id, current] of Object.entries(datasetMeta)) {
      if (current.deleted === true || selectedMap.has(id)) continue;
      const record = tombstoneRecord(name, id, operationTime, randomUUID());
      const key = await contentSyncStorageKey(name, id);
      writes[key] = record;
      writeMetadata.push([id, metadataFromSyncRecord(record)]);
    }

    if (Object.keys(writes).length) {
      assertSyncStorageBudget(allSyncRecords, writes);
      await storage.set(writes);
      for (const [id, value] of writeMetadata) datasetMeta[id] = value;
    }

    metadata.datasets[name] = datasetMeta;
    await pruneRemoteTombstones(name, definition, remoteRecords, operationTime);
    pruneLocalMetadata(metadata, operationTime);
    await setRecord(CONTENT_SYNC_META_KEY, metadata, "state");
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
  if (name === "weatherLocation") {
    const location = normalizeWeatherLocation(value);
    return location ? [{ id: "selected", value: location }] : [];
  }
  return [];
}

export function serializeLocalEntries(name, entries) {
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
  const entries = parseLocalEntries(name, name === "weatherLocation" ? value.value : [value.value]);
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

function normalizeTodoItems(value) {
  if (!Array.isArray(value)) return [];
  const output = [];
  const seen = new Set();
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const id = cleanId(item.id);
    const text = cleanStrictText(item.text, 120);
    const createdAt = normalizedDate(item.createdAt);
    if (!id || !text || !createdAt || seen.has(id)) continue;
    const completed = item.completed === true;
    const completedAt = completed ? normalizedDate(item.completedAt) : "";
    if (completed && !completedAt) continue;
    seen.add(id);
    output.push({ id, text, completed, createdAt, completedAt });
    if (output.length >= 50) break;
  }
  return output;
}

function normalizeWeatherLocation(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const coordinates = normalizeWeatherCoordinates(value.latitude, value.longitude);
  const name = cleanText(value.name, 100);
  if (!coordinates || !name) return null;
  return {
    id: cleanId(value.id),
    name,
    admin1: cleanText(value.admin1, 100),
    admin2: cleanText(value.admin2, 100),
    country: cleanText(value.country, 100),
    countryCode: cleanCode(value.countryCode, 2),
    featureCode: cleanCode(value.featureCode, 20),
    population: Number.isSafeInteger(Number(value.population)) && Number(value.population) >= 0 ? Number(value.population) : 0,
    source: cleanCode(value.source, 40),
    confidence: ["high", "verify"].includes(value.confidence) ? value.confidence : "verify",
    ...coordinates,
  };
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

function normalizedDate(value) {
  const result = timestamp(value);
  return result ? new Date(result).toISOString() : "";
}

function cleanId(value) {
  const id = String(value ?? "").trim();
  return id && Array.from(id).length <= 100 && /^[\p{L}\p{N}._:-]+$/u.test(id) ? id : "";
}

function cleanCode(value, limit) {
  const code = String(value || "").trim();
  return code.length <= limit && /^[A-Za-z0-9._:-]*$/.test(code) ? code : "";
}

function cleanText(value, limit) {
  return Array.from(String(value || "").replace(/\s+/g, " ").trim()).slice(0, limit).join("");
}

function cleanStrictText(value, limit) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return Array.from(text).length <= limit ? text : "";
}

function stableValue(value) {
  return JSON.stringify(value);
}

function jsonBytes(value) {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}
