import { SYNC_CREDENTIALS_KEY } from "./constants.mjs";
import { isValidServiceUrl, normalizeProviderSettings } from "./settings.mjs";
import { assertSyncStorageBudget, syncStorageBytes } from "./sync-budget.mjs";

const MAX_CREDENTIAL_SYNC_BYTES = 7000;
const PROVIDER_FIELDS = ["openaiBaseUrl", "openaiApiStyle", "openaiSummaryModel", "openaiApiKey"];

// A single record keeps each credential bound to its complete provider identity.
export function encodeSyncedCredentials(provider, secrets) {
  return {
    version: 1,
    enabled: true,
    provider: Object.fromEntries(PROVIDER_FIELDS.map((field) => [field, provider[field]])),
    braveSearchApiKey: secrets.braveSearchApiKey,
  };
}

export function decodeSyncedCredentials(value) {
  if (value?.version !== 1 || value.enabled !== true) return null;
  const provider = value.provider;
  if (!provider || !PROVIDER_FIELDS.every((field) => typeof provider[field] === "string")) return null;
  if (!isValidServiceUrl(provider.openaiBaseUrl)
    || !["responses", "chat_completions"].includes(provider.openaiApiStyle)
    || !provider.openaiSummaryModel.trim() || provider.openaiSummaryModel.length > 200
    || provider.openaiApiKey.length > 8192
    || typeof value.braveSearchApiKey !== "string" || value.braveSearchApiKey.length > 8192) return null;
  if (syncStorageBytes({ [SYNC_CREDENTIALS_KEY]: value }) > MAX_CREDENTIAL_SYNC_BYTES) return null;
  return {
    provider: { ...normalizeProviderSettings(provider), openaiApiKey: provider.openaiApiKey.trim() },
    secrets: { braveSearchApiKey: value.braveSearchApiKey.trim() },
  };
}

export function assertCredentialSyncBudget(records, value) {
  const writes = { [SYNC_CREDENTIALS_KEY]: value };
  if (syncStorageBytes(writes) > MAX_CREDENTIAL_SYNC_BYTES) {
    const error = new Error("CREDENTIAL_SYNC_TOO_LARGE");
    error.code = "CREDENTIAL_SYNC_TOO_LARGE";
    error.messageKey = "background.error.credentialSyncTooLarge";
    throw error;
  }
  assertSyncStorageBudget(records, writes);
}
