import { LOCAL_PROVIDER_KEY, LOCAL_SECRETS_KEY } from "./constants.mjs";
import { normalizeProviderSettings } from "./settings.mjs";

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
    const secrets = normalizeSecrets(records[LOCAL_SECRETS_KEY]);
    let provider = isRecord(records[LOCAL_PROVIDER_KEY])
      ? normalizeProviderRecord(records[LOCAL_PROVIDER_KEY])
      : null;

    if (Object.hasOwn(patch, "openaiApiKey")) {
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

    if (Object.hasOwn(patch, "braveSearchApiKey")) {
      const braveSearchApiKey = Object.hasOwn(patch, "braveSearchApiKey")
        ? cleanSecret(patch.braveSearchApiKey)
        : secrets.braveSearchApiKey;
      await writeBraveSecret(braveSearchApiKey);
    }

    return {
      hasOpenAIKey: Boolean(provider?.openaiApiKey),
      hasImageSearchKey: Boolean(Object.hasOwn(patch, "braveSearchApiKey")
        ? cleanSecret(patch.braveSearchApiKey)
        : secrets.braveSearchApiKey),
    };
  });
}

export function captureCredentialState() {
  return enqueue(async () => {
    const records = await chrome.storage.local.get([LOCAL_PROVIDER_KEY, LOCAL_SECRETS_KEY]);
    return {
      providerExists: Object.hasOwn(records, LOCAL_PROVIDER_KEY),
      provider: records[LOCAL_PROVIDER_KEY],
      secretsExists: Object.hasOwn(records, LOCAL_SECRETS_KEY),
      secrets: records[LOCAL_SECRETS_KEY],
    };
  });
}

export function restoreCredentialState(snapshot) {
  return enqueue(async () => {
    if (snapshot?.providerExists) await chrome.storage.local.set({ [LOCAL_PROVIDER_KEY]: snapshot.provider });
    else await chrome.storage.local.remove(LOCAL_PROVIDER_KEY);
    if (snapshot?.secretsExists) await chrome.storage.local.set({ [LOCAL_SECRETS_KEY]: snapshot.secrets });
    else await chrome.storage.local.remove(LOCAL_SECRETS_KEY);
  });
}

export async function secretStatus() {
  const secrets = await readSecrets();
  return {
    hasOpenAIKey: Boolean(secrets.openaiApiKey),
    hasImageSearchKey: Boolean(secrets.braveSearchApiKey),
  };
}

async function readProviderProfileRaw(fallback = {}) {
  const records = await chrome.storage.local.get(LOCAL_PROVIDER_KEY);
  const stored = records[LOCAL_PROVIDER_KEY];
  if (isRecord(stored)) {
    const normalized = normalizeProviderRecord(stored, fallback);
    if (JSON.stringify(stored) !== JSON.stringify(normalized)) {
      await chrome.storage.local.set({ [LOCAL_PROVIDER_KEY]: normalized });
    }
    return normalized;
  }

  const created = normalizeProviderRecord({ ...fallback, openaiApiKey: "" });
  await chrome.storage.local.set({ [LOCAL_PROVIDER_KEY]: created });
  return created;
}

async function readSecretsRaw() {
  const records = await chrome.storage.local.get([LOCAL_PROVIDER_KEY, LOCAL_SECRETS_KEY]);
  const provider = isRecord(records[LOCAL_PROVIDER_KEY])
    ? normalizeProviderRecord(records[LOCAL_PROVIDER_KEY])
    : null;
  const secrets = normalizeSecrets(records[LOCAL_SECRETS_KEY]);
  return {
    openaiApiKey: provider?.openaiApiKey || "",
    braveSearchApiKey: secrets.braveSearchApiKey,
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

function normalizeSecrets(value = {}) {
  return {
    braveSearchApiKey: cleanSecret(value?.braveSearchApiKey),
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
