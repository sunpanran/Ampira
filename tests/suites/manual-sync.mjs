import assert from "node:assert/strict";
import {
  DEFAULT_SETTINGS, SETTINGS_KEY, SYNC_CREDENTIALS_KEY, LOCAL_PROVIDER_KEY, LOCAL_SECRETS_KEY,
} from "../../extension/core/constants.mjs";
import { createSettingsStore, LOCAL_SETTINGS_MIRROR_KEY } from "../../extension/core/settings-store.mjs";
import { createClientStateStore } from "../../extension/core/client-state.mjs";
import { createContentSyncService, contentSyncStorageKey, CONTENT_SYNC_META_KEY } from "../../extension/core/content-sync.mjs";
import { withCredentialTransaction, secretStatus } from "../../extension/core/secrets.mjs";
import { encodeSyncedCredentials } from "../../extension/core/credential-sync.mjs";
import { createManualSyncService, SYNC_RECOVERY_KEY } from "../../extension/runtime/manual-sync-service.mjs";
import { createManualSyncController } from "../../assets/client/manual-sync-controller.mjs";

const TODO_KEY = "dash.utility.todos.v1";
const originalChrome = globalThis.chrome;
try {
  await testUpload();
  await testDownload();
  await testMissingAndInvalid();
  await testStaleAndLimits();
  await testRecovery();
  await testCredentials();
  await testConcurrentEdit();
  await testClear();
  await testClearFailure();
  await testUi();
} finally {
  if (originalChrome === undefined) delete globalThis.chrome;
  else globalThis.chrome = originalChrome;
}
console.log("manual sync tests passed");

async function testUpload() {
  const device = await fixture([todo("local", "Local fixture")]);
  await device.sync.set({ [SETTINGS_KEY]: { ...DEFAULT_SETTINGS, colorMode: "light", syncTodosEnabled: true } });
  await putTodo(device, todo("remote", "Remote fixture"));
  await device.sync.set({ "ampira.content.notes.v1.unselected": { deliberately: "invalid" } });
  const beforeState = await device.client.read();
  const preview = await device.service.preview({ direction: "upload" });
  assert(preview.hasChanges);
  assert(!JSON.stringify(preview).includes("Local fixture"), "preview must contain counts, never private content");
  const row = preview.rows.find(row => row.label === "settings.sync.todos");
  assert.deepEqual([row.added, row.updated, row.removed], [1, 0, 1]);
  await device.service.apply({ token: preview.token });
  const records = await device.sync.get(null);
  assert.equal(records[SETTINGS_KEY].colorMode, "dark", "upload must use the saved local mirror, not first adopt remote settings");
  assert.equal(records[await contentSyncStorageKey("todos", "local")].value.text, "Local fixture");
  assert.equal(records[await contentSyncStorageKey("todos", "remote")].deleted, true);
  assert(records[await contentSyncStorageKey("todos", "remote")].updatedAt > 5000);
  assert.deepEqual(await device.client.read(), beforeState, "upload must never merge remote-only content into the source");
  assert.deepEqual(records["ampira.content.notes.v1.unselected"], { deliberately: "invalid" });
  assert(!Object.hasOwn(await device.local.get(null), SYNC_RECOVERY_KEY));
  await assert.rejects(device.service.apply({ token: preview.token }), error => error.code === "SYNC_stale");
}

async function testDownload() {
  const device = await fixture([todo("same", "Local edit"), todo("local-only", "To replace")]);
  await putTodo(device, todo("same", "Remote version"));
  await putTodo(device, todo("remote-only", "Remote addition"));
  await device.sync.set({ [SETTINGS_KEY]: { ...DEFAULT_SETTINGS, colorMode: "light", syncTodosEnabled: true, syncNotesEnabled: true } });
  const preview = await device.service.preview({ direction: "download" });
  const before = await device.sync.get(null);
  await device.service.apply({ token: preview.token });
  assert.deepEqual(await device.sync.get(null), before, "download must not write local content back to sync storage");
  assert.deepEqual(JSON.parse((await device.client.read())[TODO_KEY]).map(item => item.id).sort(), ["remote-only", "same"]);
  assert.equal((await device.settings.read()).colorMode, "light");
  assert.equal((await device.settings.read()).syncNotesEnabled, false, "manual download must preserve opted-out datasets");
  await device.content.initialize();
  assert.deepEqual(await device.sync.get(null), before, "automatic sync must not resurrect replaced local-only items");
  const again = await device.service.preview({ direction: "download" });
  assert.equal(again.hasChanges, false);
  await device.sync.set({ [SETTINGS_KEY]: { ...before[SETTINGS_KEY], colorMode: "system" } });
  assert.equal((await device.settings.read()).colorMode, "system", "new automatic settings updates must still update the mirror");
  assert.equal((await device.local.get(LOCAL_SETTINGS_MIRROR_KEY))[LOCAL_SETTINGS_MIRROR_KEY].settings.colorMode, "system");

  const empty = await fixture([todo("removed", "Removed remotely")]);
  await putTodo(empty, todo("removed", ""), true);
  const download = await empty.service.preview({ direction: "download" });
  await empty.service.apply({ token: download.token });
  assert.deepEqual(JSON.parse((await empty.client.read())[TODO_KEY]), [], "valid deletion records may replace a collection with empty data");
  await empty.content.initialize();
  assert.equal((await empty.sync.get(null))[await contentSyncStorageKey("todos", "removed")].deleted, true);
}

