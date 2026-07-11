import { LOCAL_ONLY_SETTINGS_FIELDS, SETTINGS_KEY } from "./constants.mjs";
import { normalizeSettings } from "./settings.mjs";
import { decodeSettingsFromSync, encodeSettingsForSync, settingsChunkKeys } from "./settings-storage.mjs";

export function createSettingsStore(storage) {
  let mutationQueue = Promise.resolve();
  const transaction = Object.freeze({ read, write: writeUnqueued });

  return {
    read,
    write,
    mutate,
    sanitizeLocalOnlyFields,
    sanitizeLegacyCredentials,
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
    const previous = await storage.get(SETTINGS_KEY);
    const previousChunkKeys = settingsChunkKeys(previous[SETTINGS_KEY]);
    const records = encodeSettingsForSync(withoutLocalOnlyFields(normalized));
    await storage.set(records);
    const nextKeys = new Set(Object.keys(records));
    const staleKeys = previousChunkKeys.filter((key) => !nextKeys.has(key));
    if (staleKeys.length) await storage.remove(staleKeys);
    return normalized;
  }

  function mutate(action) {
    if (typeof action !== "function") return Promise.reject(new TypeError("Settings mutation must be a function"));
    return enqueue(() => action(transaction));
  }

  function sanitizeLegacyCredentials() {
    return sanitizeLocalOnlyFields();
  }

  function sanitizeLocalOnlyFields() {
    return mutate(async () => {
      const stored = await storage.get(SETTINGS_KEY);
      const root = stored[SETTINGS_KEY];
      if (!root || typeof root !== "object" || !LOCAL_ONLY_SETTINGS_FIELDS.some((key) => Object.hasOwn(root, key))) return false;
      const sanitized = { ...root };
      for (const key of LOCAL_ONLY_SETTINGS_FIELDS) delete sanitized[key];
      await storage.set({ [SETTINGS_KEY]: sanitized });
      return true;
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
