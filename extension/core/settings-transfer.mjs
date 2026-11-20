import { normalizeSettings, providerOrigin } from "./settings.mjs";
import { normalizeOriginPattern } from "./permission-state.mjs";
import { PORTABLE_SETTINGS_FIELDS, validatePortableValue, validateNormalizedCollections } from "./settings-transfer-schema.mjs";
import { settingsTransferError as transferError, invalidTransferValue as invalidValue } from "./settings-transfer-errors.mjs";

export { PORTABLE_SETTINGS_FIELDS } from "./settings-transfer-schema.mjs";
export const SETTINGS_TRANSFER_FORMAT = "ampira-settings";
export const SETTINGS_TRANSFER_VERSION = 2;
export const MAX_SETTINGS_TRANSFER_BYTES = 256 * 1024;
export const TRANSFER_BROWSER_PERMISSIONS = Object.freeze(["favicon", "search", "history"]);

export function createSettingsTransferDocument(settings, {
  appVersion = "",
  exportedAt = new Date().toISOString(),
  credentials = {},
  permissions = {},
} = {}) {
  const normalized = normalizeSettings(settings);
  const document = {
    format: SETTINGS_TRANSFER_FORMAT,
    formatVersion: SETTINGS_TRANSFER_VERSION,
    appVersion: cleanMetadata(appVersion, 40),
    exportedAt: normalizedTimestamp(exportedAt),
    settings: pickPortableSettings(normalized),
    ...(typeof settings.syncAiSettingsEnabled === "boolean" ? { syncAiSettingsEnabled: settings.syncAiSettingsEnabled } : {}),
    credentials: portableCredentials(credentials, normalized),
    permissions: portablePermissions({
      origins: (permissions.origins || []).map(normalizeOriginPattern).filter(Boolean),
      permissions: (permissions.permissions || []).filter(permission => TRANSFER_BROWSER_PERMISSIONS.includes(permission)),
      bookmarkConsent: settings.bookmarkConsentGranted === true,
    }),
  };
  serializeSettingsTransferDocument(document);
  return document;
}

export function serializeSettingsTransferDocument(document) {
  const text = `${JSON.stringify(document, null, 2)}\n`;
  if (new TextEncoder().encode(text).byteLength > MAX_SETTINGS_TRANSFER_BYTES) {
    throw transferError("SETTINGS_IMPORT_FILE_TOO_LARGE");
  }
  return text;
}

export function parseSettingsTransferDocument(input, currentSettings = {}) {
  if (!isRecord(input) || input.format !== SETTINGS_TRANSFER_FORMAT) {
    throw transferError("SETTINGS_IMPORT_INVALID_FORMAT");
  }
  if (![1, SETTINGS_TRANSFER_VERSION].includes(input.formatVersion)) {
    throw transferError("SETTINGS_IMPORT_UNSUPPORTED_VERSION", { version: input.formatVersion });
  }
  if (!isRecord(input.settings)) throw transferError("SETTINGS_IMPORT_INVALID_FORMAT");
  if (settingsTransferBytes(input) > MAX_SETTINGS_TRANSFER_BYTES) {
    throw transferError("SETTINGS_IMPORT_FILE_TOO_LARGE");
  }

  const document = decodeTransferVersion(input);
  const candidate = {};
  for (const field of PORTABLE_SETTINGS_FIELDS) {
    if (!Object.hasOwn(document.settings, field)) continue;
    validatePortableValue(field, document.settings[field]);
    candidate[field] = document.settings[field];
  }
  const credentials = portableCredentials(document.credentials, candidate);
  const permissions = portablePermissions(document.permissions);
  const syncAiSettingsEnabled = document.syncAiSettingsEnabled;
  if (syncAiSettingsEnabled !== undefined && typeof syncAiSettingsEnabled !== "boolean") throw invalidValue("syncAiSettingsEnabled");
  const fields = Object.keys(candidate);
  if (!fields.length && !Object.keys(credentials).length && !permissions.origins.length
    && !permissions.permissions.length && !permissions.bookmarkConsent) throw transferError("SETTINGS_IMPORT_EMPTY");

  const current = normalizeSettings(currentSettings);
  const normalized = normalizeSettings({ ...current, ...candidate });
  validateNormalizedCollections(candidate, normalized);
  const patch = Object.fromEntries(fields.map((field) => [field, normalized[field]]));
  const currentProviderOrigin = providerOrigin(current.openaiBaseUrl);
  const nextProviderOrigin = providerOrigin(patch.openaiBaseUrl || current.openaiBaseUrl);
  return {
    patch,
    credentials,
    permissions,
    syncAiSettingsEnabled,
    fieldCount: fields.length,
    formatVersion: input.formatVersion,
    appVersion: cleanMetadata(input.appVersion, 40),
    exportedAt: normalizedTimestamp(input.exportedAt, ""),
    providerOriginChanged: currentProviderOrigin !== nextProviderOrigin,
  };
}

