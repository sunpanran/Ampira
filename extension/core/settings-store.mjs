import { LOCAL_ONLY_SETTINGS_FIELDS, SETTINGS_KEY } from "./constants.mjs";
import { normalizeSettings } from "./settings.mjs";
import { decodeSettingsFromSync, encodeSettingsForSync, settingsChunkKeys } from "./settings-storage.mjs";
import { assertSyncStorageBudget } from "./sync-budget.mjs";

export function createSettingsStore(storage) {
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
    return normalizeSettings(decodeSettingsFromSync({ ...storedRoot, ...storedChunks }));
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
    await storage.set(records);
    if (staleKeys.length) await storage.remove(staleKeys);
    return normalized;
  }

  function mutate(action) {
    if (typeof action !== "function") return Promise.reject(new TypeError("Settings mutation must be a function"));
    return enqueue(() => action(transaction));
  }

  function reset() {
    return enqueue(() => storage.clear());
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
