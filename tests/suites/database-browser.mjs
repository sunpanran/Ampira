import * as database from "../../extension/core/db.mjs";
import { DB_NAME, CACHE_LIMIT_BYTES, CACHE_RETENTION_MS } from "../../extension/core/constants.mjs";

// Run only in a fresh browser context on the dedicated loopback test page.
// This suite never opens an extension origin or a user's Chrome profile.
export async function runDatabaseBrowserTests() {
  if (location.protocol !== "http:" || location.hostname !== "127.0.0.1" || location.pathname !== "/tests/browser/database.html") {
    throw new Error("Database tests require the isolated loopback test page");
  }
  const checks = [];
  const check = (condition, name) => {
    if (!condition) throw new Error(name);
    checks.push(name);
  };
  await requestResult(indexedDB.deleteDatabase(DB_NAME));
  const now = Date.now();
  const legacy = indexedDB.open(DB_NAME, 1);
  legacy.onupgradeneeded = () => {
    const store = legacy.result.createObjectStore("records", { keyPath: "key" });
    store.createIndex("updatedAt", "updatedAt");
    store.createIndex("kind", "kind");
    for (const record of [
      { key: "client-state", value: { synthetic: true }, kind: "state", updatedAt: now, size: 18 },
      { key: "expired", value: "old", kind: "cache", updatedAt: now - CACHE_RETENTION_MS - 1, size: 5 },
      { key: "fresh", value: "fresh", kind: "cache", updatedAt: now, size: 7 },
    ]) store.put(record);
  };
  (await requestResult(legacy)).close();
  const db = await database.openDatabase();
  check(db.objectStoreNames.contains("cache-metadata"), "v1 databases gain the metadata store");
  check((await database.getRecord("client-state")).synthetic === true, "migration preserves client state");
  check((await readTotal(db)) === 12, "migration accounts for all legacy cache bytes");
  const pruned = await database.pruneCache(now);
  check(pruned.removed === 1 && pruned.size === 7, "migration preserves the thirty-day expiration policy");

  let contentScans = 0;
  const originalStoreGetAll = IDBObjectStore.prototype.getAll;
  const originalIndexGetAll = IDBIndex.prototype.getAll;
  IDBObjectStore.prototype.getAll = function (...args) {
    if (this.name === "records") contentScans += 1;
    return originalStoreGetAll.apply(this, args);
  };
  IDBIndex.prototype.getAll = function (...args) {
    if (this.objectStore.name === "records") contentScans += 1;
    return originalIndexGetAll.apply(this, args);
  };
  try {
    for (let index = 0; index < 50; index += 1) {
      await database.setRecord(`synthetic-${index}`, { text: "Synthetic cache content" }, "cache");
    }
    check(contentScans === 0, "fifty cache writes perform zero full-content scans");
  } finally {
    IDBObjectStore.prototype.getAll = originalStoreGetAll;
    IDBIndex.prototype.getAll = originalIndexGetAll;
  }
  await assertAccounting(db, check, "accounting after repeated writes");
  await database.setRecords([
    { key: "duplicate", value: "first", kind: "cache" },
    { key: "duplicate", value: "last", kind: "cache" },
    { key: "fresh", value: { state: true }, kind: "state" },
  ]);
  check(await database.getRecord("duplicate") === "last", "duplicate batch keys use the final value");
  await assertAccounting(db, check, "accounting after duplicate keys and cache-to-state conversion");
  await Promise.all([
    ...Array.from({ length: 12 }, (_, index) => database.setRecord(`concurrent-${index}`, `${index}`, "cache")),
    database.deleteRecord("duplicate"),
  ]);
  await assertAccounting(db, check, "concurrent writes and deletion keep atomic accounting");

  const beforeFailure = await readTotal(db);
  const suppressExpectedError = (event) => {
    if (String(event.message).includes("could not be cloned")) event.preventDefault();
  };
  window.addEventListener("error", suppressExpectedError);
  let rejected = false;
  try {
    await database.setRecords([
      { key: "rollback", value: "must roll back", kind: "cache" },
      { key: "uncloneable", value: { callback() {} }, kind: "cache" },
    ]);
  } catch {
    rejected = true;
  } finally {
    window.removeEventListener("error", suppressExpectedError);
  }
  check(rejected && await database.getRecord("rollback") === null, "failed writes roll back the whole batch");
  check(await readTotal(db) === beforeFailure, "failed writes roll back metadata totals");

  await database.clearRecords("cache");
  check(await readTotal(db) === 0, "clearing caches resets accounting");
  check((await database.getRecord("client-state")).synthetic, "clearing caches preserves client state");
  await database.setRecords([
    { key: "large-a", value: "a".repeat(14 * 1024 * 1024), kind: "cache" },
    { key: "large-b", value: "b".repeat(14 * 1024 * 1024), kind: "cache" },
  ]);
  check(await database.getRecord("large-a") === null, "cache overflow evicts the oldest record");
  check((await database.getRecord("large-b")).length === 14 * 1024 * 1024, "cache overflow retains the newest record");
  await assertAccounting(db, check, "accounting stays below the twenty-five MiB limit");
  await database.clearRecords("cache");
  await database.setRecord("exact-limit", "x".repeat(CACHE_LIMIT_BYTES - 2), "cache");
  check(await readTotal(db) === CACHE_LIMIT_BYTES, "a cache exactly at the size limit is retained");
  await database.setRecord("beyond-limit", "x", "cache");
  check(await database.getRecord("exact-limit") === null, "one additional cache entry triggers immediate eviction");

  await database.clearRecords("cache");
  await database.setRecord("binary-cover", { url: "https://images.example/cover.webp" }, "cache", 8 * 1024 * 1024);
  check(await readTotal(db) > 8 * 1024 * 1024, "external image storage is included in the shared cache budget");
  await database.setRecord("other-content", "x".repeat(18 * 1024 * 1024), "cache");
  check(await database.getRecord("binary-cover") === null, "binary image bytes participate in normal oldest-first eviction");
  await assertAccounting(db, check, "external image eviction preserves shared accounting");
  await database.clearRecords("cache");
  await database.setRecord("ttl", "boundary", "cache");
  const stored = await requestResult(db.transaction("records").objectStore("records").get("ttl"));
  check((await database.pruneCache(stored.updatedAt + CACHE_RETENTION_MS)).removed === 0, "records at the exact retention boundary remain valid");
  check((await database.pruneCache(stored.updatedAt + CACHE_RETENTION_MS + 1)).removed === 1, "records past the retention boundary are removed");
  await database.setRecord("converted", "value", "state");
  await database.setRecord("converted", "value", "cache");
  await database.clearRecords("state");
  check(await database.getRecord("client-state") === null && await database.getRecord("converted") === "value", "clearing state preserves cache entries");
  await assertAccounting(db, check, "state-to-cache conversion preserves accounting");
  const caches = await database.listRecords("cache");
  check(caches.length === 1 && caches[0].key === "converted", "kind-index reads return only the requested records");
  await database.clearRecords();
  check((await database.listRecords()).length === 0 && await readTotal(db) === 0, "factory reset clears records and metadata");
  await database.setRecord("after-reset", "healthy", "cache");
  await assertAccounting(db, check, "writes after reset reconstruct accounting");
  await database.clearRecords();
  return { checks, cacheWrites: 50, fullContentScansDuringWrites: contentScans };
}

async function readTotal(db) {
  return Number((await requestResult(db.transaction("cache-metadata").objectStore("cache-metadata").get("total")))?.size || 0);
}

async function assertAccounting(db, check, name) {
  const records = await database.listRecords("cache");
  const actual = records.reduce((size, record) => size + record.size, 0);
  const total = await readTotal(db);
  check(total === actual && total >= 0 && total <= CACHE_LIMIT_BYTES, name);
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Test database is unexpectedly in use"));
  });
}
