import { LOCAL_CUSTOM_FEEDS_KEY, SETTINGS_KEY } from "./constants.mjs";
import { normalizeSettings } from "./settings.mjs";
import { removeUnusedSettingsChunks, settingsChunkKeys } from "./settings-storage.mjs";
import { assertSyncStorageBudget } from "./sync-budget.mjs";
import { prepareSettingsSyncWrite, readCompleteSyncSettings, syncSettingsValue } from "./sync-snapshot.mjs";
import { syncError } from "./sync-values.mjs";

export const LOCAL_SETTINGS_MIRROR_KEY = "ampira.settings.local.v1";

export function createSettingsStore(storage, localStorage, { canWrite = () => true } = {}) {
  let mutationQueue = Promise.resolve();
  let remoteReadsPaused = false;
  const transaction = Object.freeze({ read, write: writeUnqueued });

  return {
    read,
    write,
    mutate,
    reset,
    readLocal,
    exclusive: (action) => enqueue(async () => {
      remoteReadsPaused = true;
      try { return await action({ readLocal, applyLocal }); }
      finally { remoteReadsPaused = false; }
    }, true),
  };

  async function read() {
    if ((remoteReadsPaused || !canWrite()) && localStorage) return readLocal();
    const storedRoot = await storage.get(SETTINGS_KEY);
    const chunkKeys = settingsChunkKeys(storedRoot[SETTINGS_KEY]);
    const storedChunks = chunkKeys.length ? await storage.get(chunkKeys) : {};
    const local = localStorage ? await localStorage.get([LOCAL_CUSTOM_FEEDS_KEY, LOCAL_SETTINGS_MIRROR_KEY]) : {};
    if ((remoteReadsPaused || !canWrite()) && localStorage) return readLocal();
    const records = { ...storedRoot, ...storedChunks };
    const mirror = local[LOCAL_SETTINGS_MIRROR_KEY];
    let synced;
    try { synced = await readCompleteSyncSettings(records); }
    catch (error) {
      if (!validMirror(mirror)) throw error;
      return normalizeSettings({ ...mirror.settings, customFeeds: local[LOCAL_CUSTOM_FEEDS_KEY] || [] });
    }
    if ((remoteReadsPaused || !canWrite()) && localStorage) return readLocal();
    const source = JSON.stringify(synced);
    const settings = validMirror(mirror) && (mirror.source === source || !synced) ? mirror.settings : synced || {};
    if (localStorage && (!validMirror(mirror) || mirror.source !== source && synced)) await applyLocal(settings, synced);
    return normalizeSettings({
      ...settings,
      customFeeds: local[LOCAL_CUSTOM_FEEDS_KEY] || [],
    });
  }

  async function readLocal({ allowInvalidSync = false } = {}) {
    if (!localStorage) return read();
    const local = await localStorage.get([LOCAL_SETTINGS_MIRROR_KEY, LOCAL_CUSTOM_FEEDS_KEY]);
    if (validMirror(local[LOCAL_SETTINGS_MIRROR_KEY])) return normalizeSettings({
      ...local[LOCAL_SETTINGS_MIRROR_KEY].settings, customFeeds: local[LOCAL_CUSTOM_FEEDS_KEY] || [],
    });
    let synced;
    try { synced = await readCompleteSyncSettings(await storage.get(null)); }
    catch (error) {
      if (!allowInvalidSync) throw error;
      return normalizeSettings({ customFeeds: local[LOCAL_CUSTOM_FEEDS_KEY] || [] });
    }
    await applyLocal(synced || {}, synced);
    return normalizeSettings({ ...synced, customFeeds: local[LOCAL_CUSTOM_FEEDS_KEY] || [] });
  }

  async function applyLocal(settings, source = settings) {
    if (!localStorage) return;
    const mirror = { version: 1, settings: syncSettingsValue(settings), source: JSON.stringify(source ? syncSettingsValue(source) : null) };
    const previous = (await localStorage.get(LOCAL_SETTINGS_MIRROR_KEY))[LOCAL_SETTINGS_MIRROR_KEY];
    if (JSON.stringify(previous) !== JSON.stringify(mirror)) await localStorage.set({ [LOCAL_SETTINGS_MIRROR_KEY]: mirror });
  }

  function write(settings) {
    return enqueue(() => writeUnqueued(settings));
  }

  async function writeUnqueued(settings) {
    const normalized = normalizeSettings(settings);
    const allRecords = await storage.get(null);
    // Never publish a new settings root over an incomplete incoming snapshot.
    const { writes, removals } = await prepareSettingsSyncWrite(allRecords, normalized);
    assertSyncStorageBudget(allRecords, writes);
    const previousLocal = localStorage ? await localStorage.get(LOCAL_CUSTOM_FEEDS_KEY) : {};
    const feedsChanged = localStorage && JSON.stringify(previousLocal[LOCAL_CUSTOM_FEEDS_KEY] || []) !== JSON.stringify(normalized.customFeeds);
    if (feedsChanged) await localStorage.set({ [LOCAL_CUSTOM_FEEDS_KEY]: normalized.customFeeds });
    try {
      if (Object.keys(writes).length) await storage.set(writes);
    } catch (error) {
      if (feedsChanged) await localStorage.set({ [LOCAL_CUSTOM_FEEDS_KEY]: previousLocal[LOCAL_CUSTOM_FEEDS_KEY] || [] });
      throw error;
    }
    await removeUnusedSettingsChunks(storage, removals);
    await applyLocal(normalized);
    return normalized;
  }

  function mutate(action) {
    if (typeof action !== "function") return Promise.reject(new TypeError("Settings mutation must be a function"));
    return enqueue(() => action(transaction));
  }

  function reset() {
    return enqueue(async () => {
      await storage.clear();
      if (localStorage) await localStorage.remove([LOCAL_CUSTOM_FEEDS_KEY, LOCAL_SETTINGS_MIRROR_KEY]);
    }, true);
  }

  function enqueue(action, exclusive = false) {
    const operation = mutationQueue.then(() => {
      if (!exclusive && !canWrite()) throw syncError("partial");
      return action();
    });
    mutationQueue = operation.then(() => undefined, () => undefined);
    return operation;
  }
}

function validMirror(value) {
  return value?.version === 1 && value.settings && typeof value.settings === "object"
    && !Array.isArray(value.settings) && typeof value.source === "string";
}
