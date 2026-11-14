import { LOCAL_CUSTOM_FEEDS_KEY, LOCAL_ONLY_SETTINGS_FIELDS, SETTINGS_KEY } from "./constants.mjs";
import { normalizeSettings } from "./settings.mjs";
import { decodeSettingsFromSync, encodeSettingsForSync, settingsChunkKeys } from "./settings-storage.mjs";
import { assertSyncStorageBudget } from "./sync-budget.mjs";

export function createSettingsStore(storage, localStorage) {
  let mutationQueue = Promise.resolve();
  const transaction = Object.freeze({ read, write: writeUnqueued });

  return {
    read,
    write,
    mutate,
    reset,
  };

  async function read() {
    const storedRoot = await storage.get(SETTINGS_KEY);
    const chunkKeys = settingsChunkKeys(storedRoot[SETTINGS_KEY]);
    const storedChunks = chunkKeys.length ? await storage.get(chunkKeys) : {};
    const local = localStorage ? await localStorage.get(LOCAL_CUSTOM_FEEDS_KEY) : {};
    return normalizeSettings({
      ...decodeSettingsFromSync({ ...storedRoot, ...storedChunks }),
      customFeeds: local[LOCAL_CUSTOM_FEEDS_KEY] || [],
    });
  }

  function write(settings) {
    return enqueue(() => writeUnqueued(settings));
  }

  async function writeUnqueued(settings) {
    const normalized = normalizeSettings(settings);
    const allRecords = await storage.get(null);
    const previous = { [SETTINGS_KEY]: allRecords[SETTINGS_KEY] };
    const previousChunkKeys = settingsChunkKeys(previous[SETTINGS_KEY]);
    const records = encodeSettingsForSync(withoutLocalOnlyFields(normalized));
    const nextKeys = new Set(Object.keys(records));
    const staleKeys = previousChunkKeys.filter((key) => !nextKeys.has(key));
    assertSyncStorageBudget(allRecords, records, staleKeys);
    const previousLocal = localStorage ? await localStorage.get(LOCAL_CUSTOM_FEEDS_KEY) : {};
    const feedsChanged = localStorage && JSON.stringify(previousLocal[LOCAL_CUSTOM_FEEDS_KEY] || []) !== JSON.stringify(normalized.customFeeds);
    if (feedsChanged) await localStorage.set({ [LOCAL_CUSTOM_FEEDS_KEY]: normalized.customFeeds });
    try {
      await storage.set(records);
    } catch (error) {
      if (feedsChanged) await localStorage.set({ [LOCAL_CUSTOM_FEEDS_KEY]: previousLocal[LOCAL_CUSTOM_FEEDS_KEY] || [] });
      throw error;
    }
    if (staleKeys.length) await storage.remove(staleKeys);
    return normalized;
  }

  function mutate(action) {
    if (typeof action !== "function") return Promise.reject(new TypeError("Settings mutation must be a function"));
    return enqueue(() => action(transaction));
  }

  function reset() {
    return enqueue(async () => {
      await storage.clear();
      if (localStorage) await localStorage.remove(LOCAL_CUSTOM_FEEDS_KEY);
    });
  }

  function enqueue(action) {
    const operation = mutationQueue.then(action);
    mutationQueue = operation.then(() => undefined, () => undefined);
    return operation;
  }
}

function withoutLocalOnlyFields(settings) {
  const synced = { ...settings };
  for (const key of LOCAL_ONLY_SETTINGS_FIELDS) delete synced[key];
  return synced;
}
