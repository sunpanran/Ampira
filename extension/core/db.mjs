import { CACHE_LIMIT_BYTES, CACHE_RETENTION_MS, DB_NAME, DB_VERSION } from "./constants.mjs";
import { DEFAULT_LOCALE, translate } from "./runtime-i18n.mjs";

let databasePromise;
const CACHE_METADATA_STORE = "cache-metadata";
const CACHE_TOTAL_KEY = "total";

export function openDatabase() {
  if (!databasePromise) {
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("records")) {
          const store = db.createObjectStore("records", { keyPath: "key" });
          store.createIndex("updatedAt", "updatedAt");
          store.createIndex("kind", "kind");
        }
        if (!db.objectStoreNames.contains(CACHE_METADATA_STORE)) {
          const metadata = db.createObjectStore(CACHE_METADATA_STORE, { keyPath: "key" });
          metadata.createIndex("updatedAt", "updatedAt");
          const cursor = request.transaction.objectStore("records").index("kind").openCursor("cache");
          let size = 0;
          cursor.onsuccess = () => {
            if (!cursor.result) {
              metadata.put({ key: CACHE_TOTAL_KEY, size });
              return;
            }
            const entry = cacheMetadata(cursor.result.value);
            metadata.put(entry);
            size += entry.size;
            cursor.result.continue();
          };
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          databasePromise = null;
        };
        resolve(db);
      };
      request.onerror = () => {
        databasePromise = null;
        reject(request.error || databaseError("background.error.databaseOpen"));
      };
    });
  }
  return databasePromise;
}

export async function getRecord(key, fallback = null) {
  const db = await openDatabase();
  const record = await requestResult(db.transaction("records", "readonly").objectStore("records").get(key));
  return record ? record.value : fallback;
}

export async function setRecord(key, value, kind = "state", externalSize = 0) {
  await setRecords([{ key, value, kind, externalSize }]);
  return value;
}

export async function setRecords(entries = []) {
  const records = entries.map(({ key, value, kind = "state", externalSize = 0 }) => createRecord(key, value, kind, externalSize));
  if (!records.length) return [];
  const db = await openDatabase();
  const transaction = db.transaction(["records", CACHE_METADATA_STORE], "readwrite");
  const done = transactionComplete(transaction);
  const store = transaction.objectStore("records");
  const metadata = transaction.objectStore(CACHE_METADATA_STORE);
  const total = metadata.get(CACHE_TOTAL_KEY);
  total.onsuccess = () => {
    let size = Number(total.result?.size || 0);
    // Last entry wins, as it does for multiple puts in an IndexedDB transaction.
    const distinct = [...new Map(records.map((record) => [record.key, record])).values()];
    let remaining = distinct.length;
    for (const record of distinct) {
      const previous = metadata.get(cacheMetadataKey(record.key));
      previous.onsuccess = () => {
        size -= Number(previous.result?.size || 0);
        store.put(record);
        if (record.kind === "cache") {
          const entry = cacheMetadata(record);
          metadata.put(entry);
          size += entry.size;
        } else metadata.delete(cacheMetadataKey(record.key));
        remaining -= 1;
        if (remaining) return;
        if (records.some((entry) => entry.kind === "cache")) {
          pruneInTransaction(transaction, size, Date.now());
        } else metadata.put({ key: CACHE_TOTAL_KEY, size });
      };
    }
  };
  await done;
  return records.map((record) => record.value);
}

export async function deleteRecord(key) {
  const db = await openDatabase();
  const transaction = db.transaction(["records", CACHE_METADATA_STORE], "readwrite");
  const done = transactionComplete(transaction);
  const metadata = transaction.objectStore(CACHE_METADATA_STORE);
  const total = metadata.get(CACHE_TOTAL_KEY);
  const previous = metadata.get(cacheMetadataKey(key));
  previous.onsuccess = () => {
    transaction.objectStore("records").delete(key);
    metadata.delete(cacheMetadataKey(key));
    metadata.put({ key: CACHE_TOTAL_KEY, size: Number(total.result?.size || 0) - Number(previous.result?.size || 0) });
  };
  await done;
}

export async function listRecords(kind = "") {
  const db = await openDatabase();
  const store = db.transaction("records", "readonly").objectStore("records");
  return requestResult(kind ? store.index("kind").getAll(kind) : store.getAll());
}

export async function clearRecords(kind = "") {
  const db = await openDatabase();
  if (!kind) {
    const transaction = db.transaction(["records", CACHE_METADATA_STORE], "readwrite");
    const done = transactionComplete(transaction);
    transaction.objectStore("records").clear();
    transaction.objectStore(CACHE_METADATA_STORE).clear();
    await done;
    return;
  }
  const transaction = db.transaction(kind === "cache" ? ["records", CACHE_METADATA_STORE] : "records", "readwrite");
  const done = transactionComplete(transaction);
  const store = transaction.objectStore("records");
  const request = store.index("kind").getAllKeys(kind);
  request.onsuccess = () => request.result.forEach((key) => store.delete(key));
  request.onerror = () => transaction.abort();
  if (kind === "cache") transaction.objectStore(CACHE_METADATA_STORE).clear();
  await done;
}

export async function pruneCache(now = Date.now()) {
  const db = await openDatabase();
  const transaction = db.transaction(["records", CACHE_METADATA_STORE], "readwrite");
  const done = transactionComplete(transaction);
  const request = transaction.objectStore(CACHE_METADATA_STORE).get(CACHE_TOTAL_KEY);
  let result = { removed: 0, size: 0 };
  request.onsuccess = () => {
    result = pruneInTransaction(transaction, Number(request.result?.size || 0), now);
  };
  request.onerror = () => transaction.abort();
  await done;
  return result;
}

function pruneInTransaction(transaction, size, now) {
  const metadata = transaction.objectStore(CACHE_METADATA_STORE);
  const store = transaction.objectStore("records");
  const result = { removed: 0, size };
  const request = metadata.index("updatedAt").openCursor();
  request.onsuccess = () => {
    const cursor = request.result;
    if (!cursor || !cacheEntryShouldPrune(cursor.value, result.size, now)) {
      metadata.put({ key: CACHE_TOTAL_KEY, size: result.size });
      return;
    }
    const entry = cursor.value;
    store.delete(entry.recordKey);
    cursor.delete();
    result.size -= entry.size;
    result.removed += 1;
    cursor.continue();
  };
  return result;
}

function cacheMetadataKey(key) {
  return `record:${key}`;
}

function cacheMetadata(record) {
  return { key: cacheMetadataKey(record.key), recordKey: record.key, updatedAt: record.updatedAt, size: Number(record.size || 0) };
}

export function cacheEntryShouldPrune(entry, size, now = Date.now()) {
  return entry.updatedAt < now - CACHE_RETENTION_MS || size > CACHE_LIMIT_BYTES;
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || databaseError("background.error.databaseRequest"));
  });
}

function transactionComplete(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || databaseError("background.error.databaseWrite"));
    transaction.onabort = () => reject(transaction.error || databaseError("background.error.databaseAbort"));
  });
}

function databaseError(messageKey) {
  const error = new Error(translate(DEFAULT_LOCALE, messageKey));
  error.code = "DATABASE_ERROR";
  error.messageKey = messageKey;
  error.messageParams = {};
  return error;
}

function createRecord(key, value, kind, externalSize) {
  const json = JSON.stringify(value);
  return {
    key,
    value,
    kind,
    updatedAt: Date.now(),
    size: new TextEncoder().encode(json === undefined ? "" : json).byteLength
      + (kind === "cache" && Number.isFinite(externalSize) ? Math.max(0, externalSize) : 0),
  };
}
