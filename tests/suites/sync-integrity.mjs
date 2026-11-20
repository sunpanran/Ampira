import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { DEFAULT_SETTINGS, SETTINGS_KEY } from "../../extension/core/constants.mjs";
import { normalizeSettings } from "../../extension/core/settings.mjs";
import { createSettingsStore, LOCAL_SETTINGS_MIRROR_KEY } from "../../extension/core/settings-store.mjs";
import { encodeSettingsForSync, settingsChunkKeys } from "../../extension/core/settings-storage.mjs";
import { readCompleteSyncSettings, syncSettingsValue } from "../../extension/core/sync-snapshot.mjs";
import { createClientStateStore } from "../../extension/core/client-state.mjs";
import { createContentSyncService } from "../../extension/core/content-sync.mjs";
import { CONTENT_SYNC_META_KEY, contentSyncStorageKey } from "../../extension/core/content-sync-records.mjs";
import { createManualSyncService, SYNC_RECOVERY_KEY } from "../../extension/runtime/manual-sync-service.mjs";
import { readPublishedSettings } from "../fixtures/published-sync-settings.mjs";

await checkCleanupSerialization();
await checkIncompleteSnapshots();
await checkMixedSnapshotsAndCompatibility();
await checkInvalidLocalContent();
await checkBatchedSnapshots();
await checkCleanupRecovery();
await checkRecoveryExcludesOtherWriters();
await checkClearWithoutMirror();
await checkRejectedPublishReleasesWriters();
console.log("Sync integrity, published-format compatibility and batched snapshot tests passed");

async function checkCleanupSerialization() {
  const f = await fixture();
  await f.sync.set(await encodeSettingsForSync(syncSettingsValue(large("old", 30))));
  const preview = await f.service.preview({ direction: "upload" });
  const reached = deferred(), release = deferred();
  const remove = f.local.remove;
  f.local.remove = async keys => {
    if (keys === SYNC_RECOVERY_KEY) { reached.resolve(); await release.promise; }
    return remove(keys);
  };
  const applying = f.service.apply({ token: preview.token });
  await reached.promise;
  let saved = false;
  const saving = f.settings.write(large("new", 30)).then(() => { saved = true; });
  try {
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(saved, false, "ordinary saves must wait until manual cleanup and journal finalization finish");
  } finally { release.resolve(); }
  await Promise.all([applying, saving]);
  const records = await f.sync.get(null);
  assert(settingsChunkKeys(records[SETTINGS_KEY]).every(key => Array.isArray(records[key])));
  assert.deepEqual((await readCompleteSyncSettings(records)).excludedNewsSources, large("new", 30).excludedNewsSources);
}

async function checkIncompleteSnapshots() {
  for (const legacy of [false, true]) {
    const complete = await encodeSettingsForSync(syncSettingsValue(large("incoming", 30)));
    if (legacy) delete complete[SETTINGS_KEY].settingsChunks.hashes;
    const missing = settingsChunkKeys(complete[SETTINGS_KEY]).at(-1);
    const partial = structuredClone(complete);
    delete partial[missing];
    const sync = memoryStorage(partial), local = memoryStorage();
    const store = createSettingsStore(sync, local);
    await assert.rejects(store.read(), error => error.code === "SYNC_invalid");
    assert(!Object.hasOwn(await local.get(null), LOCAL_SETTINGS_MIRROR_KEY), "first reads must not create a truncated mirror");
    await assert.rejects(store.write(DEFAULT_SETTINGS), error => error.code === "SYNC_invalid");
    assert.deepEqual(await sync.get(null), partial, "failed integrity checks must not mutate sync storage");
    await sync.set({ [missing]: complete[missing] });
    assert.equal((await store.read()).excludedNewsSources.length, 30);

    const known = await store.readLocal();
    await sync.remove(missing);
    assert.deepEqual(await store.read(), known, "an existing valid mirror remains readable while a chunk is missing");
    await assert.rejects(store.write({ ...known, colorMode: "light" }), error => error.code === "SYNC_invalid");
    assert.deepEqual(await store.readLocal(), known);
  }
}

