// Published v1 reader from origin/main (a46604f). Keep this fixture unchanged:
// it checks that additive integrity metadata does not break installed readers.
const SETTINGS_KEY = "ampira.settings.v1";
const CHUNK_FIELDS = ["bookmarkOnlyFolders", "hiddenBookmarkCategories", "websiteShortcuts", "excludedNewsSources"];

export function readPublishedSettings(records = {}) {
  const root = records?.[SETTINGS_KEY];
  if (!root || typeof root !== "object" || Array.isArray(root)) return {};
  const decoded = { ...root };
  const fields = root.settingsChunks?.version === 1 ? root.settingsChunks.fields : null;
  if (fields && typeof fields === "object") {
    for (const field of CHUNK_FIELDS) {
      const keys = Array.isArray(fields[field]) ? fields[field] : [];
      decoded[field] = keys.flatMap(key => Array.isArray(records[key]) ? records[key] : []);
    }
  }
  delete decoded.settingsChunks;
  return decoded;
}