async function testMissingAndInvalid() {
  const device = await fixture([todo("keep", "Keep local")]);
  await device.sync.remove(SETTINGS_KEY);
  const preview = await device.service.preview({ direction: "download" });
  assert.equal(preview.hasChanges, false);
  assert(preview.rows.every(row => row.skipped));
  assert.equal(JSON.parse((await device.client.read())[TODO_KEY])[0].text, "Keep local");
  await device.sync.set({ [SETTINGS_KEY]: { settingsChunks: { version: 1, fields: { excludedNewsSources: [`${SETTINGS_KEY}.chunk.excludedNewsSources.0`] } } } });
  await assert.rejects(device.service.preview({ direction: "download" }), error => error.code === "SYNC_invalid");
  await device.sync.remove(SETTINGS_KEY);
  await device.sync.set({ [await contentSyncStorageKey("todos", "invalid")]: { version: 999 } });
  await assert.rejects(device.service.preview({ direction: "download" }), error => error.code === "SYNC_invalid");
  assert.equal(JSON.parse((await device.client.read())[TODO_KEY])[0].text, "Keep local");
}

async function testStaleAndLimits() {
  const device = await fixture([todo("original", "Original")]);
  const preview = await device.service.preview({ direction: "upload" });
  await device.client.save({ values: { [TODO_KEY]: JSON.stringify([todo("new", "New local edit")]) } });
  await assert.rejects(device.service.apply({ token: preview.token }), error => error.code === "SYNC_stale");
  assert(!Object.keys(await device.sync.get(null)).some(key => key.startsWith("ampira.content.todos.")));
  const changedRemote = await device.service.preview({ direction: "upload" });
  await putTodo(device, todo("arrival", "Arrived while confirming"));
  await assert.rejects(device.service.apply({ token: changedRemote.token }), error => error.code === "SYNC_stale");
  const invalidated = await device.service.preview({ direction: "upload" });
  device.service.invalidate();
  await assert.rejects(device.service.apply({ token: invalidated.token }), error => error.code === "SYNC_stale");
  await device.sync.set({ "fixture.unrelated": "x".repeat(94 * 1024) });
  await assert.rejects(device.service.preview({ direction: "upload" }), error => error.code === "SYNC_STORAGE_TOTAL_TOO_LARGE");
  assert(!Object.hasOwn(await device.local.get(null), SYNC_RECOVERY_KEY), "quota validation happens before staging or replacing data");
}

async function testRecovery() {
  const device = await fixture([todo("before", "Before")]);
  await device.local.set({ [LOCAL_SECRETS_KEY]: { braveSearchApiKey: "synthetic-disabled-private-key" } });
  await putTodo(device, todo("after", "After"));
  const preview = await device.service.preview({ direction: "download" });
  device.failRecord("client-state");
  await assert.rejects(device.service.apply({ token: preview.token }), error => error.code === "SYNC_partial");
  assert.equal(JSON.parse((await device.client.read())[TODO_KEY])[0].id, "before");
  assert(Object.hasOwn(await device.local.get(null), SYNC_RECOVERY_KEY));
  const recoveryText = JSON.stringify((await device.local.get(null))[SYNC_RECOVERY_KEY]);
  assert(!recoveryText.includes("synthetic-disabled-private-key") && !recoveryText.includes("private fixture"),
    "recovery records must not copy disabled credentials or unrelated client state");
  const restarted = device.restart();
  await restarted.recover();
  assert.equal(JSON.parse((await device.client.read())[TODO_KEY])[0].id, "after");
  assert(!Object.hasOwn(await device.local.get(null), SYNC_RECOVERY_KEY));

  const upload = await fixture([todo("keep", "Keep after rejected write")]);
  const uploadPreview = await upload.service.preview({ direction: "upload" });
  const before = await upload.sync.get(null);
  upload.sync.failNextSet = true;
  await assert.rejects(upload.service.apply({ token: uploadPreview.token }), error => error.code === "SYNC_partial");
  assert.deepEqual(await upload.sync.get(null), before);
  assert.equal(JSON.parse((await upload.client.read())[TODO_KEY])[0].id, "keep");
  await upload.service.recover();
}

