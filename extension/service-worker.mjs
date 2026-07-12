import {
  DEFAULT_SETTINGS,
  PUBLIC_FEEDS,
  REFRESH_ALARM,
  REFRESH_PERIOD_MINUTES,
} from "./core/constants.mjs";
import { buildBookmarkModel, hashText, inspirationPreviewSourceUrls, inspirationPreviewTargets, originsFromUrls } from "./core/bookmarks.mjs";
import { buildFallbackDigest, feedCacheOrEmpty, fetchSourceArticles, rankAndDedupe } from "./core/feed.mjs";
import { normalizeFeedback } from "./core/feedback.mjs";
import { clearRecords, deleteRecord, getRecord, listRecords, pruneCache, setRecord, setRecords } from "./core/db.mjs";
import { extractPageMetadata, fetchReader, fetchReaderHtml, loadReaderWithCache, readerTextFromBlocks } from "./core/reader.mjs";
import {
  clearLegacyCredentialData,
  readProviderProfile,
  readSecrets,
  secretStatus,
  updateProviderProfile,
  updateSecrets,
} from "./core/secrets.mjs";
import {
  grantBookmarkConsent,
  markOnboardingComplete,
  readDeviceConsent,
  setAiDisclosureConsent,
} from "./core/device-consent.mjs";
import { DEFAULT_LOCALE, defaultBookmarkFoldersForLocale, normalizeLocale, translate } from "./core/i18n.mjs";
import { requestAiCompletion, testImageSearchConnection } from "./core/ai.mjs";
import { createClientStateStore } from "./core/client-state.mjs";
import { createQuotaManager } from "./core/quota.mjs";
import { createPreviewService } from "./core/preview.mjs";
import { bravePreviewCacheKeys, previewCacheKeysOutsideTargets } from "./core/preview-cache.mjs";
import { retainActiveUnrefreshedItems, selectRefreshBatch } from "./core/refresh.mjs";
import { createRefreshCoordinator } from "./core/refresh-coordinator.mjs";
import { createEpochMutationQueue } from "./core/mutation-queue.mjs";
import { bindProviderPatchToOrigin, providerTestApiKey, providerTestConsentAllowed } from "./core/provider-policy.mjs";
import {
  buildPermissionRows,
  filterFeedItemsBySources,
  normalizeOriginPattern,
  originPattern,
  revokedSourceKeys,
} from "./core/permission-state.mjs";
import { isValidServiceUrl, normalizeSettings, providerOrigin } from "./core/settings.mjs";
import { createSettingsStore } from "./core/settings-store.mjs";
import { cleanGeneratedSummaryLine, extractGeneratedSummaryTitle, parseGeneratedDailyDigest } from "./core/summary-text.mjs";

let bookmarkRefreshTimer = 0;
let feedbackMutationQueue = Promise.resolve();
let permissionCleanupTimer = 0;
let permissionCleanupAttempts = 0;
let permissionReconcileTimer = 0;
let permissionReconcileAttempts = 0;
let permissionEpoch = 0;
const pendingRemovedOrigins = new Set();
const AI_CONNECTION_TEST_MAX_TOKENS = 900;
const AI_DIGEST_MAX_TOKENS = 900;
const AI_ARTICLE_SUMMARY_MAX_TOKENS = 1200;
const CARD_SUMMARY_EXCERPT_MAX_CHARS = 2000;
const cacheMutations = createEpochMutationQueue();
const clientStateStore = createClientStateStore({ getRecord, setRecord });
const quotaManager = createQuotaManager(chrome.storage.local, localDateKey);
const settingsStore = createSettingsStore(chrome.storage.sync);
const getSitePreview = createPreviewService({
  getSettings,
  readSecrets,
  getRecord,
  setRecord: storePreviewCache,
  hasOriginPermission,
  isAllowedTarget: isInspirationPreviewTarget,
  captureCacheEpoch: () => cacheMutations.capture(),
});
const refreshCoordinator = createRefreshCoordinator({
  getStatus: getRefreshStatus,
  run: runRefresh,
  isFresh: (status) => {
    const finishedAt = Date.parse(String(status?.finishedAt || ""));
    return Number.isFinite(finishedAt) && Date.now() - finishedAt < 10 * 60 * 1000;
  },
});

chrome.runtime.onInstalled.addListener(() => {
  ensureRuntime().catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  ensureRuntime().catch(() => {});
});

chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") }).catch(() => {});
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === REFRESH_ALARM) startRefresh(false).catch(() => {});
});

for (const event of [chrome.bookmarks.onCreated, chrome.bookmarks.onChanged, chrome.bookmarks.onMoved, chrome.bookmarks.onRemoved]) {
  event.addListener(() => scheduleBookmarkRefresh());
}

chrome.permissions.onAdded.addListener((permissions) => {
  permissionEpoch += 1;
  handleAddedOrigins(permissions?.origins || []).catch(() => {
    broadcast("settings.changed", { permissionsChanged: true });
  });
});

chrome.permissions.onRemoved.addListener((permissions) => {
  const origins = permissions?.origins || [];
  const expectedPermissionEpoch = ++permissionEpoch;
  const expectedEpoch = cacheMutations.invalidate();
  refreshCoordinator.invalidate();
  handleRemovedOrigins(origins, expectedEpoch, expectedPermissionEpoch).catch(() => {
    setRefreshStatus(defaultRefreshStatus("background.refreshPaused")).catch(() => {});
    schedulePermissionCleanup(origins, true);
    broadcast("settings.changed", { permissionsChanged: true, cleanupPending: true });
    broadcast("dashboard.updated", { reason: "permissions-removed" });
  });
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (!request || typeof request.type !== "string") return false;
  handleRequest(request, sender)
    .then((data) => sendResponse({ requestId: request.requestId || "", ok: true, data }))
    .catch((error) => sendResponse({
      requestId: request.requestId || "",
      ok: false,
      error: {
        code: error?.code || "EXTENSION_ERROR",
        message: error?.message || String(error),
        messageKey: error?.messageKey || "",
        messageParams: error?.messageParams || {},
        retryable: error?.retryable === true,
        details: publicErrorDetails(error?.details),
      },
    }));
  return true;
});

ensureRuntime().catch(() => {});

async function ensureRuntime() {
  await chrome.alarms.create(REFRESH_ALARM, { periodInMinutes: REFRESH_PERIOD_MINUTES });
  await getSettings();
  await sanitizeLegacySyncedCredentials();
  await clearLegacyCredentialData();
  const status = await getRefreshStatus();
  if (status.running) await setRefreshStatus({
    ...status,
    running: false,
    message: "",
    messageKey: "background.refreshPaused",
    messageParams: {},
  });
  await pruneCache();
  await reconcilePermissionCache().catch(() => {});
}

async function handleRequest(request) {
  const payload = request.payload || {};
  switch (request.type) {
    case "dashboard:get": return buildDashboardPayload();
    case "settings:get": return publicSettings();
    case "settings:save": return saveSettings(payload);
    case "settings:test": return testOpenAISettings(payload);
    case "settings:image-test": return testImageSearchSettings(payload);
    case "refresh:start": return startRefresh(payload.force === true);
    case "refresh:status": return getRefreshStatus();
    case "digest:refresh": return refreshDailyDigest({ automatic: false });
    case "summary:refresh": return refreshSingleSummary(payload);
    case "ai:search": return answerAiSearch(payload);
    case "reader:get": return readArticle(payload.url);
    case "preview:get": return getSitePreview(payload);
    case "cache:clear": return clearGeneratedCache();
    case "quota:reset": return resetQuota();
    case "preferences:reset": return resetPreferences();
    case "source-quality:reset": return resetSourceQuality();
    case "feedback:record": return recordFeedback(payload);
    case "client-state:get": return clientStateStore.read();
    case "client-state:set": return clientStateStore.save(payload);
    case "permissions:origins": return selectedOrigins();
    case "permissions:status": return permissionStatus(payload.origins || []);
    case "onboarding:consent": return recordBookmarkConsent();
    case "onboarding:complete": return completeOnboarding();
    default: throw typedError("UNKNOWN_REQUEST", "background.error.unknownRequest", { type: request.type }, false);
  }
}

async function getSettings() {
  const synced = await settingsStore.read();
  const provider = await readProviderProfile(synced);
  const consent = await readDeviceConsent(provider.openaiBaseUrl);
  const settings = normalizeSettings({
    ...DEFAULT_SETTINGS,
    ...synced,
    openaiBaseUrl: provider.openaiBaseUrl,
    openaiApiStyle: provider.openaiApiStyle,
    openaiSummaryModel: provider.openaiSummaryModel,
    credentialGeneration: provider.credentialGeneration,
    ...consent,
  });
  const defaults = defaultBookmarkFoldersForLocale(settingsLocale(settings));
  if (!settings.newsBookmarkFolder) settings.newsBookmarkFolder = defaults.news;
  if (!settings.inspirationBookmarkFolder) settings.inspirationBookmarkFolder = defaults.inspiration;
  return settings;
}

function sanitizeLegacySyncedCredentials() {
  return settingsStore.sanitizeLocalOnlyFields();
}

async function publicSettings() {
  const settings = await getSettings();
  const locale = settingsLocale(settings);
  const bookmarkDefaults = defaultBookmarkFoldersForLocale(locale);
  const secrets = await secretStatus();
  const model = settings.bookmarkConsentGranted ? await currentBookmarkModel(settings) : emptyBookmarkModel();
  const permission = await selectedOrigins(model, settings);
  const feedPermissions = await currentFeedPermissionState(settings, model);
  return {
    ...settings,
    newTabOverrideEnabled: true,
    hasOpenAIKey: secrets.hasOpenAIKey,
    keySource: "local-extension-storage",
    maskedKey: secrets.hasOpenAIKey ? "••••••••" : "",
    hasImageSearchKey: secrets.hasImageSearchKey,
    imageSearchKeySource: "local-extension-storage",
    maskedImageSearchKey: secrets.hasImageSearchKey ? "••••••••" : "",
    baseUrl: settings.openaiBaseUrl,
    baseUrlSource: "saved",
    apiStyle: settings.openaiApiStyle,
    apiStyleSource: "saved",
    model: settings.openaiSummaryModel,
    savedBaseUrl: settings.openaiBaseUrl,
    savedApiStyle: settings.openaiApiStyle,
    savedModel: settings.openaiSummaryModel,
    savedDailyLimit: settings.dailyAiLimit,
    savedHotNewsCacheSize: settings.hotNewsCacheSize,
    savedHotNewsEntriesPerSource: settings.hotNewsEntriesPerSource,
    savedNewsEntriesPerCategory: settings.newsEntriesPerCategory,
    dailyLimit: settings.dailyAiLimit,
    hotNewsCacheSize: settings.hotNewsCacheSize,
    hotNewsEntriesPerSource: settings.hotNewsEntriesPerSource,
    newsEntriesPerCategory: settings.newsEntriesPerCategory,
    defaultBaseUrl: DEFAULT_SETTINGS.openaiBaseUrl,
    defaultApiStyle: DEFAULT_SETTINGS.openaiApiStyle,
    defaultModel: DEFAULT_SETTINGS.openaiSummaryModel,
    defaultDailyLimit: DEFAULT_SETTINGS.dailyAiLimit,
    defaultHotNewsCacheSize: DEFAULT_SETTINGS.hotNewsCacheSize,
    defaultHotNewsEntriesPerSource: DEFAULT_SETTINGS.hotNewsEntriesPerSource,
    defaultNewsEntriesPerCategory: DEFAULT_SETTINGS.newsEntriesPerCategory,
    defaultNewsBookmarkFolder: bookmarkDefaults.news,
    defaultInspirationBookmarkFolder: bookmarkDefaults.inspiration,
    bookmarkFolderOptions: model.folderOptions,
    availableNewsFolders: model.availableNewsFolders,
    missingBookmarkFolders: model.missingFolders,
    sourcePermissions: permission,
    sourceQuality: filterSourceQuality(await getRecord("source-quality", emptySourceQuality()), feedPermissions),
  };
}

