import assert from "node:assert/strict";
import {
  CONSENT_VERSION,
  DEFAULT_SETTINGS,
  LOCAL_DEVICE_CONSENT_KEY,
  LOCAL_ONLY_SETTINGS_FIELDS,
  LOCAL_PROVIDER_KEY,
  LOCAL_SECRETS_KEY,
  SETTINGS_KEY,
} from "../../extension/core/constants.mjs";
import {
  grantBookmarkConsent,
  markOnboardingComplete,
  readDeviceConsent,
  setAiDisclosureConsent,
} from "../../extension/core/device-consent.mjs";
import {
  readProviderProfile,
  readSecrets,
  updateProviderProfile,
  updateSecrets,
} from "../../extension/core/secrets.mjs";
import { createSettingsStore } from "../../extension/core/settings-store.mjs";
import { isValidServiceUrl, normalizeServiceUrl, normalizeSettings } from "../../extension/core/settings.mjs";

assert.equal(normalizeServiceUrl("https://user:secret@example.com/v1"), DEFAULT_SETTINGS.openaiBaseUrl);
assert.equal(normalizeServiceUrl("https://example.com/v1?token=secret"), DEFAULT_SETTINGS.openaiBaseUrl);
assert.equal(normalizeServiceUrl("https://example.com/v1#fragment"), DEFAULT_SETTINGS.openaiBaseUrl);
assert.equal(normalizeServiceUrl("https://example.com/v1/"), "https://example.com/v1");
assert.equal(isValidServiceUrl("https://example.com/v1/"), true);
assert.equal(isValidServiceUrl("https://example.com/v1?token=secret"), false);

const invalidConsent = normalizeSettings({
  consentVersion: CONSENT_VERSION - 1,
  bookmarkConsentGranted: true,
  onboardingCompleted: true,
  aiDisclosureAccepted: true,
});
assert.equal(invalidConsent.bookmarkConsentGranted, false);
assert.equal(invalidConsent.onboardingCompleted, false);
assert.equal(invalidConsent.aiDisclosureAccepted, false);

const local = memoryStorage();
const sync = memoryStorage();
globalThis.chrome = {
  storage: {
    local,
    sync,
    session: memoryStorage(),
  },
};

await local.set({
  [LOCAL_PROVIDER_KEY]: {
    schemaVersion: 1,
    openaiApiKey: "local-openai",
    openaiBaseUrl: "https://api.deepseek.com/v1",
    openaiApiStyle: "chat_completions",
    openaiSummaryModel: "deepseek-chat",
    credentialGeneration: 1,
  },
  [LOCAL_SECRETS_KEY]: {
    braveSearchApiKey: "local-brave",
  },
});
await sync.set({
  [SETTINGS_KEY]: {
    ...DEFAULT_SETTINGS,
    consentVersion: CONSENT_VERSION,
    bookmarkConsentGranted: true,
    onboardingCompleted: true,
    aiDisclosureAccepted: true,
    openaiBaseUrl: "https://api.deepseek.com/v1",
    openaiApiStyle: "chat_completions",
    openaiSummaryModel: "deepseek-chat",
    openaiApiKey: "must-not-migrate-from-sync",
  },
});

const settingsStore = createSettingsStore(sync);
const syncedSettings = await settingsStore.read();
const provider = await readProviderProfile(syncedSettings);
assert.deepEqual(provider, {
  schemaVersion: 1,
  openaiApiKey: "local-openai",
  openaiBaseUrl: "https://api.deepseek.com/v1",
  openaiApiStyle: "chat_completions",
  openaiSummaryModel: "deepseek-chat",
  credentialGeneration: 1,
});
assert.deepEqual(await readSecrets(), {
  openaiApiKey: "local-openai",
  braveSearchApiKey: "local-brave",
});
assert.deepEqual((await local.get(LOCAL_SECRETS_KEY))[LOCAL_SECRETS_KEY], {
  braveSearchApiKey: "local-brave",
});
assert.deepEqual(await readDeviceConsent(provider.openaiBaseUrl), {
  consentVersion: 0,
  bookmarkConsentGranted: false,
  onboardingCompleted: false,
  aiDisclosureAccepted: false,
}, "synced consent must not be inherited by this device");

assert.equal(await settingsStore.sanitizeLocalOnlyFields(), true);
const sanitizedSyncRoot = (await sync.get(SETTINGS_KEY))[SETTINGS_KEY];
for (const field of LOCAL_ONLY_SETTINGS_FIELDS) {
  assert.equal(Object.hasOwn(sanitizedSyncRoot, field), false, `${field} must be removed from Sync`);
}
assert(!JSON.stringify(await sync.get(null)).includes("must-not-migrate-from-sync"));

