import {
  DEFAULT_SETTINGS,
  LOCAL_PROVIDER_KEY,
  LOCAL_SECRETS_KEY,
} from "./constants.mjs";
import { normalizeProviderSettings } from "./settings.mjs";

const LEGACY_LOCAL_KEYS = ["ampira.vault.v1"];
const LEGACY_SESSION_KEYS = ["ampira.vault.key.session.v1", "ampira.secrets.session.v1"];
const PROVIDER_IDENTITY_FIELDS = ["openaiApiKey", "openaiBaseUrl", "openaiApiStyle", "openaiSummaryModel"];
let mutationQueue = Promise.resolve();

export function readProviderProfile(fallback = {}) {
  return enqueue(() => readProviderProfileRaw(fallback));
}

export function updateProviderProfile(patch = {}, fallback = {}) {
  return enqueue(async () => {
    const current = await readProviderProfileRaw(fallback);
    const candidate = normalizeProviderRecord({ ...current, ...providerPatch(patch) }, current);
    const changed = PROVIDER_IDENTITY_FIELDS.some((field) => candidate[field] !== current[field]);
    if (!changed) return current;
    const next = {
      ...candidate,
      credentialGeneration: Math.min(2147483647, current.credentialGeneration + 1),
    };
    await chrome.storage.local.set({ [LOCAL_PROVIDER_KEY]: next });
    return next;
  });
}

export function readSecrets() {
  return enqueue(readSecretsRaw);
}

export function updateSecrets(patch = {}) {
  return enqueue(async () => {
    const records = await chrome.storage.local.get([LOCAL_PROVIDER_KEY, LOCAL_SECRETS_KEY]);
    const legacy = normalizeLegacySecrets(records[LOCAL_SECRETS_KEY]);
    let provider = isRecord(records[LOCAL_PROVIDER_KEY])
      ? normalizeProviderRecord(records[LOCAL_PROVIDER_KEY])
      : null;

    if (Object.hasOwn(patch, "openaiApiKey") || !provider && legacy.openaiApiKey) {
      provider = provider || await readProviderProfileRaw();
      const candidate = normalizeProviderRecord(Object.hasOwn(patch, "openaiApiKey")
        ? { ...provider, openaiApiKey: patch.openaiApiKey }
        : provider, provider);
      const changed = candidate.openaiApiKey !== provider.openaiApiKey;
      provider = changed ? {
        ...candidate,
        credentialGeneration: Math.min(2147483647, provider.credentialGeneration + 1),
      } : provider;
      if (changed) await chrome.storage.local.set({ [LOCAL_PROVIDER_KEY]: provider });
    }

    if (Object.hasOwn(patch, "braveSearchApiKey") || legacy.openaiApiKey) {
      const braveSearchApiKey = Object.hasOwn(patch, "braveSearchApiKey")
        ? cleanSecret(patch.braveSearchApiKey)
        : legacy.braveSearchApiKey;
      await writeBraveSecret(braveSearchApiKey);
    }

    return {
      hasOpenAIKey: Boolean(provider ? provider.openaiApiKey : legacy.openaiApiKey),
      hasImageSearchKey: Boolean(Object.hasOwn(patch, "braveSearchApiKey")
        ? cleanSecret(patch.braveSearchApiKey)
        : legacy.braveSearchApiKey),
    };
  });
}

export async function secretStatus() {
  const secrets = await readSecrets();
  return {
    hasOpenAIKey: Boolean(secrets.openaiApiKey),
    hasImageSearchKey: Boolean(secrets.braveSearchApiKey),
  };
}

export function clearLegacyCredentialData() {
  return enqueue(() => Promise.all([
    chrome.storage.local.remove(LEGACY_LOCAL_KEYS),
    chrome.storage.session?.remove(LEGACY_SESSION_KEYS),
  ]));
}

async function readProviderProfileRaw(fallback = {}) {
  const records = await chrome.storage.local.get([LOCAL_PROVIDER_KEY, LOCAL_SECRETS_KEY]);
  const stored = records[LOCAL_PROVIDER_KEY];
  const legacy = normalizeLegacySecrets(records[LOCAL_SECRETS_KEY]);
  if (isRecord(stored)) {
    const normalized = normalizeProviderRecord(stored, fallback);
    if (JSON.stringify(stored) !== JSON.stringify(normalized)) {
      await chrome.storage.local.set({ [LOCAL_PROVIDER_KEY]: normalized });
    }
    if (legacy.openaiApiKey) await writeBraveSecret(legacy.braveSearchApiKey);
    return normalized;
  }

  const migrated = normalizeProviderRecord({
    ...fallback,
    openaiApiKey: legacy.openaiApiKey,
    credentialGeneration: migrationGeneration(fallback, legacy.openaiApiKey),
  });
  await chrome.storage.local.set({ [LOCAL_PROVIDER_KEY]: migrated });
  if (legacy.openaiApiKey) await writeBraveSecret(legacy.braveSearchApiKey);
  return migrated;
}

async function readSecretsRaw() {
  const records = await chrome.storage.local.get([LOCAL_PROVIDER_KEY, LOCAL_SECRETS_KEY]);
  const provider = isRecord(records[LOCAL_PROVIDER_KEY])
    ? normalizeProviderRecord(records[LOCAL_PROVIDER_KEY])
    : null;
  const legacy = normalizeLegacySecrets(records[LOCAL_SECRETS_KEY]);
  return {
    openaiApiKey: provider ? provider.openaiApiKey : legacy.openaiApiKey,
    braveSearchApiKey: legacy.braveSearchApiKey,
  };
}

function normalizeProviderRecord(value = {}, fallback = {}) {
  const normalized = normalizeProviderSettings({ ...fallback, ...value });
  return {
    schemaVersion: 1,
    openaiApiKey: cleanSecret(value?.openaiApiKey),
    openaiBaseUrl: normalized.openaiBaseUrl,
    openaiApiStyle: normalized.openaiApiStyle,
    openaiSummaryModel: normalized.openaiSummaryModel,
    credentialGeneration: normalized.credentialGeneration,
  };
}

function providerPatch(value = {}) {
  const patch = {};
  for (const field of PROVIDER_IDENTITY_FIELDS) {
    if (Object.hasOwn(value, field)) patch[field] = value[field];
  }
  return patch;
}

function normalizeLegacySecrets(value = {}) {
  return {
    openaiApiKey: cleanSecret(value?.openaiApiKey),
    braveSearchApiKey: cleanSecret(value?.braveSearchApiKey || value?.imageSearchApiKey),
  };
}

async function writeBraveSecret(braveSearchApiKey) {
  const normalized = cleanSecret(braveSearchApiKey);
  if (normalized) {
    await chrome.storage.local.set({ [LOCAL_SECRETS_KEY]: { braveSearchApiKey: normalized } });
  } else {
    await chrome.storage.local.remove(LOCAL_SECRETS_KEY);
  }
}

function migrationGeneration(fallback, legacyKey) {
  const provider = normalizeProviderSettings(fallback);
  const customized = provider.openaiBaseUrl !== DEFAULT_SETTINGS.openaiBaseUrl
    || provider.openaiApiStyle !== DEFAULT_SETTINGS.openaiApiStyle
    || provider.openaiSummaryModel !== DEFAULT_SETTINGS.openaiSummaryModel;
  return legacyKey || customized ? 1 : 0;
}

function cleanSecret(value) {
  return String(value || "").trim().slice(0, 8192);
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function enqueue(action) {
  const operation = mutationQueue.then(action);
  mutationQueue = operation.then(() => undefined, () => undefined);
  return operation;
}
