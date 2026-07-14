import { CONSENT_VERSION, DEFAULT_SETTINGS } from "./constants.mjs";
import { normalizeLocale } from "./i18n.mjs";

const BOOLEAN_FIELDS = [
  "bookmarkConsentGranted", "onboardingCompleted", "aiDisclosureAccepted", "pointerGlowEnabled",
  "headerImageEnabled", "headerImageFixed", "headerImageFullscreen", "headerImageBlurEnabled", "cardSummaryEnabled",
  "floatingWebOpenEnabled", "readingQueueOpenOnReadAll", "retainSeenArchive",
  "personalizedRankingEnabled", "publicFeedSupplementEnabled", "webImageSearchEnabled", "websiteShortcutsEnabled",
];
const COLOR_MODES = new Set(["system", "dark", "light"]);
const ACCENT_THEMES = new Set(["violet", "cyan", "emerald", "amber", "rose", "custom"]);
const API_STYLES = new Set(["responses", "chat_completions"]);
const EXCLUSION_FIELDS = [
  "id", "type", "value", "host", "url", "sourceKey", "title", "reason", "reasonKey",
  "reasonDetail", "section", "category", "folderPath", "addedAt",
];
const EXCLUSION_FIELD_LIMITS = {
  id: 96,
  type: 24,
  value: 1024,
  host: 255,
  url: 1024,
  sourceKey: 96,
  title: 200,
  reason: 200,
  reasonKey: 100,
  reasonDetail: 300,
  section: 100,
  category: 150,
  folderPath: 300,
  addedAt: 40,
};
const MAX_EXCLUSION_BYTES = 55 * 1024;
export const MAX_WEBSITE_SHORTCUTS = 16;
export const MAX_WEBSITE_SHORTCUT_TITLE_LENGTH = 60;
export const MAX_WEBSITE_SHORTCUT_URL_LENGTH = 2048;

export function normalizeSettings(value = {}) {
  const input = value && typeof value === "object" ? value : {};
  const settings = { ...DEFAULT_SETTINGS, schemaVersion: 1 };
  settings.consentVersion = boundedInteger(input.consentVersion, 0, 100, DEFAULT_SETTINGS.consentVersion);
  for (const field of BOOLEAN_FIELDS) settings[field] = booleanValue(input[field], DEFAULT_SETTINGS[field]);
  if (settings.consentVersion !== CONSENT_VERSION) {
    settings.bookmarkConsentGranted = false;
    settings.onboardingCompleted = false;
    settings.aiDisclosureAccepted = false;
  }
  settings.uiLocale = input.uiLocale ? normalizeLocale(input.uiLocale) : "";
  settings.colorMode = enumValue(input.colorMode, COLOR_MODES, DEFAULT_SETTINGS.colorMode);
  settings.accentTheme = enumValue(input.accentTheme, ACCENT_THEMES, DEFAULT_SETTINGS.accentTheme);
  settings.customAccentColor = normalizeColor(input.customAccentColor, DEFAULT_SETTINGS.customAccentColor);
  settings.headerImageUrl = normalizePublicUrl(
    Object.hasOwn(input, "headerImageUrl") ? input.headerImageUrl : DEFAULT_SETTINGS.headerImageUrl,
  );
  settings.headerImageBlurAmount = boundedInteger(input.headerImageBlurAmount, 0, 24, DEFAULT_SETTINGS.headerImageBlurAmount);
  settings.headerImageFullscreen = settings.headerImageFixed && settings.headerImageFullscreen;
  settings.websiteShortcuts = normalizeWebsiteShortcuts(input.websiteShortcuts);
  settings.newsBookmarkFolder = cleanString(input.newsBookmarkFolder, 200, DEFAULT_SETTINGS.newsBookmarkFolder);
  settings.inspirationBookmarkFolder = cleanString(input.inspirationBookmarkFolder, 200, DEFAULT_SETTINGS.inspirationBookmarkFolder);
  settings.bookmarkOnlyFolders = uniqueStrings(input.bookmarkOnlyFolders, 200, 100)
    .filter((name) => ![settings.newsBookmarkFolder, settings.inspirationBookmarkFolder].includes(name));
  settings.excludedNewsSources = normalizeExclusions(input.excludedNewsSources);
  Object.assign(settings, normalizeProviderSettings(input));
  settings.dailyAiLimit = boundedInteger(input.dailyAiLimit, 1, 500, DEFAULT_SETTINGS.dailyAiLimit);
  settings.hotNewsCacheSize = boundedInteger(input.hotNewsCacheSize, 16, 500, DEFAULT_SETTINGS.hotNewsCacheSize);
  settings.hotNewsEntriesPerSource = boundedInteger(input.hotNewsEntriesPerSource, 0, 12, DEFAULT_SETTINGS.hotNewsEntriesPerSource);
  settings.newsEntriesPerCategory = boundedInteger(input.newsEntriesPerCategory, 0, 100, DEFAULT_SETTINGS.newsEntriesPerCategory);
  settings.todayNewsPerPublisherLimit = boundedInteger(input.todayNewsPerPublisherLimit, 0, 10, DEFAULT_SETTINGS.todayNewsPerPublisherLimit);
  return settings;
}

