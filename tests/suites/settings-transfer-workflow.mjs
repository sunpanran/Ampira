import assert from "node:assert/strict";
import { DEFAULT_SETTINGS, SETTINGS_KEY, SYNC_CREDENTIALS_KEY } from "../../extension/core/constants.mjs";
import { captureDeviceConsentState, grantBookmarkConsent, readDeviceConsent, restoreDeviceConsentState, setAiDisclosureConsent } from "../../extension/core/device-consent.mjs";
import { captureCredentialState, readProviderProfile, readSecrets, readTransferCredentials, restoreCredentialState, secretStatus, updateCredentials } from "../../extension/core/secrets.mjs";
import { createSettingsStore } from "../../extension/core/settings-store.mjs";
import { createSettingsTransferDocument, parseSettingsTransferDocument } from "../../extension/core/settings-transfer.mjs";
import { bindProviderPatchToOrigin, providerRequiresApiKey, providerTestConsentAllowed } from "../../extension/core/provider-policy.mjs";
import { isValidServiceUrl } from "../../extension/core/settings.mjs";
import { originPattern } from "../../extension/core/permission-state.mjs";
import { createRuntimeSettingsService } from "../../extension/runtime/settings-service.mjs";
import { createSettingsWorkflow } from "../../extension/runtime/settings-workflow.mjs";
import { authorizeSettingsImport } from "../../assets/client/settings-import-authorization.mjs";
import { requestAiCompletion } from "../../extension/core/ai.mjs";