async function checkMixedSnapshotsAndCompatibility() {
  const old = await encodeSettingsForSync(syncSettingsValue(large("old", 30)));
  const next = await encodeSettingsForSync(syncSettingsValue(large("new", 30)));
  const keys = settingsChunkKeys(next[SETTINGS_KEY]);
  assert(keys.length > 1);
  const mixed = { ...old, [SETTINGS_KEY]: next[SETTINGS_KEY], [keys[0]]: next[keys[0]] };
  await assert.rejects(readCompleteSyncSettings(mixed), error => error.code === "SYNC_invalid");
  assert.deepEqual((await readCompleteSyncSettings(next)).excludedNewsSources, large("new", 30).excludedNewsSources);
  assert.deepEqual(readPublishedSettings(next), syncSettingsValue(large("new", 30)), "the published reader must still understand new chunk records");

  const legacy = structuredClone(old);
  delete legacy[SETTINGS_KEY].settingsChunks.hashes;
  assert.deepEqual(await readCompleteSyncSettings(legacy), syncSettingsValue(large("old", 30)), "saved v1 records without checksums remain readable");
  const legacyStorage = memoryStorage(legacy);
  const legacyStore = createSettingsStore(legacyStorage, memoryStorage());
  await legacyStore.write(await legacyStore.read());
  assert((await legacyStorage.get(SETTINGS_KEY))[SETTINGS_KEY].settingsChunks.hashes, "an explicit save upgrades legacy chunks with integrity metadata");
  const contaminated = memoryStorage({ [SETTINGS_KEY]: { ...DEFAULT_SETTINGS, customFeeds: [{ url: "https://fixture.example/feed" }] } });
  const sanitizedStore = createSettingsStore(contaminated, memoryStorage());
  await sanitizedStore.write(await sanitizedStore.read());
  assert(!Object.hasOwn((await contaminated.get(SETTINGS_KEY))[SETTINGS_KEY], "customFeeds"), "logical no-op saves must still strip device-only fields from old records");
  const released = JSON.parse(await fs.readFile(new URL("../fixtures/released-settings.json", import.meta.url), "utf8"));
  assert.deepEqual(await readCompleteSyncSettings({ [SETTINGS_KEY]: released.settings }), syncSettingsValue(released.settings));
  const invalid = structuredClone(next);
  invalid[SETTINGS_KEY].settingsChunks.hashes.excludedNewsSources = [];
  await assert.rejects(readCompleteSyncSettings(invalid), error => error.code === "SYNC_invalid");
}

async function checkInvalidLocalContent() {
  const f = await fixture({ syncTodosEnabled: true });
  const values = JSON.stringify([todo("valid", "Valid fixture"), todo("damaged", "Remote recovery copy")]);
  await f.client.save({ values: { "dash.utility.todos.v1": values } });
  await f.content.initialize();
  const original = await f.sync.get(null);
  for (const broken of [
    [todo("valid", "Valid fixture"), todo("damaged", "")],
    [todo("valid", "Valid fixture"), todo("valid", "Duplicate id")],
  ]) {
    const patch = { "dash.utility.todos.v1": JSON.stringify(broken) };
    await f.client.save({ values: patch });
    await assert.rejects(f.service.preview({ direction: "upload" }), error => error.code === "SYNC_invalid");
    await assert.rejects(f.content.handleLocalPatch(patch), error => error.code === "SYNC_invalid");
    assert.deepEqual(await f.sync.get(null), original, "partial normalization must not delete valid remote content");
    assert.equal(original[await contentSyncStorageKey("todos", "damaged")].deleted, undefined);
  }
}

