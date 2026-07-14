import { apiGet, apiPost } from "./api.mjs";
import { spanText, srOnly } from "./dom.mjs";
import { getElementGroups } from "./elements.mjs";
import { createIcon, createThemedIcon, hydrateIcons } from "./icons.mjs";
import { allTranslations, formatLocaleList, getLocale, setLocale, t, tc } from "./i18n.mjs";
import { hydrateStorage, readJson, readNumber, writeJson, writeValue } from "./storage.mjs";
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
import { cloneSettingsDraft, diffSettingsDraft, snapshotSettingsDraft } from "./settings-draft.mjs";
import { createSitePreviewController, sitePreviewFingerprint } from "./inspiration-preview-controller.mjs";
import { AI_SETUP_STAGE, aiProviderOrigin, deriveAiSetupControlState } from "./ai-settings-policy.mjs";
import { isDisplayableFeedItem } from "../../extension/core/feed-item-policy.mjs";
import { cleanSummaryLines, cleanSummaryTitle, displaySummaryTitle, displayTitle, isCorrectlySummarized, itemUrl, summaryDetailLines, summaryLines, summaryText } from "./item-presenter.mjs";
import { apiStyleLabel, colorModeLabel, localizedCategory, localizedErrorMessage, localizedExclusionReason, localizedResponseMessage, localizedSourceLabel, localizedSourceReason, localizedStatusMessage, themeLabel } from "./localized-labels.mjs";
import { createContextMenuController } from "./context-menu-controller.mjs";
import { createAppearanceController } from "./appearance-controller.mjs";
import { createCoverBlurPreviewController } from "./cover-blur-preview-controller.mjs";
import { createSourceSettingsController } from "./source-settings-controller.mjs";
import { createBookmarkSettingsController } from "./bookmark-settings-controller.mjs";
import { createWebsiteShortcutsController } from "./website-shortcuts-controller.mjs";
import { createActivityController } from "./activity-controller.mjs";
import { createSummaryView } from "./summary-view.mjs";
import { createEfficiencyView } from "./efficiency-view.mjs";
import { createDailyView } from "./daily-view.mjs";
import { createBookmarksView } from "./bookmarks-view.mjs";
import { createAiPermissionController } from "./ai-permission-controller.mjs";
import { createStatusView } from "./status-view.mjs";
import { createShellController } from "./shell-controller.mjs";
import { createSettingsController } from "./settings-controller.mjs";
import { createSettingsTransferController } from "./settings-transfer-controller.mjs";
import { createDashboardController } from "./dashboard-controller.mjs";
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
const CARD_EXIT_MS = 110;
const CARD_ENTER_MS = 240;
const NEWS_CARD_TYPE = "news";
const INSPIRATION_CARD_TYPE = "inspiration";
const BOOKMARK_CARD_TYPE = "bookmark";
const LEGACY_NEWS_SECTION = "资讯";
const LEGACY_INSPIRATION_SECTION = "审美";
const ALL_FILTER = "all";
const SUMMARY_DETAIL_MAX_LENGTH = 280;

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
let activityController;
let contextMenu;
let summaryView;
let sitePreviews;
let readerController;
let settingsController;
let dashboardController;
let websiteShortcutsController;

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
  matchesQuery: (...args) => activityController.matchesQuery(...args),
  createEmptyState, cardIconName, cardTone, setIconLabel, syncSegmentedIndicator,
  openExternal: (...args) => readerController.openExternal(...args),
  contextAttachGroup: (...args) => contextMenu.attachGroup(...args),
  contextAttachLink: (...args) => contextMenu.attachLink(...args),
  toggleSeen: (...args) => activityController.toggleSeen(...args),
  defaultSeenSource: (...args) => activityController.defaultSeenSource(...args),
  isQueued: (...args) => activityController.isQueued(...args),
  actionKey: (...args) => activityController.actionKey(...args),
  toggleReadingQueue: (...args) => activityController.toggleReadingQueue(...args),
  refreshSummaryItem: (...args) => summaryView.refreshSummaryItem(...args),
  allFilter: ALL_FILTER,
});
const {
  applyDeepSeekPreset,
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
  handleGlobalSearchTyping,
  focusDashboardSearch,
  initializePointerHighlights,
  initializeScrollSpy,
  syncNavToCurrentSection,
  setActiveNavButton,
  resetToDailyView,
  getCurrentSectionButton,
} = createShellController({ state, els: shellElements });
const dailyView = createDailyView({
  state, els: dashboardElements, t, tc, itemUrl, displayTitle, displaySummaryTitle, summaryText,
  createEmptyState, createIcon, createThemedIcon, createReadingActions,
  createBookmarkFavicon,
  contextAttachLink: (...args) => contextMenu.attachLink(...args),
  openDailyItem: (...args) => activityController.openDailyItem(...args),
  toggleSeen: (...args) => activityController.toggleSeen(...args),
  defaultSeenSource: (...args) => activityController.defaultSeenSource(...args),
  newsSummaryItems: (...args) => summaryView.newsSummaryItems(...args),
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
  dailyBoardCardSelector: DAILY_BOARD_CARD_SELECTOR, cardExitMs: CARD_EXIT_MS,
  cardEnterMs: CARD_ENTER_MS, newsCardType: NEWS_CARD_TYPE,
  inspirationCardType: INSPIRATION_CARD_TYPE, bookmarkCardType: BOOKMARK_CARD_TYPE,
  legacyNewsSection: LEGACY_NEWS_SECTION, legacyInspirationSection: LEGACY_INSPIRATION_SECTION,
  createNewsRanker: (...args) => summaryView.createNewsRanker(...args),
  createSeenButton, displayBookmarkTitle, localizedCategory,
  mergeRankedUnique, selectTodayNewsItems, selectUnseenPool,
  openExternal: (...args) => readerController.openExternal(...args),
  persistSeen: () => writeJson(
    state.settings?.retainSeenArchive === true ? "dash.seen.retained" : `dash.seen.${state.day}`,
    Array.from(state.seen).map((key) => ({ key, ...(state.seenMeta.get(key) || {}) })).slice(-150),
  ),
  renderAll, renderTodayMeta, setIconLabel,
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
  state, els: dashboardElements, t, tc, apiPost, isDisplayableFeedItem, itemUrl, displaySummaryTitle,
  summaryDetailLines, cleanSummaryLines, isCorrectlySummarized, localizedCategory,
  localizedSourceLabel, localizedResponseMessage, localizedErrorMessage,
  formatDateTime, faviconUrl, hostFromUrl, createIcon, createThemedIcon,
  createReadingActions, createManualSummaryButton,
  attachLinkContextMenu: (...args) => contextMenu.attachLink(...args),
  activateCardFromKeyboard,
  matchesQuery: (...args) => activityController.matchesQuery(...args),
  findNewsItemByReference: (...args) => activityController.findNewsItemByReference(...args),
  createPriorityRanker, mergeRankedUnique, selectUnseenPool,
  shuffle, pageForItems, newsCardType: NEWS_CARD_TYPE,
  hotSummaryPageSize: HOT_SUMMARY_PAGE_SIZE,
  summaryCardSelector: SUMMARY_CARD_SELECTOR,
  summaryDetailMaxLength: SUMMARY_DETAIL_MAX_LENGTH,
  cardSummaryEnabled,
  animateCardsIn, animateCardsOut, batchLabel, canReuseCard, clearCardAnimationState,
  createEmptyState, isNewsCard, loadDashboard, newsSectionName,
  openSummaryItem: (...args) => activityController.openSummaryItem(...args),
  prefersReducedMotion, renderOverviewStatus, renderStatus, setCardItemIdentity,
  syncSegmentedIndicator, triggerRefresh, writeValue,
  newsPreviews: {
    fingerprint: (item) => sitePreviews.fingerprint(newsPreviewItem(item)),
    get: (item) => sitePreviews.get(newsPreviewItem(item)),
    reject: (item, imageUrl) => sitePreviews.reject(newsPreviewItem(item), imageUrl),
    request: (item) => sitePreviews.request(newsPreviewItem(item)),
  },
});
const {
  renderEfficiencyPanel,
  refreshDailyDigest,
  invalidateWeather,
} = createEfficiencyView({
  state, els: dashboardElements, t, tc, apiPost, createEmptyState, createIcon, createThemedIcon,
  localizedStatusMessage, localizedResponseMessage, localizedErrorMessage,
  displaySummaryTitle, itemUrl, formatDateTime,
  readingQueueItems: (...args) => activityController.readingQueueItems(...args),
  openAndMarkReadingQueue: (...args) => activityController.openAndMarkReadingQueue(...args),
  openDailyItem: (...args) => activityController.openDailyItem(...args),
  renderStatus, allTranslations, createBookmarkFavicon, displayBookmarkTitle,
  findNewsItemByReference: (...args) => activityController.findNewsItemByReference(...args),
  hostFromUrl, isNewsCard,
  openExternal: (...args) => readerController.openExternal(...args),
  readingQueueOpenOnReadAll: () => state.settings?.readingQueueOpenOnReadAll !== false,
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
} = activityController = createActivityController({
  state,
  itemUrl,
  openExternalWindow: (...args) => readerController.openExternalWindow(...args),
  openExternal: (...args) => readerController.openExternal(...args),
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
});
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
  markOpenedItem,
  renderEfficiencyPanel,
  syncNavToCurrentSection,
  toggleSeen,
  actionKey,
  defaultSeenSource,
  localizedErrorMessage,
});
const {
  open: openAiSearch,
  close: closeAiSearch,
  run: runAiSearch,
} = createAiSearchController({
  state,
  els: overlayElements,
  t,
  apiPost,
  clearTopSearchFilter,
  syncNavToCurrentSection,
  localizedResponseMessage,
  localizedErrorMessage,
  openExternal,
  requestWebsitePermission,
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
  updatePreview: updateAppearancePreview,
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
  syncSegmentedIndicator,
});
const coverBlurPreview = createCoverBlurPreviewController({
  modal: els.settingsModal,
  input: els.headerImageBlurAmountInput,
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
  legacyNewsSection: LEGACY_NEWS_SECTION,
  legacyInspirationSection: LEGACY_INSPIRATION_SECTION,
});
const {
  syncBookmarkFolderControls,
  syncBookmarkOnlyFolderControls,
  bookmarkSourcePayload,
  renderBookmarkSourceStatus,
  addBookmarkOnlyFolder,
  renderBookmarkOnlyFolderList,
  currentBookmarkOnlyFolders,
} = createBookmarkSettingsController({
  state,
  els: settingsElements,
  t,
  formatLocaleList,
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
    settingsController.selectSettingsTab("browser");
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
  bookmarkSourceStatusText,
  appearanceStatusText,
  captureSettingsSnapshot,
} = settingsController = createSettingsController({
  state, els: settingsElements, t, apiGet, apiPost, localizedResponseMessage, localizedErrorMessage,
  applyUiLocale, selectedUiLocale, syncLanguageControls, applyAppearanceSettings,
  syncAppearanceControls, renderExcludeFolderOptions, renderExclusionList,
  renderSourceSuggestionList,
  syncBookmarkFolderControls, syncWebsiteShortcutControls, syncAiSetupControls, refreshAiSetupPermission,
  getAiSetupState, clearAiSetupFeedback, focusAiSetupRequirement,
  currentExcludedNewsSources, bookmarkSourcePayload, appearancePayload,
  snapshotSettingsDraft, cloneSettingsDraft, diffSettingsDraft, selectedColorMode,
  selectedAccentTheme, colorModeLabel, themeLabel, currentBookmarkOnlyFolders,
  renderBookmarkSourceStatus, syncSeenArchiveRetention, loadDashboard, triggerRefresh,
  renderStatus, renderEfficiencyPanel, renderAll, resetToDailyView,
  syncNavToCurrentSection, getLocale, setLocale,
  settingsSaveCloseDelayMs: SETTINGS_SAVE_CLOSE_DELAY_MS,
  settingsCloseMotionMs: SETTINGS_CLOSE_MOTION_MS,
  inspirationPreviews: sitePreviews, syncHeaderImageFullscreenControl, syncHeaderImageBlurControl, availableNewsFolders,
  syncSourceSuggestionActionState, syncSegmentedIndicator, isHttpUrl,
  websiteShortcutsPayload, setWebsiteShortcutControlsBusy,
  aiSetupStage: AI_SETUP_STAGE,
});
const { exportSettings, importSettingsFile } = createSettingsTransferController({
  els: settingsElements, state, t, apiGet, apiPost, localizedErrorMessage,
  runSettingsAction, renderSettingsStatus, loadSettings, captureSettingsSnapshot, resetSecretDrafts,
  applyUiLocale, getLocale, inspirationPreviews: sitePreviews, loadDashboard, triggerRefresh,
  parseSettingsTransferText, settingsTransferFilename,
  maxSettingsTransferBytes: MAX_SETTINGS_TRANSFER_BYTES,
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

export function createDashboardApp() {
  return {
    start: initialize,
    handleRuntimeMessage,
    handleFaviconPermissionChanged,
  };
}

function handleRuntimeMessage(detail) {
  if (detail?.type === "dashboard.updated") {
    if (detail?.payload?.reason === "cache-cleared") invalidateWeather();
    loadDashboard();
  }
  if (detail?.type === "settings.changed") {
    if (detail?.payload?.permissionsChanged || detail?.payload?.imageSearchChanged) {
      sitePreviews.invalidate();
    }
    if (detail?.payload?.permissionsChanged) invalidateWeather();
    if (els.settingsModal.classList.contains("open")) {
      sitePreviews.invalidate();
      if (detail?.payload?.permissionsChanged) refreshAiSetupPermission({ focusOnLock: true });
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
  }
}

function handleFaviconPermissionChanged() {
  if (state.data) renderAll();
}

async function initialize() {
  syncViewportMetrics();
  resetToDailyView();
  bindEvents();
  startTodayClock();
  await globalThis.ampiraLayoutBootstrap?.websiteShortcutsReady;
  renderInitialLoadingState();
  await Promise.all([loadSettings(), loadDashboard({ render: false })]);
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
  syncNavExpandedWidth();
  document.fonts?.ready?.then(syncNavExpandedWidth).catch(() => {});
  window.addEventListener("resize", () => {
    syncViewportMetrics();
    syncSegmentedIndicators();
    syncNavExpandedWidth();
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
  if (typeof backFloatingWeb === "function") els.backWebFrame.addEventListener("click", backFloatingWeb);
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
    state.query = els.search.value.trim().toLowerCase();
    scheduleSearchRender();
  });
  els.search.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.isComposing) {
      const query = els.search.value.trim();
      if (!query) return;
      event.preventDefault();
      openAiSearch(query, true);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      clearTopSearchFilter();
    }
  });
  els.topAiSearch?.addEventListener("click", () => openAiSearch(els.search.value.trim(), Boolean(els.search.value.trim())));

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
  for (const select of [els.newsBookmarkFolderSelect, els.inspirationBookmarkFolderSelect]) {
    select.addEventListener("change", () => {
      syncBookmarkOnlyFolderControls();
      renderBookmarkSourceStatus();
      renderSettingsStatus();
    });
  }
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
  els.headerImageBlurEnabledInput.addEventListener("change", () => {
    syncHeaderImageBlurControl();
    updateAppearancePreview();
  });
  els.headerImageBlurAmountInput.addEventListener("input", () => updateAppearancePreview());
  els.headerImageFixedInput.addEventListener("change", () => {
    if (!els.headerImageFixedInput.checked) els.headerImageFullscreenInput.checked = false;
    syncHeaderImageFullscreenControl();
    updateAppearancePreview();
  });
  els.headerImageFullscreenInput.addEventListener("change", () => updateAppearancePreview());
  els.headerImageUrlInput.addEventListener("input", () => updateAppearancePreview());
  els.headerImage.addEventListener("load", handleHeaderImageLoad);
  els.headerImage.addEventListener("error", handleHeaderImageError);
  syncHeaderImageLoadState();
  [els.apiBaseUrlInput, els.apiStyleSelect, els.modelInput, els.dailyLimitInput, els.imageSearchApiKeyInput, els.aiDisclosureConsent, els.webImageSearchEnabledInput, els.cardSummaryEnabledInput, els.cacheSizeInput, els.hotNewsPerSourceInput, els.newsPerCategoryInput, els.floatingOpenInput, els.readingQueueOpenOnReadAllInput, els.retainSeenArchiveInput, els.personalizedRankingEnabledInput, els.publicFeedSupplementEnabledInput].forEach((input) => {
    input.addEventListener("input", () => renderSettingsStatus());
    input.addEventListener("change", () => renderSettingsStatus());
  });
  els.apiBaseUrlInput.addEventListener("input", () => {
    clearAiSetupFeedback();
    resetAiConsentForProviderChange();
    refreshAiSetupPermission();
  });
  els.aiDisclosureConsent.addEventListener("change", () => {
    clearAiSetupFeedback();
    refreshAiSetupPermission();
  });
  els.grantAiOrigin.addEventListener("click", grantAiProviderOrigin);
  document.addEventListener("ampira:locale-changed", syncAiSetupControls);
  document.addEventListener("ampira:locale-changed", refreshWebsiteShortcutTranslations);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refreshAiSetupPermission({ focusOnLock: true });
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
  els.testKey.addEventListener("click", testKey);
  els.clearKey.addEventListener("click", clearKey);
  els.testImageSearchKey.addEventListener("click", testImageSearchKey);
  els.clearImageSearchKey.addEventListener("click", clearImageSearchKey);
  els.clearCache.addEventListener("click", clearCache);
  els.resetQuota.addEventListener("click", resetQuota);
  els.resetPreferences.addEventListener("click", resetPreferences);
  els.exportSettings.addEventListener("click", exportSettings);
  els.importSettings.addEventListener("click", () => els.settingsImportFile.click());
  els.settingsImportFile.addEventListener("change", importSettingsFile);
  els.deepseekPreset.addEventListener("click", applyDeepSeekPreset);
}

function bindAiPermissionEvents() {
  globalThis.chrome?.permissions?.onAdded?.addListener(() => refreshAiSetupPermission());
  globalThis.chrome?.permissions?.onRemoved?.addListener(() => refreshAiSetupPermission({ focusOnLock: true }));
}

function setIconLabel(node, icon, label, iconClass = "btn-icon", labelClass = "btn-label") {
  node.replaceChildren(createIcon(icon, iconClass), spanText(label, labelClass));
}

function requestWebsitePermission(rawUrl) {
  if (!globalThis.chrome?.permissions?.request) return Promise.resolve(false);
  try {
    const input = String(rawUrl || "").trim();
    const url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(input) ? input : `https://${input}`);
    const isLocalHttp = url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname);
    if (url.protocol !== "https:" && !isLocalHttp) return Promise.resolve(false);
    return chrome.permissions.request({ origins: [`${url.origin}/*`] });
  } catch {
    return Promise.resolve(false);
  }
}

