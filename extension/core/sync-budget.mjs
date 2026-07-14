export const SYNC_STORAGE_SAFETY_BYTES = 90 * 1024;

export function syncStorageBytes(records = {}) {
  return Object.entries(records || {}).reduce((total, [key, value]) => (
    total + jsonBytes(key) + jsonBytes(value)
  ), 0);
}

export function projectedSyncStorage(records = {}, writes = {}, removals = []) {
  const projected = { ...(records || {}) };
  for (const key of Array.isArray(removals) ? removals : []) delete projected[key];
  Object.assign(projected, writes || {});
  return projected;
}

export function assertSyncStorageBudget(records = {}, writes = {}, removals = []) {
  const bytes = syncStorageBytes(projectedSyncStorage(records, writes, removals));
  if (bytes <= SYNC_STORAGE_SAFETY_BYTES) return bytes;
  const error = new Error("SYNC_STORAGE_TOTAL_TOO_LARGE");
  error.code = "SYNC_STORAGE_TOTAL_TOO_LARGE";
  error.messageKey = "background.error.syncStorageFull";
  error.messageParams = { bytes, limit: SYNC_STORAGE_SAFETY_BYTES };
  error.retryable = false;
  throw error;
}

function jsonBytes(value) {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}
