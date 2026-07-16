import {
  isValidServiceUrl,
  normalizePublicUrl,
  normalizeSettings,
  providerOrigin,
} from "./settings.mjs";

export const SETTINGS_TRANSFER_FORMAT = "ampira-settings";
export const SETTINGS_TRANSFER_VERSION = 1;
export const MAX_SETTINGS_TRANSFER_BYTES = 256 * 1024;

export const PORTABLE_SETTINGS_FIELDS = Object.freeze([
  "uiLocale",
  "colorMode",
  "accentTheme",
  "customAccentColor",
  "pointerGlowEnabled",
  "headerImageEnabled",
  "headerImageFixed",
  "headerImageFullscreen",
  "headerImageBlurEnabled",
  "headerImageBlurAmount",
  "headerImageHeightScale",
  "headerImageUrl",
  "bookmarkSectionEnabled",
  "websiteShortcutsEnabled",
  "websiteShortcuts",
  "newsBookmarkFolder",
  "newsSourceMode",
  "inspirationBookmarkFolder",
  "inspirationSourceMode",
  "bookmarkOnlyFolders",
  "hiddenBookmarkCategories",
  "cardSummaryEnabled",
  "floatingWebOpenEnabled",
  "readingQueueOpenOnReadAll",
  "readingQueueReadAllPrompted",
  "retainSeenArchive",
  "syncReadingQueueEnabled",
  "syncTodosEnabled",
  "syncWeatherLocationEnabled",
  "personalizedRankingEnabled",
  "publicFeedSupplementEnabled",
  "webImageSearchEnabled",
  "excludedNewsSources",
  "openaiBaseUrl",
  "openaiApiStyle",
  "openaiSummaryModel",
  "dailyAiLimit",
  "hotNewsCacheSize",
  "hotNewsEntriesPerSource",
  "newsEntriesPerCategory",
  "todayNewsPerPublisherLimit",
]);

const BOOLEAN_FIELDS = new Set([
  "pointerGlowEnabled",
  "headerImageEnabled",
  "headerImageFixed",
  "headerImageFullscreen",
  "headerImageBlurEnabled",
  "bookmarkSectionEnabled",
  "websiteShortcutsEnabled",
  "cardSummaryEnabled",
  "floatingWebOpenEnabled",
  "readingQueueOpenOnReadAll",
  "readingQueueReadAllPrompted",
  "retainSeenArchive",
  "syncReadingQueueEnabled",
  "syncTodosEnabled",
  "syncWeatherLocationEnabled",
  "personalizedRankingEnabled",
  "publicFeedSupplementEnabled",
  "webImageSearchEnabled",
]);
const ARRAY_FIELDS = new Set(["websiteShortcuts", "bookmarkOnlyFolders", "hiddenBookmarkCategories", "excludedNewsSources"]);
const NUMBER_RANGES = Object.freeze({
  headerImageBlurAmount: [0, 24],
  headerImageHeightScale: [70, 140],
  dailyAiLimit: [1, 500],
  hotNewsCacheSize: [16, 500],
  hotNewsEntriesPerSource: [0, 12],
  newsEntriesPerCategory: [0, 100],
  todayNewsPerPublisherLimit: [0, 10],
});
const STRING_LIMITS = Object.freeze({
  uiLocale: 20,
  colorMode: 20,
  accentTheme: 20,
  customAccentColor: 7,
  headerImageUrl: 2048,
  newsBookmarkFolder: 200,
  newsSourceMode: 20,
  inspirationBookmarkFolder: 200,
  inspirationSourceMode: 20,
  openaiBaseUrl: 2048,
  openaiApiStyle: 40,
  openaiSummaryModel: 200,
});
const LOCALES = new Set(["", "en", "zh-CN", "zh-Hant"]);
const COLOR_MODES = new Set(["system", "dark", "light"]);
const ACCENT_THEMES = new Set(["violet", "cyan", "emerald", "amber", "rose", "custom"]);
const API_STYLES = new Set(["responses", "chat_completions"]);
const NEWS_SOURCE_MODES = new Set(["public", "bookmarks"]);
const INSPIRATION_SOURCE_MODES = new Set(["preset", "bookmarks"]);

export function createSettingsTransferDocument(settings, {
  appVersion = "",
  exportedAt = new Date().toISOString(),
} = {}) {
  const normalized = normalizeSettings(settings);
  return {
    format: SETTINGS_TRANSFER_FORMAT,
    formatVersion: SETTINGS_TRANSFER_VERSION,
    appVersion: cleanMetadata(appVersion, 40),
    exportedAt: normalizedTimestamp(exportedAt),
    settings: pickPortableSettings(normalized),
  };
}