function saveSettings(body) {
  return queueSettingsMutation((transaction) => performSaveSettings(body, transaction));
}

function queueSettingsMutation(action) {
  return settingsStore.mutate(action);
}

async function performSaveSettings(body, transaction) {
  const previous = await getSettings();
  const next = { ...previous };
  const allowed = [
    "webImageSearchEnabled", "dailyAiLimit",
    "cardSummaryEnabled", "hotNewsCacheSize", "hotNewsEntriesPerSource", "newsEntriesPerCategory",
    "newsBookmarkFolder", "inspirationBookmarkFolder", "bookmarkOnlyFolders", "floatingWebOpenEnabled",
    "readingQueueOpenOnReadAll", "retainSeenArchive", "personalizedRankingEnabled", "publicFeedSupplementEnabled",
    "uiLocale", "colorMode", "accentTheme", "customAccentColor", "pointerGlowEnabled", "headerImageEnabled",
    "headerImageFixed", "headerImageFullscreen", "headerImageUrl", "excludedNewsSources",
  ];
  for (const key of allowed) if (Object.hasOwn(body, key)) next[key] = body[key];
  let providerPatch = {};
  for (const key of ["openaiBaseUrl", "openaiApiStyle", "openaiSummaryModel"]) {
    if (Object.hasOwn(body, key)) providerPatch[key] = body[key];
  }
  const submittedOpenAIKey = body.clearOpenAIKey === true
    ? ""
    : (typeof body.openaiApiKey === "string" ? body.openaiApiKey.trim() : "");
  if (submittedOpenAIKey) providerPatch.openaiApiKey = submittedOpenAIKey;
  if (body.clearOpenAIKey === true) providerPatch.openaiApiKey = "";
  if (Object.keys(providerPatch).length) {
    const currentProvider = await readProviderProfile(previous);
    providerPatch = bindProviderPatchToOrigin(providerPatch, currentProvider);
    if (submittedOpenAIKey) {
      const candidateBaseUrl = providerPatch.openaiBaseUrl || currentProvider.openaiBaseUrl;
      if (!isValidServiceUrl(candidateBaseUrl)) {
        throw typedError("INVALID_URL", "background.error.invalidUrl", {}, false);
      }
      const consentAllowed = providerTestConsentAllowed({
        payloadHasConsent: Object.hasOwn(body, "aiDisclosureAccepted"),
        payloadAccepted: body.aiDisclosureAccepted === true,
        savedAccepted: previous.aiDisclosureAccepted === true,
        draftBaseUrl: candidateBaseUrl,
        savedBaseUrl: currentProvider.openaiBaseUrl,
      });
      if (!consentAllowed) {
        throw typedError("AI_CONSENT_REQUIRED", "background.error.aiConsentRequired", {}, false);
      }
      if (!await hasOriginPermission(candidateBaseUrl)) {
        throw typedError("ORIGIN_PERMISSION_REQUIRED", "background.error.aiOriginPermission", {}, false);
      }
    }
  }
  let provider = Object.keys(providerPatch).length
    ? await updateProviderProfile(providerPatch, previous)
    : null;

  const bravePatch = {};
  if (typeof body.braveSearchApiKey === "string" && body.braveSearchApiKey.trim()) bravePatch.braveSearchApiKey = body.braveSearchApiKey.trim();
  if (body.clearBraveSearchApiKey === true) bravePatch.braveSearchApiKey = "";
  if (Object.keys(bravePatch).length) await updateSecrets(bravePatch);

  if (Object.hasOwn(body, "aiDisclosureAccepted")) {
    provider = provider || await readProviderProfile(previous);
    await setAiDisclosureConsent(body.aiDisclosureAccepted === true, provider.openaiBaseUrl);
  }

  await transaction.write(next);
  const normalized = await getSettings();
  const bookmarkSourceChanged = [
    "newsBookmarkFolder", "inspirationBookmarkFolder", "bookmarkOnlyFolders", "excludedNewsSources",
    "publicFeedSupplementEnabled", "hotNewsCacheSize", "hotNewsEntriesPerSource", "newsEntriesPerCategory",
  ]
    .some((key) => JSON.stringify(previous[key]) !== JSON.stringify(normalized[key]));
  const localeChanged = settingsLocale(previous) !== settingsLocale(normalized);
  const imageSearchChanged = previous.webImageSearchEnabled !== normalized.webImageSearchEnabled
    || Object.hasOwn(bravePatch, "braveSearchApiKey");
  const aiConfigurationChanged = previous.aiDisclosureAccepted !== normalized.aiDisclosureAccepted
    || previous.credentialGeneration !== normalized.credentialGeneration;
  const automaticAiChanged = aiConfigurationChanged
    || previous.cardSummaryEnabled !== normalized.cardSummaryEnabled
    || previous.dailyAiLimit !== normalized.dailyAiLimit;
  if (localeChanged || bookmarkSourceChanged || aiConfigurationChanged || imageSearchChanged) {
    cacheMutations.invalidate();
    if (bookmarkSourceChanged) refreshCoordinator.invalidate();
    await cacheMutations.run(() => setRecord("daily-digest", null, "cache"));
    if (bookmarkSourceChanged) await pruneStalePreviewCaches(normalized);
    if (imageSearchChanged) await pruneBravePreviewCaches();
  }
  let automaticAiStarted = false;
  if (automaticAiChanged) {
    const ready = normalized.cardSummaryEnabled !== false && await aiConfigured(normalized);
    await setAiAutoStatus(ready ? defaultAiAutoStatus() : { ...defaultAiAutoStatus(), phase: "not-ready" }, false);
    if (ready) {
      automaticAiStarted = true;
      startRefresh(true).catch(() => {});
    }
  }
  broadcast("settings.changed", { bookmarkSourceChanged, localeChanged, imageSearchChanged, automaticAiChanged, automaticAiStarted });
  return {
    ...(await publicSettings()),
    bookmarkSourceChanged,
    localeChanged,
    imageSearchChanged,
    automaticAiChanged,
    automaticAiStarted,
  };
}

async function buildDashboardPayload(attempt = 0) {
  const expectedCacheEpoch = cacheMutations.capture();
  const expectedPermissionEpoch = permissionEpoch;
  const settings = await getSettings();
  const locale = settingsLocale(settings);
  const secrets = await secretStatus();
  const model = settings.bookmarkConsentGranted ? await currentBookmarkModel(settings) : emptyBookmarkModel();
  let feed = feedCacheOrEmpty(await getRecord("feed", null));
  const [status, cachedDigest, quota, rawSourceQuality, autoAiStatus] = await Promise.all([
    getRefreshStatus(),
    getRecord("daily-digest", null),
    readQuota(settings.dailyAiLimit),
    getRecord("source-quality", emptySourceQuality()),
    getAiAutoStatus(),
  ]);
  const feedPermissions = await currentFeedPermissionState(settings, model);
  const visibleFeedItems = filterFeedItemsBySources(feed.items || [], feedPermissions.permitted);
  feed = {
    ...feed,
    items: visibleFeedItems,
    localCount: visibleFeedItems.filter((item) => !item.externalDiscovery).length,
    publicCount: visibleFeedItems.filter((item) => item.externalDiscovery).length,
    deniedOrigins: originsFromUrls(feedPermissions.denied.map((source) => source.url)),
  };
  let aiPermissionGranted = buildPermissionRows(
    [originPattern(settings.openaiBaseUrl)],
    feedPermissions.grantedOrigins,
  ).some((row) => row.required && row.granted);
  let configuredForAi = settings.aiDisclosureAccepted === true
    && secrets.hasOpenAIKey
    && aiPermissionGranted;
  feed = { ...feed, items: sanitizeCardAiSummaries(feed.items, settings, configuredForAi) };
  const fallbackDigest = withFeedCacheMetadata(
    buildFallbackDigest(feed.items, secrets.hasOpenAIKey ? "pending" : "no-api-key", locale),
    feed.items,
    "daily-digest",
  );
  let digest = cachedDigest?.locale === locale
    && digestCachePermitted(cachedDigest, feed.items, feedPermissions, settings, configuredForAi)
    ? cachedDigest
    : fallbackDigest;
  let sourceQuality = filterSourceQuality(rawSourceQuality, feedPermissions);
  let ready = feed.items.length;
  if (!cacheMutations.isCurrent(expectedCacheEpoch) || permissionEpoch !== expectedPermissionEpoch) {
    if (attempt < 2) return buildDashboardPayload(attempt + 1);
    feed = {
      ...feed,
      items: [],
      localCount: 0,
      publicCount: 0,
      deniedOrigins: originsFromUrls(feedPermissions.sources.map((source) => source.url)),
    };
    aiPermissionGranted = false;
    configuredForAi = false;
    digest = withFeedCacheMetadata(buildFallbackDigest([], "local", locale), [], "daily-digest");
    sourceQuality = summarizeQuality({}, feedPermissions.sources);
    ready = 0;
  }
  return {
    generatedAt: new Date().toISOString(),
    source: "Chrome Bookmarks API",
    total: model.bookmarks.length,
    sections: model.sections,
    bookmarks: model.bookmarks,
    feed: { schemaVersion: 2, ...feed },
    dailyDigest: digest,
    ai: {
      enabled: configuredForAi,
      configured: secrets.hasOpenAIKey,
      disclosureAccepted: settings.aiDisclosureAccepted === true,
      permissionGranted: aiPermissionGranted,
      model: settings.openaiSummaryModel,
      baseUrl: settings.openaiBaseUrl,
      apiStyle: settings.openaiApiStyle,
      keySource: "local-extension-storage",
      maskedKey: secrets.hasOpenAIKey ? "••••••••" : "",
      dailyLimit: settings.dailyAiLimit,
      usedToday: quota.used,
      autoStatus: autoAiStatus,
      hotNewsCacheSize: settings.hotNewsCacheSize,
      hotNewsEntriesPerSource: settings.hotNewsEntriesPerSource,
      newsEntriesPerCategory: settings.newsEntriesPerCategory,
      cardSummaryEnabled: settings.cardSummaryEnabled !== false,
    },
    cache: {
      ready,
      target: settings.hotNewsCacheSize,
      progress: Math.min(1, ready / Math.max(1, settings.hotNewsCacheSize)),
      refreshProgress: status.running ? Number(status.progress || 0) : 1,
      excluded: model.bookmarks.filter((item) => item.feedExcluded).length,
      message: status.message || "",
      messageKey: status.messageKey || "background.cacheReady",
      messageParams: status.messageParams || {},
    },
    readingQueue: { storage: "indexedDB", queueKey: "dash.readingQueue", importantKey: "dash.important" },
    sourceQuality,
    pipeline: {
      schemaVersion: 2,
      retentionDays: 30,
      personalizedRankingEnabled: settings.personalizedRankingEnabled !== false,
      publicFeedSupplementEnabled: settings.publicFeedSupplementEnabled !== false,
      stages: status.stages || pipelineStages("complete"),
      sourceHealth: { healthy: sourceQuality.healthy || 0, warning: sourceQuality.warnings || 0 },
      shadowRuns: [],
    },
    status,
    onboarding: {
      completed: settings.onboardingCompleted === true,
      bookmarkConsentGranted: settings.bookmarkConsentGranted === true,
    },
  };
}

function configuredFeedSources(settings, model) {
  if (settings.bookmarkConsentGranted !== true) return [];
  const localSources = (model?.bookmarks || []).filter((item) => item.cardType === "news" && !item.feedExcluded);
  const publicSources = settings.publicFeedSupplementEnabled === false
    ? []
    : PUBLIC_FEEDS.map((feed) => ({ ...feed, key: `public-${hashText(feed.url)}`, externalDiscovery: true }));
  return [...localSources, ...publicSources];
}