function requestWeatherPermissions() {
  if (!globalThis.chrome?.permissions?.request) return Promise.resolve(false);
  return chrome.permissions.request({ origins: WEATHER_ORIGINS.map((origin) => `${origin}/*`) });
}

function createEmptyState({ title = "", body = "", variant = "panel", actionLabel = "", onAction } = {}) {
  const node = document.createElement("div");
  const normalizedVariant = variant || "panel";
  node.className = `empty-state is-${normalizedVariant}${normalizedVariant === "error" ? " is-compact" : ""}`;
  if (normalizedVariant === "error") node.setAttribute("role", "alert");

  const copy = document.createElement("div");
  copy.className = "empty-state-copy";
  if (title) {
    const heading = document.createElement("div");
    heading.className = "empty-state-title";
    heading.textContent = title;
    copy.append(heading);
  }
  if (body) {
    const description = document.createElement("div");
    description.className = "empty-state-body";
    description.textContent = body;
    copy.append(description);
  }
  if (actionLabel && typeof onAction === "function") {
    const action = document.createElement("button");
    action.type = "button";
    action.className = "empty-state-action";
    setIconLabel(action, emptyActionIcon(actionLabel), actionLabel, "inline-icon", "btn-label");
    action.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      onAction(event);
    });
    copy.append(action);
  }

  node.append(copy);
  return node;
}

