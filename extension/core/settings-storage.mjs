import { SETTINGS_KEY } from "./constants.mjs";

const MAX_SYNC_ITEM_BYTES = 7000;
const MAX_SYNC_TOTAL_BYTES = 90 * 1024;
const CHUNK_FIELDS = ["bookmarkOnlyFolders", "excludedNewsSources"];
const CHUNK_PREFIX = `${SETTINGS_KEY}.chunk`;

export function encodeSettingsForSync(settings) {
  const normalized = settings && typeof settings === "object" ? settings : {};
  if (jsonBytes(normalized) <= MAX_SYNC_ITEM_BYTES) return { [SETTINGS_KEY]: normalized };

  const root = { ...normalized };
  const records = {};
  const fields = {};
  for (const field of CHUNK_FIELDS) {
    const chunks = chunkItems(Array.isArray(root[field]) ? root[field] : []);
    root[field] = [];
    fields[field] = chunks.map((chunk, index) => {
      const key = `${CHUNK_PREFIX}.${field}.${index}`;
      records[key] = chunk;
      return key;
    });
  }
  root.settingsChunks = { version: 1, fields };
  if (jsonBytes(root) > MAX_SYNC_ITEM_BYTES) throw settingsTooLargeError(jsonBytes(root));
  records[SETTINGS_KEY] = root;
  const totalBytes = Object.entries(records).reduce((total, [key, value]) => total + jsonBytes(key) + jsonBytes(value), 0);
  if (totalBytes > MAX_SYNC_TOTAL_BYTES) throw settingsTooLargeError(totalBytes);
  return records;
}

export function decodeSettingsFromSync(records = {}) {
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

function jsonBytes(value) {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function settingsTooLargeError(bytes) {
  const error = new Error("SETTINGS_SYNC_ITEM_TOO_LARGE");
  error.code = "SETTINGS_SYNC_ITEM_TOO_LARGE";
  error.bytes = bytes;
  return error;
}