async function currentFeedPermissionState(settings, model) {
  const sources = configuredFeedSources(settings, model);
  const requiredOrigins = [];
  for (const source of sources) {
    const pattern = originPattern(source.url);
    if (pattern) requiredOrigins.push(pattern);
  }
  let grantedOrigins = [];
  try {
    const granted = await chrome.permissions.getAll();
    grantedOrigins = granted.origins || [];
  } catch {
    grantedOrigins = [];
  }
  const grantedPatterns = new Set(buildPermissionRows(requiredOrigins, grantedOrigins)
    .filter((row) => row.required && row.granted)
    .map((row) => row.origin));
  const permitted = [];
  const denied = [];
  for (const source of sources) {
    (grantedPatterns.has(originPattern(source.url)) ? permitted : denied).push(source);
  }
  return {
    sources,
    permitted,
    denied,
    grantedOrigins,
    permittedByKey: new Map(permitted.map((source) => [String(source.key || ""), originPattern(source.url)]).filter(([key, pattern]) => key && pattern)),
  };
}

function withFeedCacheMetadata(value, items, capability, providerUrl = "") {
  const identities = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    const sourceKey = String(item?.sourceKey || "");
    const sourceOrigin = safeOrigin(item?.sourceOrigin || "");
    if (!sourceKey || !sourceOrigin) continue;
    identities.set(`${sourceKey}|${sourceOrigin}`, { sourceKey, sourceOrigin });
  }
  const result = {
    ...value,
    capability,
    sourceIdentities: [...identities.values()],
  };
  if (providerUrl) result.providerOrigin = safeOrigin(providerUrl);
  return result;
}

function cacheSourceIdentitiesPermitted(value, permissionState, requireMetadata = false) {
  if (!Array.isArray(value?.sourceIdentities)) return !requireMetadata;
  return value.sourceIdentities.every((identity) => {
    const expected = permissionState.permittedByKey.get(String(identity?.sourceKey || ""));
    return Boolean(expected && expected === originPattern(identity?.sourceOrigin || ""));
  });
}

async function assertFeedItemsStillPermitted(items) {
  const settings = await getSettings();
  const model = settings.bookmarkConsentGranted ? await currentBookmarkModel(settings) : emptyBookmarkModel();
  const permissionState = await currentFeedPermissionState(settings, model);
  const context = withFeedCacheMetadata({}, items, "ai-context");
  if (!cacheSourceIdentitiesPermitted(context, permissionState, true)) {
    throw typedError("SOURCE_PERMISSION_CHANGED", "background.error.sourcePermission", {}, false);
  }
  return {
    origins: context.sourceIdentities.map((identity) => identity.sourceOrigin),
    code: "SOURCE_PERMISSION_CHANGED",
    messageKey: "background.error.sourcePermission",
  };
}

async function assertUrlsStillPermitted(urls) {
  const raw = uniqueStrings((urls || []).filter((value) => String(value || "").trim()));
  const parsed = raw.map(normalizeUserUrl);
  if (!parsed.length || parsed.some((value) => !value)) {
    throw typedError("ORIGIN_PERMISSION_REQUIRED", "background.error.websitePermission", {}, false);
  }
  return {
    origins: uniqueStrings(parsed),
    code: "ORIGIN_PERMISSION_REQUIRED",
    messageKey: "background.error.websitePermission",
  };
}

function digestCachePermitted(digest, visibleItems, permissionState, settings, configuredForAi) {
  const visibleIds = new Set((visibleItems || []).flatMap((item) => [item?.articleId, item?.entryKey, item?.url]).filter(Boolean));
  const digestItemsVisible = (Array.isArray(digest?.items) ? digest.items : []).every((item) => (
    visibleIds.has(item?.id) || visibleIds.has(item?.url)
  ));
  if (!digestItemsVisible) return false;
  if (digest.status !== "ai") return cacheSourceIdentitiesPermitted(digest, permissionState, false);
  return configuredForAi
    && originPattern(digest.providerOrigin || "") === originPattern(settings.openaiBaseUrl)
    && cacheSourceIdentitiesPermitted(digest, permissionState, true);
}

function filterSourceQuality(sourceQuality, permissionState) {
  const records = Object.fromEntries(Object.entries(sourceQuality?.records || {}).filter(([key, record]) => {
    const expected = permissionState.permittedByKey.get(String(key || ""));
    return Boolean(expected && expected === originPattern(record?.sourceOrigin || ""));
  }));
  return summarizeQuality(records, permissionState.denied);
}

async function sanitizeDailyDigest(digest, attempt = 0) {
  const expectedCacheEpoch = cacheMutations.capture();
  const expectedPermissionEpoch = permissionEpoch;
  const settings = await getSettings();
  const locale = settingsLocale(settings);
  const model = settings.bookmarkConsentGranted ? await currentBookmarkModel(settings) : emptyBookmarkModel();
  const feed = await getRecord("feed", { items: [] });
  const permissions = await currentFeedPermissionState(settings, model);
  const items = filterFeedItemsBySources(feed.items || [], permissions.permitted);
  const aiPermitted = digest?.status === "ai"
    ? await aiSearchResultPermitted({
      usedAi: true,
      providerOrigin: digest.providerOrigin,
      sourceIdentities: digest.sourceIdentities,
    }, "", settings, permissions)
    : false;
  const sanitized = digest?.locale === locale && digestCachePermitted(digest, items, permissions, settings, aiPermitted)
    ? digest
    : withFeedCacheMetadata(buildFallbackDigest(items, "local", locale), items.slice(0, 12), "daily-digest");
  if (!cacheMutations.isCurrent(expectedCacheEpoch) || permissionEpoch !== expectedPermissionEpoch) {
    if (attempt < 2) return sanitizeDailyDigest(digest, attempt + 1);
    return {
      digest: withFeedCacheMetadata(buildFallbackDigest([], "local", locale), [], "daily-digest"),
      cacheEpoch: expectedCacheEpoch,
      permissionEpoch: expectedPermissionEpoch,
    };
  }
  return {
    digest: sanitized,
    cacheEpoch: expectedCacheEpoch,
    permissionEpoch: expectedPermissionEpoch,
  };
}

async function startRefresh(force) {
  return refreshCoordinator.start(force === true);
}

async function runRefresh(generation) {
  try {
    return await performRefresh(generation);
  } catch (error) {
    if (!refreshCoordinator.isCurrent(generation)) return;
    try {
      const previous = await getRefreshStatus();
      const failed = {
        ...previous,
        running: false,
        finishedAt: new Date().toISOString(),
        failed: Math.max(1, Number(previous.failed || 0)),
        message: "",
        messageKey: "background.refreshFailed",
        messageParams: {},
        stages: pipelineStages("complete"),
      };
      await setRefreshStatus(failed);
      const autoStatus = await getAiAutoStatus();
      if (autoStatus.running) await setAiAutoStatus({
        ...autoStatus,
        phase: "error",
        running: false,
        lastRunAt: new Date().toISOString(),
        errorKey: error?.messageKey || "background.error.aiNetwork",
      });
      broadcast("refresh.progress", failed);
    } catch {
      // Preserve the original refresh failure when status persistence also fails.
    }
    return null;
  }
}

async function performRefresh(generation) {
  const cacheEpoch = cacheMutations.capture();
  const settings = await getSettings();
  if (!refreshCoordinator.isCurrent(generation)) return;
  const locale = settingsLocale(settings);
  if (!settings.bookmarkConsentGranted) return;
  const model = await currentBookmarkModel(settings);
  const feedPermissions = await currentFeedPermissionState(settings, model);
  const { permitted, denied } = feedPermissions;
  const localSources = feedPermissions.sources.filter((source) => !source.externalDiscovery);
  const refreshCursor = await getRecord("refresh-source-cursor", 0);
  const refreshBatch = selectRefreshBatch(permitted, refreshCursor);
  const refreshSources = refreshBatch.sources;
  const status = {
    running: true,
    startedAt: new Date().toISOString(),
    finishedAt: "",
    total: refreshSources.length,
    completed: 0,
    failed: 0,
    excluded: localSources.length - permitted.filter((source) => !source.externalDiscovery).length,
    progress: 0,
    message: "",
    messageKey: refreshSources.length ? "background.readingSources" : "background.noAuthorizedSources",
    messageParams: refreshSources.length ? { count: refreshSources.length } : {},
    stages: pipelineStages("fetching"),
  };
  if (!refreshCoordinator.isCurrent(generation)) return;
  await setRefreshStatus(status);
  broadcast("refresh.progress", status);
  const quality = {};
  const articles = [];
  const successfullyRefreshedSources = [];
  await mapWithConcurrency(refreshSources, 4, async (source) => {
    try {
      const items = await fetchSourceArticles(source, sourceFetchOptions(settings.hotNewsEntriesPerSource));
      successfullyRefreshedSources.push(source);
      articles.push(...items.map((item) => ({ ...item, externalDiscovery: source.externalDiscovery === true })));
      quality[source.key] = {
        sourceKey: source.key,
        sourceOrigin: safeOrigin(source.url),
        title: source.title,
        host: source.host || hostOf(source.url),
        status: items.length ? "healthy" : "empty",
        count: items.length,
      };
    } catch (error) {
      status.failed += 1;
      quality[source.key] = {
        sourceKey: source.key,
        sourceOrigin: safeOrigin(source.url),
        title: source.title,
        host: source.host || hostOf(source.url),
        status: "error",
        reason: error?.messageKey ? "" : (error.message || String(error)),
        reasonKey: error?.messageKey || "",
        count: 0,
      };
    } finally {
      status.completed += 1;
      status.progress = status.total ? status.completed / status.total : 1;
      status.message = "";
      status.messageKey = "background.processedSources";
      status.messageParams = { completed: status.completed, total: status.total };
      if (refreshCoordinator.isCurrent(generation)) {
        await setRefreshStatus(status);
        broadcast("refresh.progress", status);
      }
    }
  });
  if (!refreshCoordinator.isCurrent(generation)) return;
  const aiReadyForRefresh = await aiConfigured(settings);
  const committed = await cacheMutations.run(async (isCurrent) => {
    if (!isCurrent() || !refreshCoordinator.isCurrent(generation)) return null;
    const [previous, previousQuality, previousDigest] = await Promise.all([
      getRecord("feed", { items: [] }),
      getRecord("source-quality", emptySourceQuality()),
      getRecord("daily-digest", null),
    ]);
    if (!isCurrent() || !refreshCoordinator.isCurrent(generation)) return null;
    const retained = filterFeedItemsBySources(
      retainActiveUnrefreshedItems(previous.items, permitted, successfullyRefreshedSources),
      permitted,
    );
    const previousByArticle = new Map((previous.items || []).map((item) => [item.articleId || item.entryKey || item.url, item]));
    const refreshed = articles.map((item) => preserveCardAiSummary(item, previousByArticle.get(item.articleId || item.entryKey || item.url), settings));
    const items = rankAndDedupe([...refreshed, ...retained], settings.hotNewsCacheSize);
    const feed = {
      schemaVersion: 2,
      generatedAt: new Date().toISOString(),
      items,
      localCount: items.filter((item) => !item.externalDiscovery).length,
      publicCount: items.filter((item) => item.externalDiscovery).length,
      deniedOrigins: originsFromUrls(denied.map((source) => source.url)),
    };
    const unrefreshedPermittedKeys = new Set(permitted.filter((source) => !refreshSources.includes(source)).map((source) => source.key));
    const retainedQuality = Object.fromEntries(Object.entries(previousQuality.records || {}).filter(([key, record]) => (
      unrefreshedPermittedKeys.has(key)
      && originPattern(record?.sourceOrigin || "") === feedPermissions.permittedByKey.get(key)
    )));
    const qualitySummary = summarizeQuality({ ...retainedQuality, ...quality }, denied);
    const preservedDigest = previousDigest?.locale === locale
      && previousDigest?.date === localDateKey()
      && digestCachePermitted(previousDigest, items, feedPermissions, settings, aiReadyForRefresh)
      ? previousDigest
      : withFeedCacheMetadata(buildFallbackDigest(items, "local", locale), items, "daily-digest");
    if (!isCurrent() || !refreshCoordinator.isCurrent(generation)) return null;
    await setRecords([
      { key: "feed", value: feed, kind: "cache" },
      { key: "source-quality", value: qualitySummary, kind: "cache" },
      {
        key: "daily-digest",
        value: preservedDigest,
        kind: "cache",
      },
      { key: "refresh-source-cursor", value: refreshBatch.nextCursor, kind: "state" },
    ]);
    return { items, needsDigest: Boolean(items.length && aiReadyForRefresh && preservedDigest.status !== "ai") };
  }, cacheEpoch);
  if (!committed || !refreshCoordinator.isCurrent(generation)) return;
  const automaticRun = await runAutomaticAiAfterRefresh({
    settings,
    items: committed.items,
    needsDigest: committed.needsDigest,
    aiReady: aiReadyForRefresh,
    cacheEpoch,
    generation,
  });
  const { items, errorKey: autoSummaryErrorKey } = automaticRun;
  const finished = {
    ...status,
    running: false,
    finishedAt: new Date().toISOString(),
    progress: 1,
    message: "",
    messageKey: items.length
      ? (autoSummaryErrorKey ? "background.cachedItemsAiDeferred" : "background.cachedItems")
      : "background.noItems",
    messageParams: items.length ? { count: items.length } : {},
    stages: pipelineStages("complete"),
  };
  await setRefreshStatus(finished);
  if (!refreshCoordinator.isCurrent(generation)) return;
  broadcast("dashboard.updated", { reason: "refresh-complete" });
}