function decodeTransferVersion(input) {
  const base = { settings: input.settings, credentials: {}, permissions: {}, syncAiSettingsEnabled: undefined };
  if (input.formatVersion === 1) return base;
  return { ...base,
    credentials: Object.hasOwn(input, "credentials") ? input.credentials : {},
    permissions: Object.hasOwn(input, "permissions") ? input.permissions : {},
    syncAiSettingsEnabled: input.syncAiSettingsEnabled,
  };
}

function portableCredentials(value, settings) {
  if (!isRecord(value)) throw invalidValue("credentials");
  const credentials = {};
  for (const field of ["openaiApiKey", "braveSearchApiKey"]) {
    if (!Object.hasOwn(value, field)) continue;
    const key = value[field];
    if (typeof key !== "string" || key.length > 8192 || /[\u0000-\u001f\u007f]/.test(key)) {
      throw invalidValue(field);
    }
    if (key.trim()) credentials[field] = key.trim();
  }
  // A key must travel with its complete provider identity, never a local default.
  if (credentials.openaiApiKey) {
    for (const field of ["openaiBaseUrl", "openaiApiStyle", "openaiSummaryModel"]) {
      if (!Object.hasOwn(settings, field) || !settings[field]) throw invalidValue(field);
      validatePortableValue(field, settings[field]);
    }
  }
  return credentials;
}

function portablePermissions(value) {
  if (!isRecord(value)) throw invalidValue("permissions");
  const { origins = [], permissions = [], bookmarkConsent = false } = value;
  if (!Array.isArray(origins) || origins.length > 1000
    || origins.some(origin => typeof origin !== "string" || origin.length > 2048 || !normalizeOriginPattern(origin)
      || normalizeOriginPattern(origin) !== origin)) throw invalidValue("permissions.origins");
  if (!Array.isArray(permissions) || permissions.length > 3
    || permissions.some(permission => !TRANSFER_BROWSER_PERMISSIONS.includes(permission))) throw invalidValue("permissions.permissions");
  if (typeof bookmarkConsent !== "boolean") throw invalidValue("permissions.bookmarkConsent");
  return { origins: [...new Set(origins)], permissions: [...new Set(permissions)], bookmarkConsent };
}

export function parseSettingsTransferText(text, currentSettings = {}) {
  let config;
  try {
    config = JSON.parse(String(text || ""));
  } catch {
    throw transferError("SETTINGS_IMPORT_INVALID_JSON");
  }
  return { ...parseSettingsTransferDocument(config, currentSettings), config };
}

export function settingsTransferBytes(value) {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

export function settingsTransferFilename(exportedAt) {
  const timestamp = normalizedTimestamp(exportedAt, new Date().toISOString());
  return `ampira-settings-${timestamp.slice(0, 10)}.json`;
}

function pickPortableSettings(settings) {
  return Object.fromEntries(PORTABLE_SETTINGS_FIELDS.map((field) => [field, settings[field]]));
}

function normalizedTimestamp(value, fallback = new Date().toISOString()) {
  const date = new Date(String(value || ""));
  return Number.isFinite(date.getTime()) ? date.toISOString() : fallback;
}

function cleanMetadata(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
