import { sendExtensionRequest as request } from "./api.mjs";
import { srOnly } from "./dom.mjs";
import { getElementGroups } from "./elements.mjs";
import { createIcon, createThemedIcon, hydrateIcons } from "./icons.mjs";
import { allTranslations, getLocale, prepareLocale, setLocale, t, tc } from "./i18n.mjs";
import { applyExternalStoragePatch, hydrateStorage, readJson, readNumber, readValue, writeJson, writeValue } from "./storage.mjs";
import { createInitialState } from "./state.mjs";
import { formatDateTime, formatTodayMeta, getTodayKey } from "./time.mjs";
import { faviconUrl, hostFromUrl, isHttpUrl, normalizeUrl } from "./urls.mjs";
import { findNewsItemByReference as findNewsItemReference } from "./dashboard-model.mjs";
import { groupItemsByKey, selectDailyEvents } from "./dashboard-selectors.mjs";
import { createReaderLauncher } from "./reader-launcher.mjs";
import { createBotModeController } from "./bot-mode-controller.mjs";
import { syncSearchCopy as syncSearchCopyView } from "./search-copy.mjs";
import { cloneSettingsDraft, diffSettingsDraft, snapshotSettingsDraft } from "./settings-draft.mjs";
import { createSitePreviewController } from "./inspiration-preview-controller.mjs";
import { AI_SETUP_STAGE, aiProviderOrigin, deriveAiSetupControlState } from "./ai-settings-policy.mjs";

import { displaySummaryTitle, displayTitle, itemUrl, summaryText } from "./item-presenter.mjs";
import { localizedCategory, localizedErrorMessage, localizedExclusionReason, localizedResponseMessage, localizedSourceLabel, localizedSourceReason, localizedStatusMessage } from "./localized-labels.mjs";
import { createContextMenuController } from "./context-menu-controller.mjs";
import { createAppearanceController } from "./appearance-controller.mjs";
import { createAccentColorPicker } from "./accent-color-picker.mjs";
import { createCoverBlurPreviewController } from "./cover-blur-preview-controller.mjs";
import { createHeaderCoverController } from "./header-cover-controller.mjs";
import { createSourceSettingsController } from "./source-settings-controller.mjs";
import { createBookmarkSettingsController } from "./bookmark-settings-controller.mjs";
import { hideBookmarkCategory as addHiddenBookmarkCategory, isBookmarkSectionVisible } from "./bookmark-visibility.mjs";
import { createWebsiteShortcutsController } from "./website-shortcuts-controller.mjs";
import { createActivityController } from "./activity-controller.mjs";
import { createSummaryView } from "./summary-view.mjs";
import { createEfficiencyView } from "./efficiency-view.mjs";
import { createDailyView } from "./daily-view.mjs";
import { createDashboardLayoutController } from "./dashboard-layout-controller.mjs";
import { createBookmarksView } from "./bookmarks-view.mjs";
import { createAiPermissionController } from "./ai-permission-controller.mjs";
import { createStatusView, refreshAvailability } from "./status-view.mjs";
import { createUnifiedSearchController } from "./unified-search-controller.mjs";
import { createShellController } from "./shell-controller.mjs";
import { createKeyboardShortcutsController } from "./keyboard-shortcuts.mjs";
import { createKeyboardShortcutSettings } from "./keyboard-shortcut-settings.mjs";
import { createSettingsController } from "./settings-controller.mjs";
import { createSettingsTransferController } from "./settings-transfer-controller.mjs";
import { createDashboardController } from "./dashboard-controller.mjs";
import { createNewsOrganizationController } from "./news-organization-controller.mjs";
import { createLazyController } from "./lazy-controller.mjs";
import { exactPermissionOrigins } from "./permission-ui-model.mjs";
import { cardIconName, cardTone } from "./card-policy.mjs";
import {
  MAX_WEBSITE_SHORTCUTS, MAX_WEBSITE_SHORTCUT_TITLE_LENGTH, MAX_WEBSITE_SHORTCUT_URL_LENGTH,
  normalizeWebsiteShortcutUrl,
} from "../../extension/core/settings.mjs";
import { WEATHER_ORIGINS } from "../../extension/core/weather.mjs";
import { normalizeReadingQueueRecords } from "../../extension/core/reading-queue.mjs";
import { createEmptyState, setIconLabel } from "./ui-primitives.mjs";
import { syncSegmentedIndicator } from "./segmented-control.mjs";
import { requestOrigins } from "./permission-client.mjs";
import { createActionPort } from "./action-port.mjs";
import { createCardTransition } from "./card-transition.mjs";
import { setContentSyncEnabled, syncContentSyncMaster } from "./content-sync-settings.mjs";
import { MOTION_DURATION, bindElasticActionFeedback, bindNavigationPressFeedback, playElasticActionFeedback, setDisclosureVisibility } from "./motion.mjs";
import { bindControlFeedback } from "./control-feedback.mjs";
import { createManualAiUsageNoticeController } from "./manual-ai-usage-notice.mjs";
import { createConfirmationDialogController } from "./confirmation-dialog.mjs";
import {
  TODO_ITEMS_KEY,
  WEATHER_LOCATION_KEY,
  normalizeTodoItems,
  normalizeWeatherLocation,
} from "./utility-card-model.mjs";