async function runAutomaticAiAfterRefresh({ settings, items, needsDigest, aiReady, cacheEpoch, generation }) {
  const previous = await getAiAutoStatus();
  const quota = await readQuota(settings.dailyAiLimit);
  const remainingQuota = Math.max(0, settings.dailyAiLimit - quota.used);
  const availableCards = settings.cardSummaryEnabled
    ? items.filter((item) => item.summaryStatus !== "ai" && String(item.excerpt || "").trim()).length
    : 0;
  const digestEligible = needsDigest && remainingQuota > 0;
  const cardEligible = Math.min(availableCards, Math.max(0, remainingQuota - Number(digestEligible)));
  const total = Number(digestEligible) + cardEligible;
  const hasPendingWork = needsDigest || availableCards > 0;
  const startedAt = new Date().toISOString();
  const base = {
    processed: 0,
    total,
    eligible: cardEligible,
    startedAt,
    lastRunAt: previous.lastRunAt || "",
    errorKey: "",
  };
  if (!aiReady) {
    await setAiAutoStatus({ ...base, phase: "not-ready", running: false, lastRunAt: startedAt });
    return { items, errorKey: "" };
  }
  if (!remainingQuota && hasPendingWork) {
    await setAiAutoStatus({ ...base, phase: "quota", running: false, lastRunAt: startedAt });
    return { items, errorKey: "" };
  }
  if (!total) {
    await setAiAutoStatus({ ...base, phase: "no-candidates", running: false, lastRunAt: startedAt });
    return { items, errorKey: "" };
  }

  let processed = 0;
  let phase = digestEligible ? "running-digest" : "running-cards";
  let errorKey = "";
  await setAiAutoStatus({ ...base, phase, running: true });

  if (digestEligible && refreshCoordinator.isCurrent(generation)) {
    const digest = await refreshDailyDigest({ automatic: true });
    if (digest.status === "ai") processed += 1;
    else if (digest.status === "quota-or-empty") phase = "quota";
    else {
      phase = "error";
      errorKey = digest.errorKey || "background.error.aiNetwork";
    }
  }

  if (!errorKey && phase !== "quota" && cardEligible && refreshCoordinator.isCurrent(generation)) {
    phase = "running-cards";
    await setAiAutoStatus({ ...base, phase, running: true, processed });
    const automatic = await automaticallySummarizeCards(settings, items, cacheEpoch, generation, cardEligible, async (cardProcessed) => {
      await setAiAutoStatus({ ...base, phase, running: true, processed: processed + cardProcessed });
    });
    items = automatic.items;
    processed += automatic.processed;
    if (automatic.quotaReached) phase = "quota";
    if (automatic.errorKey) {
      phase = "error";
      errorKey = automatic.errorKey;
    }
  }

  if (!errorKey && phase !== "quota") phase = "completed";
  await setAiAutoStatus({
    ...base,
    phase,
    running: false,
    processed,
    lastRunAt: new Date().toISOString(),
    errorKey,
  });
  return { items, errorKey };
}

async function automaticallySummarizeCards(settings, items, cacheEpoch, generation, candidateLimit, onProgress = null) {
  if (!await aiConfigured(settings)) return { items, errorKey: "", processed: 0, eligible: 0, quotaReached: false };
  const locale = settingsLocale(settings);
  let currentItems = items;
  let errorKey = "";
  let processed = 0;
  let quotaReached = false;
  const candidates = items.filter((item) => (
    item.summaryStatus !== "ai"
    && String(item.excerpt || "").trim()
  )).slice(0, candidateLimit);

  for (const candidate of candidates) {
    if (!cacheMutations.isCurrent(cacheEpoch) || !refreshCoordinator.isCurrent(generation)) break;
    let result;
    try {
      const context = await automaticCardSummaryContext(candidate);
      result = await runAiWithinQuota(settings, () => callProvider(
        settings,
        translate(locale, "background.prompt.cardSummary"),
        translate(locale, "background.prompt.webInput", {
          url: candidate.url,
          title: candidate.title,
          text: context.text,
        }),
        AI_ARTICLE_SUMMARY_MAX_TOKENS,
        "",
        async () => {
          const validation = await assertFeedItemsStillPermitted([candidate]);
          return { ...validation, origins: uniqueStrings([...validation.origins, ...context.origins]) };
        },
      ));
    } catch (error) {
      errorKey = error?.messageKey || "background.error.aiNetwork";
      break;
    }
    if (!result.usedAi) {
      quotaReached = true;
      break;
    }
    const organized = generatedCardSummary(result.value);
    if (!organized.title || !organized.summary.length) {
      errorKey = "background.error.aiNoText";
      break;
    }
    const summarizedAt = new Date().toISOString();
    const providerOrigin = safeOrigin(settings.openaiBaseUrl);
    const committedItem = await cacheMutations.run(async (isCurrent) => {
      if (!isCurrent() || !refreshCoordinator.isCurrent(generation)) return null;
      const latestSettings = await getSettings();
      if (!latestSettings.cardSummaryEnabled || !await aiConfigured(latestSettings)) return null;
      if (safeOrigin(latestSettings.openaiBaseUrl) !== providerOrigin) return null;
      const latestModel = latestSettings.bookmarkConsentGranted ? await currentBookmarkModel(latestSettings) : emptyBookmarkModel();
      const latestPermissions = await currentFeedPermissionState(latestSettings, latestModel);
      if (latestPermissions.permittedByKey.get(String(candidate.sourceKey || "")) !== originPattern(candidate.sourceOrigin || "")) return null;
      const feed = feedCacheOrEmpty(await getRecord("feed", null));
      let updatedItem = null;
      const updatedItems = feed.items.map((item) => {
        if ((item.articleId || item.entryKey) !== (candidate.articleId || candidate.entryKey) || item.url !== candidate.url) return item;
        if (item.summaryStatus === "ai") return item;
        updatedItem = { ...item, summaryTitle: organized.title, summary: organized.summary, summaryStatus: "ai", summarizedAt, summaryProviderOrigin: providerOrigin };
        return updatedItem;
      });
      if (!updatedItem || !isCurrent()) return null;
      await setRecord("feed", { ...feed, items: updatedItems }, "cache");
      return updatedItem;
    }, cacheEpoch);
    if (!committedItem) break;
    currentItems = currentItems.map((item) => item.url === committedItem.url ? committedItem : item);
    processed += 1;
    if (typeof onProgress === "function") await onProgress(processed);
  }
  return { items: currentItems, errorKey, processed, eligible: candidates.length, quotaReached };
}

function automaticCardSummaryContext(candidate) {
  return {
    text: String(candidate.excerpt || "").trim().slice(0, CARD_SUMMARY_EXCERPT_MAX_CHARS),
    origins: [],
  };
}

function preserveCardAiSummary(item, previous, settings) {
  if (previous?.summaryStatus !== "ai" || !previous.summaryTitle || !Array.isArray(previous.summary) || !previous.summary.length) return item;
  if (originPattern(previous.summaryProviderOrigin || "") !== originPattern(settings.openaiBaseUrl)) return item;
  return {
    ...item,
    summaryTitle: previous.summaryTitle,
    summary: previous.summary,
    summaryStatus: "ai",
    summarizedAt: previous.summarizedAt || "",
    summaryProviderOrigin: previous.summaryProviderOrigin,
  };
}

function sanitizeCardAiSummaries(items, settings, configuredForAi) {
  return (items || []).map((item) => {
    if (item.summaryStatus !== "ai") return item;
    if (configuredForAi && originPattern(item.summaryProviderOrigin || "") === originPattern(settings.openaiBaseUrl)) return item;
    const { summarizedAt, summaryProviderOrigin, summaryTitle, ...rest } = item;
    const excerpt = String(item.excerpt || "").trim();
    return { ...rest, summary: excerpt ? [excerpt] : [], summaryStatus: excerpt ? "excerpt" : "raw" };
  });
}

async function refreshDailyDigest({ automatic = false } = {}) {
  const cacheEpoch = cacheMutations.capture();
  const settings = await getSettings();
  const locale = settingsLocale(settings);
  const model = settings.bookmarkConsentGranted ? await currentBookmarkModel(settings) : emptyBookmarkModel();
  const feed = feedCacheOrEmpty(await getRecord("feed", null));
  const feedPermissions = await currentFeedPermissionState(settings, model);
  const permittedItems = filterFeedItemsBySources(feed.items, feedPermissions.permitted);
  const contextItems = permittedItems.slice(0, 12);
  let digest = withFeedCacheMetadata(buildFallbackDigest(permittedItems, "local", locale), contextItems, "daily-digest");
  if (contextItems.length && cacheMutations.isCurrent(cacheEpoch) && await aiConfigured(settings)) {
    const context = contextItems.map((item, index) => `${index + 1}. ${item.title}｜${item.excerpt}｜${item.url}`).join("\n");
    try {
      const operation = () => callProvider(
        settings,
        translate(locale, "background.prompt.dailyDigest"),
        context,
        AI_DIGEST_MAX_TOKENS,
        "",
        () => assertFeedItemsStillPermitted(contextItems),
      );
      const result = automatic
        ? await runAiWithinQuota(settings, operation)
        : { usedAi: true, value: await operation() };
      if (result.usedAi) {
        const organized = parseGeneratedDailyDigest(result.value, digest.items.length);
        digest = withFeedCacheMetadata({
          ...digest,
          locale,
          status: "ai",
          overview: organized.overview,
          items: digest.items.map((item, index) => {
            const aiTitle = organized.eventTitles[index] || "";
            return aiTitle ? { ...item, originalTitle: item.title, title: aiTitle, aiTitle } : item;
          }),
        }, contextItems, "daily-digest", settings.openaiBaseUrl);
      } else {
        digest = { ...digest, status: "quota-or-empty" };
      }
    } catch (error) {
      const errorKey = error?.messageKey || "background.error.aiNetwork";
      digest = {
        ...digest,
        status: "fallback",
        error: translate(locale, errorKey, error?.messageParams || {}),
        errorKey,
        errorParams: error?.messageParams || {},
      };
    }
  }
  const sanitized = await sanitizeDailyDigest(digest);
  digest = sanitized.digest;
  const committed = await cacheMutations.run(async (isCurrent) => {
    if (!isCurrent() || permissionEpoch !== sanitized.permissionEpoch) return null;
    await setRecord("daily-digest", digest, "cache");
    return digest;
  }, sanitized.cacheEpoch);
  if (committed
    && cacheMutations.isCurrent(sanitized.cacheEpoch)
    && permissionEpoch === sanitized.permissionEpoch) {
    broadcast("dashboard.updated", { reason: "digest" });
  }
  return (await sanitizeDailyDigest(committed || digest)).digest;
}