async function testCredentials() {
  const device = await fixture([]);
  const provider = { schemaVersion: 1, credentialGeneration: 2, openaiBaseUrl: "https://local-provider.example/v1", openaiApiStyle: "chat_completions", openaiSummaryModel: "fixture-local", openaiApiKey: "synthetic-local-key" };
  const remote = { ...provider, openaiBaseUrl: "https://remote-provider.example/v1", openaiSummaryModel: "fixture-remote", openaiApiKey: "synthetic-remote-key" };
  await device.local.set({ [LOCAL_PROVIDER_KEY]: provider, [LOCAL_SECRETS_KEY]: { braveSearchApiKey: "synthetic-local-brave" } });
  const off = await device.service.preview({ direction: "upload" });
  assert(!off.rows.some(row => row.label === "settings.sync.ai"));
  assert(!Object.hasOwn(await device.sync.get(null), SYNC_CREDENTIALS_KEY));
  await device.sync.set({ [SYNC_CREDENTIALS_KEY]: encodeSyncedCredentials(remote, { braveSearchApiKey: "synthetic-remote-brave" }) });
  const preview = await device.service.preview({ direction: "upload" });
  assert(!JSON.stringify(preview).includes("synthetic-") && !JSON.stringify(preview).includes("provider.example"));
  await device.service.apply({ token: preview.token });
  const uploaded = (await device.sync.get(null))[SYNC_CREDENTIALS_KEY];
  assert.equal(uploaded.provider.openaiApiKey, provider.openaiApiKey);
  assert.equal(uploaded.provider.openaiBaseUrl, provider.openaiBaseUrl);
  await device.sync.set({ [SYNC_CREDENTIALS_KEY]: encodeSyncedCredentials(remote, { braveSearchApiKey: "synthetic-remote-brave" }) });
  const download = await device.service.preview({ direction: "download" });
  device.failRecord("client-state"); // Empty value patch does not write client-state; fail metadata instead.
  device.failRecord(CONTENT_SYNC_META_KEY);
  await assert.rejects(device.service.apply({ token: download.token }), error => error.code === "SYNC_partial");
  await device.service.recover();
  const adopted = (await device.local.get(LOCAL_PROVIDER_KEY))[LOCAL_PROVIDER_KEY];
  assert.equal(adopted.openaiApiKey, remote.openaiApiKey);
  assert.equal(adopted.openaiBaseUrl, remote.openaiBaseUrl);
  assert(adopted.credentialGeneration > provider.credentialGeneration);
}

async function testConcurrentEdit() {
  const device = await fixture([todo("old", "Old")]);
  const preview = await device.service.preview({ direction: "upload" });
  let release, reached;
  const gate = new Promise(resolve => { release = resolve; });
  const entered = new Promise(resolve => { reached = resolve; });
  const originalSet = device.sync.set;
  device.sync.set = async values => { reached(); await gate; return originalSet(values); };
  const applying = device.service.apply({ token: preview.token });
  await entered;
  const newer = JSON.stringify([todo("new", "Concurrent edit")]);
  const edit = device.client.save({ values: { [TODO_KEY]: newer } });
  release();
  await Promise.all([applying, edit]);
  assert.equal((await device.client.read())[TODO_KEY], newer, "a queued local edit must run after replacement instead of being discarded");
}