async function checkBatchedSnapshots() {
  const f = await fixture({ syncTodosEnabled: true, syncCountdownsEnabled: true });
  const values = {
    "dash.utility.todos.v1": JSON.stringify([todo("one", "Fixture")]),
    "dash.countdown.items.v1": JSON.stringify([{ id: "date", title: "Fixture", date: "2027-01-01" }]),
  };
  await f.client.save({ values });
  f.resetCounts();
  await f.content.initialize();
  assert.equal(f.sync.readAllCount, 1, "one synchronization pass must read sync storage only once");
  assert.deepEqual(f.metaCounts(), { reads: 1, writes: 1 });
  f.resetCounts();
  await f.content.handleLocalPatch(values);
  assert.equal(f.sync.readAllCount, 1);
  assert.deepEqual(f.metaCounts(), { reads: 1, writes: 0 }, "unchanged metadata must not be rewritten");
}

async function checkCleanupRecovery() {
  const f = await fixture({}, { guarded: true });
  await f.sync.set(await encodeSettingsForSync(syncSettingsValue(large("old", 30))));
  const preview = await f.service.preview({ direction: "upload" });
  const remove = f.sync.remove;
  let fail = true;
  f.sync.remove = async keys => {
    if (fail && Array.isArray(keys) && keys.some(key => key.includes(".chunk."))) { fail = false; throw new Error("Synthetic cleanup failure"); }
    return remove(keys);
  };
  await assert.rejects(f.service.apply({ token: preview.token }), error => error.code === "SYNC_partial");
  assert(Object.hasOwn(await f.local.get(null), SYNC_RECOVERY_KEY));
  await assert.rejects(f.settings.write(DEFAULT_SETTINGS), error => error.code === "SYNC_partial");
  await f.restart().recover();
  assert(!Object.hasOwn(await f.local.get(null), SYNC_RECOVERY_KEY));
  assert.equal(Object.keys(await f.sync.get(null)).filter(key => key.includes(".chunk.")).length, 0);
}

async function checkRecoveryExcludesOtherWriters() {
  const f = await fixture({ syncTodosEnabled: true }, { guarded: true });
  const key = "dash.utility.todos.v1";
  await f.client.save({ values: { [key]: JSON.stringify([todo("one", "Local before download")]) } });
  await f.content.initialize();
  const syncKey = await contentSyncStorageKey("todos", "one");
  const stored = (await f.sync.get(null))[syncKey];
  await f.sync.set({ [syncKey]: { ...stored, value: todo("one", "Remote after download"), updatedAt: stored.updatedAt + 1, revision: "next" } });
  const preview = await f.service.preview({ direction: "download" });
  f.failRecord("client-state");
  await assert.rejects(f.service.apply({ token: preview.token }), error => error.code === "SYNC_partial");
  assert.equal(f.service.isReady(), false);
  const remote = await f.sync.get(null);
  await assert.rejects(f.settings.write({ ...DEFAULT_SETTINGS, colorMode: "light" }), error => error.code === "SYNC_partial");
  await assert.rejects(f.content.handleLocalPatch({ [key]: (await f.client.read())[key] }), error => error.code === "SYNC_partial");
  assert.deepEqual(await f.sync.get(null), remote, "automatic sync must not publish the old local value over a pending recovery");
  await f.service.recover();
  assert.equal(JSON.parse((await f.client.read())[key])[0].text, "Remote after download");
  assert.equal(f.service.isReady(), true);
  await f.settings.write({ ...DEFAULT_SETTINGS, syncTodosEnabled: true, colorMode: "light" });
  assert.equal((await f.settings.read()).colorMode, "light");
}

async function checkClearWithoutMirror() {
  const f = await fixture();
  await f.local.remove(LOCAL_SETTINGS_MIRROR_KEY);
  await f.sync.set({ [SETTINGS_KEY]: { schemaVersion: 999 } });
  await assert.rejects(f.settings.read(), error => error.code === "SYNC_invalid");
  const preview = await f.service.preview({ direction: "clear" });
  assert(!Object.hasOwn(await f.local.get(null), LOCAL_SETTINGS_MIRROR_KEY), "clear preview must not turn corrupt settings into a saved mirror");
  await f.service.apply({ token: preview.token });
  assert.deepEqual(await f.sync.get(null), {});
}