async function refreshSingleSummary(body) {
  const cacheEpoch = cacheMutations.capture();
  const settings = await getSettings();
  const locale = settingsLocale(settings);
  if (!settings.bookmarkConsentGranted) return resultMessage(settings, false, "background.error.sourceNotFound");
  const model = await currentBookmarkModel(settings);
  const feed = feedCacheOrEmpty(await getRecord("feed", null));
  const target = feed.items.find((item) => (
    String(item.sourceKey || "") === String(body.sourceKey || "")
    && (String(item.articleId || item.entryKey || "") === String(body.articleId || "") || item.url === body.url)
  ));
  const permissions = await currentFeedPermissionState(settings, model);
  const permittedSourceOrigin = target ? permissions.permittedByKey.get(String(target.sourceKey || "")) : "";
  if (!target || !permittedSourceOrigin || permittedSourceOrigin !== originPattern(target.sourceOrigin || "")) {
    return resultMessage(settings, false, "background.error.sourceNotFound");
  }
  const excerptText = String(target.excerpt || "").trim().slice(0, CARD_SUMMARY_EXCERPT_MAX_CHARS);
  if (!excerptText) throw typedError("SUMMARY_CONTENT_MISSING", "summary.status.noContent", {}, false);
  const summaryText = await callProvider(
    settings,
    translate(locale, "background.prompt.cardSummary"),
    translate(locale, "background.prompt.webInput", {
      url: target.url,
      title: target.title,
      text: excerptText,
    }),
    AI_ARTICLE_SUMMARY_MAX_TOKENS,
    "",
    () => assertFeedItemsStillPermitted([target]),
  );
  const organized = generatedCardSummary(summaryText);
  if (!organized.title || !organized.summary.length) throw typedError("AI_EMPTY_RESPONSE", "background.error.aiNoText", {}, true);
  const committed = await cacheMutations.run(async (isCurrent) => {
    if (!isCurrent()) return null;
    const latestSettings = await getSettings();
    if (!latestSettings.bookmarkConsentGranted) return null;
    const latestModel = await currentBookmarkModel(latestSettings);
    const latestPermissions = await currentFeedPermissionState(latestSettings, latestModel);
    if (!isCurrent() || latestPermissions.permittedByKey.get(String(target.sourceKey || "")) !== permittedSourceOrigin) return null;
    const previous = await getRecord("feed", { items: [] });
    const permittedPrevious = filterFeedItemsBySources(previous.items || [], latestPermissions.permitted);
    const items = permittedPrevious.map((item) => (
      item.sourceKey === target.sourceKey
      && (item.articleId || item.entryKey) === (target.articleId || target.entryKey)
      && item.url === target.url
        ? {
          ...item,
          summaryTitle: organized.title,
          summary: organized.summary,
          summaryStatus: "ai",
          summarizedAt: new Date().toISOString(),
          summaryProviderOrigin: safeOrigin(settings.openaiBaseUrl),
        }
        : item
    ));
    if (!items.some((item) => item.summaryStatus === "ai" && item.url === target.url)) return null;
    const feed = {
      ...previous,
      generatedAt: new Date().toISOString(),
      items,
      localCount: items.filter((item) => !item.externalDiscovery).length,
      publicCount: items.filter((item) => item.externalDiscovery).length,
      deniedOrigins: originsFromUrls(latestPermissions.denied.map((item) => item.url)),
    };
    if (!isCurrent()) return null;
    await setRecords([
      { key: "feed", value: feed, kind: "cache" },
      {
        key: "daily-digest",
        value: withFeedCacheMetadata(buildFallbackDigest(items, "local", locale), items, "daily-digest"),
        kind: "cache",
      },
    ]);
    return true;
  }, cacheEpoch);
  if (!committed || !cacheMutations.isCurrent(cacheEpoch)) return resultMessage(settings, false, "background.error.sourcePermission");
  broadcast("dashboard.updated", { reason: "single-source" });
  const quota = await readQuota(settings.dailyAiLimit);
  return { ok: true, locale, item: target, quota: { usedToday: quota.used, dailyLimit: settings.dailyAiLimit } };
}

function generatedCardSummary(value) {
  const text = String(value || "").trim();
  if (!text) return { title: "", summary: [] };
  const rawLines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const title = rawLines.map((line) => extractGeneratedSummaryTitle(line)).find(Boolean) || "";
  const lines = rawLines.map(cleanGeneratedSummaryLine).filter(Boolean);
  const summary = lines.length > 1
    ? lines.slice(0, 3)
    : (lines[0]?.match(/[^。！？.!?]+[。！？.!?]?/g) || lines).map((line) => line.trim()).filter(Boolean).slice(0, 3);
  return { title, summary };
}

async function loadQuestionSearchContext(settings, query) {
  const model = settings.bookmarkConsentGranted ? await currentBookmarkModel(settings) : emptyBookmarkModel();
  const feed = await getRecord("feed", { items: [] });
  const permissions = await currentFeedPermissionState(settings, model);
  const permittedItems = filterFeedItemsBySources(feed.items || [], permissions.permitted);
  return {
    permissions,
    candidates: searchFeed(permittedItems, query).slice(0, 8),
  };
}

function localQuestionSearchResult(locale, query, candidates) {
  const answer = candidates.length
    ? [translate(locale, "background.search.localSignals", { query }), ...candidates.map((item, index) => `${index + 1}. ${item.title} — ${item.excerpt || item.source}`)].join("\n")
    : translate(locale, "background.search.noLocalResults", { query });
  return withFeedCacheMetadata({
    ok: true,
    locale,
    type: "question",
    mode: "dashboard",
    answer,
    links: candidates.map((item) => ({ title: item.title, url: item.url })),
    usedAi: false,
  }, candidates, "ai-search");
}

function websitePermissionSearchResult(locale, url) {
  return {
    ok: true,
    locale,
    type: "url",
    mode: "website",
    answer: translate(locale, "background.search.noWebsitePermission"),
    links: [{ title: url, url }],
    usedAi: false,
  };
}

async function currentProviderCapability(settings) {
  const provider = await readProviderProfile(settings);
  const consent = await readDeviceConsent(provider.openaiBaseUrl);
  return {
    provider,
    configured: consent.aiDisclosureAccepted === true
      && Boolean(provider.openaiApiKey)
      && provider.openaiBaseUrl === settings.openaiBaseUrl
      && provider.openaiApiStyle === settings.openaiApiStyle
      && provider.openaiSummaryModel === settings.openaiSummaryModel
      && provider.credentialGeneration === settings.credentialGeneration,
  };
}

async function aiSearchResultPermitted(
  result,
  asUrl,
  settings,
  feedPermissions = null,
  expectedEpoch = null,
  providerCapability = null,
) {
  if (!result?.usedAi || !result.providerOrigin) return false;
  const capability = providerCapability || await currentProviderCapability(settings);
  const { provider } = capability;
  const providerMatches = capability.configured
    && originPattern(result.providerOrigin) === originPattern(provider.openaiBaseUrl);
  if (!providerMatches || expectedEpoch !== null && !cacheMutations.isCurrent(expectedEpoch)) return false;

  const requiredOrigins = [provider.openaiBaseUrl];
  if (asUrl) {
    const rawUrls = uniqueStrings([asUrl, result.requestedUrl, ...(result.links || []).map((link) => link?.url)].filter(Boolean));
    const normalized = rawUrls.map(normalizeUserUrl);
    if (normalized.some((url) => !url)) return false;
    requiredOrigins.push(...normalized);
  } else {
    if (!feedPermissions || !cacheSourceIdentitiesPermitted(result, feedPermissions, true)) return false;
    requiredOrigins.push(...result.sourceIdentities.map((identity) => identity.sourceOrigin));
  }
  const granted = await hasOriginPermissions(requiredOrigins);
  return granted && (expectedEpoch === null || cacheMutations.isCurrent(expectedEpoch));
}

async function sanitizeSearchResult(result, { asUrl, query, nonAiFallback }) {
  const latestSettings = await getSettings();
  const latestLocale = settingsLocale(latestSettings);
  if (asUrl) {
    const contextUrls = [asUrl, ...(result?.links || []).map((link) => link?.url)];
    if (!await cacheUrlsPermitted(contextUrls)) {
      return websitePermissionSearchResult(latestLocale, asUrl);
    }
    if (result?.usedAi && !await aiSearchResultPermitted(result, asUrl, latestSettings)) {
      if (!await cacheUrlsPermitted(contextUrls)) return websitePermissionSearchResult(latestLocale, asUrl);
      return withFeedCacheMetadata({ ...(nonAiFallback || websitePermissionSearchResult(latestLocale, asUrl)), locale: latestLocale }, [], "ai-search");
    }
    return { ...result, locale: latestLocale };
  }

  const latestContext = await loadQuestionSearchContext(latestSettings, query);
  const sourceContextPermitted = cacheSourceIdentitiesPermitted(result, latestContext.permissions, true);
  const aiPermitted = !result?.usedAi || await aiSearchResultPermitted(result, "", latestSettings, latestContext.permissions);
  if (latestLocale !== result?.locale || !sourceContextPermitted || !aiPermitted) {
    const fallbackSettings = await getSettings();
    const fallbackContext = await loadQuestionSearchContext(fallbackSettings, query);
    return localQuestionSearchResult(settingsLocale(fallbackSettings), query, fallbackContext.candidates);
  }
  return result;
}

async function answerAiSearch(body) {
  const cacheEpoch = cacheMutations.capture();
  const query = String(body.query || "").trim().slice(0, 2000);
  const settings = await getSettings();
  const locale = settingsLocale(settings);
  if (!query) return resultMessage(settings, false, "background.error.searchRequired");
  const asUrl = normalizeUserUrl(query);
  const providerIdentity = `${settings.openaiBaseUrl}|${settings.openaiApiStyle}|${settings.openaiSummaryModel}|${settings.credentialGeneration}`;
  const cacheKey = `search-${locale}-${hashText(`${localDateKey()}:${providerIdentity}:${query}`)}`;
  let feedPermissions = null;
  let candidates = [];
  if (!asUrl) {
    const context = await loadQuestionSearchContext(settings, query);
    feedPermissions = context.permissions;
    candidates = context.candidates;
  }
  const cached = await getRecord(cacheKey, null);
  if (cached?.usedAi && await aiSearchResultPermitted(cached, asUrl, settings, feedPermissions, cacheEpoch)) {
    return { ...cached, cached: true };
  }
  let result;
  let nonAiFallback = null;
  if (asUrl) {
    if (!await hasOriginPermission(asUrl)) {
      result = websitePermissionSearchResult(locale, asUrl);
    } else {
      let reader;
      try {
        reader = await readArticle(asUrl);
      } catch (error) {
        if (error?.code !== "READER_EXTRACTION_EMPTY") throw error;
        reader = await readWebsiteOverview(asUrl);
      }
      const readerText = readerTextFromBlocks(reader.blocks);
      const isArticle = readerText.trim().length >= 80;
      const mode = isArticle ? "article" : "website";
      const fallbackText = isArticle
        ? readerText.slice(0, 1200)
        : reader.description || translate(locale, "background.search.noWebsiteDescription");
      nonAiFallback = {
        ok: true,
        locale,
        type: "url",
        mode,
        answer: `${reader.title}\n\n${fallbackText}`,
        links: [{ title: reader.title, url: reader.url }],
        usedAi: false,
      };
      result = await answerWithOptionalAi(settings, {
        locale,
        type: "url",
        mode,
        fallback: nonAiFallback.answer,
        system: translate(locale, isArticle ? "background.prompt.webSummary" : "background.prompt.websiteIntro"),
        input: translate(locale, isArticle ? "background.prompt.webInput" : "background.prompt.websiteInput", {
          url: reader.url,
          title: reader.title,
          text: readerText.slice(0, 12000),
          siteName: reader.siteName,
          description: reader.description,
        }),
        links: [{ title: reader.title, url: reader.url }],
        validateRequest: () => assertUrlsStillPermitted([asUrl, reader.requestedUrl, reader.url, reader.canonicalUrl]),
      });
    }
  } else {
    nonAiFallback = localQuestionSearchResult(locale, query, candidates);
    result = await answerWithOptionalAi(settings, {
      locale,
      type: "question",
      mode: "dashboard",
      fallback: nonAiFallback.answer,
      system: translate(locale, "background.prompt.dashboardAnswer"),
      input: translate(locale, "background.prompt.dashboardInput", {
        query,
        content: candidates.length
          ? candidates.map((item, index) => `${index + 1}. ${item.title}｜${item.excerpt}｜${item.url}`).join("\n")
          : translate(locale, "background.search.noLocalResults", { query }),
      }),
      links: candidates.map((item) => ({ title: item.title, url: item.url })),
      validateRequest: () => assertFeedItemsStillPermitted(candidates),
    });
  }
  result = withFeedCacheMetadata(
    { ...result, locale, ...(asUrl ? { requestedUrl: asUrl } : {}) },
    asUrl ? [] : candidates,
    "ai-search",
    result.usedAi ? settings.openaiBaseUrl : "",
  );
  result = await sanitizeSearchResult(result, { asUrl, query, nonAiFallback });
  if (result.usedAi) {
    await cacheMutations.run(async (isCurrent) => {
      if (!isCurrent()) return;
      await setRecord(cacheKey, result, "cache");
    }, cacheEpoch);
  }
  return sanitizeSearchResult(result, { asUrl, query, nonAiFallback });
}

