import {
  DEFAULT_SETTINGS,
  REFRESH_ALARM,
  REFRESH_PERIOD_MINUTES,
} from "../core/constants.mjs";
import { buildBookmarkModel, hashText, inspirationPreviewSourceUrls, inspirationPreviewTargets, originsFromUrls } from "../core/bookmarks.mjs";
import {
  NEWS_RANKING_POLICY_VERSION,
  buildDailyCandidates,
  buildFallbackDigest,
  dailyCandidateFingerprint,
  feedCacheOrEmpty,
  fetchSourceArticles,
  rankAndDedupe,
} from "../core/feed.mjs";
import { normalizeFeedback } from "../core/feedback.mjs";
import { clearRecords, deleteRecord, getRecord, listRecords, pruneCache, setRecord, setRecords } from "../core/db.mjs";
import { extractPageMetadata, fetchReader, fetchReaderHtml, loadReaderWithCache, readerTextFromBlocks } from "../core/reader.mjs";
import {
  clearLegacyCredentialData,
  readProviderProfile,
  readSecrets,
  secretStatus,
  updateProviderProfile,
  updateSecrets,
} from "../core/secrets.mjs";
import {
  grantBookmarkConsent,
  markOnboardingComplete,
  readDeviceConsent,
  setAiDisclosureConsent,
} from "../core/device-consent.mjs";
import { DEFAULT_LOCALE, defaultBookmarkFoldersForLocale, normalizeLocale, translate } from "../core/i18n.mjs";
import { requestAiCompletion, testImageSearchConnection } from "../core/ai.mjs";
import { createClientStateStore } from "../core/client-state.mjs";
import { createQuotaManager } from "../core/quota.mjs";
import { createPreviewService, fetchSourceImageCandidates } from "../core/preview.mjs";
import { bravePreviewCacheKeys, previewCacheKeysOutsideTargets } from "../core/preview-cache.mjs";
import { retainActiveUnrefreshedItems, selectRefreshBatch } from "../core/refresh.mjs";
import { createRefreshCoordinator } from "../core/refresh-coordinator.mjs";
import { createEpochMutationQueue } from "../core/mutation-queue.mjs";
import { bindProviderPatchToOrigin, providerTestApiKey, providerTestConsentAllowed } from "../core/provider-policy.mjs";
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
import { CARD_SUMMARY_POLICY_VERSION, cleanGeneratedSummaryLine, extractGeneratedSummaryTitle, limitGeneratedSummaryLines, parseGeneratedDailyDigest } from "../core/summary-text.mjs";
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
const settingsStore = createSettingsStore(chrome.storage.sync);
const settingsService = createRuntimeSettingsService({ store: settingsStore, readProviderProfile, readDeviceConsent });
const { getSettings, sanitizeLegacySyncedCredentials } = settingsService;
let publicSettings;
let saveSettings;
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
} = createPermissionGateway({ chrome, getSettings, secretStatus, getRecord });
let refreshService;
let permissionWorkflow;
let aiSearchService;
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
  capturePermissionEpoch: (...args) => permissionWorkflow.capturePermissionEpoch(...args),
  isPermissionEpochCurrent: (...args) => permissionWorkflow.isPermissionEpochCurrent(...args),
  getSettings, settingsLocale, secretStatus, currentBookmarkModel, emptyBookmarkModel,
  feedCacheOrEmpty, getRecord, getRefreshStatus, readQuota, emptySourceQuality,
  getAiAutoStatus, filterFeedItemsBySources, originsFromUrls, buildPermissionRows,
  originPattern,
  sanitizeCardAiSummaries: (...args) => refreshService.sanitizeCardAiSummaries(...args),
  buildFallbackDigest, buildDailyCandidates, dailyCandidateFingerprint, rankingPolicyVersion: NEWS_RANKING_POLICY_VERSION,
  localDateKey, summarizeQuality, pipelineStages, publicFeedsForLocale,
  chrome, safeOrigin, typedError, uniqueStrings, normalizeUserUrl,
  aiSearchResultPermitted: (...args) => aiSearchService.aiSearchResultPermitted(...args),
});
const {
  readArticle,
  readWebsiteOverview,
  cacheUrlsPermitted,
  storePreviewCache,
  isInspirationPreviewTarget,
  previewCachePermitted,
} = createReaderPreviewService({
  normalizeUserUrl, hasOriginPermission, loadReaderWithCache, fetchReader, fetchReaderHtml,
  extractPageMetadata, getRecord, setRecord, deleteRecord, cacheMutations,
  currentBookmarkModel, emptyBookmarkModel, getSettings, secretStatus,
  inspirationPreviewSourceUrls, hashText, uniqueStrings, hasOriginPermissions,
  setRecords, typedError,
});
const {
  loadQuestionSearchContext,
  currentProviderCapability,
  aiSearchResultPermitted,
  answerAiSearch,
  callProvider,
  testOpenAISettings,
  testImageSearchSettings,
} = aiSearchService = createAiSearchService({
  getRecord, setRecord, searchFeed, settingsLocale, translate, normalizeUserUrl,
  hasOriginPermission, originPattern, secretStatus, currentFeedPermissionState,
  getSettings, currentBookmarkModel, emptyBookmarkModel, assertUrlsStillPermitted,
  cacheSourceIdentitiesPermitted, configuredFeedSources,
  readArticle,
  readWebsiteOverview,
  hashText, aiConfigured, requestAiCompletion, providerOrigin, readProviderProfile,
  readDeviceConsent, readSecrets, providerTestApiKey, providerTestConsentAllowed,
  isValidServiceUrl, typedError, resultMessage, errorResult, testImageSearchConnection,
  safeOrigin, uniqueStrings, withFeedCacheMetadata,
  filterFeedItemsBySources, cacheMutations, hasOriginPermissions, cacheUrlsPermitted,
  localDateKey, readerTextFromBlocks, assertFeedItemsStillPermitted, normalizeSettings,
});
const refreshCoordinator = createRefreshCoordinator({
  getStatus: getRefreshStatus,
  run: (generation) => refreshService.runRefresh(generation),
  isFresh: (status) => {
    const finishedAt = Date.parse(String(status?.finishedAt || ""));
    return Number.isFinite(finishedAt) && Date.now() - finishedAt < 10 * 60 * 1000;
  },
});
refreshService = createRefreshService({
  refreshCoordinator, getSettings, currentBookmarkModel, emptyBookmarkModel, currentFeedPermissionState,
  configuredFeedSources, selectRefreshBatch, getRecord, setRecord, setRecords,
  setRefreshStatus, pipelineStages, broadcast, fetchSourceArticles, sourceFetchOptions,
  mapWithConcurrency, summarizeQuality, retainActiveUnrefreshedItems, rankAndDedupe,
  updateSourceQualityRecord,
  buildDailyCandidates, dailyCandidateFingerprint, rankingPolicyVersion: NEWS_RANKING_POLICY_VERSION,
  assertFeedItemsStillPermitted, withFeedCacheMetadata, cacheMutations, aiConfigured,
  getAiAutoStatus, setAiAutoStatus, defaultAiAutoStatus, readQuota, runAiWithinQuota,
  callProvider, translate, settingsLocale, cleanGeneratedSummaryLine,
  extractGeneratedSummaryTitle, limitGeneratedSummaryLines, parseGeneratedDailyDigest,
  cardSummaryPolicyVersion: CARD_SUMMARY_POLICY_VERSION, buildFallbackDigest,
  digestCachePermitted, filterFeedItemsBySources, resultMessage, errorResult,
  emptySourceQuality, localDateKey, uniqueStrings, safeOrigin, originPattern,
  sanitizeDailyDigest, typedError, feedCacheOrEmpty, getRefreshStatus, hostOf,
  originsFromUrls, fetchSourceImageCandidates, hasOriginPermission, hashText,
  isPermissionEpochCurrent: (...args) => isPermissionEpochCurrent(...args),
});
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
} = permissionWorkflow = createPermissionWorkflow({
  broadcast, getSettings, currentBookmarkModel, emptyBookmarkModel, currentFeedPermissionState,
  revokedSourceKeys, getRefreshStatus, originPattern, aiConfigured, setAiAutoStatus,
  defaultAiAutoStatus, startRefresh, cacheMutations, refreshCoordinator, setRefreshStatus,
  defaultRefreshStatus, setRecord, setRecords, getRecord, deleteRecord, listRecords,
  filterFeedItemsBySources, previewCacheKeysOutsideTargets, bravePreviewCacheKeys,
  buildDashboardPayload, uniqueStrings, normalizeOriginPattern, filterSourceQuality,
  emptySourceQuality, originsFromUrls, secretStatus, currentProviderCapability, settingsLocale,
  aiSearchResultPermitted, previewCachePermitted, cacheUrlsPermitted, digestCachePermitted,
  withFeedCacheMetadata, buildFallbackDigest, buildDailyCandidates, inspirationPreviewTargets,
});
({ publicSettings, saveSettings } = createSettingsWorkflow({
  getSettings, settingsLocale, defaultBookmarkFoldersForLocale, secretStatus,
  currentBookmarkModel, emptyBookmarkModel, selectedOrigins, currentFeedPermissionState,
  filterSourceQuality, getRecord, emptySourceQuality, defaultSettings: DEFAULT_SETTINGS,
  settingsService, readProviderProfile, bindProviderPatchToOrigin, isValidServiceUrl,
  typedError, providerTestConsentAllowed, hasOriginPermission, updateProviderProfile,
  updateSecrets, setAiDisclosureConsent, cacheMutations, refreshCoordinator, setRecord,
  pruneStalePreviewCaches, pruneBravePreviewCaches, aiConfigured, setAiAutoStatus,
  defaultAiAutoStatus, startRefresh, broadcast,
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
  isAllowedTarget: isInspirationPreviewTarget,
  captureCacheEpoch: () => cacheMutations.capture(),
});
const routeMessage = createMessageRouter({
  "dashboard:get": () => buildDashboardPayload(),
  "settings:get": () => publicSettings(),
  "settings:save": (payload) => saveSettings(payload),
  "settings:test": (payload) => testOpenAISettings(payload),
  "settings:image-test": (payload) => testImageSearchSettings(payload),
  "refresh:start": (payload) => startRefresh(payload.force === true),
  "feed:refresh-source": (payload) => refreshSource(payload),
  "refresh:status": () => getRefreshStatus(),
  "digest:refresh": () => refreshDailyDigest({ automatic: false }),
  "summary:refresh": (payload) => refreshSingleSummary(payload),
  "ai:search": (payload) => answerAiSearch(payload),
  "reader:get": (payload) => readArticle(payload.url),
  "preview:get": (payload) => getSitePreview(payload),
  "cache:clear": () => clearGeneratedCache(),
  "quota:reset": () => resetQuota(),
  "preferences:reset": () => resetPreferences(),
  "source-quality:reset": () => resetSourceQuality(),
  "feedback:record": (payload) => recordFeedback(payload),
  "client-state:get": () => clientStateStore.read(),
  "client-state:set": (payload) => clientStateStore.save(payload),
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
    start,
  };

  function start() {
    if (started) return;
    started = true;

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
  handleAlarm(alarm);
});

for (const event of [chrome.bookmarks.onCreated, chrome.bookmarks.onChanged, chrome.bookmarks.onMoved, chrome.bookmarks.onRemoved]) {
  event.addListener(handleBookmarksChanged);
}

chrome.permissions.onAdded.addListener(handlePermissionsAdded);

chrome.permissions.onRemoved.addListener(handlePermissionsRemoved);

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

function handleAlarm(alarm) {
  if (alarm?.name === REFRESH_ALARM) startRefresh(false).catch(() => {});
}

function handleBookmarksChanged() {
  scheduleBookmarkRefresh();
}

function handlePermissionsAdded(permissions) {
  nextPermissionEpoch();
  handleAddedOrigins(permissions?.origins || []).catch(() => {
    broadcast("settings.changed", { permissionsChanged: true });
  });
}

function handlePermissionsRemoved(permissions) {
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
  return routeMessage(request);
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

function broadcast(type, payload) {
  chrome.runtime.sendMessage({ type, payload }).catch(() => {});
}
}
