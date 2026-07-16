import { apiGet, apiPost } from "./api.mjs";
import { srOnly } from "./dom.mjs";
import { getElementGroups } from "./elements.mjs";
import { createIcon, createThemedIcon, hydrateIcons } from "./icons.mjs";
import { allTranslations, getLocale, setLocale, t, tc } from "./i18n.mjs";
import { applyExternalStoragePatch, hydrateStorage, readJson, readNumber, readValue, writeJson, writeValue } from "./storage.mjs";
import { createInitialState } from "./state.mjs";
import { cleanTitleText, textLength, truncateText } from "./text.mjs";
import { formatDateTime, formatTodayMeta, getTodayKey } from "./time.mjs";
import { faviconUrl, hostFromUrl, isHttpUrl, normalizeUrl } from "./urls.mjs";
import { findNewsItemByReference as findNewsItemReference, pageForItems, seededShuffle as shuffle } from "./dashboard-model.mjs";
import {
  createPriorityRanker, groupItemsByKey, mergeRankedUnique,
  selectDailyEvents, selectTodayNewsItems, selectUnseenPool,
} from "./dashboard-selectors.mjs";
import { createReaderController } from "./reader-ui.mjs";
import { createAiSearchController } from "./ai-search-ui.mjs";
import { syncSearchCopy as syncSearchCopyView } from "./search-copy.mjs";
import { cloneSettingsDraft, diffSettingsDraft, snapshotSettingsDraft } from "./settings-draft.mjs";
import { createSitePreviewController, sitePreviewFingerprint } from "./inspiration-preview-controller.mjs";
import { AI_SETUP_STAGE, aiProviderOrigin, deriveAiSetupControlState } from "./ai-settings-policy.mjs";
import { isDisplayableFeedItem } from "../../extension/core/feed-item-policy.mjs";
import { cleanSummaryLines, cleanSummaryTitle, displaySummaryTitle, displayTitle, isCorrectlySummarized, itemUrl, summaryDetailLines, summaryLines, summaryText } from "./item-presenter.mjs";
import { apiStyleLabel, colorModeLabel, localizedCategory, localizedErrorMessage, localizedExclusionReason, localizedResponseMessage, localizedSourceLabel, localizedSourceReason, localizedStatusMessage, themeLabel } from "./localized-labels.mjs";
import { createContextMenuController } from "./context-menu-controller.mjs";
import { createAppearanceController } from "./appearance-controller.mjs";
import { createCoverBlurPreviewController } from "./cover-blur-preview-controller.mjs";
import { createHeaderCoverController } from "./header-cover-controller.mjs";
import { createSourceSettingsController } from "./source-settings-controller.mjs";
import { createBookmarkSettingsController } from "./bookmark-settings-controller.mjs";
import { hideBookmarkCategory as addHiddenBookmarkCategory } from "./bookmark-visibility.mjs";
import { createWebsiteShortcutsController } from "./website-shortcuts-controller.mjs";
import { createActivityController } from "./activity-controller.mjs";
import { createSummaryView } from "./summary-view.mjs";
import { createEfficiencyView } from "./efficiency-view.mjs";
import { createDailyView } from "./daily-view.mjs";
import { createBookmarksView } from "./bookmarks-view.mjs";
import { createAiPermissionController } from "./ai-permission-controller.mjs";
import { createStatusView, refreshAvailability } from "./status-view.mjs";
import { createShellController } from "./shell-controller.mjs";
import { createSettingsController } from "./settings-controller.mjs";
import { createSettingsTransferController } from "./settings-transfer-controller.mjs";
import { createDashboardController } from "./dashboard-controller.mjs";
import { exactPermissionOrigins } from "./permission-ui-model.mjs";
import { cardIconName, cardTone } from "./card-policy.mjs";
import {
  MAX_WEBSITE_SHORTCUTS, MAX_WEBSITE_SHORTCUT_TITLE_LENGTH, MAX_WEBSITE_SHORTCUT_URL_LENGTH,
  normalizeWebsiteShortcutUrl,
} from "../../extension/core/settings.mjs";
import {
  MAX_SETTINGS_TRANSFER_BYTES,
  parseSettingsTransferText,
  settingsTransferFilename,
} from "../../extension/core/settings-transfer.mjs";
import { WEATHER_ORIGINS } from "../../extension/core/weather.mjs";
import { normalizeReadingQueueRecords } from "../../extension/core/reading-queue.mjs";
import { createEmptyState, setIconLabel } from "./ui-primitives.mjs";
import { syncSegmentedIndicator } from "./segmented-control.mjs";
import { requestOrigins } from "./permission-client.mjs";
import { createActionPort } from "./action-port.mjs";
import { createCardTransition } from "./card-transition.mjs";
import { setAllContentSyncControls, syncContentSyncMaster } from "./content-sync-settings.mjs";
import { setDisclosureVisibility } from "./motion.mjs";
import { createManualAiUsageNoticeController } from "./manual-ai-usage-notice.mjs";
import { createConfirmationDialogController } from "./confirmation-dialog.mjs";
import {
  TODO_ITEMS_KEY,
  WEATHER_LOCATION_KEY,
  normalizeTodoItems,
  normalizeWeatherLocation,
} from "./utility-card-model.mjs";

const DAILY_NEWS_COUNT = 10;
const DAILY_NEWS_BATCH_LIMIT = 3;
const DAILY_INSPIRATION_COUNT = 5;
const DAILY_INSPIRATION_BATCH_LIMIT = 3;
const UPDATE_INSPIRATION_PRELOAD_TIMEOUT_MS = 800;
const HOT_SUMMARY_PAGE_SIZE = 16;
const SETTINGS_SAVE_CLOSE_DELAY_MS = 900;
const SETTINGS_CLOSE_MOTION_MS = 180;
const DAILY_BOARD_CARD_SELECTOR = ".news-list-card, .daily-card";
const SUMMARY_CARD_SELECTOR = ".summary-card";
const CARD_EXIT_MS = 120;
const CARD_ENTER_MS = 240;
const NEWS_CARD_TYPE = "news";
const INSPIRATION_CARD_TYPE = "inspiration";
const BOOKMARK_CARD_TYPE = "bookmark";
const ALL_FILTER = "all";
const SUMMARY_DETAIL_MAX_LENGTH = 200;

