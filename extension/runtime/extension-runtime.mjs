import {
  DEFAULT_SETTINGS,
  SETTINGS_KEY,
  REFRESH_ALARM,
  REFRESH_PERIOD_MINUTES,
  SYNC_CREDENTIALS_KEY,
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
import { createHeaderCoverCache } from "../core/header-cover-cache.mjs";
import { createHeaderCoverFetchHandler } from "./header-cover-fetch.mjs";
import { clearRecords, deleteRecord, getRecord, listRecords, pruneCache, setRecord, setRecords } from "../core/db.mjs";
import { extractPageMetadata, fetchReader, fetchReaderHtml, loadReaderWithCache, probeReaderUrl, readerTextFromBlocks } from "../core/reader.mjs";
import {
  captureCredentialState,
  readProviderProfile,
  readSecrets,
  restoreCredentialState,
  secretStatus,
  updateCredentials,
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
import {
  requestAiCompletion,
  requestAiCompletionResult,
  requestAiCompletionStream,
  testImageSearchConnection,
} from "../core/ai.mjs";
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
import { researchRequestEnabled } from "../core/research-search.mjs";
import { createMessageRouter } from "./message-router.mjs";
import { createBotBoardService } from "./bot-board-service.mjs";
import { createMcpSetupService } from "./mcp-setup-service.mjs";
import { createBotSummaryService } from "./bot-summary-service.mjs";
import { createBotNativeWorkflow } from "./bot-native-workflow.mjs";
import { botDashboardPayload } from "../core/bot-board.mjs";
import { botGeneratesBrief, botOrganizesNews, isBotMode } from "../core/bot-mode.mjs";
import { BOT_LOCAL_ORIGIN } from "../core/bot-board.mjs";
import { errorResult, publicErrorDetails, resultMessage, settingsLocale, typedError } from "./runtime-result.mjs";
import { createRuntimeStatusStore } from "./status-store.mjs";
import { createRuntimeSettingsService } from "./settings-service.mjs";
import { createPermissionGateway } from "./permission-gateway.mjs";
import { createPermissionWorkflow } from "./permission-workflow.mjs";
import { createMaintenanceService } from "./maintenance-service.mjs";
import { createRefreshService } from "./refresh-service.mjs";
import { createAiSearchService } from "./ai-search-service.mjs";
import { createImageSearchSettingsService } from "./image-search-settings-service.mjs";
import { createAiStreamPortHandler } from "./ai-stream-port.mjs";
import { createResearchSearchService } from "./research-search-service.mjs";
import { createReaderPreviewService } from "./reader-preview-service.mjs";
import { createSettingsWorkflow } from "./settings-workflow.mjs";
import { createDashboardContentService } from "./dashboard-content-service.mjs";
import { createBookmarkRefreshScheduler } from "./bookmark-refresh-scheduler.mjs";
import { createWeatherService } from "./weather-service.mjs";
import { createStockService } from "./stock-service.mjs";
import { createCardSummaryPolicy } from "./card-summary-policy.mjs";
import { createPermissionEpoch } from "./permission-epoch.mjs";
import { createCacheMetadataPolicy } from "./cache-metadata-policy.mjs";
import { createAiAccessPolicy } from "./ai-access-policy.mjs";
import { createCacheAccessPolicy } from "./cache-access-policy.mjs";
import { createActionReadingQueueService } from "./action-reading-queue-service.mjs";
import { createBrowserSearchService } from "./browser-search-service.mjs";
import { createLocalSearchService } from "./local-search-service.mjs";
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
const headerCoverCache = createHeaderCoverCache({ getRecord, setRecord, deleteRecord });
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
} = createRuntimeStatusStore({
  getRecord, setRecord, broadcast, createStages: pipelineStages,
  readUsage: async () => (await quotaManager.read(Number.MAX_SAFE_INTEGER)).used,
});
const {
  currentBookmarkModel,
  currentBookmarkTree,
  invalidateBookmarkModel,
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
const localSearchService = createLocalSearchService({
  chrome, getSettings, currentBookmarkTree, readDashboard: buildDashboardPayload,
  captureEpoch: () => `${permissionEpoch.capture()}:${cacheMutations.capture()}`,
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
} = createAiSearchService({
  getRecord, setRecord, searchFeed, settingsLocale, translate, translateAiPrompt, normalizeUserUrl,
  hasOriginPermission, originPattern, secretStatus, currentFeedPermissionState,
  getSettings, currentBookmarkModel, emptyBookmarkModel, assertUrlsStillPermitted,
  cacheSourceIdentitiesPermitted, configuredFeedSources,
  readArticle, readCachedArticle,
  readWebsiteOverview,
  hashText, aiConfigured, requestAiCompletion, requestAiCompletionResult, requestAiCompletionStream,
  providerOrigin, readProviderProfile,
  readDeviceConsent, providerTestApiKey, providerTestConsentAllowed,
  providerCredentialAvailable, providerRequiresApiKey,
  isValidServiceUrl, typedError, resultMessage, errorResult,
  safeOrigin, uniqueStrings, withFeedCacheMetadata,
  filterFeedItemsBySources, presentableFeedItems, feedCacheOrEmpty, cacheMutations, hasOriginPermissions, cacheUrlsPermitted,
  localDateKey, readerTextFromBlocks, assertFeedItemsStillPermitted, normalizeSettings,
  aiAccessPolicy,
});
const { testImageSearchSettings } = createImageSearchSettingsService({
  getSettings,
  readSecrets,
  testImageSearchConnection,
  hasOriginPermission,
  resultMessage,
  errorResult,
});
const {
  listResearchFolders,
  answerResearchSearch,
  pruneResearchCaches,
} = createResearchSearchService({
  chrome,
  getSettings,
  settingsLocale,
  translate,
  getRecord,
  setRecords,
  permissionStatus,
  hasOriginPermission,
  hasOriginPermissions,
  fetchSourceArticles,
  sourceFetchOptions,
  readArticle,
  readerTextFromBlocks,
  callProvider,
  aiConfigured,
  cacheMutations,
  feedCacheOrEmpty,
});
const aiStreamPortOptions = {
  publicErrorDetails,
  track: (operation) => {
    activeRequests.add(operation);
    operation.finally(() => activeRequests.delete(operation));
  },
  run: async (payload, controls) => {
    if (factoryResetting) throw typedError("FACTORY_RESET_IN_PROGRESS", "background.error.factoryResetInProgress", {}, true);
    const queryIsUrl = Boolean(normalizeUserUrl(payload?.query));
    const articleFollowup = Boolean(payload?.articleContext);
    return researchRequestEnabled(payload?.research) && !queryIsUrl && !articleFollowup
      ? answerResearchSearch(payload, controls)
      : answerAiSearch(payload, { ...controls, stream: true });
  },
};
const aiStreamPortHandler = createAiStreamPortHandler(aiStreamPortOptions);
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
  clearImageCache: () => headerCoverCache.clear(),
  setResetting: (value) => {
    factoryResetting = value === true;
    if (factoryResetting) invalidateBookmarkModel();
  },
  broadcast,
});
const {
  searchLocations,
  getForecast,
  weatherCachePermitted,
} = createWeatherService({
  hasOriginPermissions, getRecord, setRecord, typedError,
});
const { getQuotes, stockCachePermitted } = createStockService({
  hasOriginPermissions, getRecord, setRecord, typedError, cacheMutations, permissionEpoch,
});
const cacheAccessPolicy = createCacheAccessPolicy({
  stockCachePermitted,
  aiSearchResultPermitted: aiAccessPolicy.aiSearchResultPermitted,
  originPattern,
  cacheUrlsPermitted,
  previewCachePermitted,
  weatherCachePermitted,
});
const refreshService = createRefreshService({
  organizeBot: options => botSummaries.organize(options),
  onOrganizationComplete: () => botNative.syncBrief(),
  refreshCoordinator, getSettings, currentBookmarkModel, emptyBookmarkModel, currentFeedPermissionState,
  selectRefreshBatch, getRecord, setRecord, setRecords,
  setRefreshStatus, pipelineStages, broadcast, fetchSourceArticles, sourceFetchOptions,
  mapWithConcurrency, summarizeQuality, retainActiveUnrefreshedItems, rankAndDedupe,
  updateSourceQualityRecord,
  buildDailyCandidates, dailyCandidateFingerprint,
  assertFeedItemsStillPermitted, withFeedCacheMetadata, cacheMutations, aiConfigured,
  getAiAutoStatus, setAiAutoStatus, defaultAiAutoStatus, readQuota, runAiWithinQuota, runAiBatchWithinQuota,
  callProvider, translate, translateAiPrompt, settingsLocale, parseGeneratedDailyDigest, dailyDigestEvidence,
  cardSummaryPolicy, buildFallbackDigest,
  digestCachePermitted, filterFeedItemsBySources, presentableFeedItems, resultMessage,
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
  typedError, providerTestConsentAllowed, providerRequiresApiKey, hasOriginPermission, updateCredentials,
  setAiDisclosureConsent, captureCredentialState, restoreCredentialState,
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
  clearImageCache: () => headerCoverCache.clear(),
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
let botNative;
const botBoard = createBotBoardService({
  storage: chrome.storage.local, getRecord, setRecord, getSettings, hasOriginPermission, cacheMutations,
  capturePermissionEpoch: () => permissionEpoch.capture(),
  isPermissionEpochCurrent: (epoch) => permissionEpoch.isCurrent(epoch),
  prepareMessage: (action, settings) => botNative.prepareMessage(action, settings),
  validateMessage: evidence => botNative.validateMessage(evidence),
});
const mcpSetup = createMcpSetupService({ storage: chrome.storage.local, getSettings, hasOriginPermission, getExtensionId: () => chrome.runtime.id, botBoard });
const botSummaries = createBotSummaryService({
  quotaManager, setAiAutoStatus, onComplete: () => botNative.syncBrief(),
  getSettings, settingsLocale, getRecord, setRecord, botBoard, cacheMutations, broadcast,
  capturePermissionEpoch: () => permissionEpoch.capture(), isPermissionEpochCurrent: epoch => permissionEpoch.isCurrent(epoch),
  selectPermitted: async (settings, items) => {
    const model = settings.bookmarkConsentGranted ? await currentBookmarkModel(settings) : emptyBookmarkModel();
    const permissions = await currentFeedPermissionState(settings, model);
    return sanitizeCardAiSummaries(filterFeedItemsBySources(items, permissions.permitted, permissions.grantedOrigins), settings, await aiConfigured(settings));
  },
  presentable: async (items, settings) => presentableFeedItems(items, settings, await aiConfigured(settings)),
});
botNative = createBotNativeWorkflow({
  storage: chrome.storage.local, getSettings, settingsLocale, getRecord, setRecord, botBoard, cacheMutations,
  capturePermissionEpoch: () => permissionEpoch.capture(), isPermissionEpochCurrent: epoch => permissionEpoch.isCurrent(epoch),
  buildDailyCandidates, loadQuestionSearchContext, normalizeUserUrl, hasOriginPermission, readArticle, readerTextFromBlocks,
  assertUrlsStillPermitted, assertFeedItemsStillPermitted, getRefreshStatus, localDateKey,
  readPermittedFeed: async settings => {
    const model = settings.bookmarkConsentGranted ? await currentBookmarkModel(settings) : emptyBookmarkModel();
    const permissions = await currentFeedPermissionState(settings, model);
    const feed = feedCacheOrEmpty(await getRecord("feed", null));
    const raw = filterFeedItemsBySources(feed.items, permissions.permitted, permissions.grantedOrigins);
    const configured = await aiConfigured(settings);
    return { raw, visible: presentableFeedItems(sanitizeCardAiSummaries(raw, settings, configured), settings, configured) };
  },
});
async function refreshBotBoard(payload = {}) {
  const organization = await botSummaries.sync();
  return { ...await botNative.refreshBoard(payload), organization };
}
const routeMessage = createMessageRouter({
  "mcp:enabled": async (payload) => {
    if (payload.enabled === true && !await hasOriginPermission(BOT_LOCAL_ORIGIN)) throw typedError("MCP_PERMISSION", "background.bot.permissionRequired", {}, false);
    await saveSettings({ mcpEnabled: payload.enabled === true });
    if (payload.enabled !== true) await mcpSetup.cancel();
    await botSummaries.sync();
    await botNative.syncBrief();
    return botBoard.config();
  },
  "mcp:setup": () => mcpSetup.begin(),
  "mcp:pair": () => mcpSetup.poll(),
  "bot:config": () => botBoard.config(),
  "bot:disconnect": async () => { await mcpSetup.cancel(); return botBoard.disconnect(); },
  "bot:read": async () => botNative.sanitizeBoard(await botBoard.read()),
  "bot:refresh": refreshBotBoard,
  "bot:organization": async (payload) => {
    await saveSettings({ botOrganizeNews: payload.enabled === true });
    await botSummaries.sync();
    return botBoard.config();
  },
  "bot:takeover": async (payload) => {
    const field = payload.scope === "brief" ? "botGenerateBrief" : payload.scope === "news" ? "botOrganizeNews" : payload.scope === "questions" ? "botAnswerQuestions" : "";
    if (!field || typeof payload.enabled !== "boolean") throw typedError("INVALID_REQUEST", "background.bot.invalidData", {}, false);
    await saveSettings({ [field]: payload.enabled });
    if (field === "botGenerateBrief") await botNative.syncBrief();
    if (field === "botOrganizeNews") await botSummaries.sync();
    return botBoard.config();
  },
  "bot:submit": async payload => botNative.sanitizeBoard(await botBoard.submit(payload)),
  "bot:mode": async (payload) => {
    refreshCoordinator.invalidate();
    await saveSettings({ dashboardMode: payload.mode === "bot" ? "bot" : "standard" });
    await botSummaries.sync();
    await botNative.syncBrief();
    return botBoard.config();
  },
  "dashboard:get": async (payload) => {
    const base = await buildDashboardPayload(0, payload?.scope === "news" ? "news" : "all");
    const settings = await getSettings();
    base.organization = botOrganizesNews(settings) ? await botSummaries.status()
      : { provider: "native", available: base.ai.enabled, ...base.ai.autoStatus, running: refreshService.isOrganizingNews(), pendingIds: [], failedIds: [] };
    return isBotMode(settings) ? botDashboardPayload(base, await botNative.sanitizeBoard(await botBoard.read()), settingsLocale(settings)) : base;
  },
  "settings:get": () => publicSettings(),
  "header-cover:get": () => headerCoverStore.read(),
  "header-cover:prepare": async () => { await globalThis.clients.claim(); return { ok: true }; },
  "header-cover:reject": async (payload) => { await headerCoverCache.reject(payload.url); return { ok: true }; },
  "settings:save": (payload) => saveSettings(payload),
  "settings:export": () => exportSettings(),
  "settings:import": (payload) => importSettings(payload),
  "settings:factory-reset": () => factoryReset(),
  "settings:test": (payload) => testOpenAISettings(payload),
  "settings:image-test": (payload) => testImageSearchSettings(payload),
  "refresh:start": async (payload) => {
    return startRefresh(payload.force === true, { organize: payload.automatic === true });
  },
  "news:organize": () => refreshService.organizeNews(),
  "feed:refresh-source": (payload) => refreshSource(payload),
  "refresh:status": () => getRefreshStatus(),
  "research:folders": () => listResearchFolders(),
  "digest:refresh": async () => {
    if (!botGeneratesBrief(await getSettings())) return refreshDailyDigest({ automatic: false });
    await botNative.syncBrief(true);
    return botDashboardPayload({}, await refreshBotBoard({ force: true })).dailyDigest;
  },
  "summary:refresh": (payload) => refreshSingleSummary(payload),
  "ai:search": (payload) => {
    const queryIsUrl = Boolean(normalizeUserUrl(payload?.query));
    const articleFollowup = Boolean(payload?.articleContext);
    return researchRequestEnabled(payload?.research) && !queryIsUrl && !articleFollowup
      ? answerResearchSearch(payload)
      : answerAiSearch(payload);
  },
  "search:query": payload => localSearchService.search(payload),
  "browser:search": (payload, sender) => browserSearchService.search(payload, sender),
  "weather:search": (payload) => searchLocations(payload),
  "weather:get": (payload) => getForecast(payload),
  "stocks:get": (payload) => getQuotes(payload),
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
  let historyInvalidationRegistered = false;
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

globalThis.addEventListener?.("fetch", createHeaderCoverFetchHandler({
  cache: headerCoverCache,
  origin: new URL(chrome.runtime.getURL("/")).origin,
  clients: globalThis.clients,
  isResetting: () => factoryResetting,
  track: (operation) => {
    activeRequests.add(operation);
    operation.finally(() => activeRequests.delete(operation)).catch(() => {});
    return operation;
  },
}));

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

for (const event of [chrome.bookmarks.onCreated, chrome.bookmarks.onChanged, chrome.bookmarks.onMoved, chrome.bookmarks.onRemoved,
  chrome.bookmarks.onChildrenReordered, chrome.bookmarks.onImportEnded]) {
  event?.addListener(handleBookmarksChanged);
}

chrome.permissions.onAdded.addListener(handlePermissionsAdded);

chrome.permissions.onRemoved.addListener(handlePermissionsRemoved);

registerHistoryInvalidation();

chrome.storage.onChanged?.addListener((changes, areaName) => {
  if (factoryResetting) return;
  contentSyncService.handleStorageChanged(changes, areaName);
  const changedSettings = areaName === "sync" ? changes[SETTINGS_KEY] : null;
  if (changedSettings && JSON.stringify(changedSettings.oldValue?.dashboardCardOrder) !== JSON.stringify(changedSettings.newValue?.dashboardCardOrder)) {
    broadcast("settings.changed", { dashboardLayoutOnly: true, dashboardCardOrder: normalizeSettings(changedSettings.newValue).dashboardCardOrder });
  }
  if (changedSettings && (changedSettings.oldValue?.mcpEnabled !== changedSettings.newValue?.mcpEnabled || changedSettings.oldValue?.dashboardMode !== changedSettings.newValue?.dashboardMode
    || changedSettings.oldValue?.botOrganizeNews !== changedSettings.newValue?.botOrganizeNews
    || changedSettings.oldValue?.botGenerateBrief !== changedSettings.newValue?.botGenerateBrief
    || changedSettings.oldValue?.botAnswerQuestions !== changedSettings.newValue?.botAnswerQuestions)) {
    cacheMutations.invalidate(); refreshCoordinator.invalidate();
    broadcast("settings.changed", { mcpSettingsChanged: true });
  }
  if (areaName === "sync" && Object.hasOwn(changes, SYNC_CREDENTIALS_KEY)) {
    cacheMutations.invalidate();
    refreshCoordinator.invalidate();
    settingsService.mutate(async () => {
      if (factoryResetting) return;
      const settings = await getSettings();
      await cacheMutations.run(() => setRecord("daily-digest", null, "cache"));
      await pruneBravePreviewCaches();
      await setAiAutoStatus(await aiConfigured(settings) ? defaultAiAutoStatus() : { ...defaultAiAutoStatus(), phase: "not-ready" }, false);
      broadcast("settings.changed", { automaticAiChanged: true, imageSearchChanged: true });
      broadcast("dashboard.updated", { reason: "credential-sync" });
    }).catch(() => broadcast("settings.changed", { credentialSyncChanged: true }));
  }
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

chrome.runtime.onConnect?.addListener(handleAiStreamPort);

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

function handleAiStreamPort(port) {
  if (port?.name !== "ampira:ai-stream") return;
  aiStreamPortHandler(port);
}

function handleBookmarksChanged() {
  invalidateBookmarkModel();
  localSearchService.invalidate();
  broadcast("search.invalidated", { reason: "bookmarks-changed" });
  if (factoryResetting) return;
  scheduleBookmarkRefresh();
  pruneResearchCaches().catch(() => {});
}

function registerHistoryInvalidation() {
  if (historyInvalidationRegistered || !chrome.history?.onVisitRemoved) return;
  chrome.history.onVisitRemoved.addListener(() => {
    localSearchService.invalidate();
    broadcast("search.invalidated", { reason: "history-removed" });
  });
  historyInvalidationRegistered = true;
}

function handlePermissionsAdded(permissions) {
  if (factoryResetting) return;
  registerHistoryInvalidation();
  localSearchService.invalidate();
  broadcast("search.invalidated", { reason: "permissions-changed" });
  nextPermissionEpoch();
  handleAddedOrigins(permissions?.origins || []).catch(() => {
    broadcast("settings.changed", { permissionsChanged: true });
  });
}

function handlePermissionsRemoved(permissions) {
  invalidateBookmarkModel();
  localSearchService.invalidate();
  broadcast("search.invalidated", { reason: "permissions-changed" });
  if (factoryResetting) return;
  const origins = permissions?.origins || [];
  pruneResearchCaches({ removedOrigins: origins }).catch(() => {});
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
  await headerCoverCache.prune().catch(() => {});
  await pruneResearchCaches().catch(() => {});
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

async function runAiBatchWithinQuota(settings, count, operation) {
  const reservation = await quotaManager.reserve(settings.dailyAiLimit, count);
  if (!reservation) return { usedAi: false, value: null };
  try { return { usedAi: true, value: await operation(reservation.units) }; }
  catch (error) { if (shouldReleaseAutomaticAiQuota(error)) await quotaManager.release(reservation); throw error; }
}

function broadcast(type, payload) {
  chrome.runtime.sendMessage({ type, requestId: crypto.randomUUID(), payload }).catch(() => {});
}
}