async function testUi() {
  let dirty = true, busy = false, resolveConfirm, calls = [], status = "", focus = 0;
  const settingsController = {
    isBusy: () => busy, hasUnsavedChanges: () => dirty,
    renderSettingsStatus: value => { status = value; },
    runSettingsAction: async action => { busy = true; try { await action(() => true); } finally { busy = false; } },
    loadSettings: async () => true, resetSecretDrafts() {}, captureSettingsSnapshot() {},
  };
  const button = { isConnected: true, disabled: false, focus() { focus++; } };
  const controller = createManualSyncController({
    els: { uploadSyncData: button, downloadSyncData: button, clearSyncData: button }, settingsController,
    t: key => key, localizedErrorMessage: error => error.message,
    request: async request => { calls.push(request.type); return { token: "opaque", hasChanges: true, rows: [{ label: "settings.sync.todos", added: 1, updated: 0, removed: 1 }] }; },
    confirmAction: () => new Promise(resolve => { resolveConfirm = resolve; }), loadDashboard: async () => {},
  });
  await controller.run("upload");
  assert.deepEqual(calls, []);
  assert.equal(status, "settings.sync.saveFirst");
  dirty = false;
  const cancel = controller.run("upload");
  await new Promise(resolve => setTimeout(resolve, 0));
  await controller.run("upload");
  assert.deepEqual(calls, ["sync:preview"], "duplicate clicks must not create multiple confirmations");
  resolveConfirm(false); await cancel;
  assert.deepEqual(calls, ["sync:preview"]);
  const accept = controller.run("download");
  await new Promise(resolve => setTimeout(resolve, 0));
  resolveConfirm(true); await accept;
  assert.deepEqual(calls, ["sync:preview", "sync:preview", "sync:apply"]);
  assert.equal(status, "settings.sync.done.download");
  assert.equal(focus, 2);
  const clearCancelled = controller.run("clear");
  await new Promise(resolve => setTimeout(resolve, 0));
  resolveConfirm(false); await clearCancelled;
  assert.equal(calls.filter(type => type === "sync:apply").length, 1, "cancelling clear must not send an apply request");
}

async function testClear() {
  const device = await fixture([todo("keep", "Keep local content")]);
  await device.content.initialize();
  const localItems = [todo("keep", "Pending local edit"), todo("pending", "Not uploaded yet")];
  await device.client.save({ values: { [TODO_KEY]: JSON.stringify(localItems) } });
  await putTodo(device, todo("remote-only", "Cloud-only fixture"));
  const provider = { schemaVersion: 1, credentialGeneration: 2, openaiBaseUrl: "https://fixture.example/v1", openaiApiStyle: "responses", openaiSummaryModel: "fixture", openaiApiKey: "synthetic-kept-key" };
  const secrets = { braveSearchApiKey: "synthetic-kept-brave" };
  await device.local.set({ [LOCAL_PROVIDER_KEY]: provider, [LOCAL_SECRETS_KEY]: secrets });
  await device.sync.set({
    [SYNC_CREDENTIALS_KEY]: encodeSyncedCredentials(provider, secrets),
    "ampira.legacy.fixture": { settings: "older copy" },
    "ampira.content.notes.v1.invalid": { version: 999 },
  });
  const beforeSettings = await device.settings.readLocal();
  const beforeState = await device.client.read();
  const beforeSync = await device.sync.get(null);
  const preview = await device.service.preview({ direction: "clear" });
  assert.equal(preview.hasChanges, true);
  assert(!JSON.stringify(preview).includes("synthetic-kept"));
  assert.deepEqual(await device.sync.get(null), beforeSync, "preview must not delete or upload any sync record");
  await device.service.apply({ token: preview.token });
  assert.deepEqual(await device.sync.get(null), {}, "clear removes all extension sync records, including old and malformed copies");
  assert.deepEqual(await device.client.read(), beforeState);
  assert.deepEqual(await device.settings.read(), beforeSettings);
  assert.deepEqual((await device.local.get(LOCAL_PROVIDER_KEY))[LOCAL_PROVIDER_KEY], provider);
  assert.deepEqual((await device.local.get(LOCAL_SECRETS_KEY))[LOCAL_SECRETS_KEY], secrets);
  assert.equal((await secretStatus()).syncAiSettingsEnabled, false, "deleting the credential record turns key sync off, without removing local keys");
  await device.content.handleLocalPatch({ [TODO_KEY]: beforeState[TODO_KEY] });
  await device.restartContent().initialize();
  assert.deepEqual(await device.sync.get(null), {}, "unchanged or pending local content must not immediately refill sync after clear or restart");
  assert.equal((await device.service.preview({ direction: "clear" })).hasChanges, false, "an empty sync area needs no destructive confirmation");
  const edited = JSON.stringify([todo("keep", "A later explicit edit"), localItems[1]]);
  await device.client.save({ values: { [TODO_KEY]: edited } });
  await device.content.handleLocalPatch({ [TODO_KEY]: edited });
  assert.equal((await device.sync.get(null))[await contentSyncStorageKey("todos", "keep")].value.text, "A later explicit edit", "later edits continue to follow enabled content-sync flags");
  assert(!Object.hasOwn(await device.sync.get(null), SYNC_CREDENTIALS_KEY));
}