export async function createDashboardApp() {
  await hydrateStorage();
  const state = createInitialState();

  const elementGroups = getElementGroups();
  const els = Object.assign({}, ...Object.values(elementGroups));
  const dashboardElements = elementGroups.dashboard;
  const settingsElements = elementGroups.settings;
  const overlayElements = elementGroups.overlay;
  const shellElements = { ...elementGroups.shell, ...elementGroups.overlay, ...elementGroups.settings };
  const statusElements = { ...elementGroups.dashboard, ...elementGroups.settings };
  const appearanceElements = { ...elementGroups.dashboard, ...elementGroups.settings };
  const appVersion = globalThis.chrome?.runtime?.getManifest?.().version;
  if (els.aboutVersion && appVersion) els.aboutVersion.textContent = `v${appVersion}`;
  const { confirmAction } = createConfirmationDialogController({
    dialog: overlayElements.confirmationDialog,
    kicker: overlayElements.confirmationKicker,
    title: overlayElements.confirmationTitle,
    body: overlayElements.confirmationBody,
    cancelButton: overlayElements.confirmationCancel,
    confirmButton: overlayElements.confirmationConfirm,
  });
  const { confirmManualAiUsage } = createManualAiUsageNoticeController({
    confirmAction,
    readValue,
    writeValue,
    t,
  });
  let activityController;
  let contextMenu;
  let summaryView;
  let sitePreviews;
  let readerController;
  let settingsController;
  let headerCoverController;
  let dashboardController;
  let websiteShortcutsController;
  let libraryFeedbackTimer = 0;
  const activityActions = createActionPort([
    "actionKey", "defaultSeenSource", "findNewsItemByReference", "isQueued", "markOpenedItem",
    "matchesQuery", "openAndMarkReadingQueue", "openDailyItem", "openSummaryItem", "readingQueueItems",
    "toggleReadingQueue", "toggleSeen",
  ]);
  const readerActions = createActionPort(["openExternal", "openExternalWindow"]);
  const summaryActions = createActionPort(["createNewsRanker", "newsSummaryItems", "refreshSummaryItem"]);
  const cardTransition = createCardTransition({ exitMs: CARD_EXIT_MS, enterMs: CARD_ENTER_MS });

  const loadDashboard = (...args) => dashboardController.loadDashboard(...args);
  const triggerRefresh = (...args) => dashboardController.triggerRefresh(...args);
  const renderAll = (...args) => dashboardController.renderAll(...args);
  const renderTodayMeta = (...args) => dashboardController.renderTodayMeta(...args);
  const startTodayClock = (...args) => dashboardController.startTodayClock(...args);
  const {
    renderSectionFilters,
    renderCategoryFilters,
    renderCategories,
    displayBookmarkTitle,
    createBookmarkFavicon,
    createSeenButton,
    createReadingActions,
    createManualSummaryButton,
  } = createBookmarksView({
    state, els: dashboardElements, t, itemUrl, faviconUrl, createIcon, createThemedIcon, srOnly,
    groupItemsByKey,
    matchesQuery: activityActions.matchesQuery,
    createEmptyState, cardIconName, cardTone, setIconLabel, syncSegmentedIndicator,
    openExternal: readerActions.openExternal,
    contextAttachGroup: (...args) => contextMenu.attachGroup(...args),
    contextAttachLink: (...args) => contextMenu.attachLink(...args),
    contextAttachActions: (...args) => contextMenu.attachActions(...args),
    openBookmarkSettings: async () => {
      await settingsController.openSettings();
      settingsController.selectSettingsTab("bookmarks");
    },
    hideBookmarkCategory: saveHiddenBookmarkCategory,
    toggleSeen: activityActions.toggleSeen,
    defaultSeenSource: activityActions.defaultSeenSource,
    isQueued: activityActions.isQueued,
    actionKey: activityActions.actionKey,
    toggleReadingQueue: activityActions.toggleReadingQueue,
    refreshSummaryItem: summaryActions.refreshSummaryItem,
    allFilter: ALL_FILTER,
  });
  const {
    initializeAiProviderUi,
    prepareAiProviderUi,
    resetAiConsentForProviderChange,
    syncAiSetupControls,
    refreshAiSetupPermission,
    grantAiProviderOrigin,
    focusAiSetupRequirement,
    state: getAiSetupState,
    clearFeedback: clearAiSetupFeedback,
  } = createAiPermissionController({
    state, els: settingsElements, t, aiProviderOrigin, deriveAiSetupControlState,
    aiSetupStage: AI_SETUP_STAGE,
    settingsBusy: () => settingsController?.isBusy() === true,
    renderSettingsStatus: (...args) => settingsController.renderSettingsStatus(...args),
  });
  initializeAiProviderUi();
  const {
    renderInitialLoadingState,
    renderStatus,
    renderOverviewStatus,
    renderConnectionError,
  } = createStatusView({
    state, els: statusElements, t, tc, formatDateTime, localizedStatusMessage, localizedErrorMessage,
    setIconLabel, createEmptyState,
  });
  const {
    syncViewportMetrics,
    syncNavExpandedWidth,
    syncBookmarkSectionVisibility,
    handleGlobalSearchTyping,
    focusDashboardSearch,
    initializePointerHighlights,
    initializeScrollSpy,
    syncNavToCurrentSection,
    setActiveNavButton,
    resetToDailyView,
    getCurrentSectionButton,
  } = createShellController({ state, els: shellElements });
  const syncBookmarkSectionControls = (settings = {}) => {
    els.bookmarkSectionEnabledInput.checked = settings.bookmarkSectionEnabled !== false;
    syncBookmarkSectionVisibility(settings);
  };
  const dailyView = createDailyView({
    state, els: dashboardElements, t, tc, itemUrl, displayTitle, displaySummaryTitle, summaryText,
    createEmptyState, createIcon, createThemedIcon, createReadingActions,
    createBookmarkFavicon,
    contextAttachLink: (...args) => contextMenu.attachLink(...args),
    openDailyItem: activityActions.openDailyItem,
    toggleSeen: activityActions.toggleSeen,
    defaultSeenSource: activityActions.defaultSeenSource,
    newsSummaryItems: summaryActions.newsSummaryItems,
    inspirationPreviews: {
      fingerprint: (...args) => sitePreviews.fingerprint(...args),
      get: (...args) => sitePreviews.get(...args),
      reject: (...args) => sitePreviews.reject(...args),
      request: (...args) => sitePreviews.request(...args),
      preload: (...args) => sitePreviews.preload(...args),
    },
    apiGet, normalizeUrl, isHttpUrl, faviconUrl, hostFromUrl, formatDateTime,
    writeValue, writeJson, readJson, pageForItems, shuffle,
    dailyNewsCount: DAILY_NEWS_COUNT, dailyNewsBatchLimit: DAILY_NEWS_BATCH_LIMIT,
    dailyInspirationCount: DAILY_INSPIRATION_COUNT,
    dailyInspirationBatchLimit: DAILY_INSPIRATION_BATCH_LIMIT,
    updateInspirationPreloadTimeoutMs: UPDATE_INSPIRATION_PRELOAD_TIMEOUT_MS,
    dailyBoardCardSelector: DAILY_BOARD_CARD_SELECTOR, newsCardType: NEWS_CARD_TYPE,
    inspirationCardType: INSPIRATION_CARD_TYPE, bookmarkCardType: BOOKMARK_CARD_TYPE,
    createNewsRanker: summaryActions.createNewsRanker,
    createSeenButton, displayBookmarkTitle, localizedCategory,
    mergeRankedUnique, selectTodayNewsItems, selectUnseenPool,
    openExternal: readerActions.openExternal,
    persistSeen: () => writeJson(
      state.settings?.retainSeenArchive === true ? "dash.seen.retained" : `dash.seen.${state.day}`,
      Array.from(state.seen).map((key) => ({ key, ...(state.seenMeta.get(key) || {}) })).slice(-150),
    ),
    renderAll, renderTodayMeta, setIconLabel, localizedStatusMessage, cardTransition,
  });
  const {
    renderDaily, animateCardsIn, animateCardsOut, batchLabel, canReuseCard,
    clearCardAnimationState, isNewsCard, newsSectionName, prefersReducedMotion,
    setCardItemIdentity, activateCardFromKeyboard, preloadDailyInspiration,
    preloadBrowserImage, updateVisibleInspirationThumbs,
  } = dailyView;
  const {
    renderSummaries,
    newsSummaryItems,
    updateSummaryCard,
    reshuffleSummaries,
    updateVisibleNewsThumbs,
  } = summaryView = createSummaryView({
    state, els: dashboardElements, t, tc, apiPost, confirmManualAiUsage, isDisplayableFeedItem, itemUrl, displaySummaryTitle,
    summaryDetailLines, cleanSummaryLines, isCorrectlySummarized, localizedCategory,
    localizedSourceLabel, localizedResponseMessage, localizedErrorMessage,
    formatDateTime, faviconUrl, hostFromUrl, createIcon, createThemedIcon,
    createReadingActions, createManualSummaryButton,
    attachLinkContextMenu: (...args) => contextMenu.attachLink(...args),
    activateCardFromKeyboard,
    matchesQuery: activityActions.matchesQuery,
    findNewsItemByReference: activityActions.findNewsItemByReference,
    createPriorityRanker, mergeRankedUnique, selectUnseenPool,
    shuffle, pageForItems, newsCardType: NEWS_CARD_TYPE,
    hotSummaryPageSize: HOT_SUMMARY_PAGE_SIZE,
    summaryCardSelector: SUMMARY_CARD_SELECTOR,
    summaryDetailMaxLength: SUMMARY_DETAIL_MAX_LENGTH,
    cardSummaryEnabled,
    ...cardTransition, batchLabel,
    createEmptyState, isNewsCard, loadDashboard, newsSectionName,
    openSummaryItem: activityActions.openSummaryItem,
    prefersReducedMotion, renderOverviewStatus, renderStatus, setCardItemIdentity,
    syncSegmentedIndicator, triggerRefresh, writeValue,
    newsPreviews: {
      fingerprint: (item) => sitePreviews.fingerprint(newsPreviewItem(item)),
      get: (item) => sitePreviews.get(newsPreviewItem(item)),
      reject: (item, imageUrl) => sitePreviews.reject(newsPreviewItem(item), imageUrl),
      request: (item) => sitePreviews.request(newsPreviewItem(item)),
    },
  });
  summaryActions.bind(summaryView);
  const {
    renderEfficiencyPanel,
    refreshDailyDigest,
    invalidateWeather,
  } = createEfficiencyView({
    state, els: dashboardElements, t, tc, apiPost, confirmManualAiUsage, createEmptyState, createIcon, createThemedIcon,
    localizedStatusMessage, localizedResponseMessage, localizedErrorMessage,
    displaySummaryTitle, itemUrl, formatDateTime,
    readingQueueItems: activityActions.readingQueueItems,
    openAndMarkReadingQueue: activityActions.openAndMarkReadingQueue,
    openDailyItem: activityActions.openDailyItem,
    renderStatus, createBookmarkFavicon, displayBookmarkTitle,
    findNewsItemByReference: activityActions.findNewsItemByReference,
    hostFromUrl, isNewsCard,
    openExternal: readerActions.openExternal,
    readingQueueOpenOnReadAll: () => state.settings?.readingQueueOpenOnReadAll !== false,
    attachLinkContextMenu: (...args) => contextMenu.attachLink(...args),
    renderDaily, renderOverviewStatus, renderSummaries, selectDailyEvents, setIconLabel,
    openAiSettings,
    getLocale, writeJson, writeValue, requestWeatherPermissions,
  });
  const {
    readingQueueItems,
    openAndMarkReadingQueue,
    findNewsItemByReference,
    isQueued,
    actionKey,
    toggleReadingQueue,
    openDailyItem,
    openSummaryItem,
    matchesQuery,
    toggleSeen,
    markOpenedItem,
    dismissItem,
    sendFeedback,
    retainSeenArchiveEnabled,
    syncSeenArchiveRetention,
    defaultSeenSource,
    seenKey,
    readSeenRecords,
    replaceSeenRecords,
    applyReadingQueueUpdate,
  } = activityController = createActivityController({
    state,
    itemUrl,
    openExternalWindow: readerActions.openExternalWindow,
    openExternal: readerActions.openExternal,
    renderAll,
    renderEfficiencyPanel,
    newsSummaryItems,
    hostFromUrl,
    t,
    newsSectionName,
    newsCardType: NEWS_CARD_TYPE,
    findNewsItemReference,
    isNewsCard,
    displaySummaryTitle,
    displayTitle,
    displayBookmarkTitle,
    summaryText,
    createThemedIcon,
    srOnly,
    writeJson,
    readJson,
    apiPost,
    confirmAction,
  });
  activityActions.bind(activityController);
  const {
    backFloatingWeb,
    closeFloatingWeb,
    openExternal,
    openExternalWindow,
    reloadFloatingWeb,
  } = readerController = createReaderController({
    state,
    els: overlayElements,
    t,
    apiGet,
    apiPost,
    confirmManualAiUsage,
    markOpenedItem,
    renderEfficiencyPanel,
    syncNavToCurrentSection,
    toggleSeen,
    actionKey,
    defaultSeenSource,
    localizedErrorMessage,
  });
  readerActions.bind(readerController);
  const syncSearchCopy = (options = {}) => syncSearchCopyView({ state, els, t, ...options });
  const {
    open: openAiSearch,
    close: closeAiSearch,
    run: runAiSearch,
  } = createAiSearchController({
    state,
    els: overlayElements,
    t,
    apiPost,
    confirmManualAiUsage,
    clearTopSearchFilter,
    syncNavToCurrentSection,
    localizedResponseMessage,
    localizedErrorMessage,
    openExternal,
    requestWebsitePermission,
    syncSearchCopy,
  });
  contextMenu = createContextMenuController({
    menu: els.linkContextMenu,
    t,
    aiEnabled: () => state.data?.ai?.enabled === true,
    personalizationEnabled: () => state.settings?.personalizedRankingEnabled !== false,
    explain: (url) => openAiSearch(url, true),
    markOpened: markOpenedItem,
    openExternal: openExternalWindow,
    sendFeedback,
    dismiss: dismissItem,
    itemUrl,
  });
  const {
    syncControls: syncAppearanceControls,
    syncFullscreenControl: syncHeaderImageFullscreenControl,
    syncBlurControl: syncHeaderImageBlurControl,
    syncHeightControl: syncHeaderImageHeightControl,
    updatePreview: updateAppearancePreview,
    selectHeaderImageLayout,
    payload: appearancePayload,
    selectedUiLocale,
    selectedColorMode,
    selectedAccentTheme,
    syncLanguageControls,
    applyLocale: applyUiLocale,
    applySettings: applyAppearanceSettings,
    handleHeaderImageLoad,
    handleHeaderImageError,
    syncHeaderImageLoadState,
  } = createAppearanceController({
    state,
    els: appearanceElements,
    renderSettingsStatus: (...args) => settingsController.renderSettingsStatus(...args),
    renderTodayMeta,
    renderAll,
    syncNavExpandedWidth,
    syncAiSetupControls,
    syncHeaderCoverControls: () => headerCoverController?.syncControls(),
    syncSegmentedIndicator,
  });
  const coverBlurPreview = createCoverBlurPreviewController({
    modal: els.settingsModal,
    input: els.headerImageBlurAmountInput,
  });
  const coverHeightPreview = createCoverBlurPreviewController({
    modal: els.settingsModal,
    input: els.headerImageHeightInput,
    previewClass: "is-cover-height-previewing",
  });
  headerCoverController = createHeaderCoverController({
    state,
    els: settingsElements,
    t,
    apiGet,
    updatePreview: updateAppearancePreview,
    renderSettingsStatus: (...args) => settingsController.renderSettingsStatus(...args),
    setSettingsBusy: (...args) => settingsController.setSettingsBusy(...args),
  });
  const {
    currentExcludedNewsSources,
    availableNewsFolders,
    renderExcludeFolderOptions,
    addNewsExclusion,
    addNewsFolderExclusion,
    clearSourceSuggestions,
    blockAllSourceSuggestions,
    renderExclusionList,
    renderSourceSuggestionList,
    syncSourceSuggestionActionState,
  } = createSourceSettingsController({
    state,
    els: settingsElements,
    t,
    tc,
    apiPost,
    setIconLabel,
    createEmptyState,
    renderSettingsStatus: (...args) => settingsController.renderSettingsStatus(...args),
    runSettingsAction: (...args) => settingsController.runSettingsAction(...args),
    localizedResponseMessage,
    localizedErrorMessage,
    localizedSourceLabel,
    localizedSourceReason,
    localizedExclusionReason,
    formatDateTime,
    normalizeUrl,
    allTranslations,
    newsCardType: NEWS_CARD_TYPE,
    newsSectionName,
    confirmAction,
  });
  const {
    syncBookmarkFolderControls,
    syncBookmarkOnlyFolderControls,
    setNewsSourceSelection,
    setInspirationSourceSelection,
    syncPublicFeedSupplementControl,
    bookmarkSourcePayload,
    addBookmarkOnlyFolder,
    renderBookmarkOnlyFolderList,
    currentBookmarkOnlyFolders,
    renderHiddenBookmarkCategoryList,
  } = createBookmarkSettingsController({
    state,
    els: settingsElements,
    t,
    renderSettingsStatus: (...args) => settingsController.renderSettingsStatus(...args),
    setIconLabel,
  });
  const {
    syncWebsiteShortcutControls,
    websiteShortcutsPayload,
    renderWebsiteShortcuts,
    addOrUpdateWebsiteShortcut,
    cancelWebsiteShortcutEdit,
    setWebsiteShortcutControlsBusy,
    handleWebsiteShortcutsEnabledChange,
    refreshWebsiteShortcutTranslations,
  } = websiteShortcutsController = createWebsiteShortcutsController({
    state,
    els: { ...dashboardElements, ...settingsElements },
    t,
    faviconUrl,
    createThemedIcon,
    setIconLabel,
    normalizeWebsiteShortcutUrl,
    renderSettingsStatus: (...args) => settingsController.renderSettingsStatus(...args),
    attachLinkContextMenu: (...args) => contextMenu.attachLink(...args),
    saveWebsiteShortcutOrder: (websiteShortcuts) => apiPost("/api/settings", { websiteShortcuts }),
    localizedErrorMessage,
    openBrowserSettings: async () => {
      await settingsController.openSettings();
      settingsController.selectSettingsTab("bookmarks");
      els.websiteShortcutsEnabledInput.focus({ preventScroll: true });
      els.websiteShortcutsSettings.scrollIntoView({
        block: "center",
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      });
    },
    maxShortcuts: MAX_WEBSITE_SHORTCUTS,
    maxTitleLength: MAX_WEBSITE_SHORTCUT_TITLE_LENGTH,
    maxUrlLength: MAX_WEBSITE_SHORTCUT_URL_LENGTH,
  });

  function newsPreviewItem(item) {
    return item ? { ...item, title: displaySummaryTitle(item) } : item;
  }

  sitePreviews = createSitePreviewController({
    apiGet,
    normalizeUrl,
    isHttpUrl,
    isEnabled: () => state.settings?.bookmarkConsentGranted === true,
    canFallback: () => state.settings?.webImageSearchEnabled === true && state.settings?.hasImageSearchKey === true,
    preloadImage: preloadBrowserImage,
    isCurrent: (item, fingerprint) => {
      const current = isNewsCard(item)
        ? newsSummaryItems(false).find((candidate) => candidate.key === item.key)
        : (state.data?.bookmarks || []).find((candidate) => candidate.key === item.key);
      return sitePreviewFingerprint(isNewsCard(item) ? newsPreviewItem(current) : current, normalizeUrl) === fingerprint;
    },
    onImage: (item, imageUrl, fingerprint) => {
      if (isNewsCard(item)) updateVisibleNewsThumbs(item, imageUrl, fingerprint);
      else updateVisibleInspirationThumbs(item, imageUrl, fingerprint);
    },
  });
  const {
    loadSettings,
    saveSettings,
    grantSavedSourcePermissions,
    dismissSavedSourcePermissions,
    testKey,
    testImageSearchKey,
    clearImageSearchKey,
    clearKey,
    clearCache,
    resetQuota,
    resetPreferences,
    openSettings,
    focusSettingsStart,
    closeSettings,
    requestCloseSettings,
    resetSecretDrafts,
    setSettingsBusy,
    runSettingsAction,
    selectSettingsTab,
    renderSettingsStatus,
    captureSettingsSnapshot,
  } = settingsController = createSettingsController({
    state, els: settingsElements, t, apiGet, apiPost, confirmAction, confirmManualAiUsage, localizedResponseMessage, localizedErrorMessage,
    applyUiLocale, selectedUiLocale, syncLanguageControls, applyAppearanceSettings,
    syncAppearanceControls, renderExcludeFolderOptions, renderExclusionList,
    renderSourceSuggestionList,
    syncBookmarkFolderControls, syncBookmarkSectionControls, syncPublicFeedSupplementControl, syncWebsiteShortcutControls, syncAiSetupControls, refreshAiSetupPermission,
    prepareAiProviderUi,
    getAiSetupState, clearAiSetupFeedback, focusAiSetupRequirement,
    currentExcludedNewsSources, bookmarkSourcePayload, appearancePayload,
    snapshotSettingsDraft, cloneSettingsDraft, diffSettingsDraft, selectedColorMode,
    selectedAccentTheme, colorModeLabel, themeLabel, currentBookmarkOnlyFolders,
    syncSeenArchiveRetention, loadDashboard, triggerRefresh,
    renderStatus, renderEfficiencyPanel, renderAll, resetToDailyView,
    syncNavToCurrentSection, getLocale, setLocale,
    settingsSaveCloseDelayMs: SETTINGS_SAVE_CLOSE_DELAY_MS,
    settingsCloseMotionMs: SETTINGS_CLOSE_MOTION_MS,
    inspirationPreviews: sitePreviews, syncHeaderImageFullscreenControl, syncHeaderImageBlurControl, syncHeaderImageHeightControl,
    headerCoverController, availableNewsFolders,
    syncSourceSuggestionActionState, syncSegmentedIndicator, isHttpUrl,
    websiteShortcutsPayload, setWebsiteShortcutControlsBusy,
    aiSetupStage: AI_SETUP_STAGE,
    requestSourcePermissions, revealActiveSettingsTab,
  });
  const { exportSettings, importSettingsFile, factoryReset } = createSettingsTransferController({
    els: settingsElements, state, t, apiGet, apiPost, confirmAction, localizedErrorMessage,
    runSettingsAction, renderSettingsStatus, loadSettings, captureSettingsSnapshot, resetSecretDrafts,
    applyUiLocale, getLocale, inspirationPreviews: sitePreviews, loadDashboard, triggerRefresh,
    parseSettingsTransferText, settingsTransferFilename,
    maxSettingsTransferBytes: MAX_SETTINGS_TRANSFER_BYTES,
    resetExtensionPage,
  });
  dashboardController = createDashboardController({
    state, els: { ...dashboardElements, settingsRefresh: settingsElements.settingsRefresh }, t, apiGet, apiPost, preloadDailyInspiration,
    inspirationPreloadTimeoutMs: UPDATE_INSPIRATION_PRELOAD_TIMEOUT_MS,
    renderConnectionError, renderStatus, renderOverviewStatus, localizedErrorMessage,
    renderExclusionList, renderExcludeFolderOptions,
    renderTodayMetaValue: renderTodayMetaValue,
    renderWebsiteShortcuts, renderEfficiencyPanel, renderDaily, renderSummaries, renderSectionFilters,
    renderCategoryFilters, renderCategories, formatTodayMeta, getTodayKey,
    readNumber, writeJson, retainSeenArchiveEnabled, readSeenRecords, replaceSeenRecords,
    canRefresh: () => refreshAvailability(state.data).available,
    syncSearchCopy,
  });

  function renderTodayMetaValue(value) {
    els.todayMeta.dateTime = value.dateTime;
    els.todayMeta.setAttribute("aria-label", value.label);
    for (const part of ["date", "weekday", "time"]) {
      const target = els.todayMeta.querySelector(`[data-today-part="${part}"]`);
      if (target) target.textContent = value[part];
    }
  }

  setLocale(getLocale(), { persist: false });
  hydrateIcons(document);
  let searchRenderFrame = 0;

  if ("scrollRestoration" in history) history.scrollRestoration = "manual";

  return {
    start: initialize,
    handleRuntimeMessage,
    handleFaviconPermissionChanged,
    openAiSettings,
  };

  function handleRuntimeMessage(detail) {
    if (detail?.type === "settings.factory-reset") {
      resetExtensionPage();
      return;
    }
    if (detail?.type === "content-sync.changed") {
      const values = detail.payload?.values;
      applyExternalStoragePatch(values);
      if (Object.hasOwn(values || {}, "dash.readingQueue")) {
        applyReadingQueueUpdate(normalizeReadingQueueRecords(readJson("dash.readingQueue", [])));
      }
      if (Object.hasOwn(values || {}, TODO_ITEMS_KEY)) {
        state.todos = normalizeTodoItems(readJson(TODO_ITEMS_KEY, []));
        renderEfficiencyPanel();
      }
      if (Object.hasOwn(values || {}, WEATHER_LOCATION_KEY)) {
        state.weatherLocation = normalizeWeatherLocation(readJson(WEATHER_LOCATION_KEY, null));
        invalidateWeather();
        renderEfficiencyPanel();
      }
    }
    if (detail?.type === "reading-queue.changed") {
      applyReadingQueueUpdate(detail.payload?.records, detail.payload?.reopenedKeys);
    }
    if (detail?.type === "dashboard.updated") {
      if (detail?.payload?.reason === "cache-cleared") invalidateWeather();
      loadDashboard();
    }
    if (detail?.type === "settings.changed") {
      if (detail?.payload?.permissionsChanged || detail?.payload?.bookmarkSourceChanged || detail?.payload?.imageSearchChanged) {
        sitePreviews.invalidate();
      }
      if (detail?.payload?.permissionsChanged) invalidateWeather();
      if (els.settingsModal.classList.contains("open")) {
        sitePreviews.invalidate();
        if (detail?.payload?.permissionsChanged) refreshAiSetupPermission({ focusOnLock: true });
        if (detail?.payload?.headerCoverChanged) {
          if (headerCoverController.hasChanges()) headerCoverController.markExternalChange();
          else headerCoverController.load().then((loaded) => {
            if (loaded) applyAppearanceSettings(state.settings);
          });
        }
        loadDashboard();
        return;
      }
      loadSettings().then(() => {
        return loadDashboard();
      });
    }
    if (detail?.type === "refresh.progress" && state.data) {
      state.data.status = detail.payload;
      renderStatus();
      renderDaily();
    }
  }

  function handleFaviconPermissionChanged() {
    if (state.data) renderAll();
  }

  function revealActiveSettingsTab() {
    if (!els.settingsModal.classList.contains("open")) return;
    els.settingsTabs.querySelector("button.active")?.scrollIntoView({
      block: "nearest", inline: "nearest", behavior: "auto",
    });
  }

  async function initialize() {
    syncViewportMetrics();
    resetToDailyView();
    bindEvents();
    startTodayClock();
    const initialLoadingMotion = renderInitialLoadingState();
    try {
      await Promise.all([
        globalThis.ampiraLayoutBootstrap?.websiteShortcutsReady,
        globalThis.ampiraLayoutBootstrap?.headerCoverReady,
        loadSettings(),
        loadDashboard({ render: false }),
      ]);
    } finally {
      initialLoadingMotion?.finish();
    }
    renderAll();
    preloadDailyInspiration(UPDATE_INSPIRATION_PRELOAD_TIMEOUT_MS);
    syncSegmentedIndicators();
    resetToDailyView();
    triggerRefresh(false);
  }

  function bindEvents() {
    initializePointerHighlights();
    initializeScrollSpy();
    bindAiPermissionEvents();
    coverBlurPreview.bind();
    coverHeightPreview.bind();
    headerCoverController.bind();
    syncNavExpandedWidth();
    document.fonts?.ready?.then(syncNavExpandedWidth).catch(() => {});
    window.addEventListener("resize", () => {
      syncViewportMetrics();
      syncSegmentedIndicators();
      syncNavExpandedWidth();
      window.requestAnimationFrame(revealActiveSettingsTab);
    });
    window.visualViewport?.addEventListener("resize", syncViewportMetrics);
    contextMenu.bind();
    document.addEventListener("keydown", handleGlobalSearchTyping);

    document.querySelector("#navLogo")?.addEventListener("click", (event) => {
      const logo = event.currentTarget;
      logo.classList.remove("is-returning");
      void logo.offsetWidth;
      logo.classList.add("is-returning");
      logo.addEventListener("animationend", () => logo.classList.remove("is-returning"), { once: true });
      window.scrollTo({
        top: 0,
        left: 0,
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      });
      setActiveNavButton(document.querySelector("[data-scroll='daily']"));
    });

    document.querySelectorAll("[data-scroll]").forEach((button) => {
      button.addEventListener("click", () => {
        document.getElementById(button.dataset.scroll)?.scrollIntoView({ behavior: "smooth", block: "start" });
        setActiveNavButton(button);
      });
    });

    document.querySelector("#settingsNav").addEventListener("click", openSettings);
    els.aiSearchNav.addEventListener("click", () => openAiSearch());
    els.closeSettings.addEventListener("click", requestCloseSettings);
    els.settingsModal.addEventListener("click", (event) => {
      if (event.target === els.settingsModal) requestCloseSettings();
    });
    els.aiSearchOverlay.addEventListener("click", (event) => {
      if (!els.aiSearchOverlay.classList.contains("open")) return;
      if (event.target.closest(".ai-search-form, .ai-answer")) return;
      closeAiSearch();
    });
    els.closeWebFrame.addEventListener("click", closeFloatingWeb);
    els.webFrameOverlay.addEventListener("click", (event) => {
      if (event.target === els.webFrameOverlay) closeFloatingWeb();
    });
    els.reloadWebFrame.addEventListener("click", reloadFloatingWeb);
    els.openWebFrameExternal.addEventListener("click", () => {
      if (!state.webFrameUrl) return;
      if (state.webFrameItem) markOpenedItem(state.webFrameItem);
      openExternalWindow(state.webFrameUrl);
    });
    els.webFrameFavicon.addEventListener("error", () => {
      if (els.webFrameFavicon.src.endsWith("/favicon.svg")) return;
      els.webFrameFavicon.src = "favicon.svg";
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !els.linkContextMenu.hidden) {
        contextMenu.hide();
        return;
      }
      if (event.key !== "Escape") return;
      if (els.confirmationDialog.open) return;
      if (els.webFrameOverlay.classList.contains("open")) {
        closeFloatingWeb();
        return;
      }
      if (els.aiSearchOverlay.classList.contains("open")) {
        closeAiSearch();
        return;
      }
      if (els.settingsModal.classList.contains("open")) requestCloseSettings();
    });
    els.settingsForm.addEventListener("submit", (event) => {
      event.preventDefault();
      saveSettings();
    });
    els.aiSearchForm.addEventListener("submit", (event) => {
      event.preventDefault();
      runAiSearch(els.aiSearchInput.value);
    });

    els.search.addEventListener("input", () => {
      if (browserSearchEnabled()) return;
      state.query = els.search.value.trim().toLowerCase();
      scheduleSearchRender();
    });
    els.search.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.isComposing) {
        const query = els.search.value.trim();
        if (!query) return;
        event.preventDefault();
        if (browserSearchEnabled()) {
          runBrowserSearch(query);
          return;
        }
        openAiSearch(query, true);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        clearTopSearchFilter();
      }
    });
    els.topAiSearch?.addEventListener("click", () => {
      const query = els.search.value.trim();
      if (browserSearchEnabled()) {
        if (!query) els.search.focus({ preventScroll: true });
        else runBrowserSearch(query);
        return;
      }
      openAiSearch(query, Boolean(query));
    });
    window.addEventListener("ampira:browser-search-permission-changed", (event) => {
      applyBrowserSearchPermission(event.detail?.granted === true);
    });

    els.sectionFilter.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-section]");
      if (!button) return;
      if (state.filter === button.dataset.section) return;
      state.filter = button.dataset.section;
      state.categoryFilter = ALL_FILTER;
      for (const item of els.sectionFilter.querySelectorAll("button")) item.classList.toggle("active", item === button);
      renderCategoryFilters();
      renderCategories();
      syncSegmentedIndicator(els.sectionFilter, button);
      syncSegmentedIndicator(els.categoryFilter);
    });

    els.categoryFilter.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-category]");
      if (!button) return;
      state.categoryFilter = button.dataset.category;
      for (const item of els.categoryFilter.querySelectorAll("button")) item.classList.toggle("active", item === button);
      renderCategories();
      syncSegmentedIndicator(els.categoryFilter, button);
    });

    els.refresh.addEventListener("click", () => triggerRefresh(true));
    els.settingsRefresh.addEventListener("click", () => triggerRefresh(true));
    els.summaryBatch.addEventListener("click", reshuffleSummaries);
    els.summaryOrder.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-order]");
      if (!button) return;
      state.summaryOrder = button.dataset.order;
      state.variants.summary = 0;
      writeValue("dash.summary.order", state.summaryOrder);
      writeValue(`dash.variant.${state.day}.summary`, "0");
      renderSummaries();
      syncSegmentedIndicator(els.summaryOrder, button);
    });
    els.settingsTabs.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-settings-tab]");
      if (!button) return;
      selectSettingsTab(button.dataset.settingsTab);
    });
    els.settingsOverviewAction.addEventListener("click", () => {
      selectSettingsTab("service");
      focusSettingsStart({ reveal: true });
    });
    els.uiLocaleSelect.addEventListener("change", () => {
      applyUiLocale(els.uiLocaleSelect.value, { persist: false });
      renderSettingsStatus();
    });
    els.newsBookmarkFolderSelect.addEventListener("change", () => {
      setNewsSourceSelection(els.newsBookmarkFolderSelect.value);
    });
    els.inspirationBookmarkFolderSelect.addEventListener("change", () => {
      setInspirationSourceSelection(els.inspirationBookmarkFolderSelect.value);
    });
    els.addBookmarkOnlyFolder.addEventListener("click", addBookmarkOnlyFolder);
    els.bookmarkOnlyFolderSelect.addEventListener("change", () => renderSettingsStatus());
    els.websiteShortcutsEnabledInput.addEventListener("change", handleWebsiteShortcutsEnabledChange);
    els.addWebsiteShortcut.addEventListener("click", addOrUpdateWebsiteShortcut);
    els.cancelWebsiteShortcutEdit.addEventListener("click", cancelWebsiteShortcutEdit);
    for (const input of [els.websiteShortcutTitleInput, els.websiteShortcutUrlInput]) {
      input.addEventListener("input", () => renderSettingsStatus());
      input.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" || event.isComposing) return;
        event.preventDefault();
        addOrUpdateWebsiteShortcut();
      });
    }
    els.colorModeGroup.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-color-mode]");
      if (!button) return;
      updateAppearancePreview({ colorMode: button.dataset.colorMode });
      syncSegmentedIndicator(els.colorModeGroup, button);
    });
    els.accentThemeGroup.addEventListener("click", (event) => {
      const swatch = event.target.closest("[data-accent-theme]");
      if (!swatch) return;
      updateAppearancePreview({ accentTheme: swatch.dataset.accentTheme });
    });
    els.accentThemeGroup.addEventListener("keydown", (event) => {
      const swatch = event.target.closest("[data-accent-theme]");
      if (!swatch || (event.key !== "Enter" && event.key !== " ")) return;
      event.preventDefault();
      updateAppearancePreview({ accentTheme: swatch.dataset.accentTheme });
      if (swatch.dataset.accentTheme === "custom") els.customAccentInput.click();
    });
    els.customAccentInput.addEventListener("input", () => updateAppearancePreview({ accentTheme: "custom" }));
    els.pointerGlowEnabledInput.addEventListener("change", () => updateAppearancePreview());
    els.headerImageEnabledInput.addEventListener("change", () => updateAppearancePreview());
    els.headerImageBlurAmountInput.addEventListener("input", () => updateAppearancePreview());
    els.headerImageHeightInput.addEventListener("input", () => updateAppearancePreview());
    els.headerImageLayoutGroup.addEventListener("click", (event) => {
      const button = event.target.closest("[data-header-image-layout]");
      if (!button || button.disabled) return;
      selectHeaderImageLayout(button.dataset.headerImageLayout);
      updateAppearancePreview();
    });
    els.headerImageUrlInput.addEventListener("input", () => updateAppearancePreview());
    els.headerImage.addEventListener("load", handleHeaderImageLoad);
    els.headerImage.addEventListener("error", handleHeaderImageError);
    syncHeaderImageLoadState();
    els.readingQueueOpenOnReadAllInput.addEventListener("change", () => {
      state.settings = { ...(state.settings || {}), readingQueueReadAllPrompted: true };
    });
    els.contentSyncEnabledInput.addEventListener("change", () => {
      setAllContentSyncControls(els, els.contentSyncEnabledInput.checked);
      renderSettingsStatus();
    });
    [els.syncReadingQueueEnabledInput, els.syncTodosEnabledInput, els.syncWeatherLocationEnabledInput].forEach((input) => {
      input.addEventListener("change", () => { syncContentSyncMaster(els); renderSettingsStatus(); });
    });
    els.webImageSearchEnabledInput.addEventListener("change", () => {
      setDisclosureVisibility(els.imageSearchStrategy, els.webImageSearchEnabledInput.checked);
    });
    [els.apiBaseUrlInput, els.apiStyleSelect, els.modelInput, els.dailyLimitInput, els.imageSearchApiKeyInput, els.aiDisclosureConsent, els.webImageSearchEnabledInput, els.cardSummaryEnabledInput, els.cacheSizeInput, els.hotNewsPerSourceInput, els.newsPerCategoryInput, els.bookmarkSectionEnabledInput, els.floatingOpenInput, els.readingQueueOpenOnReadAllInput, els.retainSeenArchiveInput, els.personalizedRankingEnabledInput, els.publicFeedSupplementEnabledInput].forEach((input) => {
      input.addEventListener("input", () => renderSettingsStatus());
      input.addEventListener("change", () => renderSettingsStatus());
    });
    els.apiBaseUrlInput.addEventListener("input", () => {
      clearAiSetupFeedback();
      resetAiConsentForProviderChange();
      refreshAiSetupPermission();
    });
    els.apiKeyInput.addEventListener("input", syncAiSetupControls);
    els.modelInput.addEventListener("input", syncAiSetupControls);
    els.aiDisclosureConsent.addEventListener("change", () => {
      clearAiSetupFeedback();
      refreshAiSetupPermission();
    });
    els.grantAiOrigin.addEventListener("click", grantAiProviderOrigin);
    document.addEventListener("ampira:locale-changed", refreshWebsiteShortcutTranslations);
    document.addEventListener("ampira:locale-changed", () => {
      renderBookmarkOnlyFolderList();
      renderHiddenBookmarkCategoryList();
    });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) return;
      refreshAiSetupPermission({ focusOnLock: true });
      loadDashboard();
    });
    window.addEventListener("focus", () => refreshAiSetupPermission({ focusOnLock: true }));
    els.addExclude.addEventListener("click", addNewsExclusion);
    els.addExcludeFolder.addEventListener("click", addNewsFolderExclusion);
    els.clearSourceSuggestions.addEventListener("click", clearSourceSuggestions);
    els.blockAllSuggestions.addEventListener("click", blockAllSourceSuggestions);
    els.excludeFolderSelect.addEventListener("change", () => renderSettingsStatus());
    els.excludeInput.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      addNewsExclusion();
    });
    els.saveSettings.addEventListener("click", saveSettings);
    els.grantSavedSourcePermissions.addEventListener("click", grantSavedSourcePermissions);
    els.dismissSavedSourcePermissions.addEventListener("click", dismissSavedSourcePermissions);
    els.testKey.addEventListener("click", testKey);
    els.clearKey.addEventListener("click", clearKey);
    els.testImageSearchKey.addEventListener("click", testImageSearchKey);
    els.clearImageSearchKey.addEventListener("click", clearImageSearchKey);
    els.clearCache.addEventListener("click", clearCache);
    els.resetQuota.addEventListener("click", resetQuota);
    els.resetPreferences.addEventListener("click", resetPreferences);
    els.exportSettings.addEventListener("click", exportSettings);
    els.importSettings.addEventListener("click", () => els.settingsImportFile.click());
    els.factoryResetSettings.addEventListener("click", factoryReset);
    els.settingsImportFile.addEventListener("change", importSettingsFile);
  }

  function bindAiPermissionEvents() {
    globalThis.chrome?.permissions?.onAdded?.addListener(() => {
      refreshAiSetupPermission();
      loadDashboard();
    });
    globalThis.chrome?.permissions?.onRemoved?.addListener(() => {
      refreshAiSetupPermission({ focusOnLock: true });
      loadDashboard();
    });
  }

  function requestWebsitePermission(rawUrl) {
    if (!globalThis.chrome?.permissions?.request) return Promise.resolve(false);
    try {
      const input = String(rawUrl || "").trim();
      const url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(input) ? input : `https://${input}`);
      const isLocalHttp = url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname);
      if (url.protocol !== "https:" && !isLocalHttp) return Promise.resolve(false);
      return requestOrigins([`${url.origin}/*`]);
    } catch {
      return Promise.resolve(false);
    }
  }

  function requestSourcePermissions(origins) {
    if (!globalThis.chrome?.permissions?.request) return Promise.resolve(false);
    const requested = exactPermissionOrigins(origins);
    if (!requested.length) return Promise.resolve(false);
    return requestOrigins(requested);
  }

  function requestWeatherPermissions() {
    if (!globalThis.chrome?.permissions?.request) return Promise.resolve(false);
    return requestOrigins(WEATHER_ORIGINS.map((origin) => `${origin}/*`));
  }

  async function openAiSettings() {
    await settingsController.openSettings();
    settingsController.selectSettingsTab("service");
    settingsController.focusSettingsStart({ reveal: true });
  }

  async function saveHiddenBookmarkCategory(section, category, sectionKey = "", categoryKey = "") {
    const hiddenBookmarkCategories = addHiddenBookmarkCategory(state.settings, section, category, sectionKey, categoryKey);
    if (hiddenBookmarkCategories.length === (state.settings?.hiddenBookmarkCategories || []).length) return;
    try {
      const savedSettings = await apiPost("/api/settings", { hiddenBookmarkCategories });
      state.settings = savedSettings;
      if (state.filter === section && state.categoryFilter === category) state.categoryFilter = ALL_FILTER;
      renderCategoryFilters();
      renderCategories();
      requestAnimationFrame(() => {
        els.categoryFilter.querySelector("button.active")?.focus({ preventScroll: true });
      });
      announceLibraryFeedback("bookmarks.categoryHidden", { category });
    } catch (error) {
      announceLibraryFeedback("bookmarks.categoryHideFailed", {
        message: localizedErrorMessage(error),
      }, true);
    }
  }

  function announceLibraryFeedback(key, params = {}, visibleError = false) {
    if (libraryFeedbackTimer) window.clearTimeout(libraryFeedbackTimer);
    els.libraryFeedback.textContent = t(key, params);
    els.libraryFeedback.classList.toggle("is-visible-error", visibleError);
    libraryFeedbackTimer = window.setTimeout(() => {
      els.libraryFeedback.textContent = "";
      els.libraryFeedback.classList.remove("is-visible-error");
      libraryFeedbackTimer = 0;
    }, visibleError ? 6000 : 2500);
  }

  function clearTopSearchFilter() {
    if (!els.search.value && !state.query) return;
    if (searchRenderFrame) cancelAnimationFrame(searchRenderFrame);
    searchRenderFrame = 0;
    els.search.value = "";
    state.query = "";
    renderWebsiteShortcuts();
    renderDaily();
    renderSummaries();
    renderCategories();
  }

  function resetExtensionPage() {
    try {
      globalThis.localStorage?.clear();
    } catch {
      // The cleared extension storage remains authoritative if page storage is unavailable.
    }
    const target = new URL("dashboard.html", globalThis.location.href);
    globalThis.location.replace(target.href);
  }

  function browserSearchEnabled() {
    return state.settings?.browserSearchEnabled === true;
  }

  function applyBrowserSearchPermission(granted) {
    const enabled = granted === true;
    const changed = browserSearchEnabled() !== enabled;
    state.settings = { ...(state.settings || {}), browserSearchEnabled: enabled };
    if (changed) clearTopSearchFilter();
    syncSearchCopy();
  }

  async function runBrowserSearch(query) {
    try {
      await apiPost("/api/browser/search", { query });
    } catch (error) {
      announceLibraryFeedback("search.browser.failed", {
        message: localizedErrorMessage(error),
      }, true);
    }
  }

  function scheduleSearchRender() {
    if (searchRenderFrame) return;
    searchRenderFrame = requestAnimationFrame(() => {
      searchRenderFrame = 0;
      renderWebsiteShortcuts();
      renderDaily();
      renderSummaries();
      renderCategories();
      syncNavToCurrentSection();
    });
  }

  function syncSegmentedIndicators() {
    syncSegmentedIndicator(els.summaryOrder);
    syncSegmentedIndicator(els.sectionFilter);
    syncSegmentedIndicator(els.categoryFilter);
    syncSegmentedIndicator(els.colorModeGroup);
    syncSegmentedIndicator(els.headerImageLayoutGroup);
  }

  function cardSummaryEnabled() {
    return state.data?.ai?.enabled === true
      && state.settings?.cardSummaryEnabled !== false
      && state.data?.ai?.cardSummaryEnabled !== false;
  }
}
