import { SETTINGS_KEY } from "./constants.mjs";
import { MAX_SYNC_RECORD_BYTES, syncError, syncValueBytes as jsonBytes, syncValueDigest } from "./sync-values.mjs";

const MAX_SYNC_ITEM_BYTES = MAX_SYNC_RECORD_BYTES;
const MAX_SYNC_TOTAL_BYTES = 90 * 1024;
const CHUNK_FIELDS = ["bookmarkOnlyFolders", "hiddenBookmarkCategories", "websiteShortcuts", "excludedNewsSources"];
const CHUNK_PREFIX = `${SETTINGS_KEY}.chunk`;

export async function encodeSettingsForSync(settings) {
  const normalized = settings && typeof settings === "object" ? settings : {};
  if (jsonBytes(normalized) <= MAX_SYNC_ITEM_BYTES) return { [SETTINGS_KEY]: normalized };

  const root = { ...normalized };
  const records = {};
  const fields = {};
  const hashes = {};
  for (const field of CHUNK_FIELDS) {
    const chunks = chunkItems(Array.isArray(root[field]) ? root[field] : []);
    root[field] = [];
    fields[field] = chunks.map((chunk, index) => {
      const key = `${CHUNK_PREFIX}.${field}.${index}`;
      records[key] = chunk;
      return key;
    });
    hashes[field] = await Promise.all(chunks.map(syncValueDigest));
  }
  // The published v1 reader follows `fields` and ignores additive metadata.
  // Digests bind every chunk to this root without doubling sync storage usage.
  root.settingsChunks = { version: 1, fields, hashes };
  if (jsonBytes(root) > MAX_SYNC_ITEM_BYTES) throw settingsTooLargeError(jsonBytes(root));
  records[SETTINGS_KEY] = root;
  const totalBytes = Object.entries(records).reduce((total, [key, value]) => total + jsonBytes(key) + jsonBytes(value), 0);
  if (totalBytes > MAX_SYNC_TOTAL_BYTES) throw settingsTooLargeError(totalBytes);
  return records;
}

function decodeSettingsPayload(records = {}) {
  const root = records?.[SETTINGS_KEY];
  if (!root || typeof root !== "object" || Array.isArray(root)) return {};
  const decoded = { ...root };
  const fields = root.settingsChunks?.version === 1 ? root.settingsChunks.fields : null;
  if (fields && typeof fields === "object") {
    for (const field of CHUNK_FIELDS) {
      const keys = Array.isArray(fields[field]) ? fields[field] : [];
      decoded[field] = keys.flatMap((key) => Array.isArray(records[key]) ? records[key] : []);
    }
  }
  delete decoded.settingsChunks;
  return decoded;
}

export async function decodeSettingsFromSync(records = {}) {
  if (!Object.hasOwn(records, SETTINGS_KEY) || records[SETTINGS_KEY] === undefined) return null;
  const root = records[SETTINGS_KEY];
  if (!root || typeof root !== "object" || Array.isArray(root)
    || root.schemaVersion !== undefined && root.schemaVersion !== 1) throw syncError("invalid");
  const chunks = root.settingsChunks;
  if (chunks !== undefined) {
    if (!chunks || chunks.version !== 1 || !chunks.fields || typeof chunks.fields !== "object" || Array.isArray(chunks.fields)) throw syncError("invalid");
    const hashed = Object.hasOwn(chunks, "hashes");
    if (hashed && (!chunks.hashes || typeof chunks.hashes !== "object" || Array.isArray(chunks.hashes)
      || Object.keys(chunks.hashes).some(field => !Object.hasOwn(chunks.fields, field)))) throw syncError("invalid");
    for (const [field, keys] of Object.entries(chunks.fields)) {
      if (!CHUNK_FIELDS.includes(field) || !Array.isArray(keys)
        || keys.some((key, index) => key !== `${CHUNK_PREFIX}.${field}.${index}` || !Array.isArray(records[key]))) throw syncError("invalid");
      if (hashed) {
        const expected = chunks.hashes[field];
        if (!Array.isArray(expected) || expected.length !== keys.length
          || expected.some(hash => typeof hash !== "string" || !/^[a-f0-9]{64}$/.test(hash))) throw syncError("invalid");
        const actual = await Promise.all(keys.map(key => syncValueDigest(records[key])));
        if (actual.some((hash, index) => hash !== expected[index])) throw syncError("invalid");
      }
    }
  }
  return decodeSettingsPayload(records);
}

// Call while holding the settings writer's queue. Recheck live references so
// cleanup never relies solely on a plan prepared before the user confirmed it.
export async function removeUnusedSettingsChunks(storage, candidates = []) {
  if (!candidates.length) return;
  const current = await storage.get(SETTINGS_KEY);
  const referenced = new Set(settingsChunkKeys(current[SETTINGS_KEY]));
  const stale = candidates.filter(key => typeof key === "string" && key.startsWith(`${CHUNK_PREFIX}.`) && !referenced.has(key));
  if (stale.length) await storage.remove(stale);
}

export function settingsChunkKeys(root) {
  const fields = root?.settingsChunks?.version === 1 ? root.settingsChunks.fields : null;
  if (!fields || typeof fields !== "object") return [];
  return [...new Set(CHUNK_FIELDS.flatMap((field) => Array.isArray(fields[field]) ? fields[field] : []))]
    .filter((key) => typeof key === "string" && key.startsWith(`${CHUNK_PREFIX}.`));
}

function chunkItems(items) {
  const chunks = [];
  let current = [];
  for (const item of items) {
    const candidate = [...current, item];
    if (jsonBytes(candidate) <= MAX_SYNC_ITEM_BYTES) {
      current = candidate;
      continue;
    }
    if (!current.length) throw settingsTooLargeError(jsonBytes(candidate));
    chunks.push(current);
    current = [item];
    if (jsonBytes(current) > MAX_SYNC_ITEM_BYTES) throw settingsTooLargeError(jsonBytes(current));
  }
  if (current.length) chunks.push(current);
  return chunks;
}

function settingsTooLargeError(bytes) {
  const error = new Error("SETTINGS_SYNC_ITEM_TOO_LARGE");
  error.code = "SETTINGS_SYNC_ITEM_TOO_LARGE";
  error.bytes = bytes;
  return error;
}
