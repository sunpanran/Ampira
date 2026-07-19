import {
  DEFAULT_SETTINGS,
  REFRESH_ALARM,
  REFRESH_PERIOD_MINUTES,
} from "../core/constants.mjs";
import { hashText, inspirationPreviewTargets, originsFromUrls } from "../core/bookmarks.mjs";
import {
  buildDailyCandidates,
  buildFallbackDigest,
  dailyCandidateFingerprint,
  feedCacheOrEmpty,
  fetchSourceArticles,
  rankAndDedupe,
} from "../core/feed.mjs";
import { normalizeFeedback } from "../core/feedback.mjs";
import { filterPresentableFeedItems } from "../core/feed-language-policy.mjs";
import { createHeaderCoverStore } from "../core/header-cover.mjs";
import { clearRecords, deleteRecord, getRecord, listRecords, pruneCache, setRecord, setRecords } from "../core/db.mjs";
import { extractPageMetadata, fetchReader, fetchReaderHtml, loadReaderWithCache, probeReaderUrl, readerTextFromBlocks } from "../core/reader.mjs";
import {
  captureCredentialState,
  readProviderProfile,
  readSecrets,
  restoreCredentialState,
  secretStatus,
  updateProviderProfile,
  updateSecrets,
} from "../core/secrets.mjs";
import {
  captureDeviceConsentState,
  grantBookmarkConsent,
  markOnboardingComplete,
  readDeviceConsent,
  restoreDeviceConsentState,
  setAiDisclosureConsent,
} from "../core/device-consent.mjs";
import { defaultBookmarkFoldersForLocale, translate, translateAiPrompt } from "../core/runtime-i18n.mjs";
import { readerTranslationMatchesLocale } from "../core/ai-output-language.mjs";
import { requestAiCompletion, testImageSearchConnection } from "../core/ai.mjs";
import { createClientStateStore } from "../core/client-state.mjs";
import { createContentSyncService } from "../core/content-sync.mjs";
import { createQuotaManager, shouldReleaseAutomaticAiQuota } from "../core/quota.mjs";
import { createPreviewService, fetchSourceImageCandidateRecords } from "../core/preview.mjs";
import { bravePreviewCacheKeys, newsPreviewTargets, previewCacheKeysOutsideTargets } from "../core/preview-cache.mjs";
import { retainActiveUnrefreshedItems, selectRefreshBatch } from "../core/refresh.mjs";
import { createRefreshCoordinator } from "../core/refresh-coordinator.mjs";
import { createEpochMutationQueue } from "../core/mutation-queue.mjs";
import {
  bindProviderPatchToOrigin,
  providerCredentialAvailable,
  providerRequiresApiKey,
  providerTestApiKey,
  providerTestConsentAllowed,
} from "../core/provider-policy.mjs";
import {
  buildPermissionRows,
  filterFeedItemsBySources,
  normalizeOriginPattern,
  originPattern,
  revokedSourceKeys,
} from "../core/permission-state.mjs";
import { isValidServiceUrl, normalizeSettings, providerOrigin } from "../core/settings.mjs";
import { publicFeedsForLocale } from "../core/public-feeds.mjs";
import { createSettingsStore } from "../core/settings-store.mjs";
import { createSettingsTransferDocument, parseSettingsTransferDocument } from "../core/settings-transfer.mjs";
import { dailyDigestEvidence, parseGeneratedDailyDigest } from "../core/summary-text.mjs";
import { normalizeUserUrl, searchFeed } from "../core/search.mjs";
import { createMessageRouter } from "./message-router.mjs";
import { errorResult, publicErrorDetails, resultMessage, settingsLocale, typedError } from "./runtime-result.mjs";
import { createRuntimeStatusStore } from "./status-store.mjs";
import { createRuntimeSettingsService } from "./settings-service.mjs";
import { createPermissionGateway } from "./permission-gateway.mjs";
import { createPermissionWorkflow } from "./permission-workflow.mjs";
import { createMaintenanceService } from "./maintenance-service.mjs";
import { createRefreshService } from "./refresh-service.mjs";
import { createAiSearchService } from "./ai-search-service.mjs";
import { createReaderPreviewService } from "./reader-preview-service.mjs";
import { createSettingsWorkflow } from "./settings-workflow.mjs";
import { createDashboardContentService } from "./dashboard-content-service.mjs";
import { createBookmarkRefreshScheduler } from "./bookmark-refresh-scheduler.mjs";
import { createWeatherService } from "./weather-service.mjs";
import { createCardSummaryPolicy } from "./card-summary-policy.mjs";
import { createPermissionEpoch } from "./permission-epoch.mjs";
import { createCacheMetadataPolicy } from "./cache-metadata-policy.mjs";
import { createAiAccessPolicy } from "./ai-access-policy.mjs";
import { createCacheAccessPolicy } from "./cache-access-policy.mjs";
import { createActionReadingQueueService } from "./action-reading-queue-service.mjs";
import { createBrowserSearchService } from "./browser-search-service.mjs";
import { createFactoryResetService } from "./factory-reset-service.mjs";
import {
  emptySourceQuality,
  hostOf,
  localDateKey,
  mapWithConcurrency,
  pipelineStages,
  safeOrigin,
  summarizeQuality,
  updateSourceQualityRecord,
  uniqueStrings,
} from "./runtime-utils.mjs";

