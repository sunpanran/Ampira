import {
  CONTENT_SYNC_META_KEY, CONTENT_SYNC_TOMBSTONE_RETENTION_MS, CONTENT_SYNC_DATASETS, MAX_TOMBSTONES_PER_DATASET,
  flagsFromSettings, emptyFlags, isContentSyncKey, inspectLocalSyncEntries, readRemoteSyncRecords,
  parseLocalEntries, selectSyncEntries, compareVersions, metadataFromSyncRecord, syncRecord, tombstoneRecord,
  contentSyncStorageKey, serializeLocalEntries, pruneLocalMetadata, stableValue, nextSyncTime,
} from "./content-sync-records.mjs";
import { MAX_SYNC_RECORD_BYTES, syncValueBytes as jsonBytes, syncError } from "./sync-values.mjs";
import { assertSyncStorageBudget } from "./sync-budget.mjs";
export { CONTENT_SYNC_META_KEY, CONTENT_SYNC_TOMBSTONE_RETENTION_MS, CONTENT_SYNC_DATASETS, contentSyncStorageKey, parseLocalEntries, selectSyncEntries, normalizeSyncRecord, metadataFromSyncRecord } from "./content-sync-records.mjs";

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
    canSync = () => true,
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
    runExclusive: action => enqueue(action, true),
  };

  async function reset() {
    if (settingsRefreshTimer) clearTimeout(settingsRefreshTimer);
    settingsRefreshTimer = 0;
    if (initializePromise) await initializePromise.catch(() => {});
    return enqueue(async () => {
      activeFlags = emptyFlags();
      initialized = true;
    }, true);
  }

  async function initialize() {
    if (initialized) return;
    if (initializePromise) return initializePromise;
    initializePromise = enqueue(async () => {
      const settings = await getSettings();
      activeFlags = flagsFromSettings(settings);
      await reconcileDatasets(Object.keys(CONTENT_SYNC_DATASETS).filter(name => activeFlags[CONTENT_SYNC_DATASETS[name].flag]));
      initialized = true;
    }).finally(() => {
      initializePromise = null;
    });
    return initializePromise;
  }

  async function applySettings(previous, next) {
    await initialize();
    return enqueue(async () => {
      const previousFlags = flagsFromSettings(previous);
      const nextFlags = flagsFromSettings(next);
      const names = Object.keys(CONTENT_SYNC_DATASETS);
      await clearDatasets(names.filter(name => previousFlags[CONTENT_SYNC_DATASETS[name].flag] && !nextFlags[CONTENT_SYNC_DATASETS[name].flag]));
      await reconcileDatasets(names.filter(name => !previousFlags[CONTENT_SYNC_DATASETS[name].flag] && nextFlags[CONTENT_SYNC_DATASETS[name].flag]));
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
      const latest = await clientStateStore.read();
      const publicPatch = Object.fromEntries(relevant.map(([, definition]) => [definition.localKey, latest[definition.localKey]]));
      broadcast("content-sync.changed", { values: publicPatch });
      return await enqueue(() => reconcileDatasets(relevant.filter(([, definition]) => activeFlags[definition.flag]).map(([name]) => name)));
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
    initialize().then(() => enqueue(() => reconcileDatasets(changedDatasets.filter(([, definition]) => activeFlags[definition.flag]).map(([name]) => name)))).catch(() => {});
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

  async function reconcileDatasets(names) {
    if (!names.length) return;
    const [records, metadata] = await Promise.all([storage.get(null), readMetadata()]);
    const before = stableValue(metadata);
    try {
      for (const name of names) await reconcileDataset(name, records, metadata);
    } finally {
      pruneLocalMetadata(metadata, now());
      if (stableValue(metadata) !== before) await setRecord(CONTENT_SYNC_META_KEY, metadata, "state");
    }
  }

  async function reconcileDataset(name, allSyncRecords, metadata) {
    const definition = CONTENT_SYNC_DATASETS[name];
    const datasetMeta = { ...(metadata.datasets[name] || {}) };
    const remoteRecords = await readRemoteSyncRecords(name, allSyncRecords);
    const writes = {};
    const currentTime = now();
    const operationTime = nextSyncTime(datasetMeta, remoteRecords, currentTime);
    // Read and merge under the same queue as local saves, after the remote read.
    const localChanged = await clientStateStore.mutate(async (clientState) => {
      const source = inspectLocalSyncEntries(name, clientState[definition.localKey]);
      const localEntries = source.entries;
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
        if (jsonBytes(record) > MAX_SYNC_RECORD_BYTES) throw syncError("tooLarge");
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
        // Retain the published reader's normalization for harmless additions,
        // but never let a lossy local parse overwrite or delete remote data.
        if (source.error && Object.entries(writes).some(([key, record]) => record.deleted || Object.hasOwn(allSyncRecords, key))) throw syncError(source.error);
        assertSyncStorageBudget(allSyncRecords, writes);
        await storage.set(writes);
        Object.assign(allSyncRecords, writes);
        for (const [id, value] of writeMetadata) datasetMeta[id] = value;
      }
      const serialized = serializeLocalEntries(name, mergedEntries, clientState[definition.localKey]);
      const changed = remoteChanged && serialized !== String(clientState[definition.localKey] ?? "");
      return { values: changed ? { [definition.localKey]: serialized } : {}, result: changed };
    });
    metadata.datasets[name] = datasetMeta;
    await pruneRemoteTombstones(definition, remoteRecords.filter(record => !Object.hasOwn(writes, record.storageKey)), currentTime, allSyncRecords);
    if (localChanged) {
      const latest = await clientStateStore.read();
      broadcast("content-sync.changed", { values: { [definition.localKey]: latest[definition.localKey] } });
    }
  }

  async function clearDatasets(names) {
    if (!names.length) return;
    const records = await storage.get(null);
    const keys = Object.keys(records).filter(key => names.some(name => key.startsWith(CONTENT_SYNC_DATASETS[name].prefix)));
    if (keys.length) await storage.remove(keys);
    const metadata = await readMetadata();
    const changed = names.some(name => Object.hasOwn(metadata.datasets, name));
    for (const name of names) delete metadata.datasets[name];
    if (changed) await setRecord(CONTENT_SYNC_META_KEY, metadata, "state");
  }

  async function pruneRemoteTombstones(definition, records, currentTime, allRecords) {
    const tombstones = records.filter((record) => record.deleted === true)
      .sort((left, right) => right.updatedAt - left.updatedAt);
    const staleBefore = currentTime - CONTENT_SYNC_TOMBSTONE_RETENTION_MS;
    const keys = tombstones
      .filter((record, index) => record.updatedAt < staleBefore || index >= MAX_TOMBSTONES_PER_DATASET)
      .map((record) => record.storageKey)
      .filter((key) => key.startsWith(definition.prefix));
    if (keys.length) {
      await storage.remove(keys);
      for (const key of keys) delete allRecords[key];
    }
  }

  function enqueue(action, exclusive = false) {
    const operation = operationQueue.then(() => {
      if (!exclusive && !canSync()) throw syncError("partial");
      return action();
    });
    operationQueue = operation.catch(() => {});
    return operation;
  }
}

async function readMetadataFrom(getRecord) {
  const value = await getRecord(CONTENT_SYNC_META_KEY, null);
  if (!value || value.version !== 1 || typeof value.datasets !== "object" || Array.isArray(value.datasets)) {
    return { version: 1, datasets: {} };
  }
  return { version: 1, datasets: { ...value.datasets } };
}