const oldChrome = globalThis.chrome;
const local = memoryStorage(), sync = memoryStorage();
const granted = { permissions: ["storage", "bookmarks"], origins: [] };
globalThis.chrome = { storage: { local, sync } };
try {
  const store = createSettingsStore(sync);
  await store.write(DEFAULT_SETTINGS);
  const settingsService = createRuntimeSettingsService({ store, readProviderProfile, readDeviceConsent });
  let refreshes = 0, rejectContent = false, failEffects = 0, failView = 0;
  const events = [];
  const workflow = createSettingsWorkflow({
    settingsService, getSettings: settingsService.getSettings, settingsLocale: () => "en", secretStatus, readTransferCredentials,
    readProviderProfile, bindProviderPatchToOrigin, isValidServiceUrl, providerTestConsentAllowed, providerRequiresApiKey,
    hasOriginPermission: async url => granted.origins.includes(originPattern(url)),
    updateCredentials, setAiDisclosureConsent, captureCredentialState, restoreCredentialState,
    captureDeviceConsentState, restoreDeviceConsentState, defaultSettings: DEFAULT_SETTINGS,
    typedError: code => Object.assign(new Error(code), { code }),
    currentBookmarkModel: async () => ({}), emptyBookmarkModel: () => ({}),
    selectedOrigins: async () => (await secretStatus()).hasImageSearchKey
      ? [{ origin: "https://api.search.brave.com/*", granted: granted.origins.includes("https://api.search.brave.com/*") }] : [],
    currentFeedPermissionState: async () => { if (failView-- > 0) throw new Error("SYNTHETIC_VIEW_FAILURE"); return {}; }, filterSourceQuality: () => ({}), getRecord: async () => null, emptySourceQuality: () => ({}),
    contentSyncService: { applySettings: async () => { if (rejectContent) { rejectContent = false; throw new Error("SYNTHETIC_CONTENT_FAILURE"); } } },
    cacheMutations: { invalidate() {}, run: fn => fn() }, refreshCoordinator: { invalidate() {} },
    setRecord: async () => { if (failEffects-- > 0) throw new Error("SYNTHETIC_EFFECT_FAILURE"); }, pruneStalePreviewCaches: async () => {}, pruneBravePreviewCaches: async () => {},
    aiConfigured: async settings => settings.aiDisclosureAccepted && granted.origins.includes(originPattern(settings.openaiBaseUrl)),
    setAiAutoStatus: async () => {}, defaultAiAutoStatus: () => ({}), startRefresh: async () => { refreshes++; },
    broadcast: (...args) => events.push(args), createSettingsTransferDocument, parseSettingsTransferDocument,
    getAppVersion: () => "fixture", now: () => "2026-11-20T00:00:00.000Z", getOptionalPermissions: async () => structuredClone(granted),
  });
  await updateCredentials({ providerPatch: { openaiApiKey: "synthetic-original-ai" }, secretsPatch: { braveSearchApiKey: "synthetic-original-brave" } });
  await setAiDisclosureConsent(true, DEFAULT_SETTINGS.openaiBaseUrl);
  granted.permissions.push("favicon", "history", "search");
  granted.origins.push("https://original.example/*");
  const exported = await workflow.exportSettings();
  assert.deepEqual(exported.credentials, { openaiApiKey: "synthetic-original-ai", braveSearchApiKey: "synthetic-original-brave" });
  assert.deepEqual(exported.permissions.permissions, ["favicon", "history", "search"]);
  assert.equal(exported.settings.openaiBaseUrl, (await readTransferCredentials()).openaiBaseUrl);
  granted.permissions = ["storage", "bookmarks"];
  granted.origins = [];

  const config = createSettingsTransferDocument({ ...DEFAULT_SETTINGS, openaiBaseUrl: "https://imported.example/v1", bookmarkConsentGranted: true }, {
    credentials: { openaiApiKey: "synthetic-imported-ai", braveSearchApiKey: "synthetic-imported-brave" },
    permissions: { permissions: ["favicon", "history", "search"], origins: ["https://feed.example/*"] },
  });
  const imported = await workflow.importSettings({ config });
  assert.deepEqual(await readSecrets(), config.credentials, "both keys restore before any permission is granted");
  assert.equal(imported.aiDisclosureAccepted, false);
  assert.equal(imported.bookmarkConsentGranted, false, "the bookmark consent marker is only a request");
  assert.equal(refreshes, 0, "imported AI keys must not activate automatic AI before consent");
  assert.deepEqual(imported.importAuthorization.permissions, ["favicon", "history", "search"]);
  assert.equal(imported.importAuthorization.bookmarkConsent, true);
  assert.deepEqual(new Set(imported.importAuthorization.origins), new Set([
    "https://feed.example/*", "https://api.search.brave.com/*", "https://imported.example/*",
  ]));
  assert.equal((await secretStatus()).syncAiSettingsEnabled, false);
  assert.equal(Object.hasOwn(await sync.get(null), SYNC_CREDENTIALS_KEY), false);
  assert.equal(JSON.stringify([imported, events, await workflow.publicSettings()]).includes("synthetic-imported"), false,
    "import results, public settings and broadcasts must not reveal keys");
  assert.equal(Object.hasOwn((await sync.get(SETTINGS_KEY))[SETTINGS_KEY], "openaiApiKey"), false);
  await assert.rejects(workflow.authorizeImportedSettings(imported.importAuthorization.aiProvider), { code: "ORIGIN_PERMISSION_REQUIRED" });
  assert.equal((await settingsService.getSettings()).aiDisclosureAccepted, false);
  granted.origins = [...imported.importAuthorization.origins];
  const authorized = await workflow.authorizeImportedSettings(imported.importAuthorization.aiProvider);
  assert.equal(authorized.aiDisclosureAccepted, true);
  assert.equal(refreshes, 1, "AI activation uses the existing automatic refresh path");
  const previousConsent = await captureDeviceConsentState();
  const previousPermissions = [...granted.permissions];
  await grantBookmarkConsent();
  granted.permissions.push(...config.permissions.permissions);
  const readyImport = await workflow.importSettings({ config });
  assert.equal(readyImport.aiDisclosureAccepted, true, "same-origin imports preserve this device's valid AI consent");
  assert.equal(readyImport.bookmarkConsentGranted, true, "imports preserve existing bookmark consent");
  globalThis.chrome.permissions = { contains: async details => (details.origins || []).every(origin => granted.origins.includes(origin))
    && (details.permissions || []).every(permission => granted.permissions.includes(permission)) };
  const readyAccess = await authorizeSettingsImport(readyImport.importAuthorization, {
    request: async message => { assert.equal(message.type, "settings:get"); return workflow.publicSettings(); },
    confirmAction: () => assert.fail("existing grants must not require another confirmation"),
  }, () => true);
  assert.equal(readyAccess.status, "ready");

  assert.equal((await captureAiRequest(settingsService)).endpoint, "https://imported.example/v1/responses");
  await restoreDeviceConsentState(previousConsent);
  granted.permissions = previousPermissions;
  await updateCredentials({ providerPatch: { openaiApiKey: "synthetic-concurrent-key" } });
  await assert.rejects(workflow.authorizeImportedSettings(imported.importAuthorization.aiProvider), { code: "AI_CONFIGURATION_CHANGED" });

  await setAiDisclosureConsent(false, "https://imported.example/v1");
  await assert.rejects(workflow.saveSettings({ openaiApiKey: "synthetic-bypass", importing: true }), { code: "AI_CONSENT_REQUIRED" });
  const snapshot = await captureCredentialState(), consent = await captureDeviceConsentState();
  const beforeSettings = await settingsService.getSettings();
  sync.failNextSet = true;
  await assert.rejects(workflow.importSettings({ config: { ...config, settings: { ...config.settings, colorMode: "light" } } }), /SYNTHETIC_STORAGE_FAILURE/);
  assert.deepEqual(await captureCredentialState(), snapshot, "failed import restores previous keys");
  assert.deepEqual(await captureDeviceConsentState(), consent, "failed import restores device consent");
  rejectContent = true;
  await assert.rejects(workflow.importSettings({ config: { ...config, settings: { ...config.settings, colorMode: "light" } } }), /SYNTHETIC_CONTENT_FAILURE/);
  assert.deepEqual(await captureCredentialState(), snapshot);
  assert.deepEqual(await settingsService.getSettings(), beforeSettings);

  await workflow.importSettings({ config: { format: "ampira-settings", formatVersion: 1, settings: { colorMode: "light" } } });
  assert.equal((await readSecrets()).openaiApiKey, "synthetic-concurrent-key", "legacy partial imports preserve keys");
  await workflow.importSettings({ config: { format: "ampira-settings", formatVersion: 1, settings: { openaiBaseUrl: "https://other.example/v1" } } });
  assert.equal((await readSecrets()).openaiApiKey, "", "changing provider without an imported key clears the old key");
  await updateCredentials({ syncEnabled: true });
  await workflow.importSettings({ config });
  assert.equal((await sync.get(SYNC_CREDENTIALS_KEY))[SYNC_CREDENTIALS_KEY].provider.openaiApiKey, config.credentials.openaiApiKey,
    "an existing credential-sync opt-in still applies");

  const noKey = await workflow.importSettings({ config: createSettingsTransferDocument({ ...DEFAULT_SETTINGS, openaiBaseUrl: "http://localhost:11434/v1" }) });
  assert(noKey.importAuthorization.aiProvider, "local providers also require device consent and website access");
  assert(noKey.importAuthorization.origins.includes("http://localhost:11434/*"));
  const legacyBookmarks = await workflow.importSettings({ config: { format: "ampira-settings", formatVersion: 1,
    settings: { newsSourceMode: "bookmarks", newsBookmarkFolder: "Synthetic News" } } });
  assert.equal(legacyBookmarks.importAuthorization.bookmarkConsent, true, "legacy imports selecting bookmarks must request device consent too");
  await testCredentialSyncRoundTrip(workflow, settingsService, granted);
  failEffects = 1;
  const partial = await workflow.importSettings({ config: { format: "ampira-settings", formatVersion: 2,
    settings: { webImageSearchEnabled: !(await settingsService.getSettings()).webImageSearchEnabled } } });
  assert.equal(partial.committed, true);
  assert.deepEqual(partial.postCommit, { status: "pending", failedSteps: ["effects"] });
  assert(partial.importAuthorization, "post-commit failure must still return the authorization requirements");
  const preserved = await captureCredentialState(), savedState = await settingsService.getSettings();
  const syncWrites = sync.writes, localWrites = local.writes;
  const completed = await workflow.reconcileImportedSettings();
  assert.equal(completed.postCommit.status, "complete");
  assert.deepEqual(await settingsService.getSettings(), savedState);
  assert.deepEqual(await captureCredentialState(), preserved);
  assert.equal(sync.writes, syncWrites, "retrying follow-up processing cannot rewrite synced settings or credentials");
  assert.equal(local.writes, localWrites);
  failView = 1;
  const viewFailure = await workflow.importSettings({ config: { format: "ampira-settings", formatVersion: 1, settings: { colorMode: "dark" } } });
  assert.equal(viewFailure.committed, true);
  assert(viewFailure.postCommit.failedSteps.includes("settings-view"));
  assert.equal(Object.hasOwn(viewFailure, "openaiApiKey"), false);
  assert.equal((await workflow.reconcileImportedSettings()).postCommit.status, "complete");

} finally {
  globalThis.chrome = oldChrome;
}
console.log("settings transfer credential and permission workflow tests passed");

