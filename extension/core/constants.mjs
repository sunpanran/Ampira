export const SETTINGS_KEY = "ampira.settings.v1";
export const LOCAL_SECRETS_KEY = "ampira.secrets.local.v1";
export const LOCAL_PROVIDER_KEY = "ampira.provider.local.v1";
export const LOCAL_DEVICE_CONSENT_KEY = "ampira.device-consent.local.v1";
export const LOCAL_HEADER_COVER_KEY = "ampira.header-cover.local.v1";
export const DB_NAME = "ampira-extension";
export const DB_VERSION = 1;
export const CACHE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const CACHE_LIMIT_BYTES = 25 * 1024 * 1024;
export const REFRESH_ALARM = "ampira-refresh";
export const REFRESH_PERIOD_MINUTES = 15;
export const CONSENT_VERSION = 1;

export const LOCAL_ONLY_SETTINGS_FIELDS = Object.freeze([
  "consentVersion",
  "bookmarkConsentGranted",
  "onboardingCompleted",
  "aiDisclosureAccepted",
  "openaiBaseUrl",
  "openaiApiStyle",
  "openaiSummaryModel",
  "credentialGeneration",
  "openaiApiKey",
  "braveSearchApiKey",
  "imageSearchApiKey",
]);

export const DEFAULT_SETTINGS = Object.freeze({
  schemaVersion: 1,
  consentVersion: 0,
  bookmarkConsentGranted: false,
  onboardingCompleted: false,
  aiDisclosureAccepted: false,
  uiLocale: "",
  colorMode: "dark",
  accentTheme: "violet",
  customAccentColor: "#9152FF",
  pointerGlowEnabled: true,
  dashboardGlassBlurEnabled: true,
  headerImageEnabled: true,
  headerImageFixed: false,
  headerImageFullscreen: false,
  headerImageBlurEnabled: false,
  headerImageBlurAmount: 12,
  headerImageHeightScale: 100,
  headerImageUrl: "",
  bookmarkSectionEnabled: true,
  websiteShortcutsEnabled: false,
  websiteShortcuts: [],
  newsBookmarkFolder: "",
  newsSourceMode: "public",
  inspirationBookmarkFolder: "",
  inspirationSourceMode: "preset",
  bookmarkOnlyFolders: [],
  hiddenBookmarkCategories: [],
  cardSummaryEnabled: true,
  floatingWebOpenEnabled: false,
  readingQueueOpenOnReadAll: true,
  readingQueueReadAllPrompted: false,
  retainSeenArchive: true,
  syncReadingQueueEnabled: false,
  syncTodosEnabled: false,
  syncWeatherLocationEnabled: false,
  personalizedRankingEnabled: false,
  publicFeedSupplementEnabled: true,
  webImageSearchEnabled: false,
  excludedNewsSources: [],
  openaiBaseUrl: "https://api.openai.com/v1",
  openaiApiStyle: "responses",
  openaiSummaryModel: "gpt-5.4-mini",
  credentialGeneration: 0,
  dailyAiLimit: 50,
  hotNewsCacheSize: 192,
  hotNewsEntriesPerSource: 5,
  newsEntriesPerCategory: 12,
  todayNewsPerPublisherLimit: 0,
});

export const PREFERRED_FEEDS = Object.freeze({
  "ithome.com": ["https://www.ithome.com/rss/"],
  "sspai.com": ["https://sspai.com/feed"],
  "solidot.org": ["https://www.solidot.org/index.rss"],
  "ifanr.com": ["https://www.ifanr.com/feed"],
  "theverge.com": ["https://www.theverge.com/rss/index.xml"],
  "engadget.com": ["https://www.engadget.com/rss.xml"],
  "macrumors.com": ["https://feeds.macrumors.com/MacRumors-Front"],
  "feeds.macrumors.com": ["https://feeds.macrumors.com/MacRumors-Front"]
});