async function answerWithOptionalAi(settings, options) {
  if (!await aiConfigured(settings)) return { ok: true, locale: options.locale, type: options.type, mode: options.mode, answer: options.fallback, links: options.links, usedAi: false };
  try {
    const value = await callProvider(settings, options.system, options.input, 900, "", options.validateRequest);
    return { ok: true, locale: options.locale, type: options.type, mode: options.mode, answer: value, links: options.links, usedAi: true };
  } catch (error) {
    const messageKey = error?.messageKey || "background.error.aiNetwork";
    const messageParams = error?.messageParams || {};
    return {
      ok: true,
      locale: options.locale,
      type: options.type,
      mode: options.mode,
      answer: options.fallback,
      links: options.links,
      usedAi: false,
      error: translate(options.locale, messageKey, messageParams),
      errorKey: messageKey,
      errorParams: messageParams,
    };
  }
}

async function callProvider(settings, system, input, maxTokens, apiKeyOverride = "", validateRequest = null) {
  let providerSettings = settings;
  let apiKey = apiKeyOverride;
  if (!apiKeyOverride) {
    const provider = await readProviderProfile(settings);
    const consent = await readDeviceConsent(provider.openaiBaseUrl);
    if (!consent.aiDisclosureAccepted) throw typedError("AI_CONSENT_REQUIRED", "background.error.aiConsentRequired", {}, false);
    providerSettings = normalizeSettings({
      ...settings,
      openaiBaseUrl: provider.openaiBaseUrl,
      openaiApiStyle: provider.openaiApiStyle,
      openaiSummaryModel: provider.openaiSummaryModel,
      credentialGeneration: provider.credentialGeneration,
      ...consent,
    });
    apiKey = provider.openaiApiKey;
  }
  if (!apiKey) throw typedError("AI_KEY_MISSING", "background.error.aiKeyMissing", {}, false);
  const expectedProvider = {
    openaiBaseUrl: providerSettings.openaiBaseUrl,
    openaiApiStyle: providerSettings.openaiApiStyle,
    openaiSummaryModel: providerSettings.openaiSummaryModel,
    credentialGeneration: providerSettings.credentialGeneration,
    openaiApiKey: apiKey,
  };
  const validateCurrentRequest = async () => {
    if (!apiKeyOverride) {
      const latestProvider = await readProviderProfile(settings);
      const latestConsent = await readDeviceConsent(latestProvider.openaiBaseUrl);
      const unchanged = latestConsent.aiDisclosureAccepted === true
        && latestProvider.openaiBaseUrl === expectedProvider.openaiBaseUrl
        && latestProvider.openaiApiStyle === expectedProvider.openaiApiStyle
        && latestProvider.openaiSummaryModel === expectedProvider.openaiSummaryModel
        && latestProvider.credentialGeneration === expectedProvider.credentialGeneration
        && latestProvider.openaiApiKey === expectedProvider.openaiApiKey;
      if (!unchanged) throw typedError("AI_CONFIGURATION_CHANGED", "background.error.aiConfigurationChanged", {}, false);
    }
    return typeof validateRequest === "function" ? validateRequest() : null;
  };
  return requestAiCompletion(providerSettings, {
    system,
    input,
    maxTokens,
    apiKey,
    hasOriginPermission,
    hasOriginPermissions,
    validateRequest: validateCurrentRequest,
  });
}

async function testOpenAISettings(body) {
  try {
    const savedSettings = await getSettings();
    const settings = normalizeSettings({ ...savedSettings,
      openaiBaseUrl: body.openaiBaseUrl || undefined,
      openaiApiStyle: body.openaiApiStyle || undefined,
      openaiSummaryModel: body.openaiSummaryModel || undefined,
    });
    if (!providerTestConsentAllowed({
      payloadHasConsent: Object.hasOwn(body, "aiDisclosureAccepted"),
      payloadAccepted: body.aiDisclosureAccepted === true,
      savedAccepted: savedSettings.aiDisclosureAccepted === true,
      draftBaseUrl: settings.openaiBaseUrl,
      savedBaseUrl: savedSettings.openaiBaseUrl,
    })) {
      return resultMessage(settings, false, "background.error.aiConsentRequired");
    }
    const storedProvider = await readProviderProfile(savedSettings);
    const apiKey = providerTestApiKey({
      draftKey: body.openaiApiKey,
      storedKey: storedProvider.openaiApiKey,
      draftBaseUrl: settings.openaiBaseUrl,
      storedBaseUrl: storedProvider.openaiBaseUrl,
    });
    if (!apiKey) return resultMessage(settings, false, "background.error.aiKeyMissing");
    const locale = settingsLocale(settings);
    const sample = await callProvider(
      settings,
      translate(locale, "background.prompt.connectionSystem"),
      translate(locale, "background.prompt.connectionInput"),
      AI_CONNECTION_TEST_MAX_TOKENS,
      apiKey,
    );
    return resultMessage(settings, /^ok\b/i.test(sample.trim()) || Boolean(sample), "background.connectionAvailable");
  } catch (error) {
    return errorResult(await getSettings(), error);
  }
}

async function testImageSearchSettings(body) {
  const settings = await getSettings();
  try {
    const secrets = await readSecrets();
    const apiKey = String(body.braveSearchApiKey || secrets.braveSearchApiKey || "").trim();
    const result = await testImageSearchConnection(apiKey, hasOriginPermission);
    return resultMessage(settings, true, "background.imageConnectionAvailable", { count: result.count });
  } catch (error) {
    return errorResult(settings, error);
  }
}

async function readArticle(url) {
  const cacheEpoch = cacheMutations.capture();
  const normalized = normalizeUserUrl(url);
  if (!normalized) throw typedError("INVALID_URL", "background.error.invalidUrl", {}, false, { url: String(url || "") });
  const origin = new URL(normalized).origin;
  if (!await hasOriginPermission(normalized)) {
    throw typedError("ORIGIN_PERMISSION_REQUIRED", "background.error.websitePermission", {}, false, { origin, url: normalized });
  }
  const reader = await loadReaderWithCache(normalized, {
    readCache: readReaderCache,
    storeCache: (reader) => storeReaderCache(reader, cacheEpoch),
    validateCache: async (cached) => cachedReaderPermitted(normalized, cached),
    fetchDocument: async (target) => {
      const reader = await fetchReader(target, {
        validateResponse: async (response) => {
          const finalUrl = response.url || target;
          if (!await hasOriginPermission(finalUrl)) {
            throw typedError("ORIGIN_PERMISSION_REQUIRED", "background.error.websitePermission", {}, false, {
              origin: new URL(finalUrl).origin,
              url: finalUrl,
            });
          }
        },
      });
      const finalOrigin = new URL(reader.url).origin;
      if (finalOrigin !== origin && !await hasOriginPermission(reader.url)) {
        throw typedError("ORIGIN_PERMISSION_REQUIRED", "background.error.websitePermission", {}, false, { origin: finalOrigin, url: reader.url });
      }
      return reader;
    },
  });
  if (!await cachedReaderPermitted(normalized, reader)) {
    throw typedError("ORIGIN_PERMISSION_REQUIRED", "background.error.websitePermission", {}, false, {
      origin,
      url: normalized,
    });
  }
  return reader;
}

async function readWebsiteOverview(url) {
  const normalized = normalizeUserUrl(url);
  if (!normalized) throw typedError("INVALID_URL", "background.error.invalidUrl", {}, false, { url: String(url || "") });
  const response = await fetchReaderHtml(normalized, 12000, {
    validateResponse: async (result) => {
      const finalUrl = result.url || normalized;
      if (!await hasOriginPermission(finalUrl)) {
        throw typedError("ORIGIN_PERMISSION_REQUIRED", "background.error.websitePermission", {}, false, {
          origin: new URL(finalUrl).origin,
          url: finalUrl,
        });
      }
    },
  });
  const metadata = extractPageMetadata(response.text, response.url);
  return {
    requestedUrl: normalized,
    url: response.url,
    canonicalUrl: metadata.canonicalUrl || response.url,
    title: metadata.title || metadata.siteName || new URL(response.url).hostname,
    siteName: metadata.siteName || new URL(response.url).hostname,
    description: metadata.description || "",
    blocks: [],
  };
}

async function cachedReaderPermitted(requestedUrl, cached) {
  return cacheUrlsPermitted([requestedUrl, cached?.url, cached?.canonicalUrl]);
}

async function cacheUrlsPermitted(values) {
  const urls = [];
  const seen = new Set();
  for (const value of values) {
    if (!String(value || "").trim()) continue;
    const normalized = normalizeUserUrl(value);
    if (!normalized) return false;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    urls.push(normalized);
  }
  if (!urls.length) return false;
  return hasOriginPermissions(urls);
}

async function readReaderCache(url) {
  const alias = await getRecord(readerAliasKey(url), null);
  if (!alias?.contentKey) return null;
  const value = await getRecord(alias.contentKey, null);
  return value?.schemaVersion === 2 && Array.isArray(value.blocks) ? value : null;
}

async function storeReaderCache(reader, cacheEpoch = cacheMutations.capture()) {
  const primaryUrl = reader.canonicalUrl || reader.url || reader.requestedUrl;
  const contentKey = `reader-content-v2-${hashText(primaryUrl)}`;
  const stored = { ...reader, capability: "reader", source: "live", staleReason: "", staleCode: "" };
  const aliases = uniqueStrings([reader.requestedUrl, reader.url, reader.canonicalUrl]);
  await cacheMutations.run(async (isCurrent) => {
    if (!isCurrent() || !await cacheUrlsPermitted(aliases)) return;
    if (!isCurrent()) return;
    await setRecords([
      { key: contentKey, value: stored, kind: "cache" },
      ...aliases.map((alias) => ({ key: readerAliasKey(alias), value: { capability: "reader-alias", contentKey }, kind: "cache" })),
    ]);
  }, cacheEpoch);
}

function storePreviewCache(key, value, kind = "cache", cacheEpoch) {
  const commit = async (isCurrent) => {
    if (!isCurrent() || !await previewCachePermitted(value)) return;
    if (!isCurrent()) return;
    await setRecord(key, value, kind);
  };
  return Number.isInteger(cacheEpoch)
    ? cacheMutations.run(commit, cacheEpoch)
    : cacheMutations.run(commit);
}

async function isInspirationPreviewTarget(value) {
  const settings = await getSettings();
  if (settings.bookmarkConsentGranted !== true) return false;
  const model = await currentBookmarkModel(settings);
  return previewTargetInModel(value, model);
}