local.clearSetLog();
const updated = await updateProviderProfile({
  openaiApiKey: "new-openai-key",
  openaiBaseUrl: "https://api.openai.com/v1",
  openaiApiStyle: "responses",
  openaiSummaryModel: "gpt-5.4-mini",
});
assert.equal(updated.credentialGeneration, provider.credentialGeneration + 1);
assert.deepEqual((await local.get(LOCAL_PROVIDER_KEY))[LOCAL_PROVIDER_KEY], updated);
const providerWrites = local.setLog().filter((entry) => Object.hasOwn(entry, LOCAL_PROVIDER_KEY));
assert.equal(providerWrites.length, 1, "one provider change must use one local storage write");
assert.deepEqual(providerWrites[0][LOCAL_PROVIDER_KEY], updated, "the atomic record must contain key and complete provider identity");
assert.equal((await updateProviderProfile({ ...updated })).credentialGeneration, updated.credentialGeneration, "an unchanged profile must not advance its generation");

const separateSecretLocal = memoryStorage();
chrome.storage.local = separateSecretLocal;
await updateProviderProfile({ openaiApiKey: "provider-key-kept-during-brave-update" });
await updateSecrets({ braveSearchApiKey: "old-brave-key" });
await updateSecrets({ braveSearchApiKey: "new-brave-key" });
assert.equal((await readProviderProfile()).openaiApiKey, "provider-key-kept-during-brave-update");
assert.deepEqual(await readSecrets(), {
  openaiApiKey: "provider-key-kept-during-brave-update",
  braveSearchApiKey: "new-brave-key",
});

const noSyncedKeyLocal = memoryStorage();
chrome.storage.local = noSyncedKeyLocal;
const noLocalKeyProfile = await readProviderProfile({
  ...syncedSettings,
  openaiApiKey: "sync-only-key",
});
assert.equal(noLocalKeyProfile.openaiApiKey, "", "a credential present only in Sync must never be copied locally");

const consentLocal = memoryStorage();
chrome.storage.local = consentLocal;
await grantBookmarkConsent();
assert.deepEqual(await readDeviceConsent("https://api.openai.com/v1"), {
  consentVersion: CONSENT_VERSION,
  bookmarkConsentGranted: true,
  onboardingCompleted: false,
  aiDisclosureAccepted: false,
});
await markOnboardingComplete();
await setAiDisclosureConsent(true, "https://api.openai.com/v1");
assert.equal((await readDeviceConsent("https://api.openai.com/other-path")).aiDisclosureAccepted, true, "AI consent is bound to origin, not a mutable API path");
assert.equal((await readDeviceConsent("https://api.deepseek.com/v1")).aiDisclosureAccepted, false, "AI consent must not follow a provider-origin change");
const storedConsent = (await consentLocal.get(LOCAL_DEVICE_CONSENT_KEY))[LOCAL_DEVICE_CONSENT_KEY];
assert.equal(storedConsent.aiDisclosure.providerOrigin, "https://api.openai.com");

await consentLocal.set({
  [LOCAL_DEVICE_CONSENT_KEY]: {
    ...storedConsent,
    bookmark: { version: CONSENT_VERSION + 1, granted: true },
    onboarding: { version: CONSENT_VERSION + 1, completed: true },
    aiDisclosure: {
      version: CONSENT_VERSION + 1,
      accepted: true,
      providerOrigin: "https://api.openai.com",
    },
  },
});
assert.deepEqual(await readDeviceConsent("https://api.openai.com/v1"), {
  consentVersion: 0,
  bookmarkConsentGranted: false,
  onboardingCompleted: false,
  aiDisclosureAccepted: false,
}, "a consent-version change must force fresh device consent");

await settingsStore.write({
  ...DEFAULT_SETTINGS,
  consentVersion: CONSENT_VERSION,
  bookmarkConsentGranted: true,
  aiDisclosureAccepted: true,
  openaiBaseUrl: "https://local-only.example/v1",
  credentialGeneration: 99,
});
const finalSync = await sync.get(null);
for (const field of LOCAL_ONLY_SETTINGS_FIELDS) {
  assert.equal(Object.hasOwn(finalSync[SETTINGS_KEY], field), false, `${field} must stay out of new Sync writes`);
}

console.log("provider and consent tests passed");

function memoryStorage() {
  const values = {};
  const writes = [];
  return {
    async get(keys) {
      if (keys == null) return clone(values);
      const list = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(list
        .filter((key) => Object.hasOwn(values, key))
        .map((key) => [key, clone(values[key])]));
    },
    async set(input) {
      const copied = clone(input);
      writes.push(copied);
      Object.assign(values, copied);
    },
    async remove(keys) {
      for (const key of (Array.isArray(keys) ? keys : [keys])) delete values[key];
    },
    async clear() {
      for (const key of Object.keys(values)) delete values[key];
    },
    setLog() {
      return clone(writes);
    },
    clearSetLog() {
      writes.length = 0;
    },
  };
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}
