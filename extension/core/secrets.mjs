import { LOCAL_PROVIDER_KEY, LOCAL_SECRETS_KEY, SYNC_CREDENTIALS_KEY } from "./constants.mjs";
import { assertCredentialSyncBudget, decodeSyncedCredentials, encodeSyncedCredentials } from "./credential-sync.mjs";
import { bindProviderPatchToOrigin } from "./provider-policy.mjs";
import { normalizeProviderSettings } from "./settings.mjs";

const PROVIDER_IDENTITY_FIELDS = ["openaiApiKey", "openaiBaseUrl", "openaiApiStyle", "openaiSummaryModel"];
let mutationQueue = Promise.resolve();

export function readProviderProfile(fallback = {}) {
  return enqueue(async () => (await readCredentialBundle(fallback)).provider);
}

export function readSecrets() {
  return enqueue(async () => {
    const { provider, secrets } = await readCredentialBundle();
    return { openaiApiKey: provider.openaiApiKey, braveSearchApiKey: secrets.braveSearchApiKey };
  });
}

export function updateCredentials(patch = {}, fallback = {}) {
  return enqueue(async () => (await writeCredentialBundle(patch, fallback)).provider);
}

export function captureCredentialState() {
  return enqueue(captureCredentialStateRaw);
}

export function restoreCredentialState(snapshot) {
  return enqueue(async () => {
    await restoreLocalCredentialState(snapshot);
    const stored = await chrome.storage.sync.get(SYNC_CREDENTIALS_KEY);
    if (sameValue(stored[SYNC_CREDENTIALS_KEY], snapshot?.synced)) return;
    if (snapshot?.syncedExists) await chrome.storage.sync.set({ [SYNC_CREDENTIALS_KEY]: snapshot.synced });
    else await chrome.storage.sync.remove(SYNC_CREDENTIALS_KEY);
  });
}

export function secretStatus() {
  return enqueue(async () => {
    const { provider, secrets, syncEnabled } = await readCredentialBundle();
    return {
      hasOpenAIKey: Boolean(provider.openaiApiKey),
      hasImageSearchKey: Boolean(secrets.braveSearchApiKey),
      syncAiSettingsEnabled: syncEnabled,
    };
  });
}

async function readCredentialBundle(fallback = {}) {
  const snapshot = await captureCredentialStateRaw();
  const localProvider = normalizeProviderRecord(snapshot.providerExists
    ? snapshot.provider
    : { ...fallback, openaiApiKey: "" });
  const synced = decodeSyncedCredentials(snapshot.synced);
  const provider = synced ? nextProviderRecord(synced.provider, localProvider) : localProvider;
  const secrets = normalizeSecrets(synced?.secrets || snapshot.secrets);
  // Keep a local copy so disabling sync preserves each device's last received config.
  await persistLocalCredentials(provider, secrets, snapshot);
  return { provider, secrets, syncEnabled: Boolean(synced), snapshot };
}

async function writeCredentialBundle({ providerPatch: patch = {}, secretsPatch = {}, syncEnabled } = {}, fallback = {}) {
  const current = await readCredentialBundle(fallback);
  const boundPatch = bindProviderPatchToOrigin(providerPatch(patch), current.provider);
  const provider = nextProviderRecord({ ...current.provider, ...boundPatch }, current.provider);
  const secrets = normalizeSecrets({ ...current.secrets, ...secretsPatch });
  const enabled = typeof syncEnabled === "boolean" ? syncEnabled : current.syncEnabled;
  const synced = enabled ? encodeSyncedCredentials(provider, secrets) : undefined;
  const syncChanged = enabled
    ? !sameValue(synced, current.snapshot.synced)
    : syncEnabled === false && current.snapshot.syncedExists;
  if (enabled && syncChanged) {
    assertCredentialSyncBudget(await chrome.storage.sync.get(null), synced);
  }
  const snapshot = await captureCredentialStateRaw();
  try {
    await persistLocalCredentials(provider, secrets, snapshot);
    if (syncChanged) {
      if (enabled) await chrome.storage.sync.set({ [SYNC_CREDENTIALS_KEY]: synced });
      else await chrome.storage.sync.remove(SYNC_CREDENTIALS_KEY);
    }
  } catch (error) {
    try { await restoreLocalCredentialState(snapshot); } catch {
      error.rollbackFailed = true;
      error.rollbackCode = "CREDENTIAL_ROLLBACK_FAILED";
    }
    throw error;
  }
  return { provider, secrets, syncEnabled: enabled };
}

async function captureCredentialStateRaw() {
  const [records, synced] = await Promise.all([
    chrome.storage.local.get([LOCAL_PROVIDER_KEY, LOCAL_SECRETS_KEY]),
    chrome.storage.sync.get(SYNC_CREDENTIALS_KEY),
  ]);
  return {
    providerExists: Object.hasOwn(records, LOCAL_PROVIDER_KEY),
    provider: records[LOCAL_PROVIDER_KEY],
    secretsExists: Object.hasOwn(records, LOCAL_SECRETS_KEY),
    secrets: records[LOCAL_SECRETS_KEY],
    syncedExists: Object.hasOwn(synced, SYNC_CREDENTIALS_KEY),
    synced: synced[SYNC_CREDENTIALS_KEY],
  };
}

async function persistLocalCredentials(provider, secrets, snapshot) {
  const writes = {};
  if (!sameValue(snapshot.provider, provider)) writes[LOCAL_PROVIDER_KEY] = provider;
  if (secrets.braveSearchApiKey && !sameValue(snapshot.secrets, secrets)) writes[LOCAL_SECRETS_KEY] = secrets;
  if (Object.keys(writes).length) await chrome.storage.local.set(writes);
  if (!secrets.braveSearchApiKey && snapshot.secretsExists) await chrome.storage.local.remove(LOCAL_SECRETS_KEY);
}

async function restoreLocalCredentialState(snapshot) {
  const writes = {};
  const removals = [];
  if (snapshot?.providerExists) writes[LOCAL_PROVIDER_KEY] = snapshot.provider;
  else removals.push(LOCAL_PROVIDER_KEY);
  if (snapshot?.secretsExists) writes[LOCAL_SECRETS_KEY] = snapshot.secrets;
  else removals.push(LOCAL_SECRETS_KEY);
  if (Object.keys(writes).length) await chrome.storage.local.set(writes);
  if (removals.length) await chrome.storage.local.remove(removals);
}

function nextProviderRecord(value, current) {
  const candidate = normalizeProviderRecord(value, current);
  const changed = PROVIDER_IDENTITY_FIELDS.some((field) => candidate[field] !== current[field]);
  return {
    ...candidate,
    credentialGeneration: Math.min(2147483647, current.credentialGeneration + Number(changed)),
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
  return Object.fromEntries(PROVIDER_IDENTITY_FIELDS.filter((field) => Object.hasOwn(value, field)).map((field) => [field, value[field]]));
}

function normalizeSecrets(value = {}) {
  return { braveSearchApiKey: cleanSecret(value?.braveSearchApiKey) };
}

function cleanSecret(value) {
  return String(value || "").trim().slice(0, 8192);
}

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function enqueue(action) {
  const operation = mutationQueue.then(action);
  mutationQueue = operation.then(() => undefined, () => undefined);
  return operation;
}