async function testClearFailure() {
  const device = await fixture([todo("safe", "Preserved after failure")]);
  await device.content.initialize();
  const before = await device.sync.get(null);
  const preview = await device.service.preview({ direction: "clear" });
  device.sync.failNextClear = true;
  await assert.rejects(device.service.apply({ token: preview.token }), error => error.code === "SYNC_clearFailed");
  assert.deepEqual(await device.sync.get(null), before);
  assert.equal(JSON.parse((await device.client.read())[TODO_KEY])[0].id, "safe");
  assert(!Object.hasOwn(await device.local.get(null), SYNC_RECOVERY_KEY), "failed deletion must not be retried without a new confirmation");
  const retry = await device.service.preview({ direction: "clear" });
  device.failRecord(CONTENT_SYNC_META_KEY);
  await assert.rejects(device.service.apply({ token: retry.token }), error => error.code === "SYNC_clearFailed");
  assert.deepEqual(await device.sync.get(null), {});
  const clearCalls = device.sync.clearCalls;
  await device.restart().recover();
  assert.equal(device.sync.clearCalls, clearCalls, "recovery only completes local bookkeeping; it must never clear again");
  await device.restartContent().initialize();
  assert.deepEqual(await device.sync.get(null), {});
  const staleDevice = await fixture([]);
  const stale = await staleDevice.service.preview({ direction: "clear" });
  await staleDevice.sync.set({ "arrived-after-preview": true });
  await assert.rejects(staleDevice.service.apply({ token: stale.token }), error => error.code === "SYNC_stale");
  assert((await staleDevice.sync.get(null))["arrived-after-preview"]);
  await staleDevice.sync.set({ [SETTINGS_KEY]: { schemaVersion: 999 }, [SYNC_CREDENTIALS_KEY]: { version: 999 } });
  const repair = await staleDevice.service.preview({ direction: "clear" });
  await staleDevice.service.apply({ token: repair.token });
  assert.deepEqual(await staleDevice.sync.get(null), {}, "clear must be usable to remove malformed sync records");
}

async function fixture(items) {
  const sync = memoryStorage(), local = memoryStorage();
  globalThis.chrome = { storage: { sync, local } };
  const settings = createSettingsStore(sync, local);
  await settings.write({ ...DEFAULT_SETTINGS, colorMode: "dark", syncTodosEnabled: true });
  const records = new Map([["client-state", { [TODO_KEY]: JSON.stringify(items), "dash.fixture.local": "private fixture" }]]);
  let failKey = "";
  const getRecord = async (key, fallback) => structuredClone(records.has(key) ? records.get(key) : fallback);
  const setRecord = async (key, value) => {
    if (key === failKey) { failKey = ""; throw new Error("Synthetic persistence failure"); }
    records.set(key, structuredClone(value));
  };
  const client = createClientStateStore({ getRecord, setRecord });
  const contentOptions = { storage: sync, clientStateStore: client, getSettings: () => settings.read(), getRecord, setRecord, now: () => 10000 };
  const content = createContentSyncService(contentOptions);
  const options = { storage: sync, localStorage: local, settingsStore: settings, contentSyncService: content, clientStateStore: client, withCredentialTransaction, getRecord, setRecord, now: () => 1000 };
  return { sync, local, settings, client, content, service: createManualSyncService(options), restart: () => createManualSyncService(options), restartContent: () => createContentSyncService(contentOptions), failRecord: key => { failKey = key; } };
}

function todo(id, text) { return { id, text, completed: false, createdAt: "2026-11-20T00:00:00.000Z", completedAt: "" }; }

async function putTodo(device, value, deleted = false) {
  await device.sync.set({ [await contentSyncStorageKey("todos", value.id)]: {
    version: 1, dataset: "todos", id: value.id, updatedAt: 5000, revision: "5000:remote", ...(deleted ? { deleted: true } : { value }),
  } });
}

function memoryStorage() {
  const records = {};
  const store = {
    failNextSet: false,
    failNextClear: false, clearCalls: 0,
    async get(keys) {
      if (keys === null) return structuredClone(records);
      return structuredClone(Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter(key => Object.hasOwn(records, key)).map(key => [key, records[key]])));
    },
    async set(values) {
      if (store.failNextSet) { store.failNextSet = false; throw new Error("Synthetic sync rejection"); }
      Object.assign(records, structuredClone(values));
    },
    async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) delete records[key]; },
    async clear() {
      store.clearCalls++;
      if (store.failNextClear) { store.failNextClear = false; throw new Error("Synthetic clear rejection"); }
      for (const key of Object.keys(records)) delete records[key];
    },
  };
  return store;
}