export function createExtensionRuntime(deps = {}) {
const chrome = deps.chrome || globalThis.chrome;
const cacheMutations = createEpochMutationQueue();
const clientStateStore = createClientStateStore({ getRecord, setRecord });
const quotaManager = createQuotaManager(chrome.storage.local, localDateKey);
const headerCoverStore = createHeaderCoverStore(chrome.storage.local);
const settingsStore = createSettingsStore(chrome.storage.sync);
const settingsService = createRuntimeSettingsService({ store: settingsStore, readProviderProfile, readDeviceConsent });
const { getSettings } = settingsService;
const cardSummaryPolicy = createCardSummaryPolicy({ settingsLocale, originPattern });
const browserSearchService = createBrowserSearchService({ chrome, typedError });
const presentableFeedItems = (items, settings, configuredForAi) => filterPresentableFeedItems(
  items,
  settingsLocale(settings),
  {
    aiConfigured: configuredForAi === true,
    providerOrigin: settings.openaiBaseUrl,
  },
);
const permissionEpoch = createPermissionEpoch();
const cacheMetadataPolicy = createCacheMetadataPolicy({ safeOrigin, originPattern, buildPermissionRows });
const contentSyncService = createContentSyncService({
  storage: chrome.storage.sync,
  clientStateStore,
  getSettings,
  getRecord,
  setRecord,
  broadcast,
});
const { handleActionClicked, resetActionFeedback } = createActionReadingQueueService({
  chrome, clientStateStore, contentSyncService, getSettings, settingsLocale, translate, localDateKey, broadcast,
});
let publicSettings;
let saveSettings;
let exportSettings;
let importSettings;
let factoryResetting = false;
const activeRequests = new Set();
const {
  getRefreshStatus,
  setRefreshStatus,
  getAiAutoStatus,
  setAiAutoStatus,
  defaultAiAutoStatus,
  defaultRefreshStatus,
} = createRuntimeStatusStore({ getRecord, setRecord, broadcast, createStages: pipelineStages });
const {
  currentBookmarkModel,
  emptyBookmarkModel,
  selectedOrigins,
  permissionStatus,
  hasOriginPermission,
  hasOriginPermissions,
} = createPermissionGateway({ chrome, getSettings, secretStatus, getRecord, providerCredentialAvailable });
const aiAccessPolicy = createAiAccessPolicy({
  readProviderProfile, readDeviceConsent, originPattern, cacheMutations,
  uniqueStrings, normalizeUserUrl,
  cacheSourceIdentitiesPermitted: cacheMetadataPolicy.cacheSourceIdentitiesPermitted,
  hasOriginPermissions, providerCredentialAvailable,
});
const {
  buildDashboardPayload,
  configuredFeedSources,
  currentFeedPermissionState,
  withFeedCacheMetadata,
  cacheSourceIdentitiesPermitted,
  assertFeedItemsStillPermitted,
  assertUrlsStillPermitted,
  digestCachePermitted,
  filterSourceQuality,
  sanitizeDailyDigest,
} = createDashboardContentService({
  cacheMutations,
  capturePermissionEpoch: permissionEpoch.capture,
  isPermissionEpochCurrent: permissionEpoch.isCurrent,
  getSettings, settingsLocale, secretStatus, currentBookmarkModel, emptyBookmarkModel,
  feedCacheOrEmpty, getRecord, getRefreshStatus, readQuota, emptySourceQuality,
  getAiAutoStatus, filterFeedItemsBySources, originsFromUrls, buildPermissionRows,
  originPattern,
  ...cacheMetadataPolicy,
  sanitizeCardAiSummaries: cardSummaryPolicy.sanitizeCardAiSummaries,
  buildFallbackDigest, buildDailyCandidates, dailyCandidateFingerprint,
  localDateKey, summarizeQuality, pipelineStages, publicFeedsForLocale,
  chrome, typedError, uniqueStrings, normalizeUserUrl,
  aiSearchResultPermitted: aiAccessPolicy.aiSearchResultPermitted,
  providerCredentialAvailable, aiConfigured, presentableFeedItems,
});
const {
  readArticle,
  readCachedArticle,
  readWebsiteOverview,
  cacheUrlsPermitted,
  storePreviewCache,
  isSitePreviewTarget,
  previewCachePermitted,
} = createReaderPreviewService({
  normalizeUserUrl, hasOriginPermission, loadReaderWithCache, fetchReader, fetchReaderHtml, probeReaderUrl,
  extractPageMetadata, getRecord, setRecord, deleteRecord, cacheMutations,
  currentBookmarkModel, emptyBookmarkModel, getSettings, secretStatus,
  inspirationPreviewTargets, newsPreviewTargets, currentFeedPermissionState,
  filterFeedItemsBySources, presentableFeedItems, aiConfigured, feedCacheOrEmpty,
  hashText, uniqueStrings, hasOriginPermissions, setRecords, typedError,
});
const {
  loadQuestionSearchContext,
  answerAiSearch,
  callProvider,
  testOpenAISettings,
  testImageSearchSettings,
} = createAiSearchService({
  getRecord, setRecord, searchFeed, settingsLocale, translate, translateAiPrompt, normalizeUserUrl,
  hasOriginPermission, originPattern, secretStatus, currentFeedPermissionState,
  getSettings, currentBookmarkModel, emptyBookmarkModel, assertUrlsStillPermitted,
  cacheSourceIdentitiesPermitted, configuredFeedSources,
  readArticle, readCachedArticle,
  readWebsiteOverview,
  hashText, aiConfigured, requestAiCompletion, providerOrigin, readProviderProfile,
  readDeviceConsent, readSecrets, providerTestApiKey, providerTestConsentAllowed,
  providerCredentialAvailable, providerRequiresApiKey,
  isValidServiceUrl, typedError, resultMessage, errorResult, testImageSearchConnection,
  safeOrigin, uniqueStrings, withFeedCacheMetadata,
  filterFeedItemsBySources, presentableFeedItems, feedCacheOrEmpty, cacheMutations, hasOriginPermissions, cacheUrlsPermitted,
  localDateKey, readerTextFromBlocks, assertFeedItemsStillPermitted, normalizeSettings,
  aiAccessPolicy,
});
const refreshCoordinator = createRefreshCoordinator({
  getStatus: getRefreshStatus,
  isFresh: (status) => {
    const finishedAt = Date.parse(String(status?.finishedAt || ""));
    return Number.isFinite(finishedAt) && Date.now() - finishedAt < 10 * 60 * 1000;
  },
});
const { factoryReset } = createFactoryResetService({
  chrome,
  cacheMutations,
  refreshCoordinator,
  permissionEpoch,
  contentSyncService,
  clientStateStore,
  waitForActiveRequests: () => Promise.allSettled([...activeRequests]),
  clearSyncStorage: settingsStore.reset,
  clearRecords,
  setResetting: (value) => { factoryResetting = value === true; },
  broadcast,
});
const {
  searchLocations,
  getForecast,
  weatherCachePermitted,
} = createWeatherService({
  hasOriginPermissions, getRecord, setRecord, typedError,
});
const cacheAccessPolicy = createCacheAccessPolicy({
  aiSearchResultPermitted: aiAccessPolicy.aiSearchResultPermitted,
  originPattern,
  cacheUrlsPermitted,
  previewCachePermitted,
  weatherCachePermitted,
});
const refreshService = createRefreshService({
  refreshCoordinator, getSettings, currentBookmarkModel, emptyBookmarkModel, currentFeedPermissionState,
  configuredFeedSources, selectRefreshBatch, getRecord, setRecord, setRecords,
  setRefreshStatus, pipelineStages, broadcast, fetchSourceArticles, sourceFetchOptions,
  mapWithConcurrency, summarizeQuality, retainActiveUnrefreshedItems, rankAndDedupe,
  updateSourceQualityRecord,
  buildDailyCandidates, dailyCandidateFingerprint,
  assertFeedItemsStillPermitted, withFeedCacheMetadata, cacheMutations, aiConfigured,
  getAiAutoStatus, setAiAutoStatus, defaultAiAutoStatus, readQuota, runAiWithinQuota,
  callProvider, translate, translateAiPrompt, settingsLocale, parseGeneratedDailyDigest, dailyDigestEvidence,
  cardSummaryPolicy, buildFallbackDigest,
  digestCachePermitted, filterFeedItemsBySources, presentableFeedItems, resultMessage, errorResult,
  emptySourceQuality, localDateKey, uniqueStrings, safeOrigin, originPattern,
  sanitizeDailyDigest, typedError, feedCacheOrEmpty, getRefreshStatus, hostOf,
  originsFromUrls, fetchSourceImageCandidates: fetchSourceImageCandidateRecords, hasOriginPermission, hashText,
  isPermissionEpochCurrent: permissionEpoch.isCurrent,
});
refreshCoordinator.setRun(refreshService.runRefresh);
const {
  startRefresh,
  refreshDailyDigest,
  refreshSingleSummary,
  refreshSource,
  generatedCardSummary,
  preserveCardAiSummary,
  sanitizeCardAiSummaries,
} = refreshService;
const {
  nextPermissionEpoch,
  capturePermissionEpoch,
  isPermissionEpochCurrent,
  handleAddedOrigins,
  handleRemovedOrigins,
  reconcilePermissionCache,
  pruneStalePreviewCaches,
  pruneBravePreviewCaches,
  schedulePermissionCleanup,
  schedulePermissionReconcile,
} = createPermissionWorkflow({
  broadcast, getSettings, currentBookmarkModel, emptyBookmarkModel, currentFeedPermissionState,
  revokedSourceKeys, getRefreshStatus, originPattern, aiConfigured, setAiAutoStatus,
  defaultAiAutoStatus, startRefresh, cacheMutations, setRefreshStatus,
  defaultRefreshStatus, setRecords, getRecord, deleteRecord, listRecords,
  filterFeedItemsBySources, presentableFeedItems, feedCacheOrEmpty, previewCacheKeysOutsideTargets, bravePreviewCacheKeys,
  uniqueStrings, normalizeOriginPattern, filterSourceQuality,
  emptySourceQuality, originsFromUrls, secretStatus, settingsLocale, digestCachePermitted,
  withFeedCacheMetadata, buildFallbackDigest, buildDailyCandidates, inspirationPreviewTargets,
  newsPreviewTargets,
  permissionEpoch, aiAccessPolicy, cacheAccessPolicy,
});
({ publicSettings, saveSettings, exportSettings, importSettings } = createSettingsWorkflow({
  getSettings, settingsLocale, defaultBookmarkFoldersForLocale, secretStatus,
  currentBookmarkModel, emptyBookmarkModel, selectedOrigins, currentFeedPermissionState,
  filterSourceQuality, getRecord, emptySourceQuality, defaultSettings: DEFAULT_SETTINGS,
  settingsService, readProviderProfile, bindProviderPatchToOrigin, isValidServiceUrl,
  typedError, providerTestConsentAllowed, providerRequiresApiKey, hasOriginPermission, updateProviderProfile,
  updateSecrets, setAiDisclosureConsent, captureCredentialState, restoreCredentialState,
  captureDeviceConsentState, restoreDeviceConsentState, cacheMutations, refreshCoordinator, setRecord,
  pruneStalePreviewCaches, pruneBravePreviewCaches, aiConfigured, setAiAutoStatus,
  defaultAiAutoStatus, startRefresh, broadcast,
  createSettingsTransferDocument, parseSettingsTransferDocument,
  contentSyncService,
  headerCoverStore,
  browserSearchEnabled: browserSearchService.enabled,
  getAppVersion: () => chrome.runtime.getManifest().version,
  now: () => new Date().toISOString(),
}));
const { schedule: scheduleBookmarkRefresh } = createBookmarkRefreshScheduler({
  cacheMutations, refreshCoordinator, getSettings, pruneStalePreviewCaches,
  broadcast, startRefresh,
});
const {
  recordBookmarkConsent,
  completeOnboarding,
  clearGeneratedCache,
  resetQuota,
  resetPreferences,
  resetSourceQuality,
  recordFeedback,
} = createMaintenanceService({
  grantBookmarkConsent, publicSettings, markOnboardingComplete, startRefresh, getSettings,
  cacheMutations, refreshCoordinator, clearRecords, setRecord, setRefreshStatus,
  defaultRefreshStatus, setAiAutoStatus, defaultAiAutoStatus, broadcast, resultMessage,
  quotaManager, getAiAutoStatus, emptySourceQuality, normalizeFeedback, getRecord,
});
const getSitePreview = createPreviewService({
  getSettings,
  readSecrets,
  getRecord,
  setRecord: storePreviewCache,
  hasOriginPermission,
  isAllowedTarget: isSitePreviewTarget,
  captureCacheEpoch: () => cacheMutations.capture(),
});
const routeMessage = createMessageRouter({
  "dashboard:get": () => buildDashboardPayload(),
  "settings:get": () => publicSettings(),
  "header-cover:get": () => headerCoverStore.read(),
  "settings:save": (payload) => saveSettings(payload),
  "settings:export": () => exportSettings(),
  "settings:import": (payload) => importSettings(payload),
  "settings:factory-reset": () => factoryReset(),
  "settings:test": (payload) => testOpenAISettings(payload),
  "settings:image-test": (payload) => testImageSearchSettings(payload),
  "refresh:start": (payload) => startRefresh(payload.force === true),
  "feed:refresh-source": (payload) => refreshSource(payload),
  "refresh:status": () => getRefreshStatus(),
  "digest:refresh": () => refreshDailyDigest({ automatic: false }),
  "summary:refresh": (payload) => refreshSingleSummary(payload),
  "ai:search": (payload) => answerAiSearch(payload),
  "browser:search": (payload, sender) => browserSearchService.search(payload, sender),
  "weather:search": (payload) => searchLocations(payload),
  "weather:get": (payload) => getForecast(payload),
  "reader:get": (payload) => readArticle(payload.url),
  "reader:translate": (payload) => translateReaderArticle(payload),
  "preview:get": (payload) => getSitePreview(payload),
  "cache:clear": () => clearGeneratedCache(),
  "quota:reset": () => resetQuota(),
  "preferences:reset": () => resetPreferences(),
  "source-quality:reset": () => resetSourceQuality(),
  "feedback:record": (payload) => recordFeedback(payload),
  "client-state:get": async () => {
    await contentSyncService.initialize();
    return clientStateStore.read();
  },
  "client-state:set": async (payload) => {
    if (factoryResetting) return { ok: true, resetInProgress: true };
    const result = await clientStateStore.save(payload);
    await contentSyncService.handleLocalPatch(payload.values || {});
    return result;
  },
  "reading-queue:capture-current": (payload) => handleActionClicked(payload.tab || {}),
  "permissions:origins": () => selectedOrigins(),
  "permissions:status": (payload) => permissionStatus(payload.origins || []),
  "onboarding:consent": () => recordBookmarkConsent(),
  "onboarding:complete": () => completeOnboarding(),
}, (type) => {
  throw typedError("UNKNOWN_REQUEST", "background.error.unknownRequest", { type }, false);
});

  let started = false;
  return {
    ensureReady: ensureRuntime,
    handleMessage: handleRequest,
    refresh: startRefresh,
    handleAlarm,
    handleBookmarksChanged,
    handlePermissionsAdded,
    handlePermissionsRemoved,
    handleActionClicked,
    handleTabUpdated,
    start,
  };

  function start() {
    if (started) return;
    started = true;

chrome.runtime.onInstalled.addListener((details = {}) => {
  ensureRuntime().catch(() => {});
  if (details.reason === "install") {
    chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") }).catch(() => {});
  }
});

chrome.runtime.onStartup.addListener(() => {
  ensureRuntime().catch(() => {});
});

chrome.tabs.onUpdated.addListener(handleTabUpdated);

chrome.alarms.onAlarm.addListener((alarm) => {
  handleAlarm(alarm);
});

for (const event of [chrome.bookmarks.onCreated, chrome.bookmarks.onChanged, chrome.bookmarks.onMoved, chrome.bookmarks.onRemoved]) {
  event.addListener(handleBookmarksChanged);
}

chrome.permissions.onAdded.addListener(handlePermissionsAdded);

chrome.permissions.onRemoved.addListener(handlePermissionsRemoved);

chrome.storage.onChanged?.addListener((changes, areaName) => {
  if (factoryResetting) return;
  contentSyncService.handleStorageChanged(changes, areaName);
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
  }

  function handleTabUpdated(tabId, changeInfo = {}) {
    if (factoryResetting) return;
    if (changeInfo.status !== "loading") return;
    resetActionFeedback(tabId).catch(() => {});
  }

function handleAlarm(alarm) {
  if (factoryResetting) return;
  if (alarm?.name === REFRESH_ALARM) startRefresh(false).catch(() => {});
}

function handleBookmarksChanged() {
  if (factoryResetting) return;
  scheduleBookmarkRefresh();
}

function handlePermissionsAdded(permissions) {
  if (factoryResetting) return;
  nextPermissionEpoch();
  handleAddedOrigins(permissions?.origins || []).catch(() => {
    broadcast("settings.changed", { permissionsChanged: true });
  });
}

function handlePermissionsRemoved(permissions) {
  if (factoryResetting) return;
  const origins = permissions?.origins || [];
  const expectedPermissionEpoch = nextPermissionEpoch();
  const expectedEpoch = cacheMutations.invalidate();
  refreshCoordinator.invalidate();
  handleRemovedOrigins(origins, expectedEpoch, expectedPermissionEpoch).catch(() => {
    setRefreshStatus(defaultRefreshStatus("background.refreshPaused")).catch(() => {});
    schedulePermissionCleanup(origins, true);
    broadcast("settings.changed", { permissionsChanged: true, cleanupPending: true });
    broadcast("dashboard.updated", { reason: "permissions-removed" });
  });
}

async function ensureRuntime() {
  await chrome.alarms.create(REFRESH_ALARM, { periodInMinutes: REFRESH_PERIOD_MINUTES });
  await getSettings();
  await contentSyncService.initialize();
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

async function handleRequest(request, sender) {
  if (request?.type === "settings:factory-reset") return routeMessage(request, sender);
  if (factoryResetting && request?.type !== "settings:factory-reset") {
    throw typedError("FACTORY_RESET_IN_PROGRESS", "background.error.factoryResetInProgress", {}, true);
  }
  const operation = Promise.resolve().then(() => routeMessage(request, sender));
  activeRequests.add(operation);
  try {
    return await operation;
  } finally {
    activeRequests.delete(operation);
  }
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

async function aiConfigured(settings) {
  const provider = await readProviderProfile(settings);
  const consent = await readDeviceConsent(provider.openaiBaseUrl);
  return consent.aiDisclosureAccepted === true
    && providerCredentialAvailable(provider.openaiBaseUrl, provider.openaiApiKey)
    && Boolean(String(provider.openaiSummaryModel || "").trim())
    && await hasOriginPermission(provider.openaiBaseUrl);
}

async function translateReaderArticle(payload = {}) {
  const settings = await getSettings();
  if (!await aiConfigured(settings)) throw typedError("AI_NOT_CONFIGURED", "background.error.aiKeyMissing", {}, false);
  const locale = settingsLocale(settings);
  const title = String(payload.title || "").trim().slice(0, 500);
  const text = String(payload.text || "").trim().slice(0, 24000);
  if (!text) throw typedError("READER_TRANSLATION_EMPTY", "reader.translationEmpty", {}, false);
  const value = await callProvider(
    settings,
    translateAiPrompt(locale, "background.prompt.readerTranslation"),
    translate(locale, "background.prompt.readerTranslationInput", { title, text }),
    6000,
    "",
    () => assertUrlsStillPermitted([payload.url]),
    { expectedLocale: locale, outputValidator: readerTranslationMatchesLocale },
  );
  const parts = String(value || "").split(/\n\s*\n/);
  const translatedTitle = parts.length > 1 ? parts.shift().trim() : title;
  return { locale, title: translatedTitle, text: parts.join("\n\n").trim() || value };
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
    if (shouldReleaseAutomaticAiQuota(error)) await quotaManager.release(reservation);
    throw error;
  }
}

function broadcast(type, payload) {
  chrome.runtime.sendMessage({ type, requestId: crypto.randomUUID(), payload }).catch(() => {});
}
}