export function parseSettingsTransferDocument(input, currentSettings = {}) {
  if (!isRecord(input) || input.format !== SETTINGS_TRANSFER_FORMAT) {
    throw transferError("SETTINGS_IMPORT_INVALID_FORMAT");
  }
  if (input.formatVersion !== SETTINGS_TRANSFER_VERSION) {
    throw transferError("SETTINGS_IMPORT_UNSUPPORTED_VERSION", { version: input.formatVersion });
  }
  if (!isRecord(input.settings)) throw transferError("SETTINGS_IMPORT_INVALID_FORMAT");
  if (settingsTransferBytes(input) > MAX_SETTINGS_TRANSFER_BYTES) {
    throw transferError("SETTINGS_IMPORT_FILE_TOO_LARGE");
  }

  const candidate = {};
  for (const field of PORTABLE_SETTINGS_FIELDS) {
    if (!Object.hasOwn(input.settings, field)) continue;
    validatePortableValue(field, input.settings[field]);
    candidate[field] = input.settings[field];
  }
  const fields = Object.keys(candidate);
  if (!fields.length) throw transferError("SETTINGS_IMPORT_EMPTY");

  const current = normalizeSettings(currentSettings);
  const normalized = normalizeSettings({ ...current, ...candidate });
  validateNormalizedCollections(candidate, normalized);
  const patch = Object.fromEntries(fields.map((field) => [field, normalized[field]]));
  const currentProviderOrigin = providerOrigin(current.openaiBaseUrl);
  const nextProviderOrigin = providerOrigin(patch.openaiBaseUrl || current.openaiBaseUrl);
  return {
    patch,
    fieldCount: fields.length,
    formatVersion: input.formatVersion,
    appVersion: cleanMetadata(input.appVersion, 40),
    exportedAt: normalizedTimestamp(input.exportedAt, ""),
    providerOriginChanged: currentProviderOrigin !== nextProviderOrigin,
  };
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

function validatePortableValue(field, value) {
  if (BOOLEAN_FIELDS.has(field)) {
    if (typeof value !== "boolean") throw invalidValue(field);
    return;
  }
  if (ARRAY_FIELDS.has(field)) {
    if (!Array.isArray(value)) throw invalidValue(field);
    validateCollection(field, value);
    return;
  }
  if (Object.hasOwn(NUMBER_RANGES, field)) {
    const [min, max] = NUMBER_RANGES[field];
    if (!Number.isInteger(value) || value < min || value > max
      || field === "headerImageHeightScale" && value % 5 !== 0) throw invalidValue(field);
    return;
  }
  if (!Object.hasOwn(STRING_LIMITS, field) || typeof value !== "string" || value.length > STRING_LIMITS[field]) {
    throw invalidValue(field);
  }
  if (field === "uiLocale" && !LOCALES.has(value)) throw invalidValue(field);
  if (field === "colorMode" && !COLOR_MODES.has(value)) throw invalidValue(field);
  if (field === "accentTheme" && !ACCENT_THEMES.has(value)) throw invalidValue(field);
  if (field === "customAccentColor" && !/^#[0-9a-f]{6}$/i.test(value)) throw invalidValue(field);
  if (field === "headerImageUrl" && value && !normalizePublicUrl(value)) throw invalidValue(field);
  if (field === "openaiBaseUrl" && !isValidServiceUrl(value)) throw invalidValue(field);
  if (field === "openaiApiStyle" && !API_STYLES.has(value)) throw invalidValue(field);
  if (field === "newsSourceMode" && !NEWS_SOURCE_MODES.has(value)) throw invalidValue(field);
  if (field === "inspirationSourceMode" && !INSPIRATION_SOURCE_MODES.has(value)) throw invalidValue(field);
}

function validateCollection(field, value) {
  if (field === "bookmarkOnlyFolders") {
    if (value.length > 100 || value.some((item) => typeof item !== "string" || !item.trim() || item.length > 200)) {
      throw invalidValue(field);
    }
    return;
  }
  const limit = field === "websiteShortcuts" ? 16 : 250;
  if (value.length > limit || value.some((item) => !isRecord(item))) throw invalidValue(field);
}

function validateNormalizedCollections(candidate, normalized) {
  for (const field of ARRAY_FIELDS) {
    if (!Object.hasOwn(candidate, field)) continue;
    if (JSON.stringify(candidate[field]) !== JSON.stringify(normalized[field])) throw invalidValue(field);
  }
  if (Object.hasOwn(candidate, "headerImageFullscreen")
    && candidate.headerImageFullscreen !== normalized.headerImageFullscreen) {
    throw invalidValue("headerImageFullscreen");
  }
}

function invalidValue(field) {
  return transferError("SETTINGS_IMPORT_INVALID_VALUE", { field });
}

function transferError(code, details = {}) {
  const error = new Error(code);
  error.name = "SettingsTransferError";
  error.code = code;
  error.details = details;
  return error;
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