async function previewCachePermitted(value, context = {}) {
  const settings = context.settings || await getSettings();
  if (settings.bookmarkConsentGranted !== true) return false;
  const model = context.model || await currentBookmarkModel(settings);
  const requestedUrl = previewIdentityUrl(value?.requestedUrl);
  if (!requestedUrl || !previewTargetInModel(requestedUrl, model)) return false;
  if (value.capability === "site-preview-origin") {
    if (value.strategyVersion !== 3) return false;
    if (value.sourceOrigin !== new URL(requestedUrl).origin) return false;
    return hasOriginPermission(requestedUrl);
  }
  if (value.capability === "site-preview-brave") {
    if (value.strategyVersion !== 2) return false;
    const secrets = context.secrets || await secretStatus();
    return value.providerOrigin === "https://api.search.brave.com"
      && settings.webImageSearchEnabled === true
      && secrets.hasImageSearchKey === true
      && await hasOriginPermission("https://api.search.brave.com/");
  }
  return false;
}

function previewTargetInModel(value, model) {
  const requestedUrl = previewIdentityUrl(value);
  if (!requestedUrl) return false;
  return inspirationPreviewSourceUrls(model?.bookmarks).some((url) => previewIdentityUrl(url) === requestedUrl);
}

function previewIdentityUrl(value) {
  const normalized = normalizeUserUrl(value);
  if (!normalized) return "";
  try {
    const url = new URL(normalized);
    url.hash = "";
    return url.href;
  } catch {
    return "";
  }
}

function readerAliasKey(url) {
  return `reader-alias-v2-${hashText(normalizeReaderCacheUrl(url))}`;
}

function normalizeReaderCacheUrl(value) {
  try {
    const url = new URL(value);
    url.hash = "";
    ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"].forEach((key) => url.searchParams.delete(key));
    return url.href;
  } catch {
    return String(value || "");
  }
}

async function currentBookmarkModel(settings) {
  const tree = await chrome.bookmarks.getTree();
  return buildBookmarkModel(tree, settings);
}

function emptyBookmarkModel() {
  return { folderOptions: [], sections: [], bookmarks: [], availableNewsFolders: [], missingFolders: [] };
}

async function selectedOrigins(modelArg, settingsArg) {
  const settings = settingsArg || await getSettings();
  const model = modelArg || (settings.bookmarkConsentGranted ? await currentBookmarkModel(settings) : emptyBookmarkModel());
  const urls = settings.bookmarkConsentGranted === true
    ? model.bookmarks.filter((item) => item.cardType === "news" && !item.feedExcluded).map((item) => item.url)
    : [];
  if (settings.bookmarkConsentGranted === true) urls.push(...inspirationPreviewSourceUrls(model.bookmarks));
  if (settings.bookmarkConsentGranted === true && settings.publicFeedSupplementEnabled !== false) urls.push(...PUBLIC_FEEDS.map((feed) => feed.url));
  const secrets = await secretStatus();
  if (settings.openaiBaseUrl && settings.aiDisclosureAccepted === true && secrets.hasOpenAIKey) urls.push(settings.openaiBaseUrl);
  if (settings.webImageSearchEnabled && secrets.hasImageSearchKey) urls.push("https://api.search.brave.com/");
  const requiredOrigins = originsFromUrls(urls);
  const granted = await chrome.permissions.getAll();
  return buildPermissionRows(requiredOrigins, granted.origins || []);
}

async function permissionStatus(origins) {
  const requiredOrigins = uniqueStrings(origins);
  const granted = await chrome.permissions.getAll();
  const rows = buildPermissionRows(requiredOrigins, granted.origins || []);
  return rows.filter((row) => row.required);
}

async function hasOriginPermission(value) {
  return hasOriginPermissions([value]);
}

async function hasOriginPermissions(values) {
  const raw = uniqueStrings((Array.isArray(values) ? values : []).map((value) => String(value || "").trim()).filter(Boolean));
  const mapped = raw.map(originPattern);
  if (!mapped.length || mapped.some((pattern) => !pattern)) return false;
  const patterns = uniqueStrings(mapped);
  try {
    return chrome.permissions.contains({ origins: patterns });
  } catch {
    return false;
  }
}

async function handleAddedOrigins(values) {
  const addedOrigins = uniqueStrings(values.map(normalizeOriginPattern).filter(Boolean));
  broadcast("settings.changed", { permissionsChanged: true });
  if (!addedOrigins.length) return;
  const settings = await getSettings();
  const model = settings.bookmarkConsentGranted ? await currentBookmarkModel(settings) : emptyBookmarkModel();
  const feedPermissions = await currentFeedPermissionState(settings, model);
  const addedSourceKeys = revokedSourceKeys(feedPermissions.permitted, addedOrigins);
  const status = await getRefreshStatus();
  const aiOriginAdded = addedOrigins.includes(originPattern(settings.openaiBaseUrl));
  const aiAutoReady = aiOriginAdded && settings.cardSummaryEnabled !== false && await aiConfigured(settings);
  if (aiAutoReady) {
    await setAiAutoStatus(defaultAiAutoStatus(), false);
  }
  if (addedSourceKeys.size || status.running || aiAutoReady) startRefresh(true).catch(() => {});
}

async function handleRemovedOrigins(
  values,
  expectedEpoch = cacheMutations.capture(),
  expectedPermissionEpoch = permissionEpoch,
) {
  const removedOrigins = uniqueStrings(values.map(normalizeOriginPattern).filter(Boolean));
  if (!removedOrigins.length) {
    broadcast("settings.changed", { permissionsChanged: true });
    return;
  }
  const mutation = await cacheMutations.run(
    (isQueueCurrent) => applyEffectivePermissionCachePolicy(
      removedOrigins,
      () => isQueueCurrent() && expectedPermissionEpoch === permissionEpoch,
    ),
    expectedEpoch,
  );
  if (!mutation) {
    schedulePermissionCleanup(removedOrigins);
    schedulePermissionReconcile(true);
    broadcast("settings.changed", { permissionsChanged: true });
    return;
  }
  if (mutation.statusRunning || mutation.feedAffected) {
    await setRefreshStatus(defaultRefreshStatus("background.waitingFirstRefresh"));
  }
  broadcast("settings.changed", { permissionsChanged: true });
  broadcast("dashboard.updated", { reason: "permissions-removed" });
  if (mutation.statusRunning || mutation.feedAffected) startRefresh(true).catch(() => {});
}

async function reconcilePermissionCache() {
  const expectedEpoch = cacheMutations.capture();
  try {
    const result = await cacheMutations.run(
      (isCurrent) => applyEffectivePermissionCachePolicy([], isCurrent),
      expectedEpoch,
    );
    if (result) permissionReconcileAttempts = 0;
    else schedulePermissionReconcile();
    return result;
  } catch (error) {
    schedulePermissionReconcile();
    throw error;
  }
}

async function applyEffectivePermissionCachePolicy(removedOrigins, isCurrent) {
  if (!isCurrent()) return null;
  const settings = await getSettings();
  const locale = settingsLocale(settings);
  const model = settings.bookmarkConsentGranted ? await currentBookmarkModel(settings) : emptyBookmarkModel();
  const feedPermissions = await currentFeedPermissionState(settings, model);
  const [providerCapability, secrets, status] = await Promise.all([
    currentProviderCapability(settings),
    secretStatus(),
    getRefreshStatus(),
  ]);
  if (!isCurrent()) return null;

  const [feed, sourceQuality, dailyDigest, cacheRecords] = await Promise.all([
    getRecord("feed", { schemaVersion: 2, items: [] }),
    getRecord("source-quality", emptySourceQuality()),
    getRecord("daily-digest", null),
    listRecords("cache"),
  ]);
  if (!isCurrent()) return null;
  const items = filterFeedItemsBySources(feed.items || [], feedPermissions.permitted);
  const feedContentChanged = JSON.stringify(items) !== JSON.stringify(feed.items || []);
  const nextFeed = {
    ...feed,
    generatedAt: feedContentChanged ? new Date().toISOString() : feed.generatedAt,
    items,
    localCount: items.filter((item) => !item.externalDiscovery).length,
    publicCount: items.filter((item) => item.externalDiscovery).length,
    deniedOrigins: originsFromUrls(feedPermissions.denied.map((source) => source.url)),
  };
  const nextQuality = filterSourceQuality(sourceQuality, feedPermissions);
  const directKeys = new Set();
  for (const record of cacheRecords) {
    if (!isCurrent()) return null;
    if (record.key.startsWith("search-")) {
      const requestedUrl = record.value?.type === "url"
        ? record.value?.requestedUrl || record.value?.links?.[0]?.url || ""
        : "";
      const permitted = await aiSearchResultPermitted(
        record.value,
        requestedUrl,
        settings,
        feedPermissions,
        null,
        providerCapability,
      );
      if (!permitted) directKeys.add(record.key);
    } else if (record.key.startsWith("preview-") || /^(?:image-preview|site-preview-)/.test(record.value?.capability || "")) {
      if (!await previewCachePermitted(record.value, { settings, model, secrets })) directKeys.add(record.key);
    } else if (record.key.startsWith("reader-content-v2-") || record.value?.capability === "reader") {
      const permitted = await cacheUrlsPermitted([
        record.value?.requestedUrl,
        record.value?.url,
        record.value?.canonicalUrl,
      ]);
      if (!permitted) directKeys.add(record.key);
    }
  }
  for (const record of cacheRecords) {
    if (directKeys.has(String(record.value?.contentKey || ""))) directKeys.add(record.key);
  }
  if (!isCurrent()) return null;
  for (const key of directKeys) {
    if (!isCurrent()) return null;
    await deleteRecord(key);
  }

  const aiDigestPermitted = dailyDigest?.status === "ai"
    && await aiSearchResultPermitted({
      usedAi: true,
      providerOrigin: dailyDigest.providerOrigin,
      sourceIdentities: dailyDigest.sourceIdentities,
    }, "", settings, feedPermissions, null, providerCapability);
  const digestPermitted = dailyDigest?.locale === locale
    && digestCachePermitted(dailyDigest, items, feedPermissions, settings, aiDigestPermitted);
  const matchedSourceKeys = revokedSourceKeys(feedPermissions.sources, removedOrigins);
  const sourceKeys = new Set([...matchedSourceKeys].filter((key) => !feedPermissions.permittedByKey.has(key)));
  const entries = [
    { key: "feed", value: nextFeed, kind: "cache" },
    { key: "source-quality", value: nextQuality, kind: "cache" },
    ...(!digestPermitted ? [{
      key: "daily-digest",
      value: withFeedCacheMetadata(buildFallbackDigest(items, "local", locale), items, "daily-digest"),
      kind: "cache",
    }] : []),
  ];
  if (sourceKeys.size || feedContentChanged) entries.push({ key: "refresh-source-cursor", value: 0, kind: "state" });
  if (!isCurrent()) return null;
  await setRecords(entries);
  return {
    feedAffected: Boolean(sourceKeys.size || feedContentChanged),
    statusRunning: status.running === true,
    feedItems: items.length,
    deleted: directKeys.size,
  };
}

async function pruneStalePreviewCaches(settings, expectedEpoch = cacheMutations.capture()) {
  return cacheMutations.run(async (isCurrent) => {
    if (!isCurrent()) return null;
    const model = settings.bookmarkConsentGranted ? await currentBookmarkModel(settings) : emptyBookmarkModel();
    if (!isCurrent()) return null;
    const cacheRecords = await listRecords("cache");
    if (!isCurrent()) return null;
    const staleKeys = previewCacheKeysOutsideTargets(
      cacheRecords,
      inspirationPreviewTargets(model.bookmarks),
    );
    for (const key of staleKeys) {
      if (!isCurrent()) return null;
      await deleteRecord(key);
    }
    return staleKeys.length;
  }, expectedEpoch);
}

