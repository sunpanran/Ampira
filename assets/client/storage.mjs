const memory = new Map();
const locallyWrittenKeys = new Set();
const CLIENT_STATE_KEY_PATTERN = /^dash\.[A-Za-z0-9._-]{1,91}$/;
const MAX_CLIENT_STATE_VALUE_BYTES = 512 * 1024;
let hydrated = false;
let hydratePromise = null;
const pendingWrites = new Map();
let flushTimer = 0;
let flushPromise = null;
let retryDelayMs = 250;

export async function hydrateStorage() {
  if (hydrated) return;
  if (hydratePromise) return hydratePromise;
  hydratePromise = hydrateStorageOnce().finally(() => {
    hydratePromise = null;
  });
  return hydratePromise;
}

async function hydrateStorageOnce() {
  if (hasExtensionRuntime()) {
    try {
      const response = await chrome.runtime.sendMessage({ type: "client-state:get", requestId: crypto.randomUUID() });
      if (!response?.ok || !response.data || typeof response.data !== "object" || Array.isArray(response.data)) return;
      mergeHydratedValues(response.data);
      hydrated = true;
    } catch {
      // Keep hydration retryable when the extension runtime is temporarily unavailable.
    }
    return;
  }
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key && !locallyWrittenKeys.has(key)) memory.set(key, localStorage.getItem(key));
    }
  } catch {
    // Storage may be unavailable in locked-down contexts.
  }
  hydrated = true;
}

export function readJson(key, fallback) {
  try {
    const value = memory.get(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

export function writeJson(key, value) {
  writeValue(key, JSON.stringify(value));
}

export function readNumber(key, fallback) {
  const value = Number(readValue(key));
  return Number.isFinite(value) ? value : fallback;
}

export function readValue(key) {
  return memory.has(key) ? memory.get(key) : null;
}

export function writeValue(key, value) {
  const serialized = String(value);
  memory.set(key, serialized);
  locallyWrittenKeys.add(key);
  if (!isPersistableEntry(key, serialized)) return;
  if (hasExtensionRuntime()) {
    pendingWrites.set(key, serialized);
    scheduleFlush(50);
    return;
  }
  try {
    localStorage.setItem(key, serialized);
  } catch {
    // Best-effort UI state must not block the dashboard.
  }
}

export function applyExternalStoragePatch(values = {}) {
  if (!values || typeof values !== "object" || Array.isArray(values)) return;
  for (const [key, value] of Object.entries(values)) {
    const serialized = String(value);
    if (!isPersistableEntry(key, serialized)) continue;
    if (locallyWrittenKeys.has(key) && memory.get(key) !== serialized) continue;
    memory.set(key, serialized);
    locallyWrittenKeys.delete(key);
  }
}

export async function flushStorage() {
  if (!hasExtensionRuntime()) return;
  if (flushPromise) return flushPromise;
  if (!pendingWrites.size) return;
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = 0;
  const batch = Object.fromEntries(pendingWrites);
  pendingWrites.clear();
  flushPromise = Promise.resolve()
    .then(() => chrome.runtime.sendMessage({
      type: "client-state:set",
      requestId: crypto.randomUUID(),
      payload: { values: batch },
    }))
    .then((response) => {
      if (!response?.ok) throw responseError(response);
      retryDelayMs = 250;
    })
    .catch((error) => {
      if (error?.retryable === false) {
        retryDelayMs = 250;
        return;
      }
      for (const [key, value] of Object.entries(batch)) {
        if (!pendingWrites.has(key)) pendingWrites.set(key, value);
      }
      scheduleFlush(retryDelayMs);
      retryDelayMs = Math.min(5000, retryDelayMs * 2);
    })
    .finally(() => {
      flushPromise = null;
      if (pendingWrites.size && !flushTimer) scheduleFlush(50);
    });
  return flushPromise;
}

function mergeHydratedValues(values) {
  for (const [key, value] of Object.entries(values)) {
    if (!locallyWrittenKeys.has(key)) memory.set(key, String(value));
  }
}

function isPersistableEntry(key, value) {
  return typeof key === "string"
    && CLIENT_STATE_KEY_PATTERN.test(key)
    && new TextEncoder().encode(value).byteLength <= MAX_CLIENT_STATE_VALUE_BYTES;
}

function responseError(response) {
  const error = new Error(response?.error?.message || "CLIENT_STATE_WRITE_FAILED");
  error.retryable = response?.error?.retryable === true;
  return error;
}

function scheduleFlush(delayMs) {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    flushTimer = 0;
    flushStorage();
  }, delayMs);
}

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushStorage();
  });
}

function hasExtensionRuntime() {
  return location.protocol === "chrome-extension:"
    && Boolean(globalThis.chrome?.runtime?.id && globalThis.chrome.runtime.sendMessage);
}
