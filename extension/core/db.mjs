import { CACHE_LIMIT_BYTES, CACHE_RETENTION_MS, DB_NAME, DB_VERSION } from "./constants.mjs";
import { DEFAULT_LOCALE, translate } from "./runtime-i18n.mjs";

let databasePromise;

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

export async function setRecord(key, value, kind = "state") {
  await setRecords([{ key, value, kind }]);
  return value;
}

export async function setRecords(entries = []) {
  const records = entries.map(({ key, value, kind = "state" }) => createRecord(key, value, kind));
  if (!records.length) return [];
  const db = await openDatabase();
  await transactionDone(db.transaction("records", "readwrite"), (store) => {
    for (const record of records) store.put(record);
  });
  if (records.some((record) => record.kind === "cache")) await pruneCache();
  return records.map((record) => record.value);
}

export async function deleteRecord(key) {
  const db = await openDatabase();
  await transactionDone(db.transaction("records", "readwrite"), (store) => store.delete(key));
}

export async function listRecords(kind = "") {
  const db = await openDatabase();
  const records = await requestResult(db.transaction("records", "readonly").objectStore("records").getAll());
  return kind ? records.filter((record) => record.kind === kind) : records;
}

export async function clearRecords(kind = "") {
  const db = await openDatabase();
  if (!kind) {
    await transactionDone(db.transaction("records", "readwrite"), (store) => store.clear());
    return;
  }
  const transaction = db.transaction("records", "readwrite");
  const store = transaction.objectStore("records");
  const request = store.index("kind").getAllKeys(kind);
  request.onsuccess = () => request.result.forEach((key) => store.delete(key));
  request.onerror = () => transaction.abort();
  await transactionComplete(transaction);
}

export async function pruneCache(now = Date.now()) {
  const db = await openDatabase();
  const transaction = db.transaction("records", "readwrite");
  const store = transaction.objectStore("records");
  const request = store.index("kind").getAll("cache");
  let result = { removed: 0, size: 0 };
  request.onsuccess = () => {
    const { remove, remainingSize } = recordsToPrune(request.result, now);
    remove.forEach((record) => store.delete(record.key));
    result = { removed: remove.length, size: remainingSize };
  };
  request.onerror = () => transaction.abort();
  await transactionComplete(transaction);
  return result;
}

export function recordsToPrune(input, now = Date.now()) {
  const records = [...(input || [])].sort((left, right) => left.updatedAt - right.updatedAt);
  const expiredBefore = now - CACHE_RETENTION_MS;
  const remove = records.filter((record) => record.updatedAt < expiredBefore);
  const removing = new Set(remove);
  let remainingSize = records.reduce((total, record) => total + Number(record.size || 0), 0)
    - remove.reduce((total, record) => total + Number(record.size || 0), 0);
  for (const record of records) {
    if (removing.has(record) || remainingSize <= CACHE_LIMIT_BYTES) continue;
    remove.push(record);
    removing.add(record);
    remainingSize -= Number(record.size || 0);
  }
  return { remove, remainingSize };
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || databaseError("background.error.databaseRequest"));
  });
}

function transactionDone(transaction, action) {
  action(transaction.objectStore("records"));
  return transactionComplete(transaction);
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

function createRecord(key, value, kind) {
  const json = JSON.stringify(value);
  return {
    key,
    value,
    kind,
    updatedAt: Date.now(),
    size: new TextEncoder().encode(json === undefined ? "" : json).byteLength,
  };
}
