import assert from "node:assert/strict";
import { DEFAULT_SETTINGS, LOCAL_PROVIDER_KEY, SETTINGS_KEY, SYNC_CREDENTIALS_KEY } from "../../extension/core/constants.mjs";
import { decodeSyncedCredentials } from "../../extension/core/credential-sync.mjs";
import { readDeviceConsent, setAiDisclosureConsent } from "../../extension/core/device-consent.mjs";
import { captureCredentialState, readProviderProfile, readSecrets, restoreCredentialState, secretStatus, updateCredentials } from "../../extension/core/secrets.mjs";
import { createSettingsStore } from "../../extension/core/settings-store.mjs";
import { createSettingsTransferDocument, parseSettingsTransferDocument } from "../../extension/core/settings-transfer.mjs";
import { bindProviderPatchToOrigin, providerRequiresApiKey, providerTestConsentAllowed } from "../../extension/core/provider-policy.mjs";
import { isValidServiceUrl } from "../../extension/core/settings.mjs";
import { createRuntimeSettingsService } from "../../extension/runtime/settings-service.mjs";
import { createSettingsWorkflow } from "../../extension/runtime/settings-workflow.mjs";

const previousChrome = globalThis.chrome;
const sync = memoryStorage();
const deviceA = memoryStorage();
const deviceB = memoryStorage();
const selectDevice = (local) => { globalThis.chrome = { storage: { local, sync } }; };
try {
  selectDevice(deviceA);
  await updateCredentials({
    providerPatch: {
      openaiBaseUrl: "https://provider-a.example/v1", openaiApiStyle: "chat_completions",
      openaiSummaryModel: "fixture-model-a", openaiApiKey: "synthetic-ai-a",
    },
    secretsPatch: { braveSearchApiKey: "synthetic-brave-a" },
  });
  assert.equal((await secretStatus()).syncAiSettingsEnabled, false);
  assert.deepEqual(await sync.get(null), {}, "existing credentials remain local until explicit opt-in");
  await setAiDisclosureConsent(true, "https://provider-a.example/v1");
  await updateCredentials({ syncEnabled: true });
  const firstSynced = (await sync.get(SYNC_CREDENTIALS_KEY))[SYNC_CREDENTIALS_KEY];
  assert.equal(firstSynced.provider.openaiApiKey, "synthetic-ai-a");
  assert.equal(firstSynced.braveSearchApiKey, "synthetic-brave-a");
  assert.deepEqual(Object.keys(firstSynced).sort(), ["braveSearchApiKey", "enabled", "provider", "version"]);
  assert.equal(Object.hasOwn(firstSynced.provider, "credentialGeneration"), false, "device epochs must not sync");

  selectDevice(deviceB);
  const restored = await readProviderProfile();
  assert.equal(restored.openaiBaseUrl, "https://provider-a.example/v1");
  assert.equal(restored.openaiApiStyle, "chat_completions");
  assert.equal(restored.openaiSummaryModel, "fixture-model-a");
  assert.deepEqual(await readSecrets(), { openaiApiKey: "synthetic-ai-a", braveSearchApiKey: "synthetic-brave-a" });
  assert.equal((await readDeviceConsent(restored.openaiBaseUrl)).aiDisclosureAccepted, false);
  assert.equal((await secretStatus()).syncAiSettingsEnabled, true);
  assert.equal((await readProviderProfile()).credentialGeneration, restored.credentialGeneration, "unchanged reads must not invalidate requests");

  selectDevice(deviceA);
  const writesBefore = sync.writes.length;
  await updateCredentials({
    providerPatch: { openaiBaseUrl: "https://provider-b.example/v1", openaiApiStyle: "responses", openaiSummaryModel: "fixture-model-b", openaiApiKey: "synthetic-ai-b" },
    secretsPatch: { braveSearchApiKey: "synthetic-brave-b" },
  });
  assert.equal(sync.writes.length, writesBefore + 1, "provider identity and all credentials must publish atomically");
  selectDevice(deviceB);
  const changed = await readProviderProfile();
  assert.equal(changed.openaiApiKey, "synthetic-ai-b");
  assert.equal(changed.openaiBaseUrl, "https://provider-b.example/v1");
  assert(changed.credentialGeneration > restored.credentialGeneration, "remote edits must invalidate older provider requests");
  assert.equal((await readDeviceConsent(changed.openaiBaseUrl)).aiDisclosureAccepted, false);
  await updateCredentials({ providerPatch: { openaiBaseUrl: "https://provider-c.example/v1" } });
  assert.equal((await sync.get(SYNC_CREDENTIALS_KEY))[SYNC_CREDENTIALS_KEY].provider.openaiApiKey, "", "changing origin must never move an old key to a new service");

  await Promise.all([
    updateCredentials({ providerPatch: { openaiApiKey: "synthetic-concurrent-ai" } }),
    updateCredentials({ secretsPatch: { braveSearchApiKey: "synthetic-concurrent-brave" } }),
  ]);
  selectDevice(deviceA);
  assert.deepEqual(await readSecrets(), { openaiApiKey: "synthetic-concurrent-ai", braveSearchApiKey: "synthetic-concurrent-brave" });
  await updateCredentials({ providerPatch: { openaiApiKey: "" }, secretsPatch: { braveSearchApiKey: "" } });
  selectDevice(deviceB);
  assert.deepEqual(await readSecrets(), { openaiApiKey: "", braveSearchApiKey: "" }, "key deletion must propagate");

  const beforeDisableWrites = sync.writes.length;
  await updateCredentials({ syncEnabled: false, providerPatch: { openaiApiKey: "synthetic-local-after-disable" } });
  assert.equal(sync.writes.length, beforeDisableWrites, "a key edited while disabling sync must never be uploaded");
  assert.equal((await secretStatus()).syncAiSettingsEnabled, false);
  assert.equal((await readSecrets()).openaiApiKey, "synthetic-local-after-disable");
  assert.equal(Object.hasOwn(await sync.get(null), SYNC_CREDENTIALS_KEY), false);
  selectDevice(deviceA);
  assert.equal((await readProviderProfile()).openaiBaseUrl, "https://provider-c.example/v1", "remote disable preserves the last received local config");
  assert.equal((await readSecrets()).openaiApiKey, "");
  await updateCredentials({ providerPatch: { openaiApiKey: "synthetic-local-only" } });
  assert.equal(Object.hasOwn(await sync.get(null), SYNC_CREDENTIALS_KEY), false, "other devices must not recreate a removed sync record");

  await updateCredentials({ syncEnabled: true });
  const stable = await captureCredentialState();
  await assert.rejects(updateCredentials({ providerPatch: { openaiApiKey: "x".repeat(7200) } }), (error) => error.code === "CREDENTIAL_SYNC_TOO_LARGE");
  assert.deepEqual(await captureCredentialState(), stable, "oversized records must preserve both copies");
  await sync.set(Object.fromEntries(Array.from({ length: 14 }, (_, index) => [`fixture.${index}`, "x".repeat(6600)])));
  await assert.rejects(updateCredentials({ secretsPatch: { braveSearchApiKey: "synthetic-over-budget" } }), (error) => error.code === "SYNC_STORAGE_TOTAL_TOO_LARGE");
  assert.deepEqual(await captureCredentialState(), stable);
  await sync.remove(Array.from({ length: 14 }, (_, index) => `fixture.${index}`));
  sync.failNextSet = true;
  await assert.rejects(updateCredentials({ secretsPatch: { braveSearchApiKey: "synthetic-write-failure" } }), /SYNTHETIC_STORAGE_FAILURE/);
  assert.deepEqual(await captureCredentialState(), stable, "failed sync writes must roll back local credentials");
  sync.failNextRemove = true;
  await assert.rejects(updateCredentials({ syncEnabled: false, providerPatch: { openaiApiKey: "synthetic-not-saved" } }), /SYNTHETIC_STORAGE_FAILURE/);
  assert.deepEqual(await captureCredentialState(), stable, "failed disable must leave sync enabled and preserve the prior key");

  const settingsStore = createSettingsStore(sync);
  await settingsStore.write(DEFAULT_SETTINGS);
  const settingsService = createRuntimeSettingsService({ store: settingsStore, readProviderProfile, readDeviceConsent });
  const workflow = createSettingsWorkflow(workflowOptions(settingsService));
  const publicSettings = await workflow.publicSettings();
  assert.equal(publicSettings.syncAiSettingsEnabled, true);
  assert.equal(publicSettings.keySource, "browser-account-sync");
  assert.equal(publicSettings.maskedKey, "••••••••");
  assert.equal(JSON.stringify(publicSettings).includes("synthetic-local-only"), false, "public settings must never expose synced key values");
  const transfer = createSettingsTransferDocument({ ...publicSettings, openaiApiKey: "synthetic-export-key" });
  assert.equal(JSON.stringify(transfer).includes("synthetic-export-key"), false);
  assert.equal(Object.hasOwn(parseSettingsTransferDocument(transfer, publicSettings).patch, "syncAiSettingsEnabled"), false, "imports must not turn on credential sync");
  sync.failNextSet = true;
  await assert.rejects(workflow.saveSettings({ clearOpenAIKey: true }), /SYNTHETIC_STORAGE_FAILURE/);
  assert.deepEqual(await captureCredentialState(), stable);
  const failingWorkflow = createSettingsWorkflow(workflowOptions({
    ...settingsService,
    mutate: async (action) => action({ write: async () => { throw new Error("SYNTHETIC_SETTINGS_FAILURE"); } }),
  }));
  await assert.rejects(failingWorkflow.saveSettings({ clearOpenAIKey: true, syncAiSettingsEnabled: false }), /SYNTHETIC_SETTINGS_FAILURE/);
  assert.deepEqual(await captureCredentialState(), stable, "later settings failure must restore local and sync credentials together");
  await workflow.saveSettings({ clearOpenAIKey: true });
  assert.equal((await sync.get(SYNC_CREDENTIALS_KEY))[SYNC_CREDENTIALS_KEY].provider.openaiApiKey, "");
  assert.equal((await workflow.publicSettings()).hasOpenAIKey, false);
  for (const field of ["openaiApiKey", "braveSearchApiKey", "syncAiSettingsEnabled"]) {
    assert.equal(Object.hasOwn((await sync.get(SETTINGS_KEY))[SETTINGS_KEY], field), false, "ordinary settings must not duplicate credential state");
  }

  await restoreCredentialState(stable);
  for (const malformed of [
    { ...firstSynced, version: 2 },
    { ...firstSynced, enabled: false },
    { ...firstSynced, provider: { ...firstSynced.provider, openaiBaseUrl: "http://insecure.example/v1" } },
    { ...firstSynced, provider: { ...firstSynced.provider, openaiBaseUrl: "https://user:pass@example.com/v1" } },
    { ...firstSynced, provider: { openaiApiKey: "synthetic-unbound-key" } },
  ]) assert.equal(decodeSyncedCredentials(malformed), null);
  await sync.set({ [SYNC_CREDENTIALS_KEY]: { ...firstSynced, provider: { openaiApiKey: "synthetic-unbound-key" } } });
  assert.equal((await readProviderProfile()).openaiApiKey, stable.provider.openaiApiKey, "malformed sync records must never rebind an unrelated key");
  assert.equal((await secretStatus()).syncAiSettingsEnabled, false);
  await updateCredentials({ syncEnabled: false });
  assert.equal(Object.hasOwn(await sync.get(null), SYNC_CREDENTIALS_KEY), false);
  assert.equal((await deviceA.get(LOCAL_PROVIDER_KEY))[LOCAL_PROVIDER_KEY].openaiApiKey, stable.provider.openaiApiKey);
} finally {
  globalThis.chrome = previousChrome;
}
console.log("credential sync tests passed");

