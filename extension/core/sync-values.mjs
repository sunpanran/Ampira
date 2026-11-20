export const MAX_SYNC_RECORD_BYTES = 7000;

export function syncError(code) {
  return Object.assign(new Error(code), { code: `SYNC_${code}`, messageKey: `settings.sync.error.${code}`, retryable: true });
}

export function stableSyncValue(value) {
  if (Array.isArray(value)) return `[${value.map(stableSyncValue).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableSyncValue(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

export function syncValueBytes(value) {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

export async function syncValueDigest(value) {
  const bytes = new TextEncoder().encode(stableSyncValue(value));
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("");
}