const UPDATE_INSPIRATION_PRELOAD_TIMEOUT_MS = 800;

const SETTINGS_SAVE_CLOSE_DELAY_MS = 900;

const CARD_EXIT_MS = 120;
const NEWS_CARD_TYPE = "news";

const ALL_FILTER = "all";

export function readRuntimeAppVersion() {
  try {
    const manifest = globalThis.chrome?.runtime?.getManifest?.();
    const version = manifest?.version_name || manifest?.version;
    return typeof version === "string" ? version : "";
  } catch {
    return "";
  }
}

async function resolveAppVersion() {
  const runtimeVersion = readRuntimeAppVersion();
  if (runtimeVersion) return runtimeVersion;

  try {
    const response = await fetch(new URL("../../manifest.json", import.meta.url));
    if (!response.ok) return "";
    const manifest = await response.json();
    const version = manifest?.version_name || manifest?.version;
    return typeof version === "string" ? version : "";
  } catch {
    return "";
  }
}

export async function createDashboardApp() {
  const runtimeAppVersion = readRuntimeAppVersion();
  const aboutVersion = document.querySelector("#aboutVersion");
  if (aboutVersion && runtimeAppVersion) aboutVersion.textContent = `v${runtimeAppVersion}`;

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
  const appVersion = runtimeAppVersion || await resolveAppVersion();
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
  let accentColorPicker;
  let headerCoverController;
  let dashboardController;
  let websiteShortcutsController;
  let libraryFeedbackTimer = 0;
  let localeChangeToken = 0;
  const activityActions = createActionPort([
    "actionKey", "defaultSeenSource", "findNewsItemByReference", "isQueued", "markOpenedItem",
    "openAndMarkReadingQueue", "openDailyItem", "openSummaryItem", "readingQueueItems",
    "toggleReadingQueue", "toggleSeen",
  ]);
  const readerActions = createActionPort(["openExternal", "openExternalWindow"]);
  const summaryActions = createActionPort(["createNewsRanker", "newsSummaryItems", "refreshSummaryItem"]);
  const cardTransition = createCardTransition({ exitMs: CARD_EXIT_MS, enterMs: MOTION_DURATION.emphasis });
  const dashboardLayout = createDashboardLayoutController({ state, els: dashboardElements, t, request, localizedErrorMessage });

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
    dashboardLayout,
    state, els: statusElements, t, tc, formatDateTime, localizedStatusMessage, localizedErrorMessage,
    setIconLabel, createEmptyState,
  });
  createNewsOrganizationController({ state, els: settingsElements, request, loadDashboard, renderStatus, renderOverviewStatus, localizedErrorMessage, t });
  const {
    syncViewportMetrics,
    syncNavExpandedWidth,
    syncBookmarkSectionVisibility,
    handleGlobalSearchTyping,
    initializePointerHighlights,
    initializeScrollSpy,
    syncNavToCurrentSection,
    setActiveNavButton,
    resetToDailyView,
    getCurrentSectionButton,
    navigateToSection,
  } = createShellController({ state, els: shellElements, openSearch: text => unifiedSearch.open(text) });
  let navigationAutoHide, navigationAutoHideReady, navigationAutoHideSettings;
  function syncNavigationAutoHide(settings) {
    navigationAutoHideSettings = settings;
    if (navigationAutoHide) { navigationAutoHide.sync(settings); return; }
    if (!settings.navAutoHideEnabled) return;
    navigationAutoHideReady ||= import("./navigation-auto-hide.mjs").then(({ createNavigationAutoHideController }) => {
      navigationAutoHide = createNavigationAutoHideController({ sidebar: els.sidebar, reveal: els.navReveal });
      navigationAutoHide.sync(navigationAutoHideSettings);
    });
  }
  const syncBookmarkSectionControls = (settings = {}) => {
    els.bookmarkSectionEnabledInput.checked = isBookmarkSectionVisible(settings);
    syncBookmarkSectionVisibility(settings);
  };
  const dailyView = createDailyView({
    dashboardLayout, renderDailyCards: (...args) => renderDailyCards(...args), state, els: dashboardElements,
    t, createEmptyState, createThemedIcon, createReadingActions, createBookmarkFavicon,
    contextAttachLink: (...args) => contextMenu.attachLink(...args),
    attachMenuButton: (...args) => contextMenu.attachMenuButton(...args),
    toggleSeen: activityActions.toggleSeen,
    openDailyItem: activityActions.openDailyItem, newsSummaryItems: summaryActions.newsSummaryItems,
    inspirationPreviews: {
      fingerprint: (...args) => sitePreviews.fingerprint(...args),
      get: (...args) => sitePreviews.get(...args),
      reject: (...args) => sitePreviews.reject(...args),
      request: (...args) => sitePreviews.request(...args),
      preload: (...args) => sitePreviews.preload(...args),
    },
    faviconUrl, writeValue, createNewsRanker: summaryActions.createNewsRanker, createSeenButton,
    displayBookmarkTitle, localizedCategory, openExternal: readerActions.openExternal,
    persistSeen: () => writeJson(
      state.settings?.retainSeenArchive === true ? "dash.seen.retained" : `dash.seen.${state.day}`,
      Array.from(state.seen).map((key) => ({ key, ...(state.seenMeta.get(key) || {}) })).slice(-150),
    ),
    renderAll, renderTodayMeta, setIconLabel, localizedStatusMessage, confirmAction, cardTransition,
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
    state, els: dashboardElements, t, request, confirmManualAiUsage, localizedCategory,
    localizedResponseMessage, localizedErrorMessage, formatDateTime, faviconUrl, createThemedIcon,
    createReadingActions, createManualSummaryButton,
    attachLinkContextMenu: (...args) => contextMenu.attachLink(...args), activateCardFromKeyboard,
    findNewsItemByReference: activityActions.findNewsItemByReference, cardSummaryEnabled, ...cardTransition,
    batchLabel, createEmptyState, isNewsCard, loadDashboard, newsSectionName,
    openSummaryItem: activityActions.openSummaryItem, prefersReducedMotion, renderOverviewStatus, renderStatus,
    setCardItemIdentity, triggerRefresh, writeValue,
    newsPreviews: {
      fingerprint: (item) => sitePreviews.fingerprint(newsPreviewItem(item)),
      get: (item) => sitePreviews.get(newsPreviewItem(item)),
      isRejected: (item, imageUrl) => sitePreviews.isRejected(newsPreviewItem(item), imageUrl),
      reject: (item, imageUrl) => sitePreviews.reject(newsPreviewItem(item), imageUrl),
      rejectUrl: (item, imageUrl) => sitePreviews.rejectUrl(newsPreviewItem(item), imageUrl),
      request: (item) => sitePreviews.request(newsPreviewItem(item)),
    },
  });
  summaryActions.bind(summaryView);
  const {
    renderEfficiencyPanel,
    refreshDailyDigest,
    invalidateWeather,
    invalidateStocks,
    syncPersonalCards,
    openTodoComposer,
    getTodoTargetCard,
    getCardContextActions,
    renderDailyCards,
  } = createEfficiencyView({
    dashboardLayout,
    state, els: dashboardElements, t, tc, request, confirmManualAiUsage, confirmAction, createEmptyState, createIcon,
    localizedErrorMessage, displaySummaryTitle, itemUrl,
    readingQueueItems: activityActions.readingQueueItems,
    openAndMarkReadingQueue: activityActions.openAndMarkReadingQueue,
    openDailyItem: activityActions.openDailyItem,
    createBookmarkFavicon, displayBookmarkTitle,
    findNewsItemByReference: activityActions.findNewsItemByReference,
    hostFromUrl, isNewsCard,
    openExternal: readerActions.openExternal,
    readingQueueOpenOnReadAll: () => state.settings?.readingQueueOpenOnReadAll !== false,
    createArchiveContent: dailyView.createArchiveContent,
    createDailyContent: dailyView.createDailyContent,
    syncDailyContent: dailyView.syncDailyContent,
    attachLinkContextMenu: (...args) => contextMenu.attachLink(...args),
    renderDaily, renderOverviewStatus, renderSummaries, selectDailyEvents,
    openAiSettings,
    getLocale, readJson, writeJson, writeValue, requestWeatherPermissions,
    newsSummaryItems, formatDateTime,
    isQueued: activityActions.isQueued,
    toggleReadingQueue: activityActions.toggleReadingQueue,
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
    renderActivitySurfaces: () => {
      renderEfficiencyPanel();
      renderDaily();
      renderSummaries();
    },
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
    request,
    confirmAction,
  });
  activityActions.bind(activityController);
  const {
    backFloatingWeb,
    closeFloatingWeb,
    openExternal,
    openExternalWindow,
    reloadFloatingWeb,
  } = readerController = createReaderLauncher({
    state,
    els: overlayElements,
    t,
    request,
    confirmManualAiUsage,
    markOpenedItem,
    renderEfficiencyPanel,
    syncNavToCurrentSection,
    toggleSeen,
    actionKey,
    defaultSeenSource,
    localizedErrorMessage,
    onError: error => renderOverviewStatus(t("reader.error.genericTitle"), localizedErrorMessage(error)),
  });
  readerActions.bind(readerController);
  const syncSearchCopy = (options = {}) => syncSearchCopyView({ state, els, t, ...options });
  const aiSearch = createLazyController({
    load: async () => {
      const [{ createAiSearchController }, { createAiStreamClient }] = await Promise.all([
        import("./ai-search-ui.mjs"),
        import("./ai-stream-client.mjs"),
      ]);
      const controller = createAiSearchController({
        state, els: overlayElements, t, request, confirmManualAiUsage, confirmAction,
        streamClient: createAiStreamClient(), syncNavToCurrentSection,
        restoreFocus: () => unifiedSearch.restoreFocus(),
        setActiveNavButton, navButton: els.aiSearchNav, localizedResponseMessage, localizedErrorMessage,
        openExternal, requestWebsitePermission, requestSourcePermissions, openAiSettings, syncSearchCopy,
      });
      controller.syncLocale();
      return controller;
    },
    onError: (error) => renderOverviewStatus(t("aiSearch.title"), localizedErrorMessage(error)),
    onLoading: (loading) => {
      if (loading) els.aiSearchNav.setAttribute("aria-busy", "true");
      else els.aiSearchNav.removeAttribute("aria-busy");
    },
  });
  const unifiedSearch = createUnifiedSearchController({
    state, els, t, request, aiSearch, openExternalWindow,
    setActiveNavButton, syncNavToCurrentSection, localizedErrorMessage,
    openResult: result => {
      const item = newsSummaryItems(false).find(item => item.key === result.articleId)
        || { key: result.articleId || result.id, url: result.url, title: result.title, sourceKey: result.sourceKey,
          summary: { title: result.title, itemUrl: result.url } };
      openExternal(result.url, result.title, item, { contentKind: "news" });
    },
  });
  const openAiSearch = (...args) => unifiedSearch.openConversation(...args);
  const closeAiSearch = () => unifiedSearch.close();
  const submitOrStopAiSearch = () => aiSearch.call("submitOrStop");
  const cancelAiSearchEdit = () => aiSearch.call("cancelEdit");
  const newAiSearchConversation = () => aiSearch.call("newConversation");
  const handleAiSearchComposerInput = (...args) => aiSearch.call("handleComposerInput", ...args);
  const handleAiSearchComposerKeydown = (...args) => aiSearch.call("handleComposerKeydown", ...args);
  const handleResearchFolderChange = (...args) => aiSearch.call("handleResearchFolderChange", ...args);
  const handleWebSearchToggle = (...args) => aiSearch.call("handleWebSearchToggle", ...args);
  const loadResearchFolders = (...args) => aiSearch.call("loadResearchFolders", ...args);
  const trapAiSearchFocus = (...args) => unifiedSearch.trapFocus(...args);
  const syncAiSearchLocale = (...args) => aiSearch.call("syncLocale", ...args);
  const syncAiSearchProviderCapability = (...args) => aiSearch.call("syncProviderCapability", ...args);
  contextMenu = createContextMenuController({
    menu: els.linkContextMenu,
    headerCover: els.headerImageHero,
    openAppearanceSettings: async () => {
      await settingsController.openSettings();
      settingsController.selectSettingsTab("appearance");
      settingsController.focusSettingsStart();
    },
    getCardActions: getCardContextActions,
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
    syncNavigationAutoHide,
    syncAiSearchLocale,
    syncHeaderCoverControls: () => headerCoverController?.syncControls(),
    syncSegmentedIndicator,
    syncCustomAccentColor: (color) => accentColorPicker?.sync(color),
  });
  accentColorPicker = createAccentColorPicker({
    trigger: els.customAccentTrigger,
    picker: els.customAccentPicker,
    plane: els.customAccentField,
    hueInput: els.customAccentHue,
    hexInput: els.customAccentInput,
    inputError: els.customAccentInputError,
    closeButton: els.closeCustomAccentPicker,
    onChange: () => updateAppearancePreview({ accentTheme: "custom" }),
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
    hero: els.headerImageHero,
    t,
    request,
    updatePreview: updateAppearancePreview,
    renderSettingsStatus: (...args) => settingsController.renderSettingsStatus(...args),
    setSettingsBusy: (...args) => settingsController.setSettingsBusy(...args),
  });
  const {
    currentExcludedNewsSources,
    customFeeds,
    availableNewsFolders,
    renderExcludeFolderOptions,
    addNewsExclusion,
    addNewsFolderExclusion,
    clearSourceSuggestions,
    blockAllSourceSuggestions,
    renderExclusionList,
    syncSourceSuggestionActionState,
  } = createSourceSettingsController({
    state,
    els: settingsElements,
    t,
    tc,
    request,
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
    saveWebsiteShortcutOrder: (websiteShortcuts) => request({ type: "settings:save", payload: { websiteShortcuts } }),
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
    request,
    normalizeUrl,
    isHttpUrl,
    isEnabled: () => state.settings?.bookmarkConsentGranted === true,
    canFallback: () => state.settings?.webImageSearchEnabled === true && state.settings?.hasImageSearchKey === true,
    profileForItem: (item) => isNewsCard(item) ? "article" : "visual",
    preloadImage: preloadBrowserImage,
    isCurrent: (item, fingerprint) => {
      const current = isNewsCard(item)
        ? newsSummaryItems(false).find((candidate) => candidate.key === item.key)
        : (state.data?.bookmarks || []).find((candidate) => candidate.key === item.key);
      return sitePreviews.fingerprint(isNewsCard(item) ? newsPreviewItem(current) : current) === fingerprint;
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
    closeSettings,
    requestCloseSettings,
    resetSecretDrafts,
    setSettingsBusy,
    runSettingsAction,
    grantBookmarkAccess,
    selectSettingsTab,
    renderSettingsStatus,
    captureSettingsSnapshot,
  } = settingsController = createSettingsController({
    shortcutSettings: createKeyboardShortcutSettings({
      root: els.keyboardShortcutEditor, resetButton: els.resetKeyboardShortcuts,
      feedback: els.keyboardShortcutFeedback, enabledInput: els.keyboardShortcutsEnabledInput,
      t, onChange: () => settingsController.renderSettingsStatus(),
    }),
    state, els: settingsElements, t, request, confirmAction, confirmManualAiUsage, localizedResponseMessage, localizedErrorMessage,
    applyUiLocale, selectedUiLocale, syncLanguageControls, applyAppearanceSettings,
    syncAppearanceControls, renderExcludeFolderOptions, renderExclusionList, customFeeds,
    syncBookmarkFolderControls, syncBookmarkSectionControls, syncPublicFeedSupplementControl, syncWebsiteShortcutControls, syncAiSetupControls, refreshAiSetupPermission,
    prepareAiProviderUi,
    getAiSetupState, clearAiSetupFeedback, focusAiSetupRequirement,
    currentExcludedNewsSources, bookmarkSourcePayload, appearancePayload,
    snapshotSettingsDraft, cloneSettingsDraft, diffSettingsDraft,
    syncSeenArchiveRetention, loadDashboard, triggerRefresh,
    renderStatus,
    syncNavToCurrentSection, setActiveNavButton, navButton: els.settingsNav, getLocale, prepareLocale,
    settingsSaveCloseDelayMs: SETTINGS_SAVE_CLOSE_DELAY_MS,
    settingsCloseMotionMs: MOTION_DURATION.state,
    inspirationPreviews: sitePreviews, syncHeaderImageFullscreenControl, syncHeaderImageBlurControl, syncHeaderImageHeightControl,
    syncAccentColorPickerBusy: (busy) => accentColorPicker.setBusy(busy),
    headerCoverController, availableNewsFolders,
    syncSourceSuggestionActionState, syncSegmentedIndicator,
    websiteShortcutsPayload, setWebsiteShortcutControlsBusy,
    aiSetupStage: AI_SETUP_STAGE,
    requestSourcePermissions, revealActiveSettingsTab,
  });
  const { exportSettings, importSettingsFile, factoryReset } = createSettingsTransferController({
    els: settingsElements, state, t, request, confirmAction, localizedErrorMessage,
    runSettingsAction, renderSettingsStatus, loadSettings, captureSettingsSnapshot, resetSecretDrafts,
    applyUiLocale, getLocale, prepareLocale, inspirationPreviews: sitePreviews, loadDashboard, triggerRefresh,
    resetExtensionPage,
  });
  dashboardController = createDashboardController({
    state, els: { ...dashboardElements, settingsRefresh: settingsElements.settingsRefresh }, t, request, preloadDailyInspiration,
    inspirationPreloadTimeoutMs: UPDATE_INSPIRATION_PRELOAD_TIMEOUT_MS,
    renderConnectionError, renderStatus, renderOverviewStatus, localizedErrorMessage,
    renderExclusionList, renderExcludeFolderOptions,
    renderTodayMetaValue: renderTodayMetaValue,
    renderWebsiteShortcuts, renderEfficiencyPanel, renderDaily, renderSummaries, renderSectionFilters,
    renderCategoryFilters, renderCategories, formatTodayMeta, getTodayKey,
    readNumber, writeJson, retainSeenArchiveEnabled, readSeenRecords, replaceSeenRecords,
    canRefresh: () => refreshAvailability(state.data).available,
    syncSearchCopy,
    syncAiSearchCapability: syncAiSearchProviderCapability,
  });
  const keyboardShortcuts = createKeyboardShortcutsController({
    isEnabled: () => Boolean(state.settings && state.data) && state.settings.keyboardShortcutsEnabled === true,
    getBindings: () => state.settings?.keyboardShortcuts,
    isBlocked: () => dashboardLayout.isInteracting(),
    getUtilityCard: getTodoTargetCard,
    openTodoComposer, navigateToSection,
    getBatchTargets: () => [
      ...Object.keys(state.cardTypes).map((id) => {
        const root = dashboardLayout.getCard(id);
        return { root, button: root?.querySelector("[data-batch-action]"), run: () => dailyView.reshuffleDailyColumn(id) };
      }),
      { root: els.summaryGrid.closest("section"), button: els.summaryBatch, run: advanceSummaryBatch },
    ],
  });
  const botModeController = createBotModeController({ state, request, t, loadDashboard });
  botModeController.start();

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
    if (detail?.type === "content-sync.changed" || detail?.type === "personal-cards.changed") {
      const values = detail.payload?.values;
      applyExternalStoragePatch(values);
      syncPersonalCards();
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
      if (detail?.payload?.reason === "cache-cleared") { invalidateWeather(); invalidateStocks(); }
      const scope = ["feed", "digest", "news-organization", "refresh-complete", "refresh-failed-ai-fallback"].includes(detail?.payload?.reason) ? "news" : "all";
      loadDashboard({ scope });
    }
    if (detail?.type === "dashboard.ai-progress") {
      dashboardController.applyAiProgress(detail.payload);
    }
    if (detail?.type === "settings.changed") {
      if (detail.payload?.dashboardLayoutOnly) {
        dashboardLayout.receive(detail.payload.dashboardCardOrder);
        return;
      }
      if (detail?.payload?.permissionsChanged || detail?.payload?.bookmarkSourceChanged || detail?.payload?.imageSearchChanged) {
        sitePreviews.invalidate();
      }
      if (detail?.payload?.permissionsChanged) { invalidateWeather(); invalidateStocks(); }
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
    // Header-cover storage and image decoding are visual enhancements. The cached
    // layout hint already reserves the right geometry, so they must not delay data.
    void Promise.resolve(globalThis.ampiraLayoutBootstrap?.headerCoverReady).catch(() => {});
    try {
      await Promise.all([
        globalThis.ampiraLayoutBootstrap?.websiteShortcutsReady,
        loadSettings().finally(() => {
          if (document.documentElement.dataset.bookmarkSection === "pending") {
            syncBookmarkSectionVisibility(state.settings);
          }
        }),
        loadDashboard({ render: false }),
      ]);
    } finally {
      initialLoadingMotion?.finish();
    }
    if (state.data) {
      renderAll();
      preloadDailyInspiration(UPDATE_INSPIRATION_PRELOAD_TIMEOUT_MS);
    }
    syncSegmentedIndicators();
    resetToDailyView();
    triggerRefresh(false);
  }

  function advanceSummaryBatch() {
    playElasticActionFeedback(els.summaryBatch);
    reshuffleSummaries();
  }

  function bindEvents() {
    bindControlFeedback();
    document.querySelectorAll(".nav-btn").forEach(bindNavigationPressFeedback);
    bindElasticActionFeedback(els.summaryBatch);
    bindElasticActionFeedback(document.querySelector("#navLogo"));
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
    keyboardShortcuts.bind();
    document.addEventListener("keydown", handleGlobalSearchTyping);

    document.querySelector("#navLogo")?.addEventListener("click", (event) => {
      playElasticActionFeedback(event.currentTarget);
      window.scrollTo({
        top: 0,
        left: 0,
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      });
    });

    document.querySelectorAll("[data-scroll]").forEach((button) => {
      button.addEventListener("click", () => {
        navigateToSection(button.dataset.scroll);
      });
    });

    els.settingsNav.addEventListener("click", openSettings);
    els.aiSearchNav.addEventListener("click", () => unifiedSearch.open());
    els.newAiSearch.addEventListener("click", newAiSearchConversation);
    els.closeAiSearch.addEventListener("click", closeAiSearch);
    els.closeSettings.addEventListener("click", requestCloseSettings);
    els.settingsModal.addEventListener("click", (event) => {
      if (event.target === els.settingsModal) requestCloseSettings();
    });
    els.aiSearchOverlay.addEventListener("click", (event) => {
      if (!els.aiSearchOverlay.classList.contains("open")) return;
      if (event.target === els.aiSearchOverlay) closeAiSearch();
    });
    els.aiSearchOverlay.addEventListener("keydown", trapAiSearchFocus);
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
      if (els.webFrameOverlay.classList.contains("open") || els.webFrameOverlay.getAttribute("aria-busy") === "true") {
        closeFloatingWeb();
        return;
      }
      if (els.aiSearchOverlay.classList.contains("open") || els.aiSearchNav.getAttribute("aria-busy") === "true") {
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
      submitOrStopAiSearch();
    });
    els.aiSearchInput.addEventListener("input", handleAiSearchComposerInput);
    els.aiSearchInput.addEventListener("keydown", handleAiSearchComposerKeydown);
    els.aiResearchFolder.addEventListener("change", handleResearchFolderChange);
    els.aiResearchFolder.addEventListener("comboboxopen", loadResearchFolders);
    els.aiWebSearchToggle.addEventListener("click", handleWebSearchToggle);
    els.cancelAiSearchEdit?.addEventListener("click", cancelAiSearchEdit);

    window.addEventListener("ampira:browser-search-permission-changed", () => unifiedSearch.invalidate());

    els.sectionFilter.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-section]");
      if (!button) return;
      if (state.filter === button.dataset.section) return;
      state.filter = button.dataset.section;
      state.categoryFilter = ALL_FILTER;
      for (const item of els.sectionFilter.querySelectorAll("button")) {
        item.classList.toggle("active", item === button);
        item.setAttribute("aria-pressed", String(item === button));
      }
      renderCategoryFilters();
      renderCategories();
      syncSegmentedIndicator(els.sectionFilter, button);
    });

    els.categoryFilter.addEventListener("change", () => {
      state.categoryFilter = els.categoryFilter.value;
      renderCategories();
    });

    els.refresh.addEventListener("click", () => {
      triggerRefresh(true);
      els.refresh.classList.remove("is-elastic");
      void els.refresh.offsetWidth;
      els.refresh.classList.add("is-elastic");
      els.refresh.addEventListener("animationend", () => els.refresh.classList.remove("is-elastic"), { once: true });
    });
    els.settingsRefresh.addEventListener("click", () => triggerRefresh(true));
    els.summaryBatch.addEventListener("click", advanceSummaryBatch);
    els.summaryOrder.addEventListener("change", () => {
      const order = els.summaryOrder.value;
      if (!["time", "importance"].includes(order) || order === state.summaryOrder) return;
      state.summaryOrder = order;
      state.variants.summary = 0;
      writeValue("dash.summary.order", state.summaryOrder);
      writeValue(`dash.variant.${state.day}.summary`, "0");
      renderSummaries();
    });
    els.settingsTabs.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-settings-tab]");
      if (!button) return;
      selectSettingsTab(button.dataset.settingsTab);
    });
    els.uiLocaleSelect.addEventListener("change", async () => {
      const token = ++localeChangeToken;
      const locale = els.uiLocaleSelect.value;
      try {
        await prepareLocale(locale);
        if (token !== localeChangeToken) return;
        applyUiLocale(locale, { persist: false });
        renderSettingsStatus();
      } catch (error) {
        if (token !== localeChangeToken) return;
        els.uiLocaleSelect.value = getLocale();
        renderSettingsStatus(t("settings.status.loadFailed", { message: error.message || error }), "error");
      }
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
    els.navPositionGroup.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-nav-position]");
      if (!button || button.disabled) return;
      updateAppearancePreview({ navPosition: button.dataset.navPosition });
    });
    els.pointerGlowEnabledInput.addEventListener("change", () => updateAppearancePreview());
    els.navAutoHideEnabledInput.addEventListener("change", () => updateAppearancePreview());
    els.dashboardGlassBlurEnabledInput.addEventListener("change", () => updateAppearancePreview());
    els.sectionTitleOpacityGroup.addEventListener("click", (event) => {
      const button = event.target.closest("[data-title-opacity]");
      if (!button || button.disabled) return;
      updateAppearancePreview({ sectionTitleOpacity: Number(button.dataset.titleOpacity) });
    });
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
    els.headerImageMediaTypeInput.addEventListener("change", () => updateAppearancePreview());
    els.headerImageFitInput.addEventListener("change", () => updateAppearancePreview());
    els.headerImage.addEventListener("load", handleHeaderImageLoad);
    els.headerImage.addEventListener("error", handleHeaderImageError);
    syncHeaderImageLoadState();
    els.readingQueueOpenOnReadAllInput.addEventListener("change", () => {
      state.settings = { ...(state.settings || {}), readingQueueReadAllPrompted: true };
    });
    els.contentSyncEnabledInput.addEventListener("change", () => {
      setContentSyncEnabled(els, els.contentSyncEnabledInput.checked);
      renderSettingsStatus();
    });
    els.webImageSearchEnabledInput.addEventListener("change", () => {
      setDisclosureVisibility(els.imageSearchStrategy, els.webImageSearchEnabledInput.checked);
    });
    [els.syncReadingQueueEnabledInput, els.syncTodosEnabledInput, els.syncWeatherLocationEnabledInput,
      els.syncStockWatchlistEnabledInput, els.syncCountdownsEnabledInput, els.syncTrackedTopicsEnabledInput, els.syncCalendarEnabledInput,
      els.syncNotesEnabledInput, els.syncWorldClockEnabledInput].forEach((input) => {
      input.addEventListener("change", () => { syncContentSyncMaster(els, { keepOpen: true }); renderSettingsStatus(); });
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
    els.grantBookmarkAccess?.addEventListener("click", grantBookmarkAccess);
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
      const savedSettings = await request({ type: "settings:save", payload: { hiddenBookmarkCategories } });
      state.settings = savedSettings;
      if (state.filter === section && state.categoryFilter === category) state.categoryFilter = ALL_FILTER;
      renderCategoryFilters();
      renderCategories();
      requestAnimationFrame(() => {
        const target = els.categoryFilter.disabled
          ? els.sectionFilter.querySelector("button.active")
          : els.categoryFilter;
        target?.focus({ preventScroll: true });
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

  function resetExtensionPage() {
    try {
      globalThis.localStorage?.clear();
    } catch {
      // The cleared extension storage remains authoritative if page storage is unavailable.
    }
    const target = new URL("dashboard.html", globalThis.location.href);
    globalThis.location.replace(target.href);
  }

  function syncSegmentedIndicators() {
    syncSegmentedIndicator(els.sectionFilter);
    syncSegmentedIndicator(els.colorModeGroup);
    syncSegmentedIndicator(els.navPositionGroup);
    syncSegmentedIndicator(els.headerImageLayoutGroup);
  }

  function cardSummaryEnabled() {
    return (state.data?.organization?.available ?? state.data?.ai?.enabled) === true
      && state.settings?.cardSummaryEnabled !== false
      && state.data?.ai?.cardSummaryEnabled !== false;
  }
}