async function checkRejectedPublishReleasesWriters() {
  const f = await fixture({}, { guarded: true });
  await f.sync.set(await encodeSettingsForSync(syncSettingsValue(large("remote", 30))));
  const preview = await f.service.preview({ direction: "upload" });
  const set = f.sync.set;
  let rejectOnce = true;
  f.sync.set = async values => {
    if (rejectOnce) { rejectOnce = false; throw new Error("Synthetic rejected publish"); }
    return set(values);
  };
  await assert.rejects(f.service.apply({ token: preview.token }), error => error.code === "SYNC_partial");
  assert.equal(f.service.isReady(), true, "rejected publication with no retained journal must not block later saves");
  await f.settings.write(DEFAULT_SETTINGS);
}

async function fixture(flags = {}, { guarded = false } = {}) {
  const sync = memoryStorage(), local = memoryStorage();
  let activeService;
  const ready = () => !guarded || !activeService || activeService.isReady();
  const settings = createSettingsStore(sync, local, { canWrite: ready });
  const saved = normalizeSettings({ ...DEFAULT_SETTINGS, ...flags });
  await settings.write(saved);
  const records = new Map();
  let reads = 0, writes = 0, failKey = "";
  const getRecord = async (key, fallback) => { if (key === CONTENT_SYNC_META_KEY) reads++; return structuredClone(records.has(key) ? records.get(key) : fallback); };
  const setRecord = async (key, value) => {
    if (failKey === key) { failKey = ""; throw new Error("Synthetic local commit failure"); }
    if (key === CONTENT_SYNC_META_KEY) writes++;
    records.set(key, structuredClone(value));
  };
  const client = createClientStateStore({ getRecord, setRecord });
  const content = createContentSyncService({ storage: sync, clientStateStore: client, getSettings: async () => saved, getRecord, setRecord, now: () => 10000, canSync: ready });
  const options = {
    storage: sync, localStorage: local, settingsStore: settings, contentSyncService: content, clientStateStore: client, getRecord, setRecord,
    withCredentialTransaction: action => action({ capture: async () => ({ providerExists: false, secretsExists: false, syncedExists: false }), applyLocal: async () => {} }),
  };
  activeService = createManualSyncService(options);
  await activeService.recover();
  return { sync, local, settings, client, content, service: activeService, restart: () => activeService = createManualSyncService(options), failRecord: key => { failKey = key; },
    resetCounts() { reads = 0; writes = 0; sync.readAllCount = 0; }, metaCounts: () => ({ reads, writes }) };
}

function large(prefix, count) {
  return normalizeSettings({ ...DEFAULT_SETTINGS, excludedNewsSources: Array.from({ length: count }, (_, index) => ({
    id: `${prefix}-${index}`, type: "source", value: `https://${prefix}-${index}.example.com/${"path/".repeat(60)}`,
    url: `https://${prefix}-${index}.example.com/${"article/".repeat(60)}`, title: `${prefix} ${index} ${"title ".repeat(20)}`, reasonDetail: "failure ".repeat(40),
  })) });
}
function todo(id, text) { return { id, text, completed: false, createdAt: "2026-11-20T00:00:00.000Z", completedAt: "" }; }
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
function memoryStorage(initial = {}) {
  const records = structuredClone(initial);
  const store = {
    readAllCount: 0,
    async get(keys) { if (keys === null) store.readAllCount++; return structuredClone(keys === null ? records : Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter(key => Object.hasOwn(records, key)).map(key => [key, records[key]]))); },
    async set(values) { Object.assign(records, structuredClone(values)); },
    async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) delete records[key]; },
    async clear() { for (const key of Object.keys(records)) delete records[key]; },
  };
  return store;
}
