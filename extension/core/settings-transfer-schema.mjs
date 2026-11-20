import { HEADER_IMAGE_HEIGHT_MIN, HEADER_IMAGE_HEIGHT_MAX, HEADER_IMAGE_HEIGHT_STEP } from "./constants.mjs";
import { isValidServiceUrl, normalizePublicUrl } from "./settings.mjs";
import { validKeyboardShortcutMap } from "./keyboard-shortcuts.mjs";
import { invalidTransferValue } from "./settings-transfer-errors.mjs";

const boolean = { valid: value => typeof value === "boolean" };
const choice = values => ({ valid: value => values.includes(value) });
const text = limit => ({ valid: value => typeof value === "string" && value.length <= limit });
const integer = (min, max, step = 1) => ({ valid: value => Number.isInteger(value) && value >= min && value <= max && (value - min) % step === 0 });
const collection = (limit, validItem) => ({ canonical: true, valid: value => Array.isArray(value) && value.length <= limit && value.every(validItem) });
const record = value => Boolean(value) && typeof value === "object" && !Array.isArray(value);

// The ordered schema owns both the portable allowlist and its field validation.
const FIELDS = Object.freeze({
  keyboardShortcutsEnabled: boolean,
  keyboardShortcuts: { valid: validKeyboardShortcutMap },
  uiLocale: choice(["", "en", "zh-CN", "zh-Hant"]),
  colorMode: choice(["system", "dark", "light"]),
  navPosition: choice(["top", "bottom", "left", "right"]),
  navAutoHideEnabled: boolean,
  accentTheme: choice(["violet", "cyan", "emerald", "amber", "rose", "custom"]),
  customAccentColor: { valid: value => typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) },
  sectionTitleOpacity: integer(0, 100),
  pointerGlowEnabled: boolean,
  dashboardGlassBlurEnabled: boolean,
  dashboardCardOrder: collection(6, value => typeof value === "string"),
  headerImageEnabled: boolean,
  headerImageFixed: boolean,
  headerImageFullscreen: boolean,
  headerImageBlurEnabled: boolean,
  headerImageBlurAmount: integer(0, 50),
  headerImageHeightScale: integer(HEADER_IMAGE_HEIGHT_MIN, HEADER_IMAGE_HEIGHT_MAX, HEADER_IMAGE_HEIGHT_STEP),
  headerImageUrl: { valid: value => typeof value === "string" && value.length <= 2048 && (!value || Boolean(normalizePublicUrl(value))) },
  headerImageMediaType: choice(["auto", "image", "video"]),
  headerImageFit: choice(["cover", "contain", "fill", "height"]),
  bookmarkSectionEnabled: boolean,
  websiteShortcutsEnabled: boolean,
  websiteShortcuts: collection(16, record),
  newsBookmarkFolder: text(200),
  newsSourceMode: choice(["public", "bookmarks"]),
  inspirationBookmarkFolder: text(200),
  inspirationSourceMode: choice(["preset", "bookmarks"]),
  bookmarkOnlyFolders: collection(100, value => typeof value === "string" && Boolean(value.trim()) && value.length <= 200),
  hiddenBookmarkCategories: collection(250, record),
  cardSummaryEnabled: boolean,
  floatingWebOpenEnabled: boolean,
  readingQueueOpenOnReadAll: boolean,
  readingQueueReadAllPrompted: boolean,
  retainSeenArchive: boolean,
  syncReadingQueueEnabled: boolean,
  syncTodosEnabled: boolean,
  syncWeatherLocationEnabled: boolean,
  syncStockWatchlistEnabled: boolean,
  syncCountdownsEnabled: boolean,
  syncTrackedTopicsEnabled: boolean,
  syncCalendarEnabled: boolean,
  syncNotesEnabled: boolean,
  syncWorldClockEnabled: boolean,
  personalizedRankingEnabled: boolean,
  publicFeedSupplementEnabled: boolean,
  webImageSearchEnabled: boolean,
  excludedNewsSources: collection(250, record),
  openaiBaseUrl: { valid: value => typeof value === "string" && value.length <= 2048 && isValidServiceUrl(value) },
  openaiApiStyle: choice(["responses", "chat_completions"]),
  openaiSummaryModel: text(200),
  dailyAiLimit: integer(1, 500),
  hotNewsCacheSize: integer(16, 500),
  hotNewsEntriesPerSource: integer(0, 12),
  newsEntriesPerCategory: integer(0, 100),
  todayNewsPerPublisherLimit: integer(0, 10),
});

export const PORTABLE_SETTINGS_FIELDS = Object.freeze(Object.keys(FIELDS));

export function validatePortableValue(field, value) {
  if (!FIELDS[field]?.valid(value)) throw invalidTransferValue(field);
}

export function validateNormalizedCollections(candidate, normalized) {
  for (const [field, rule] of Object.entries(FIELDS)) {
    if (rule.canonical && Object.hasOwn(candidate, field)
      && JSON.stringify(candidate[field]) !== JSON.stringify(normalized[field])) throw invalidTransferValue(field);
  }
  if (Object.hasOwn(candidate, "headerImageFullscreen") && candidate.headerImageFullscreen !== normalized.headerImageFullscreen) {
    throw invalidTransferValue("headerImageFullscreen");
  }
}