async function testCredentialSyncRoundTrip(workflow, settingsService, granted) {
  await updateCredentials({ syncEnabled: true, providerPatch: {
    openaiBaseUrl: DEFAULT_SETTINGS.openaiBaseUrl, openaiApiStyle: DEFAULT_SETTINGS.openaiApiStyle,
    openaiSummaryModel: DEFAULT_SETTINGS.openaiSummaryModel, openaiApiKey: "synthetic-roundtrip-ai",
  } });
  granted.origins.push(originPattern(DEFAULT_SETTINGS.openaiBaseUrl));
  await setAiDisclosureConsent(true, DEFAULT_SETTINGS.openaiBaseUrl);
  const beforeRequest = await captureAiRequest(settingsService);
  const config = await workflow.exportSettings();
  assert.equal(config.syncAiSettingsEnabled, true, "the exported file must record the enabled sync preference");
  await updateCredentials({ syncEnabled: false, providerPatch: {
    openaiBaseUrl: "https://other-provider.example/v1", openaiApiStyle: "chat_completions",
    openaiSummaryModel: "synthetic-other-model", openaiApiKey: "synthetic-other-key",
  } });
  const beforeImport = await captureCredentialState();
  await assert.rejects(workflow.importSettings({ config }), { code: "SETTINGS_IMPORT_SYNC_CONFIRMATION_REQUIRED" });
  assert.deepEqual(await captureCredentialState(), beforeImport, "unconfirmed cloud restoration must not change local keys or sync");
  const restored = await workflow.importSettings({ config, restoreCredentialSync: true });
  assert.equal(restored.syncAiSettingsEnabled, true);
  await workflow.authorizeImportedSettings(restored.importAuthorization.aiProvider);
  assert.deepEqual(await captureAiRequest(settingsService), beforeRequest,
    "import must preserve the actual endpoint, model, protocol and Authorization header sent to AI");
  const disabled = await workflow.importSettings({ config: { ...config, syncAiSettingsEnabled: false }, restoreCredentialSync: true });
  assert.equal(disabled.syncAiSettingsEnabled, false);
  assert.equal((await readSecrets()).openaiApiKey, "synthetic-roundtrip-ai", "disabling restored sync keeps the imported local key");
  await updateCredentials({ syncEnabled: true });
  const oldConfig = { ...config };
  delete oldConfig.syncAiSettingsEnabled;
  const kept = await workflow.importSettings({ config: oldConfig });
  assert.equal(kept.syncAiSettingsEnabled, true, "files without the preference cannot turn existing sync off");
}

async function captureAiRequest(settingsService) {
  const originalFetch = globalThis.fetch;
  let sent;
  globalThis.fetch = async (endpoint, init) => {
    sent = { endpoint, headers: init.headers, body: JSON.parse(init.body) };
    return new Response(JSON.stringify({ output_text: "Synthetic completion" }), { headers: { "content-type": "application/json" } });
  };
  try {
    const settings = await settingsService.getSettings(), provider = await readProviderProfile(settings);
    await requestAiCompletion(settings, { apiKey: provider.openaiApiKey, input: "synthetic input", maxTokens: 40,
      hasOriginPermission: async () => true });
    return sent;
  } finally { globalThis.fetch = originalFetch; }
}

function memoryStorage() {
  const values = {};
  return {
    failNextSet: false, writes: 0,
    async get(keys) {
      if (keys == null) return structuredClone(values);
      return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter(key => Object.hasOwn(values, key)).map(key => [key, structuredClone(values[key])]));
    },
    async set(input) {
      if (this.failNextSet) { this.failNextSet = false; throw new Error("SYNTHETIC_STORAGE_FAILURE"); }
      this.writes++;
      Object.assign(values, structuredClone(input));
    },
    async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) delete values[key]; },
  };
}