async function pruneBravePreviewCaches(expectedEpoch = cacheMutations.capture()) {
  return cacheMutations.run(async (isCurrent) => {
    if (!isCurrent()) return null;
    const staleKeys = bravePreviewCacheKeys(await listRecords("cache"));
    if (!isCurrent()) return null;
    for (const key of staleKeys) {
      if (!isCurrent()) return null;
      await deleteRecord(key);
    }
    return staleKeys.length;
  }, expectedEpoch);
}

function schedulePermissionCleanup(values, resetAttempts = false) {
  for (const value of values || []) {
    const normalized = normalizeOriginPattern(value);
    if (normalized) pendingRemovedOrigins.add(normalized);
  }
  if (resetAttempts) permissionCleanupAttempts = 0;
  if (permissionCleanupTimer || !pendingRemovedOrigins.size || permissionCleanupAttempts >= 3) return;
  const delay = Math.min(8000, 1000 * 2 ** permissionCleanupAttempts);
  permissionCleanupTimer = setTimeout(async () => {
    permissionCleanupTimer = 0;
    const origins = [...pendingRemovedOrigins];
    pendingRemovedOrigins.clear();
    try {
      await handleRemovedOrigins(origins);
      permissionCleanupAttempts = 0;
    } catch {
      permissionCleanupAttempts += 1;
      origins.forEach((origin) => pendingRemovedOrigins.add(origin));
      schedulePermissionCleanup([]);
    }
  }, delay);
}

function schedulePermissionReconcile(resetAttempts = false) {
  if (resetAttempts) permissionReconcileAttempts = 0;
  if (permissionReconcileTimer || permissionReconcileAttempts >= 3) return;
  const delay = Math.min(8000, 1000 * 2 ** permissionReconcileAttempts);
  permissionReconcileTimer = setTimeout(async () => {
    permissionReconcileTimer = 0;
    permissionReconcileAttempts += 1;
    try {
      const result = await reconcilePermissionCache();
      if (result) permissionReconcileAttempts = 0;
    } catch {
      schedulePermissionReconcile();
    }
  }, delay);
}

function sourceFetchOptions(limit) {
  const requirePermission = async (value) => {
    if (await hasOriginPermission(value)) return;
    throw typedError("ORIGIN_PERMISSION_REQUIRED", "background.error.sourcePermission", {}, false, {
      origin: safeOrigin(value),
      url: String(value || ""),
    });
  };
  return {
    limit,
    validateUrl: requirePermission,
    validateResponse: (response) => requirePermission(response.url),
  };
}

function safeOrigin(value) {
  try { return new URL(value).origin; } catch { return ""; }
}

async function recordBookmarkConsent() {
  await grantBookmarkConsent();
  return publicSettings();
}

async function completeOnboarding() {
  await markOnboardingComplete();
  startRefresh(true).catch(() => {});
  return publicSettings();
}

async function clearGeneratedCache() {
  const settings = await getSettings();
  cacheMutations.invalidate();
  refreshCoordinator.invalidate();
  await cacheMutations.run(async () => {
    await clearRecords("cache");
    await setRecord("refresh-source-cursor", 0, "state");
    await setRefreshStatus(defaultRefreshStatus("background.cacheClearedWaiting"));
    await setAiAutoStatus(defaultAiAutoStatus(), false);
  });
  broadcast("dashboard.updated", { reason: "cache-cleared" });
  return resultMessage(settings, true, "background.cacheClearSuccess");
}

async function resetQuota() {
  const settings = await getSettings();
  await quotaManager.reset();
  const previous = await getAiAutoStatus();
  await setAiAutoStatus({ ...defaultAiAutoStatus(), lastRunAt: previous.lastRunAt || "" });
  return resultMessage(settings, true, "background.quotaReset", {}, { quota: { usedToday: 0, dailyLimit: settings.dailyAiLimit } });
}

async function resetPreferences() {
  const settings = await getSettings();
  await setRecord("feedback", [], "state");
  return resultMessage(settings, true, "background.preferencesReset");
}

async function resetSourceQuality() {
  const settings = await getSettings();
  const summary = emptySourceQuality();
  await cacheMutations.run(() => setRecord("source-quality", summary, "cache"));
  return resultMessage(settings, true, "background.sourceQualityReset", {}, { sourceQuality: summary });
}

async function recordFeedback(body) {
  const operation = feedbackMutationQueue.then(async () => {
    const settings = await getSettings();
    const record = normalizeFeedback(body);
    if (record.action === "opened" && settings.personalizedRankingEnabled === false) return { ok: true, recorded: false };
    const feedback = await getRecord("feedback", []);
    feedback.push({ ...record, recordedAt: new Date().toISOString() });
    await setRecord("feedback", feedback.slice(-2000), "state");
    return { ok: true, recorded: true };
  });
  feedbackMutationQueue = operation.catch(() => {});
  return operation;
}

async function getRefreshStatus() {
  return getRecord("refresh-status", defaultRefreshStatus());
}

async function setRefreshStatus(status) {
  await setRecord("refresh-status", status, "state");
  return status;
}

async function getAiAutoStatus() {
  return { ...defaultAiAutoStatus(), ...(await getRecord("ai-auto-status", null) || {}) };
}

async function setAiAutoStatus(status, notify = true) {
  const normalized = { ...defaultAiAutoStatus(), ...status };
  await setRecord("ai-auto-status", normalized, "state");
  if (notify) broadcast("dashboard.updated", { reason: "ai-auto-status" });
  return normalized;
}

function defaultAiAutoStatus() {
  return {
    phase: "never",
    running: false,
    processed: 0,
    total: 0,
    eligible: 0,
    startedAt: "",
    lastRunAt: "",
    errorKey: "",
  };
}

function defaultRefreshStatus(messageKey = "background.waitingFirstRefresh") {
  return {
    running: false,
    startedAt: "",
    finishedAt: "",
    total: 0,
    completed: 0,
    failed: 0,
    excluded: 0,
    progress: 0,
    message: "",
    messageKey,
    messageParams: {},
    stages: pipelineStages("complete"),
  };
}

function summarizeQuality(quality, denied) {
  const records = Object.values(quality);
  const warnings = records.filter((record) => record.status !== "healthy");
  const suggestions = warnings.slice(0, 20).map((record) => ({
    sourceKey: record.sourceKey,
    title: record.title,
    host: record.host,
    action: "review",
    reason: record.reason || "",
    reasonKey: record.reasonKey || (record.reason ? "" : (record.status === "empty" ? "sourceQuality.empty" : "sourceQuality.failed")),
  }));
  return {
    checked: records.length,
    healthy: records.filter((record) => record.status === "healthy").length,
    warnings: warnings.length,
    denied: denied.length,
    suggestions,
    records: quality,
  };
}

function emptySourceQuality() {
  return { checked: 0, healthy: 0, warnings: 0, denied: 0, suggestions: [], records: {} };
}

function scheduleBookmarkRefresh() {
  cacheMutations.invalidate();
  refreshCoordinator.invalidate();
  if (bookmarkRefreshTimer) clearTimeout(bookmarkRefreshTimer);
  bookmarkRefreshTimer = setTimeout(() => {
    bookmarkRefreshTimer = 0;
    getSettings().then(async (settings) => {
      if (!settings.bookmarkConsentGranted) return;
      await pruneStalePreviewCaches(settings).catch(() => {});
      broadcast("dashboard.updated", { reason: "bookmarks-changed" });
      startRefresh(true).catch(() => {});
    }).catch(() => {});
  }, 800);
}

async function aiConfigured(settings) {
  const provider = await readProviderProfile(settings);
  const consent = await readDeviceConsent(provider.openaiBaseUrl);
  return consent.aiDisclosureAccepted === true
    && Boolean(provider.openaiApiKey)
    && await hasOriginPermission(provider.openaiBaseUrl);
}

async function readQuota(limit) {
  return quotaManager.read(limit);
}

async function runAiWithinQuota(settings, operation) {
  const reservation = await quotaManager.reserve(settings.dailyAiLimit);
  if (!reservation) return { usedAi: false, value: null };
  try {
    return { usedAi: true, value: await operation() };
  } catch (error) {
    await quotaManager.release(reservation);
    throw error;
  }
}

function normalizeUserUrl(value) {
  const text = String(value || "").trim();
  const candidate = /^https?:\/\//i.test(text) ? text : (/^[\w.-]+\.[a-z]{2,}(?:[/:?#].*)?$/i.test(text) ? `https://${text}` : "");
  if (!candidate) return "";
  try {
    const url = new URL(candidate);
    if (url.protocol === "https:") return url.href;
    if (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)) return url.href;
  } catch {
    return "";
  }
  return "";
}

function searchFeed(items, query) {
  const terms = searchQueryTerms(query);
  if (!terms.length) return [];
  return (items || []).map((item) => {
    const title = String(item.title || "").toLowerCase();
    const excerpt = String(item.excerpt || "").toLowerCase();
    const source = `${item.source || ""} ${item.category || ""}`.toLowerCase();
    const score = terms.reduce((total, term) => total
      + (title.includes(term) ? 4 : 0)
      + (excerpt.includes(term) ? 2 : 0)
      + (source.includes(term) ? 1 : 0), 0);
    return { item, score };
  }).filter((entry) => entry.score > 0).sort((a, b) => b.score - a.score || Number(b.item.score || 0) - Number(a.item.score || 0)).map((entry) => entry.item);
}

function searchQueryTerms(query) {
  const text = String(query || "").trim().toLowerCase();
  if (!text) return [];
  const terms = new Set(text.split(/[^\p{L}\p{N}]+/u).filter((term) => term.length > 1));
  try {
    const segmenter = new Intl.Segmenter(undefined, { granularity: "word" });
    for (const segment of segmenter.segment(text)) {
      const term = String(segment.segment || "").trim();
      if (segment.isWordLike && term.length > 1) terms.add(term);
    }
  } catch {}
  for (const sequence of text.match(/[\p{Script=Han}]{2,}/gu) || []) {
    for (let index = 0; index < sequence.length - 1; index += 1) terms.add(sequence.slice(index, index + 2));
  }
  return [...terms];
}

function pipelineStages(active) {
  return { discovering: "complete", fetching: active === "fetching" ? "running" : "complete", extracting: "complete", deduplicating: "complete", enriching: "complete", complete: active === "complete" ? "running" : "pending" };
}

function broadcast(type, payload) {
  chrome.runtime.sendMessage({ type, payload }).catch(() => {});
}

async function mapWithConcurrency(items, limit, worker) {
  let index = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const current = items[index++];
      await worker(current);
    }
  });
  await Promise.all(runners);
}

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value || "").trim()).filter(Boolean))];
}

function hostOf(value) {
  try { return new URL(value).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; }
}

function localDateKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function settingsLocale(settings = {}) {
  if (settings.uiLocale) return normalizeLocale(settings.uiLocale);
  return normalizeLocale(globalThis.chrome?.i18n?.getUILanguage?.() || DEFAULT_LOCALE);
}

function resultMessage(settings, ok, messageKey, messageParams = {}, extra = {}) {
  return {
    ok,
    message: translate(settingsLocale(settings), messageKey, messageParams),
    messageKey,
    messageParams,
    ...extra,
  };
}

function errorResult(settings, error) {
  const messageKey = error?.messageKey || "";
  const messageParams = error?.messageParams || {};
  return {
    ok: false,
    message: messageKey ? translate(settingsLocale(settings), messageKey, messageParams) : (error?.message || String(error)),
    messageKey,
    messageParams,
  };
}

function publicErrorDetails(value) {
  if (!value || typeof value !== "object") return {};
  const details = {};
  if (Number.isFinite(Number(value.status))) details.status = Number(value.status);
  if (typeof value.origin === "string") details.origin = value.origin.slice(0, 500);
  if (typeof value.url === "string") details.url = value.url.slice(0, 2000);
  return details;
}

function typedError(code, messageKey, messageParams = {}, retryable = false, details = {}) {
  const error = new Error(translate(DEFAULT_LOCALE, messageKey, messageParams));
  error.code = code;
  error.messageKey = messageKey;
  error.messageParams = messageParams;
  error.retryable = retryable;
  error.details = details;
  return error;
}