function workflowOptions(settingsService) {
  return {
    settingsService, getSettings: settingsService.getSettings, settingsLocale: () => "en", secretStatus,
    readProviderProfile, bindProviderPatchToOrigin, isValidServiceUrl, providerTestConsentAllowed, providerRequiresApiKey,
    hasOriginPermission: async () => true, updateCredentials, setAiDisclosureConsent, captureCredentialState, restoreCredentialState,
    defaultSettings: DEFAULT_SETTINGS,
    typedError: (code) => Object.assign(new Error(code), { code }),
    currentBookmarkModel: async () => ({}), emptyBookmarkModel: () => ({}), selectedOrigins: async () => [],
    currentFeedPermissionState: async () => ({}), filterSourceQuality: () => ({}), getRecord: async () => null, emptySourceQuality: () => ({}),
    contentSyncService: { applySettings: async () => {} }, cacheMutations: { invalidate() {}, run: (fn) => fn() },
    refreshCoordinator: { invalidate() {} }, setRecord: async () => {}, pruneStalePreviewCaches: async () => {},
    pruneBravePreviewCaches: async () => {}, aiConfigured: async () => false, setAiAutoStatus: async () => {},
    defaultAiAutoStatus: () => ({}), startRefresh: async () => {}, broadcast() {},
  };
}

function memoryStorage() {
  const values = {};
  return {
    writes: [], failNextSet: false, failNextRemove: false,
    async get(keys) {
      if (keys == null) return structuredClone(values);
      return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter((key) => Object.hasOwn(values, key)).map((key) => [key, structuredClone(values[key])]));
    },
    async set(input) {
      if (this.failNextSet) { this.failNextSet = false; throw new Error("SYNTHETIC_STORAGE_FAILURE"); }
      this.writes.push(structuredClone(input));
      Object.assign(values, structuredClone(input));
    },
    async remove(keys) {
      if (this.failNextRemove) { this.failNextRemove = false; throw new Error("SYNTHETIC_STORAGE_FAILURE"); }
      for (const key of (Array.isArray(keys) ? keys : [keys])) delete values[key];
    },
  };
}
