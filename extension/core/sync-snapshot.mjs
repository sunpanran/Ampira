import { LOCAL_ONLY_SETTINGS_FIELDS, SETTINGS_KEY } from "./constants.mjs";
import { normalizeSettings } from "./settings.mjs";
import { decodeSettingsFromSync, encodeSettingsForSync, settingsChunkKeys } from "./settings-storage.mjs";
import { stableSyncValue } from "./sync-values.mjs";

export function syncSettingsValue(value) {
  const settings = normalizeSettings(value || {});
  for (const key of LOCAL_ONLY_SETTINGS_FIELDS) delete settings[key];
  return settings;
}

export async function readCompleteSyncSettings(records) {
  const decoded = await decodeSettingsFromSync(records);
  return decoded === null ? null : syncSettingsValue(decoded);
}

export async function prepareSettingsSyncWrite(records, settings) {
  const previous = await decodeSettingsFromSync(records);
  const normalized = syncSettingsValue(settings);
  const chunks = records[SETTINGS_KEY]?.settingsChunks;
  const needsIntegrityMetadata = chunks && !Object.hasOwn(chunks, "hashes");
  if (previous && !needsIntegrityMetadata && stableSyncValue(previous) === stableSyncValue(normalized)) return { writes: {}, removals: [] };
  const writes = await encodeSettingsForSync(normalized);
  const removals = settingsChunkKeys(records[SETTINGS_KEY]).filter(key => !Object.hasOwn(writes, key));
  return { writes, removals };
}