function emptyActionIcon(label) {
  if (allTranslations("action.openSettings").some((value) => label.includes(value))) return "settings";
  if (allTranslations("action.configureAi").some((value) => label.includes(value))) return "settings";
  if (allTranslations("action.generateDigest").some((value) => label.includes(value))) return "refresh-cw-01";
  if (allTranslations("action.reorganize").some((value) => label.includes(value))) return "refresh-cw-01";
  return "arrow-up-right";
}

async function openAiSettings() {
  await settingsController.openSettings();
  settingsController.selectSettingsTab("service");
  settingsController.focusSettingsStart({ reveal: true });
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
}

function syncSegmentedIndicator(control, activeButton = null) {
  placeSegmentedIndicator(control, activeButton);
  requestAnimationFrame(() => placeSegmentedIndicator(control, activeButton));
}

function placeSegmentedIndicator(control, activeButton = null) {
  if (!control) return;
  ensureSegmentedIndicator(control);
  const button = activeButton?.matches?.("button")
    ? activeButton
    : control.querySelector("button.active");
  if (control.hidden || !button || !control.getClientRects().length || !button.getClientRects().length) {
    control.classList.remove("has-indicator");
    return;
  }
  const controlRect = control.getBoundingClientRect();
  const buttonRect = button.getBoundingClientRect();
  const controlStyle = getComputedStyle(control);
  const borderLeft = parseFloat(controlStyle.borderLeftWidth) || 0;
  const borderTop = parseFloat(controlStyle.borderTopWidth) || 0;
  control.style.setProperty("--segmented-x", `${Math.round(buttonRect.left - controlRect.left - borderLeft)}px`);
  control.style.setProperty("--segmented-y", `${Math.round(buttonRect.top - controlRect.top - borderTop)}px`);
  control.style.setProperty("--segmented-w", `${Math.round(buttonRect.width)}px`);
  control.style.setProperty("--segmented-h", `${Math.round(buttonRect.height)}px`);
  control.classList.add("has-indicator");
}

function ensureSegmentedIndicator(control) {
  for (const child of control.children) {
    if (child.classList.contains("segment-indicator")) return child;
  }
  const indicator = document.createElement("span");
  indicator.className = "segment-indicator";
  indicator.setAttribute("aria-hidden", "true");
  control.prepend(indicator);
  return indicator;
}

function cardSummaryEnabled() {
  return state.data?.ai?.enabled === true
    && state.settings?.cardSummaryEnabled !== false
    && state.data?.ai?.cardSummaryEnabled !== false;
}