export function normalizeProviderSettings(value = {}) {
  const input = value && typeof value === "object" ? value : {};
  return {
    openaiBaseUrl: normalizeServiceUrl(input.openaiBaseUrl || DEFAULT_SETTINGS.openaiBaseUrl),
    openaiApiStyle: enumValue(input.openaiApiStyle, API_STYLES, DEFAULT_SETTINGS.openaiApiStyle),
    openaiSummaryModel: cleanString(input.openaiSummaryModel, 200, DEFAULT_SETTINGS.openaiSummaryModel),
    credentialGeneration: boundedInteger(input.credentialGeneration, 0, 2147483647, DEFAULT_SETTINGS.credentialGeneration),
  };
}

export function providerOrigin(value) {
  return new URL(normalizeServiceUrl(value)).origin;
}

export function normalizeServiceUrl(value) {
  return normalizedServiceUrl(value) || DEFAULT_SETTINGS.openaiBaseUrl;
}

export function isValidServiceUrl(value) {
  return Boolean(normalizedServiceUrl(value));
}

function normalizedServiceUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    if (url.href.length > 2048) return "";
    if (url.username || url.password || url.search || url.hash) return "";
    if (url.protocol === "https:") return url.href.replace(/\/$/, "");
    if (url.protocol === "http:" && isLocalHost(url.hostname)) return url.href.replace(/\/$/, "");
  } catch {
    // Use the safe default below.
  }
  return "";
}

export function normalizePublicUrl(value) {
  if (!value) return "";
  try {
    const url = new URL(String(value).trim());
    if (url.href.length > 2048) return "";
    if (url.protocol === "https:" || url.protocol === "http:" && isLocalHost(url.hostname)) return url.href;
  } catch {
    return "";
  }
  return "";
}

export function normalizeWebsiteShortcutUrl(value) {
  let text = String(value || "").trim();
  if (!text) return "";
  if (!/^[a-z][a-z\d+.-]*:/i.test(text)) text = `https://${text}`;
  try {
    const url = new URL(text);
    if (url.href.length > MAX_WEBSITE_SHORTCUT_URL_LENGTH || url.username || url.password) return "";
    if (url.protocol === "https:") return url.href;
    if (url.protocol === "http:" && isLocalHost(url.hostname)) return url.href;
  } catch {
    return "";
  }
  return "";
}

function normalizeWebsiteShortcuts(value) {
  if (!Array.isArray(value)) return [];
  const output = [];
  const seen = new Set();
  for (const item of value) {
    if (output.length >= MAX_WEBSITE_SHORTCUTS) break;
    if (!item || typeof item !== "object") continue;
    const title = cleanString(item.title, MAX_WEBSITE_SHORTCUT_TITLE_LENGTH, "");
    const url = normalizeWebsiteShortcutUrl(item.url);
    if (!title || !url || seen.has(url)) continue;
    seen.add(url);
    output.push({ title, url });
  }
  return output;
}

function normalizeExclusions(value) {
  if (!Array.isArray(value)) return [];
  const output = [];
  const seen = new Set();
  let usedBytes = 2;
  for (const item of value.slice(0, 250)) {
    if (!item || typeof item !== "object") continue;
    const normalized = {};
    for (const field of EXCLUSION_FIELDS) {
      const text = cleanString(item[field], EXCLUSION_FIELD_LIMITS[field], "");
      if (text) normalized[field] = text;
    }
    if (Number.isFinite(Number(item.streak))) normalized.streak = Math.max(0, Math.min(10000, Math.round(Number(item.streak))));
    const identity = `${normalized.type || "source"}:${normalized.value || normalized.url || normalized.host || normalized.folderPath || ""}`.toLowerCase();
    if (!identity.endsWith(":") && !seen.has(identity)) {
      const entryBytes = new TextEncoder().encode(JSON.stringify(normalized)).byteLength + (output.length ? 1 : 0);
      if (usedBytes + entryBytes > MAX_EXCLUSION_BYTES) break;
      seen.add(identity);
      output.push(normalized);
      usedBytes += entryBytes;
    }
  }
  return output;
}

function booleanValue(value, fallback = false) {
  return value === undefined ? fallback === true : value === true;
}

function enumValue(value, allowed, fallback) {
  const text = String(value || "").trim();
  return allowed.has(text) ? text : fallback;
}

function normalizeColor(value, fallback) {
  const text = String(value || "").trim();
  return /^#[0-9a-f]{6}$/i.test(text) ? text.toUpperCase() : fallback;
}

function cleanString(value, maxLength, fallback) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text ? text.slice(0, maxLength) : fallback;
}

function uniqueStrings(values, maxLength, maxItems) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => cleanString(value, maxLength, ""))
    .filter(Boolean))].slice(0, maxItems);
}

function boundedInteger(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, Math.round(number))) : fallback;
}

function isLocalHost(hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1";
}
