import { apiGet, apiPost } from "./api.mjs";
import { spanText, srOnly } from "./dom.mjs";
import { getElements } from "./elements.mjs";
import { createIcon, createThemedIcon, hydrateIcons } from "./icons.mjs";
import { allTranslations, formatLocaleList, getLocale, normalizeLocale, setLocale, t, tc, translateDocument } from "./i18n.mjs";
import { hydrateStorage, readJson, readNumber, writeJson, writeValue } from "./storage.mjs";
import { createInitialState } from "./state.mjs";
import { cleanTitleText, normalizeComparableText, similarityScore, textLength } from "./text.mjs";
import { formatDateTime, formatFullDateTime, getTodayKey } from "./time.mjs";
import { faviconUrl, hostFromUrl, isHttpUrl, normalizeUrl } from "./urls.mjs";
import { findNewsItemByReference as findNewsItemReference, pageForItems, seededShuffle as shuffle } from "./dashboard-model.mjs";
import { createPriorityRanker, groupItemsByKey, mergeRankedUnique, selectUnseenPool } from "./dashboard-selectors.mjs";
import { createReaderController } from "./reader-ui.mjs";
import { createAiSearchController } from "./ai-search-ui.mjs";
import { cloneSettingsDraft, diffSettingsDraft, snapshotSettingsDraft } from "./settings-draft.mjs";
import { createInspirationPreviewController, inspirationPreviewFingerprint } from "./inspiration-preview-controller.mjs";
import {
  ACCENT_THEMES,
  DEFAULT_ACCENT_THEME,
  DEFAULT_COLOR_MODE,
  DEFAULT_CUSTOM_ACCENT_COLOR,
  normalizeAccentTheme,
  normalizeColorMode,
  normalizeHexColor,
  paletteFromAccent,
} from "./appearance-model.mjs";

const QUICK_REFERENCE_LINES = new Set(allTranslations("summary.quickReference"));
const DAILY_NEWS_COUNT = 11;
const DAILY_NEWS_BATCH_LIMIT = 3;
const DAILY_INSPIRATION_COUNT = 5;
const DAILY_INSPIRATION_BATCH_LIMIT = 3;
const HOT_SUMMARY_PAGE_SIZE = 16;
const SETTINGS_SAVE_CLOSE_DELAY_MS = 900;
const DAILY_BOARD_CARD_SELECTOR = ".news-list-card, .daily-card";
const SUMMARY_CARD_SELECTOR = ".summary-card";
const CARD_EXIT_MS = 180;
const CARD_ENTER_MS = 340;
const NEWS_CARD_TYPE = "news";
const INSPIRATION_CARD_TYPE = "inspiration";
const BOOKMARK_CARD_TYPE = "bookmark";
const LEGACY_NEWS_SECTION = "资讯";
const LEGACY_INSPIRATION_SECTION = "审美";
const ALL_FILTER = "all";
const READING_QUEUE_STORAGE_KEY = "dash.readingQueue";
const OPENED_STORAGE_KEY = "dash.opened";
const DISMISSED_STORAGE_KEY = "dash.dismissed";
const RETAINED_SEEN_STORAGE_KEY = "dash.seen.retained";
const ACTION_RECORD_LIMIT = 150;

await hydrateStorage();
const state = createInitialState();

const els = getElements();
const {
  backFloatingWeb,
  closeFloatingWeb,
  openExternal,
  openExternalWindow,
  reloadFloatingWeb,
} = createReaderController({
  state,
  els,
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
  els,
  t,
  apiPost,
  clearTopSearchFilter,
  syncNavToCurrentSection,
  localizedResponseMessage,
  localizedErrorMessage,
  openExternal,
});
const inspirationPreviews = createInspirationPreviewController({
  apiGet,
  normalizeUrl,
  isHttpUrl,
  isEnabled: () => state.settings?.webImageSearchEnabled === true && state.settings?.hasImageSearchKey === true,
  isCurrent: (item, fingerprint) => {
    const current = (state.data?.bookmarks || []).find((candidate) => candidate.key === item.key);
    return inspirationPreviewFingerprint(current, normalizeUrl) === fingerprint;
  },
  onImage: updateVisibleInspirationThumbs,
});
setLocale(getLocale(), { persist: false });
hydrateIcons(document);
let dailyBoardRenderToken = 0;
let summaryRenderToken = 0;
let dashboardLoadToken = 0;
let settingsLoadToken = 0;
let refreshPollToken = 0;
let todayClockTimer = 0;
let viewportMetricWidth = 0;
let activeDigestTitlePreview = null;
let digestTitlePreviewId = 0;
let settingsLocaleAtOpen = getLocale();
let settingsSnapshot = null;
let settingsSession = 0;
let settingsActionGeneration = 0;
let searchRenderFrame = 0;
let seenRetentionMode = null;

if ("scrollRestoration" in history) history.scrollRestoration = "manual";
initialize();

window.addEventListener("ampira:runtime-message", (event) => {
  if (event.detail?.type === "dashboard.updated") loadDashboard();
  if (event.detail?.type === "settings.changed") {
    if (els.settingsModal.classList.contains("open")) {
      inspirationPreviews.invalidate();
      els.refreshPermissionStatus?.click();
      loadDashboard();
      return;
    }
    loadSettings().then(() => {
      els.refreshPermissionStatus?.click();
      return loadDashboard();
    });
  }
  if (event.detail?.type === "refresh.progress" && state.data) {
    state.data.status = event.detail.payload;
    renderStatus();
  }
});

async function initialize() {
  syncViewportMetrics();
  resetToDailyView();
  bindEvents();
  startTodayClock();
  await Promise.all([loadSettings(), loadDashboard()]);
  renderAll();
  syncSegmentedIndicators();
  resetToDailyView();
  triggerRefresh(false);
}

function bindEvents() {
  initializePointerHighlights();
  initializeScrollSpy();
  syncNavExpandedWidth();
  document.fonts?.ready?.then(syncNavExpandedWidth).catch(() => {});
  window.addEventListener("resize", () => {
    hideDigestTitlePreview();
    syncViewportMetrics();
    syncSegmentedIndicators();
    syncNavExpandedWidth();
  });
  window.visualViewport?.addEventListener("resize", syncViewportMetrics);
  bindContextMenuEvents();
  document.addEventListener("keydown", handleGlobalSearchTyping);
  document.addEventListener("scroll", () => hideDigestTitlePreview(), true);

  document.querySelectorAll("[data-scroll]").forEach((button) => {
    button.addEventListener("click", () => {
      document.getElementById(button.dataset.scroll)?.scrollIntoView({ behavior: "smooth", block: "start" });
      setActiveNavButton(button);
    });
  });

  document.querySelector("#settingsNav").addEventListener("click", openSettings);
  els.aiSearchNav.addEventListener("click", () => openAiSearch());
  els.closeSettings.addEventListener("click", closeSettings);
  els.settingsModal.addEventListener("click", (event) => {
    if (event.target === els.settingsModal) closeSettings();
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
      hideContextMenu();
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
    if (els.settingsModal.classList.contains("open")) closeSettings();
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
    if (event.key !== "Escape") return;
    event.preventDefault();
    clearTopSearchFilter();
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
  els.headerImageFixedInput.addEventListener("change", () => {
    if (!els.headerImageFixedInput.checked) els.headerImageFullscreenInput.checked = false;
    syncHeaderImageFullscreenControl();
    updateAppearancePreview();
  });
  els.headerImageFullscreenInput.addEventListener("change", () => updateAppearancePreview());
  els.headerImageUrlInput.addEventListener("input", () => updateAppearancePreview());
  els.headerImage.addEventListener("load", () => {
    els.headerImageHero.classList.add("is-loaded");
  });
  els.headerImage.addEventListener("error", () => {
    els.headerImageHero.classList.remove("is-loaded");
    els.headerImageHero.hidden = true;
    document.documentElement.classList.remove("has-header-cover", "has-fixed-header-cover", "has-fullscreen-header-cover");
  });
  [els.apiBaseUrlInput, els.apiStyleSelect, els.modelInput, els.dailyLimitInput, els.imageSearchApiKeyInput, els.aiDisclosureConsent, els.webImageSearchEnabledInput, els.cardSummaryEnabledInput, els.cacheSizeInput, els.hotNewsPerSourceInput, els.newsPerCategoryInput, els.floatingOpenInput, els.readingQueueOpenOnReadAllInput, els.retainSeenArchiveInput, els.personalizedRankingEnabledInput, els.publicFeedSupplementEnabledInput].forEach((input) => {
    input.addEventListener("input", () => renderSettingsStatus());
    input.addEventListener("change", () => renderSettingsStatus());
  });
  els.apiBaseUrlInput.addEventListener("input", resetAiConsentForProviderChange);
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
  els.deepseekPreset.addEventListener("click", applyDeepSeekPreset);
}

function syncViewportMetrics() {
  const width = Math.max(320, document.documentElement.clientWidth || window.innerWidth || 0);
  if (Math.abs(width - viewportMetricWidth) < 0.5) return;
  viewportMetricWidth = width;
  document.documentElement.style.setProperty("--dashboard-viewport-w", `${width}px`);
  document.documentElement.style.setProperty("--dashboard-viewport-half-w", `${width / 2}px`);
}

function syncNavExpandedWidth() {
  const sidebar = document.querySelector(".sidebar");
  const buttons = [...document.querySelectorAll(".nav-btn")];
  if (!sidebar || !buttons.length) return;

  if (window.matchMedia("(max-width: 1120px)").matches) {
    sidebar.style.removeProperty("--nav-expanded-width");
    sidebar.style.removeProperty("--nav-expanded-button-width");
    sidebar.style.removeProperty("--nav-label-slot-width");
    return;
  }

  const rootStyle = getComputedStyle(document.documentElement);
  const gap = cssLength(rootStyle, "--nav-expanded-gap", 9);
  const paddingRight = cssLength(rootStyle, "--nav-expanded-button-pad-right", 11);
  const minButtonWidth = cssLength(rootStyle, "--nav-expanded-button-min", 80);
  const iconWidth = navIconWidth(buttons) || 16;
  const iconTrackWidth = cssLength(rootStyle, "--nav-icon-track-width", iconWidth);
  const labelSlotMin = lengthValue(rootStyle.getPropertyValue("--nav-label-slot-min"));
  const maxLabelWidth = Math.max(...buttons.map((button) => navLabelWidth(button)));
  const labelSlotWidth = Math.ceil(Math.max(labelSlotMin, maxLabelWidth + 8));
  const iconRight = iconTrackWidth / 2 + iconWidth / 2;
  const fittedButtonWidth = iconRight + gap + labelSlotWidth + paddingRight + 2;
  const buttonWidth = Math.ceil(Math.max(minButtonWidth, fittedButtonWidth));
  const sidebarStyle = getComputedStyle(sidebar);
  const sidebarWidth = Math.ceil(
    buttonWidth
    + lengthValue(sidebarStyle.paddingLeft)
    + lengthValue(sidebarStyle.paddingRight)
    + lengthValue(sidebarStyle.borderLeftWidth)
    + lengthValue(sidebarStyle.borderRightWidth)
  );

  sidebar.style.setProperty("--nav-expanded-button-width", `${buttonWidth}px`);
  sidebar.style.setProperty("--nav-label-slot-width", `${labelSlotWidth}px`);
  sidebar.style.setProperty("--nav-expanded-width", `${sidebarWidth}px`);
}

function navLabelWidth(button) {
  const label = button.querySelector(".nav-label");
  const text = label?.textContent?.trim() || "";
  if (!label || !text) return 0;
  const style = getComputedStyle(label);
  const canvas = syncNavExpandedWidth.canvas || (syncNavExpandedWidth.canvas = document.createElement("canvas"));
  const context = canvas.getContext("2d");
  if (!context) return label.scrollWidth || text.length * 13;
  context.font = [
    style.fontStyle,
    style.fontVariant,
    style.fontWeight,
    style.fontSize,
    style.fontFamily,
  ].filter(Boolean).join(" ");
  return context.measureText(text).width;
}

function navIconWidth(buttons) {
  for (const button of buttons) {
    const icon = button.querySelector(".nav-icon");
    const width = icon ? lengthValue(getComputedStyle(icon).width) : 0;
    if (width > 0) return width;
  }
  return 0;
}

function cssLength(style, property, fallback) {
  const value = lengthValue(style.getPropertyValue(property));
  return value > 0 ? value : fallback;
}

function lengthValue(value) {
  const number = Number.parseFloat(value);
  return Number.isFinite(number) ? number : 0;
}

function handleGlobalSearchTyping(event) {
  if (!shouldCaptureSearchTyping(event)) return;
  event.preventDefault();
  focusDashboardSearch();
  insertSearchText(event.key);
}

function shouldCaptureSearchTyping(event) {
  if (event.defaultPrevented) return false;
  if (!event.key || event.key.length !== 1) return false;
  if (event.ctrlKey || event.metaKey || event.altKey) return false;
  if (els.settingsModal.classList.contains("open")) return false;
  if (els.aiSearchOverlay.classList.contains("open")) return false;
  if (els.webFrameOverlay.classList.contains("open")) return false;
  if (!els.linkContextMenu.hidden) return false;
  return !isInteractiveTarget(event.target);
}

function isInteractiveTarget(target) {
  return Boolean(target?.closest?.("input, textarea, select, button, a[href], [role='button'], [role='link'], [role='menuitem'], [contenteditable='true'], [contenteditable='']"));
}

function focusDashboardSearch() {
  els.search.focus({ preventScroll: true });
  els.search.scrollIntoView({ behavior: "smooth", block: "center" });
}

function insertSearchText(text) {
  const start = els.search.selectionStart ?? els.search.value.length;
  const end = els.search.selectionEnd ?? start;
  const next = `${els.search.value.slice(0, start)}${text}${els.search.value.slice(end)}`;
  const cursor = start + text.length;
  els.search.value = next;
  els.search.setSelectionRange(cursor, cursor);
  els.search.dispatchEvent(new Event("input", { bubbles: true }));
}

function setIconLabel(node, icon, label, iconClass = "btn-icon", labelClass = "btn-label") {
  node.replaceChildren(createIcon(icon, iconClass), spanText(label, labelClass));
}

function bindContextMenuEvents() {
  els.linkContextMenu.addEventListener("click", (event) => {
    event.stopPropagation();
  });
  document.addEventListener("click", (event) => {
    if (els.linkContextMenu.hidden || event.target.closest("#linkContextMenu")) return;
    hideContextMenu();
  });
  document.addEventListener("scroll", hideContextMenu, { capture: true, passive: true });
  window.addEventListener("resize", hideContextMenu, { passive: true });
}

function attachLinkContextMenu(element, getLink) {
  element.addEventListener("contextmenu", (event) => {
    if (event.target.closest("button, input, select, textarea")) return;
    const link = typeof getLink === "function" ? getLink() : getLink;
    const url = String(link?.url || "").trim();
    if (!url) return;
    event.preventDefault();
    const actions = [
      {
        label: t("context.openNewTab"),
        icon: "arrow-up-right",
        action: () => {
          if (link?.item) markOpenedItem(link.item);
          openExternalWindow(url);
        },
      },
      {
        label: t("context.copyLink"),
        icon: "copy-01",
        action: () => copyToClipboard(url),
      },
    ];
    const item = link?.item;
    if (item?.feedItem?.articleId && state.settings?.personalizedRankingEnabled !== false) {
      actions.push(
        {
          label: t("context.moreLike"),
          icon: "stars-01",
          action: () => sendFeedback(item, "more_like_this"),
        },
        {
          label: t("context.notInterested"),
          icon: "slash-circle-01",
          action: () => dismissItem(item),
        },
      );
    }
    showContextMenu(event, actions);
  });
}

function attachGroupContextMenu(element, getGroup) {
  element.addEventListener("contextmenu", (event) => {
    if (event.target.closest("button, input, select, textarea")) return;
    const group = typeof getGroup === "function" ? getGroup() : getGroup;
    const links = uniqueContextLinks(group?.items || []);
    if (!links.length) return;
    event.preventDefault();
    showContextMenu(event, [
      {
        label: t("context.openAll", { count: links.length }),
        icon: "arrow-up-right",
        action: () => openContextLinks(links),
      },
    ]);
  });
}

function showContextMenu(event, actions) {
  const menu = els.linkContextMenu;
  menu.replaceChildren(...actions.map(createContextMenuButton));
  menu.hidden = false;
  menu.style.left = "0px";
  menu.style.top = "0px";
  const rect = menu.getBoundingClientRect();
  const left = Math.min(Math.max(8, event.clientX), Math.max(8, window.innerWidth - rect.width - 8));
  const top = Math.min(Math.max(8, event.clientY), Math.max(8, window.innerHeight - rect.height - 8));
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  menu.querySelector("button")?.focus({ preventScroll: true });
}

function createContextMenuButton(item) {
  const button = document.createElement("button");
  button.type = "button";
  button.setAttribute("role", "menuitem");
  setIconLabel(button, item.icon || "arrow-up-right", item.label, "menu-icon", "menu-label");
  button.addEventListener("click", async () => {
    hideContextMenu();
    await item.action();
  });
  return button;
}

function hideContextMenu() {
  if (!els.linkContextMenu || els.linkContextMenu.hidden) return;
  els.linkContextMenu.hidden = true;
  els.linkContextMenu.replaceChildren();
}

function uniqueContextLinks(items) {
  const seen = new Set();
  const links = [];
  for (const item of items || []) {
    const url = String(item?.url || itemUrl(item) || "").trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    links.push({ url, title: displayBookmarkTitle(item) });
  }
  return links;
}

function openContextLinks(links) {
  for (const link of links) openExternalWindow(link.url);
}

async function copyToClipboard(text) {
  const value = String(text || "");
  if (!value) return;
  try {
    await navigator.clipboard.writeText(value);
    return;
  } catch {
    const input = document.createElement("textarea");
    input.value = value;
    input.setAttribute("readonly", "");
    input.style.position = "fixed";
    input.style.left = "-9999px";
    document.body.append(input);
    input.select();
    document.execCommand("copy");
    input.remove();
  }
}

function initializePointerHighlights() {
  const selector = [
    ".nav-btn",
    ".efficiency-card",
    ".board-column",
    ".summary-card",
    ".category",
    ".daily-card",
    ".news-list-card",
    ".archive-card",
    ".link-row",
  ].join(", ");

  let frame = 0;
  let pointer = null;
  document.addEventListener("pointermove", (event) => {
    if (document.documentElement.dataset.pointerGlow === "off") return;
    pointer = { target: event.target, x: event.clientX, y: event.clientY };
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (!pointer || document.documentElement.dataset.pointerGlow === "off") return;
      let target = pointer.target instanceof Element ? pointer.target.closest(selector) : null;
      while (target?.isConnected) {
        const rect = target.getBoundingClientRect();
        target.style.setProperty("--mx", `${pointer.x - rect.left}px`);
        target.style.setProperty("--my", `${pointer.y - rect.top}px`);
        target = target.parentElement?.closest(selector);
      }
    });
  }, { passive: true });
}

function initializeScrollSpy() {
  const scheduleSync = () => {
    if (state.navSyncFrame) return;
    state.navSyncFrame = requestAnimationFrame(() => {
      state.navSyncFrame = 0;
      syncNavToCurrentSection();
    });
  };

  window.addEventListener("scroll", scheduleSync, { passive: true });
  window.addEventListener("resize", scheduleSync, { passive: true });
  syncNavToCurrentSection();
}

function syncNavToCurrentSection() {
  if (els.settingsModal.classList.contains("open")) return;
  setActiveNavButton(getCurrentSectionButton());
}

function setActiveNavButton(activeButton) {
  document.querySelectorAll(".nav-btn").forEach((item) => item.classList.toggle("active", item === activeButton));
}

function resetToDailyView() {
  window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  setActiveNavButton(document.querySelector("[data-scroll='daily']"));
}

function getCurrentSectionButton() {
  const buttons = [...document.querySelectorAll("[data-scroll]")];
  const activationY = Math.min(220, Math.max(120, window.innerHeight * 0.32));
  let currentButton = buttons[0] || null;

  for (const button of buttons) {
    const section = document.getElementById(button.dataset.scroll);
    if (!section) continue;
    const rect = section.getBoundingClientRect();
    if (rect.top <= activationY) currentButton = button;
    if (rect.top <= activationY && rect.bottom > activationY) return button;
  }

  return currentButton;
}

async function loadDashboard() {
  const token = ++dashboardLoadToken;
  try {
    const data = await apiGet("/api/dashboard");
    if (token !== dashboardLoadToken) return false;
    state.data = data;
    renderAll();
    return true;
  } catch (error) {
    if (token !== dashboardLoadToken) return false;
    renderConnectionError(error);
    return false;
  }
}

async function loadSettings() {
  const token = ++settingsLoadToken;
  try {
    const settings = await apiGet("/api/settings");
    if (token !== settingsLoadToken) return false;
    const imagePreviewChanged = !state.settings
      || state.settings.webImageSearchEnabled !== settings.webImageSearchEnabled
      || state.settings.hasImageSearchKey !== settings.hasImageSearchKey;
    state.settings = settings;
    if (imagePreviewChanged) inspirationPreviews.invalidate();
    syncLanguageControls(state.settings, { render: false });
    els.apiBaseUrlInput.value = state.settings.savedBaseUrl || state.settings.baseUrl || state.settings.defaultBaseUrl || "";
    els.apiStyleSelect.value = state.settings.savedApiStyle || state.settings.apiStyle || state.settings.defaultApiStyle || "responses";
    els.modelInput.value = state.settings.savedModel || state.settings.model || state.settings.defaultModel || "";
    els.modelInput.placeholder = state.settings.defaultModel || "gpt-5.4-mini";
    els.dailyLimitInput.value = state.settings.savedDailyLimit || state.settings.dailyLimit || state.settings.defaultDailyLimit || 50;
    els.dailyLimitInput.placeholder = state.settings.defaultDailyLimit || "50";
    els.cacheSizeInput.value = state.settings.savedHotNewsCacheSize || state.settings.hotNewsCacheSize || state.settings.defaultHotNewsCacheSize || 192;
    els.cacheSizeInput.placeholder = state.settings.defaultHotNewsCacheSize || "192";
    els.hotNewsPerSourceInput.value = state.settings.savedHotNewsEntriesPerSource === ""
      ? (state.settings.hotNewsEntriesPerSource ?? state.settings.defaultHotNewsEntriesPerSource ?? 5)
      : (state.settings.savedHotNewsEntriesPerSource ?? state.settings.hotNewsEntriesPerSource ?? state.settings.defaultHotNewsEntriesPerSource ?? 5);
    els.hotNewsPerSourceInput.placeholder = state.settings.defaultHotNewsEntriesPerSource || "5";
    els.newsPerCategoryInput.value = state.settings.savedNewsEntriesPerCategory === ""
      ? (state.settings.newsEntriesPerCategory ?? state.settings.defaultNewsEntriesPerCategory ?? 12)
      : (state.settings.savedNewsEntriesPerCategory ?? state.settings.newsEntriesPerCategory ?? state.settings.defaultNewsEntriesPerCategory ?? 12);
    els.newsPerCategoryInput.placeholder = state.settings.defaultNewsEntriesPerCategory || "12";
    syncBookmarkFolderControls(state.settings);
    els.cardSummaryEnabledInput.checked = state.settings.cardSummaryEnabled !== false;
    els.floatingOpenInput.checked = state.settings.floatingWebOpenEnabled !== false;
    els.readingQueueOpenOnReadAllInput.checked = state.settings.readingQueueOpenOnReadAll !== false;
    els.retainSeenArchiveInput.checked = state.settings.retainSeenArchive === true;
    els.personalizedRankingEnabledInput.checked = state.settings.personalizedRankingEnabled !== false;
    els.publicFeedSupplementEnabledInput.checked = state.settings.publicFeedSupplementEnabled !== false;
    els.webImageSearchEnabledInput.checked = state.settings.webImageSearchEnabled !== false;
    els.aiDisclosureConsent.checked = state.settings.aiDisclosureAccepted === true;
    syncSeenArchiveRetention({ render: false });
    syncAppearanceControls(state.settings);
    applyAppearanceSettings(state.settings);
    els.apiKeyInput.placeholder = state.settings.maskedKey || "sk-...";
    els.imageSearchApiKeyInput.placeholder = state.settings.maskedImageSearchKey || "BSA...";
    renderExcludeFolderOptions();
    renderExclusionList();
    renderSettingsStatus();
    return true;
  } catch (error) {
    if (token !== settingsLoadToken) return false;
    els.settingsStatus.textContent = t("settings.status.loadFailed", { message: error.message || error });
    return false;
  }
}

async function triggerRefresh(force) {
  if (!state.data) return;
  els.refresh.disabled = true;
  try {
    const result = await apiPost(`/api/refresh${force ? "?force=1" : ""}`);
    if (state.data && result.status) {
      state.data.status = result.status;
      renderStatus();
    }
    if (result.started || result.status?.running) startPolling();
    else await loadDashboard();
  } catch (error) {
    renderOverviewStatus(t("status.refreshRequestFailed"), localizedErrorMessage(error));
  } finally {
    els.refresh.disabled = Boolean(state.data?.status?.running);
  }
}

function startPolling() {
  if (state.pollTimer) clearTimeout(state.pollTimer);
  const token = ++refreshPollToken;
  const poll = async () => {
    state.pollTimer = null;
    try {
      const status = await apiGet("/api/refresh");
      if (token !== refreshPollToken) return;
      if (state.data) {
        state.data.status = status;
        renderStatus();
      }
      if (status.running) {
        state.pollTimer = setTimeout(poll, 2500);
        return;
      }
      await loadDashboard();
    } catch (error) {
      if (token !== refreshPollToken) return;
      renderOverviewStatus(t("status.refreshStatusFailed"), localizedErrorMessage(error));
    }
  };
  state.pollTimer = setTimeout(poll, 2500);
}

async function saveSettings() {
  const session = settingsSession;
  settingsActionGeneration += 1;
  setSettingsBusy(true);
  try {
    const draft = {
      openaiApiKey: els.apiKeyInput.value,
      openaiBaseUrl: els.apiBaseUrlInput.value,
      openaiApiStyle: els.apiStyleSelect.value,
      openaiSummaryModel: els.modelInput.value,
      braveSearchApiKey: els.imageSearchApiKeyInput.value,
      aiDisclosureAccepted: els.aiDisclosureConsent.checked,
      webImageSearchEnabled: els.webImageSearchEnabledInput.checked,
      dailyAiLimit: els.dailyLimitInput.value,
      cardSummaryEnabled: els.cardSummaryEnabledInput.checked,
      hotNewsCacheSize: els.cacheSizeInput.value,
      hotNewsEntriesPerSource: els.hotNewsPerSourceInput.value,
      newsEntriesPerCategory: els.newsPerCategoryInput.value,
      ...bookmarkSourcePayload(),
      floatingWebOpenEnabled: els.floatingOpenInput.checked,
      readingQueueOpenOnReadAll: els.readingQueueOpenOnReadAllInput.checked,
      retainSeenArchive: els.retainSeenArchiveInput.checked,
      personalizedRankingEnabled: els.personalizedRankingEnabledInput.checked,
      publicFeedSupplementEnabled: els.publicFeedSupplementEnabledInput.checked,
      ...appearancePayload(),
      excludedNewsSources: currentExcludedNewsSources()
    };
    const payload = diffSettingsDraft(draft, settingsSnapshot);
    const savedSettings = await apiPost("/api/settings", payload);
    if (session !== settingsSession) return;
    state.settings = savedSettings;
    syncSeenArchiveRetention();
    const bookmarkSourceChanged = state.settings?.bookmarkSourceChanged === true;
    const localeChanged = state.settings?.localeChanged === true;
    const imageSearchChanged = state.settings?.imageSearchChanged === true;
    resetSecretDrafts();
    if (imageSearchChanged) {
      inspirationPreviews.invalidate();
    }
    syncBookmarkFolderControls(state.settings);
    syncAppearanceControls(state.settings);
    applyAppearanceSettings(state.settings);
    applyUiLocale(state.settings.uiLocale || selectedUiLocale(), { persist: true });
    settingsLocaleAtOpen = getLocale();
    renderExclusionList();
    renderSettingsStatus(t(bookmarkSourceChanged
      ? "settings.status.savedRefreshing"
      : localeChanged ? "settings.status.savedLocale" : "settings.status.saved"));
    await wait(SETTINGS_SAVE_CLOSE_DELAY_MS);
    if (session === settingsSession && els.settingsModal.classList.contains("open")) closeSettings(true);
    await loadDashboard();
    if (bookmarkSourceChanged) await triggerRefresh(true);
  } catch (error) {
    if (session !== settingsSession) return;
    renderSettingsStatus(t("settings.status.saveFailed", { message: error.message || error }));
  } finally {
    if (session === settingsSession || !els.settingsModal.classList.contains("open")) setSettingsBusy(false);
  }
}

function testKey() {
  return runSettingsAction(async (isCurrent) => {
    renderSettingsStatus(t("settings.test.testing"));
    try {
      const result = await apiPost("/api/settings/test", {
        openaiApiKey: els.apiKeyInput.value,
        openaiBaseUrl: els.apiBaseUrlInput.value,
        openaiApiStyle: els.apiStyleSelect.value,
        openaiSummaryModel: els.modelInput.value,
        aiDisclosureAccepted: els.aiDisclosureConsent.checked,
      });
      if (!isCurrent()) return;
      renderSettingsStatus(result.ok
        ? t("settings.test.success")
        : t("settings.test.failed", { message: localizedResponseMessage(result, "error.requestFailed") }));
    } catch (error) {
      if (isCurrent()) renderSettingsStatus(t("settings.test.failed", { message: localizedErrorMessage(error) }));
    }
  });
}

function testImageSearchKey() {
  return runSettingsAction(async (isCurrent) => {
    renderSettingsStatus(t("settings.imageTest.testing"));
    try {
      const result = await apiPost("/api/settings/image-search/test", {
        braveSearchApiKey: els.imageSearchApiKeyInput.value,
      });
      if (!isCurrent()) return;
      renderSettingsStatus(t(result.ok ? "settings.imageTest.success" : "settings.imageTest.failed", {
        message: localizedResponseMessage(result, "error.requestFailed"),
      }));
    } catch (error) {
      if (isCurrent()) renderSettingsStatus(t("settings.imageTest.failed", { message: localizedErrorMessage(error) }));
    }
  });
}

function clearImageSearchKey() {
  return runSettingsAction(async (isCurrent) => {
    try {
      const settings = await apiPost("/api/settings", { clearBraveSearchApiKey: true });
      if (!isCurrent()) return;
      state.settings = settings;
      els.imageSearchApiKeyInput.value = "";
      els.imageSearchApiKeyInput.placeholder = state.settings.maskedImageSearchKey || "BSA...";
      renderSettingsStatus(t("settings.imageKey.removed"));
    } catch (error) {
      if (isCurrent()) renderSettingsStatus(t("settings.imageKey.removeFailed", { message: localizedErrorMessage(error) }));
    }
  });
}

function clearKey() {
  return runSettingsAction(async (isCurrent) => {
    try {
      const settings = await apiPost("/api/settings", { clearOpenAIKey: true });
      if (!isCurrent()) return;
      state.settings = settings;
      syncSeenArchiveRetention();
      const bookmarkSourceChanged = state.settings?.bookmarkSourceChanged === true;
      els.apiKeyInput.value = "";
      syncBookmarkFolderControls(state.settings);
      syncAppearanceControls(state.settings);
      applyAppearanceSettings(state.settings);
      renderExclusionList();
      renderSettingsStatus(t(bookmarkSourceChanged ? "settings.key.clearedRefreshing" : "settings.key.cleared"));
      await loadDashboard();
      if (isCurrent() && bookmarkSourceChanged) await triggerRefresh(true);
    } catch (error) {
      if (isCurrent()) renderSettingsStatus(t("settings.key.clearFailed", { message: localizedErrorMessage(error) }));
    }
  });
}

function clearCache() {
  return runSettingsAction(async (isCurrent) => {
    renderSettingsStatus(t("settings.cache.clearing"));
    try {
      const result = await apiPost("/api/cache/clear");
      if (!isCurrent()) return;
      if (!result.ok) throw new Error(localizedResponseMessage(result, "error.requestFailed"));
      renderSettingsStatus(localizedResponseMessage(result, "settings.cache.cleared"));
      await loadDashboard();
    } catch (error) {
      if (isCurrent()) renderSettingsStatus(t("settings.cache.clearFailed", { message: localizedErrorMessage(error) }));
    }
  });
}

function resetQuota() {
  return runSettingsAction(async (isCurrent) => {
    renderSettingsStatus(t("settings.quota.resetting"));
    try {
      const result = await apiPost("/api/quota/reset");
      if (!isCurrent()) return;
      if (!result.ok) throw new Error(localizedResponseMessage(result, "error.requestFailed"));
      if (state.data?.ai && result.quota) {
        state.data.ai.usedToday = result.quota.usedToday;
        state.data.ai.dailyLimit = result.quota.dailyLimit;
        renderStatus();
      }
      renderSettingsStatus(localizedResponseMessage(result, "settings.quota.reset"));
      await loadDashboard();
    } catch (error) {
      if (isCurrent()) renderSettingsStatus(t("settings.quota.resetFailed", { message: localizedErrorMessage(error) }));
    }
  });
}

function resetPreferences() {
  return runSettingsAction(async (isCurrent) => {
    renderSettingsStatus(t("settings.preferences.clearing"));
    try {
      const result = await apiPost("/api/preferences/reset");
      if (!isCurrent()) return;
      if (!result.ok) throw new Error(localizedResponseMessage(result, "error.requestFailed"));
      renderSettingsStatus(localizedResponseMessage(result, "settings.preferences.cleared"));
      await loadDashboard();
    } catch (error) {
      if (isCurrent()) renderSettingsStatus(t("settings.preferences.clearFailed", { message: localizedErrorMessage(error) }));
    }
  });
}

function currentExcludedNewsSources() {
  return Array.isArray(state.settings?.excludedNewsSources) ? state.settings.excludedNewsSources : [];
}

function availableNewsFolders() {
  const settingsFolders = Array.isArray(state.settings?.availableNewsFolders) ? state.settings.availableNewsFolders : [];
  if (settingsFolders.length) return settingsFolders;
  const folders = [];
  for (const section of state.data?.sections || []) {
    if (section.cardType !== NEWS_CARD_TYPE) continue;
    for (const category of section.categories || []) {
      const name = String(category.name || "").trim();
      if (!name) continue;
      folders.push({
        type: "folder",
        section: section.name,
        category: name,
        folderPath: name,
        value: `${section.name}/${name}`,
        title: `${section.name} / ${name}`,
        count: Number(category.count || 0),
      });
    }
  }
  return folders;
}

function renderExcludeFolderOptions() {
  const folders = availableNewsFolders();
  const previousValue = els.excludeFolderSelect.value;
  if (!folders.length) {
    const option = new Option(t("exclusion.noFolders"), "");
    els.excludeFolderSelect.replaceChildren(option);
    els.excludeFolderSelect.disabled = true;
    els.addExcludeFolder.disabled = true;
    return;
  }
  const excluded = new Set(currentExcludedNewsSources().map(exclusionClientIdentity).filter(Boolean));
  const options = folders.map((folder) => {
    const value = folder.value || folderExclusionValue(folder);
    const count = Number(folder.count || 0);
    const label = `${folder.title || folderDisplayName(folder)}${count ? ` (${count})` : ""}`;
    const option = new Option(excluded.has(exclusionClientIdentity({ ...folder, type: "folder", value }))
      ? t("exclusion.optionBlocked", { label })
      : label, value);
    option.dataset.section = folder.section || newsSectionName();
    option.dataset.category = folder.category || "";
    option.dataset.folderPath = folder.folderPath || folder.category || "";
    option.dataset.title = folder.title || folderDisplayName(folder);
    option.dataset.count = String(count);
    option.disabled = excluded.has(exclusionClientIdentity({ ...folder, type: "folder", value }));
    return option;
  });
  els.excludeFolderSelect.replaceChildren(...options);
  els.excludeFolderSelect.disabled = false;
  els.addExcludeFolder.disabled = false;
  if (previousValue && [...els.excludeFolderSelect.options].some((option) => option.value === previousValue && !option.disabled)) {
    els.excludeFolderSelect.value = previousValue;
  } else {
    const firstAvailable = [...els.excludeFolderSelect.options].find((option) => !option.disabled);
    els.excludeFolderSelect.value = firstAvailable?.value || "";
  }
  els.addExcludeFolder.disabled = !els.excludeFolderSelect.value || els.excludeFolderSelect.selectedOptions[0]?.disabled;
}

function addNewsExclusion() {
  const value = els.excludeInput.value.trim();
  if (!value) {
    renderSettingsStatus(t("exclusion.enterSource"));
    return;
  }
  const list = currentExcludedNewsSources();
  const identity = exclusionClientIdentity({ value });
  if (identity && list.some((item) => exclusionClientIdentity(item) === identity)) {
    renderSettingsStatus(t("exclusion.alreadyBlocked"));
    return;
  }
  state.settings = {
    ...(state.settings || {}),
    excludedNewsSources: [
      ...list,
      {
        id: `manual-${Date.now()}`,
        value,
        title: value,
        reasonKey: "exclusion.reason.manual",
        addedAt: new Date().toISOString(),
        streak: 0,
      },
    ],
  };
  els.excludeInput.value = "";
  renderExclusionList();
  renderSettingsStatus(t("exclusion.added"));
}

function addNewsFolderExclusion() {
  const option = els.excludeFolderSelect.selectedOptions[0];
  if (!option?.value) {
    renderSettingsStatus(t("exclusion.selectFolder"));
    return;
  }
  const folder = {
    type: "folder",
    value: option.value,
    section: option.dataset.section || newsSectionName(),
    category: option.dataset.category || option.dataset.folderPath || option.textContent,
    folderPath: option.dataset.folderPath || option.dataset.category || "",
    title: option.dataset.title || option.textContent,
  };
  const list = currentExcludedNewsSources();
  const identity = exclusionClientIdentity(folder);
  if (identity && list.some((item) => exclusionClientIdentity(item) === identity)) {
    renderSettingsStatus(t("exclusion.folderAlreadyBlocked"));
    return;
  }
  state.settings = {
    ...(state.settings || {}),
    excludedNewsSources: [
      ...list,
      {
        id: `folder-${Date.now()}`,
        ...folder,
        reasonKey: "exclusion.reason.manualFolder",
        addedAt: new Date().toISOString(),
        streak: 0,
      },
    ],
  };
  renderExclusionList();
  renderSettingsStatus(t("exclusion.folderAdded"));
}

function removeNewsExclusion(id) {
  const list = currentExcludedNewsSources();
  state.settings = {
    ...(state.settings || {}),
    excludedNewsSources: list.filter((item, index) => exclusionClientId(item, index) !== id),
  };
  renderExclusionList();
  renderSettingsStatus(t("exclusion.restored"));
}

function clearSourceSuggestions() {
  const checked = Number(sourceQualitySummary().checked || 0);
  if (!checked) {
    renderSettingsStatus(t("exclusion.suggestionsEmpty"));
    return Promise.resolve();
  }
  if (!window.confirm(t("exclusion.clearSuggestionsConfirm", { count: checked }))) return Promise.resolve();
  return runSettingsAction(async (isCurrent) => {
    try {
      const result = await apiPost("/api/source-quality/reset");
      if (!isCurrent()) return;
      const sourceQuality = result.sourceQuality || { checked: 0, reviewCount: 0, keepCount: 0, suggestions: [] };
      if (state.data) state.data.sourceQuality = sourceQuality;
      if (state.settings) state.settings.sourceQuality = sourceQuality;
      renderExclusionList();
      renderSettingsStatus(localizedResponseMessage(result, "exclusion.suggestionsCleared"));
    } catch (error) {
      if (isCurrent()) renderSettingsStatus(t("exclusion.clearSuggestionsFailed", { message: localizedErrorMessage(error) }));
    }
  });
}

function blockAllSourceSuggestions() {
  const suggestions = actionableSourceSuggestions();
  if (!suggestions.length) return;
  if (!window.confirm(t("exclusion.blockAllConfirm", { count: suggestions.length }))) return;
  const addedAt = new Date().toISOString();
  const timestamp = Date.now();
  const next = [...currentExcludedNewsSources()];
  suggestions.forEach((suggestion, index) => {
    if (sourceSuggestionAlreadyExcluded(suggestion, next)) return;
    next.push({
      id: `suggested-${timestamp}-${index}`,
      ...sourceSuggestionDraft(suggestion),
      addedAt,
    });
  });
  const addedCount = next.length - currentExcludedNewsSources().length;
  state.settings = {
    ...(state.settings || {}),
    excludedNewsSources: next,
  };
  renderExclusionList();
  renderSettingsStatus(t("exclusion.blockAllAdded", { count: addedCount }));
}

function renderExclusionList() {
  const list = currentExcludedNewsSources();
  renderExcludeFolderOptions();
  renderSourceSuggestionList();
  syncSourceSuggestionActionState();
  els.exclusionStatus.textContent = list.length
    ? tc("exclusion.ruleCount", list.length)
    : t("exclusion.keepAll");
  if (!list.length) {
    els.exclusionList.replaceChildren(createEmptyState({
      title: t("exclusion.empty.title"),
      body: t("exclusion.empty.body"),
      variant: "compact",
    }));
    return;
  }
  els.exclusionList.replaceChildren(...list.map(createExclusionRow));
}

function renderSourceSuggestionList() {
  if (!els.sourceSuggestionList || !els.sourceSuggestionStatus) return;
  const summary = sourceQualitySummary();
  const checked = Number(summary.checked || 0);
  const suggestions = actionableSourceSuggestions();
  els.sourceSuggestionStatus.textContent = suggestions.length
    ? tc("exclusion.pendingSuggestions", suggestions.length)
    : t(checked ? "exclusion.nonePending" : "exclusion.waitingStats");
  if (!suggestions.length) {
    els.sourceSuggestionList.replaceChildren(createEmptyState({
      title: t("exclusion.suggestionEmpty.title"),
      body: t(checked ? "exclusion.suggestionEmpty.checked" : "exclusion.suggestionEmpty.waiting"),
      variant: "compact",
    }));
    return;
  }
  els.sourceSuggestionList.replaceChildren(...suggestions.slice(0, 8).map(createSourceSuggestionRow));
}

function actionableSourceSuggestions() {
  const suggestions = Array.isArray(sourceQualitySummary().suggestions) ? sourceQualitySummary().suggestions : [];
  const excluded = currentExcludedNewsSources();
  return suggestions.filter((suggestion) => suggestion?.action
    && suggestion.action !== "keep"
    && sourceSuggestionDraft(suggestion).value
    && !sourceSuggestionAlreadyExcluded(suggestion, excluded));
}

function syncSourceSuggestionActionState(busy = false) {
  els.clearSourceSuggestions.disabled = busy || !Number(sourceQualitySummary().checked || 0);
  els.blockAllSuggestions.disabled = busy || !actionableSourceSuggestions().length;
}

function sourceQualitySummary() {
  return state.data?.sourceQuality || state.settings?.sourceQuality || {};
}

function sourceSuggestionAlreadyExcluded(suggestion, excluded) {
  const suggestionIdentity = exclusionClientIdentity(sourceSuggestionDraft(suggestion));
  return excluded.some((item) => {
    if (item?.sourceKey && suggestion?.sourceKey && item.sourceKey === suggestion.sourceKey) return true;
    return suggestionIdentity && exclusionClientIdentity(item) === suggestionIdentity;
  });
}

function createSourceSuggestionRow(suggestion) {
  const row = document.createElement("div");
  row.className = `source-suggestion-row is-${suggestion.action || "neutral"}`;
  const main = document.createElement("div");
  main.className = "source-suggestion-main";
  const title = document.createElement("div");
  title.className = "source-suggestion-title";
  title.textContent = suggestion.title || suggestion.host || t("exclusion.unnamedSource");
  const meta = document.createElement("div");
  meta.className = "source-suggestion-meta";
  const checks = Number(suggestion.checks || 0);
  meta.textContent = [localizedSourceLabel(suggestion.label, suggestion.labelKey), localizedSourceReason(suggestion.reason, suggestion.reasonKey), checks ? t("exclusion.recentChecks", { count: checks }) : ""].filter(Boolean).join(" · ");
  main.append(title, meta);
  const action = document.createElement("button");
  action.className = "btn";
  action.type = "button";
  setIconLabel(action, "block", t("settings.exclusions.block"));
  action.addEventListener("click", () => addSuggestedNewsExclusion(suggestion));
  row.append(main, action);
  return row;
}

function addSuggestedNewsExclusion(suggestion) {
  const draft = sourceSuggestionDraft(suggestion);
  if (!draft.value) {
    renderSettingsStatus(t("exclusion.missingValue"));
    return;
  }
  const list = currentExcludedNewsSources();
  if (sourceSuggestionAlreadyExcluded(suggestion, list)) {
    renderSettingsStatus(t("exclusion.alreadyBlocked"));
    return;
  }
  state.settings = {
    ...(state.settings || {}),
    excludedNewsSources: [
      ...list,
      {
        id: `suggested-${Date.now()}`,
        ...draft,
        addedAt: new Date().toISOString(),
      },
    ],
  };
  renderExclusionList();
  renderSettingsStatus(t("exclusion.added"));
}

function sourceSuggestionDraft(suggestion = {}) {
  const value = suggestion.host || suggestion.url || "";
  const reasonDetail = [localizedSourceLabel(suggestion.label, suggestion.labelKey), localizedSourceReason(suggestion.reason, suggestion.reasonKey)].filter(Boolean).join(" · ");
  return {
    value,
    host: suggestion.host || "",
    url: suggestion.url || "",
    sourceKey: suggestion.sourceKey || "",
    title: suggestion.title || suggestion.host || value || t("exclusion.unnamedSource"),
    reasonKey: "exclusion.reason.suggestion",
    reasonDetail,
    streak: Number(suggestion.consecutiveFailures || 0),
  };
}

function createExclusionRow(item, index) {
  const row = document.createElement("div");
  row.className = "exclude-row";
  const main = document.createElement("div");
  main.className = "exclude-main";
  const title = document.createElement("div");
  title.className = "exclude-title";
  title.textContent = item.title || folderDisplayName(item) || item.host || item.value || t("exclusion.unnamedSource");
  const meta = document.createElement("div");
  meta.className = "exclude-meta";
  const added = item.addedAt ? formatDateTime(item.addedAt) : t("exclusion.timeUnknown");
  const streak = Number(item.streak || 0);
  const streakText = streak > 0 ? t("exclusion.streak", { count: streak }) : "";
  const targetText = item.type === "folder" ? t("exclusion.folderTarget", { name: folderDisplayName(item) }) : (item.host || item.value || "-");
  meta.textContent = t("exclusion.meta", { target: targetText, streak: streakText, added });
  const reason = document.createElement("div");
  reason.className = "exclude-reason";
  reason.textContent = localizedExclusionReason(item);
  main.append(title, meta, reason);
  const action = document.createElement("button");
  action.className = "btn";
  action.type = "button";
  setIconLabel(action, "refresh-cw-01", t("exclusion.restore"));
  action.addEventListener("click", () => removeNewsExclusion(exclusionClientId(item, index)));
  row.append(main, action);
  return row;
}

function exclusionClientId(item, index) {
  return item.id || exclusionClientIdentity(item) || `exclude-${index}`;
}

function exclusionClientIdentity(item) {
  if (isFolderExclusion(item)) return `folder:${folderExclusionValue(item)}`;
  const value = String(item?.value || item?.url || item?.host || "").trim();
  if (!value) return "";
  try {
    const parsed = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`);
    const host = parsed.hostname.replace(/^www\./, "").toLowerCase();
    const path = parsed.pathname.replace(/\/+$/, "");
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value) && path && path !== "/") return `url:${normalizeUrl(parsed.toString())}`;
    return `host:${host}`;
  } catch {
    return `host:${value.replace(/^www\./, "").toLowerCase()}`;
  }
}

function isFolderExclusion(item) {
  if (item?.type === "folder") return true;
  const id = String(item?.id || "");
  const reason = String(item?.reason || "");
  const isLegacyFolderReason = allTranslations("exclusion.reason.manualFolder").some((value) => reason.includes(value));
  return (id.startsWith("folder-") || item?.reasonKey === "exclusion.reason.manualFolder" || isLegacyFolderReason)
    && Boolean(folderExclusionValue(item));
}

function folderExclusionValue(item) {
  const rawValue = String(item?.value || "").trim();
  if (rawValue && /[\\/／]/.test(rawValue)) return normalizeFolderValue(rawValue);
  const section = String(item?.section || newsSectionName()).trim() || newsSectionName();
  const folderPath = stripFolderSection(normalizeFolderPath(item?.folderPath || item?.category || item?.title || rawValue), section);
  return normalizeFolderValue(`${section}/${folderPath}`);
}

function folderDisplayName(item) {
  const section = String(item?.section || newsSectionName()).trim() || newsSectionName();
  const folderPath = stripFolderSection(normalizeFolderPath(item?.folderPath || item?.category || item?.title || ""), section);
  if (!folderPath) return "";
  return `${section} / ${folderPath.replace(/\//g, " / ")}`;
}

function stripFolderSection(folderPath, section) {
  const parts = normalizeFolderPath(folderPath).split("/").filter(Boolean);
  if (parts[0] === section) parts.shift();
  return parts.join("/");
}

function normalizeFolderValue(value) {
  const parts = String(value || "")
    .split(/[\\/]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (!parts.length) return "";
  const knownSections = new Set([
    ...(state.data?.sections || []).map((section) => section.name),
    LEGACY_NEWS_SECTION,
    LEGACY_INSPIRATION_SECTION,
  ]);
  if (!knownSections.has(parts[0])) parts.unshift(newsSectionName());
  return parts.join("/");
}

function normalizeFolderPath(value) {
  return String(value || "")
    .split(/[\\/]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .join("/");
}

async function openSettings() {
  const session = ++settingsSession;
  settingsActionGeneration += 1;
  settingsLocaleAtOpen = getLocale();
  settingsSnapshot = snapshotSettingsDraft(state.settings, selectedUiLocale());
  resetSecretDrafts();
  document.querySelectorAll(".nav-btn").forEach((item) => item.classList.toggle("active", item.id === "settingsNav"));
  els.settingsModal.classList.add("open");
  els.apiKeyInput.focus({ preventScroll: true });
  setSettingsBusy(true);
  try {
    if (await loadSettings() && session === settingsSession) settingsSnapshot = snapshotSettingsDraft(state.settings, selectedUiLocale());
  } finally {
    if (session === settingsSession) setSettingsBusy(false);
  }
}

function closeSettings(commit = false) {
  const shouldCommit = commit === true;
  settingsSession += 1;
  settingsActionGeneration += 1;
  resetSecretDrafts();
  els.settingsModal.classList.remove("open");
  setSettingsBusy(false);
  if (!shouldCommit && settingsSnapshot) {
    state.settings = cloneSettingsDraft(settingsSnapshot);
    syncBookmarkFolderControls(state.settings);
    syncAppearanceControls(state.settings);
    applyAppearanceSettings(state.settings);
    renderExcludeFolderOptions();
    renderExclusionList();
    renderSettingsStatus();
  }
  applyUiLocale(state.settings?.uiLocale || settingsLocaleAtOpen, { persist: true });
  resetSecretDrafts();
  window.setTimeout(() => {
    if (!els.settingsModal.classList.contains("open")) resetSecretDrafts();
  }, 0);
  settingsSnapshot = null;
  syncNavToCurrentSection();
}

function resetSecretDrafts() {
  els.apiKeyInput.value = "";
  els.imageSearchApiKeyInput.value = "";
}


function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  if (allTranslations("action.reorganize").some((value) => label.includes(value))) return "refresh-cw-01";
  return "arrow-up-right";
}

function clearTopSearchFilter() {
  if (!els.search.value && !state.query) return;
  if (searchRenderFrame) cancelAnimationFrame(searchRenderFrame);
  searchRenderFrame = 0;
  els.search.value = "";
  state.query = "";
  renderDaily();
  renderSummaries();
  renderCategories();
}

function scheduleSearchRender() {
  if (searchRenderFrame) return;
  searchRenderFrame = requestAnimationFrame(() => {
    searchRenderFrame = 0;
    renderDaily();
    renderSummaries();
    renderCategories();
    syncNavToCurrentSection();
  });
}

function setSettingsBusy(busy) {
  els.saveSettings.disabled = busy;
  els.testKey.disabled = busy;
  els.clearKey.disabled = busy;
  els.testImageSearchKey.disabled = busy;
  els.clearImageSearchKey.disabled = busy;
  els.clearCache.disabled = busy;
  els.resetQuota.disabled = busy;
  els.resetPreferences.disabled = busy;
  els.deepseekPreset.disabled = busy;
  els.cardSummaryEnabledInput.disabled = busy;
  els.floatingOpenInput.disabled = busy;
  els.readingQueueOpenOnReadAllInput.disabled = busy;
  els.retainSeenArchiveInput.disabled = busy;
  els.personalizedRankingEnabledInput.disabled = busy;
  els.publicFeedSupplementEnabledInput.disabled = busy;
  els.uiLocaleSelect.disabled = busy;
  els.webImageSearchEnabledInput.disabled = busy;
  els.aiDisclosureConsent.disabled = busy;
  els.newsBookmarkFolderSelect.disabled = busy;
  els.inspirationBookmarkFolderSelect.disabled = busy;
  els.bookmarkOnlyFolderSelect.disabled = busy || !els.bookmarkOnlyFolderSelect.value;
  els.addBookmarkOnlyFolder.disabled = busy || !els.bookmarkOnlyFolderSelect.value;
  els.customAccentInput.disabled = busy;
  els.pointerGlowEnabledInput.disabled = busy;
  els.headerImageEnabledInput.disabled = busy;
  els.headerImageFixedInput.disabled = busy;
  syncHeaderImageFullscreenControl(busy);
  els.headerImageUrlInput.disabled = busy;
  els.colorModeGroup.querySelectorAll("button[data-color-mode]").forEach((button) => {
    button.disabled = busy;
  });
  els.accentThemeGroup.querySelectorAll("button[data-accent-theme]").forEach((button) => {
    button.disabled = busy;
  });
  els.excludeInput.disabled = busy;
  els.addExclude.disabled = busy;
  els.excludeFolderSelect.disabled = busy || !availableNewsFolders().length;
  els.addExcludeFolder.disabled = busy || !els.excludeFolderSelect.value;
  syncSourceSuggestionActionState(busy);
  els.sourceSuggestionList?.querySelectorAll("button").forEach((button) => {
    button.disabled = busy;
  });
  els.exclusionList.querySelectorAll("button").forEach((button) => {
    button.disabled = busy;
  });
  els.bookmarkOnlyFolderList.querySelectorAll("button").forEach((button) => {
    button.disabled = busy;
  });
}

async function runSettingsAction(action) {
  const session = settingsSession;
  const generation = ++settingsActionGeneration;
  const isCurrent = () => session === settingsSession
    && generation === settingsActionGeneration
    && els.settingsModal.classList.contains("open");
  setSettingsBusy(true);
  try {
    await action(isCurrent);
  } finally {
    if (isCurrent()) setSettingsBusy(false);
  }
}

function selectSettingsTab(tab) {
  for (const button of els.settingsTabs.querySelectorAll("button[data-settings-tab]")) {
    const active = button.dataset.settingsTab === tab;
    button.classList.toggle("active", active);
  }
  for (const panel of els.settingsForm.querySelectorAll("[data-settings-panel]")) {
    panel.classList.toggle("active", panel.dataset.settingsPanel === tab);
  }
  if (tab === "appearance") syncSegmentedIndicator(els.colorModeGroup);
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

function syncBookmarkFolderControls(settings = {}) {
  const options = Array.isArray(settings.bookmarkFolderOptions) ? settings.bookmarkFolderOptions : [];
  syncBookmarkFolderSelect(els.newsBookmarkFolderSelect, options, settings.newsBookmarkFolder || settings.defaultNewsBookmarkFolder);
  syncBookmarkFolderSelect(els.inspirationBookmarkFolderSelect, options, settings.inspirationBookmarkFolder || settings.defaultInspirationBookmarkFolder);
  syncBookmarkOnlyFolderControls();
  renderBookmarkSourceStatus();
}

function syncBookmarkOnlyFolderControls() {
  const options = bookmarkOnlyFolderOptions();
  syncBookmarkFolderSelect(els.bookmarkOnlyFolderSelect, options, options[0]?.name || "");
  const canAdd = Boolean(els.bookmarkOnlyFolderSelect.value);
  els.bookmarkOnlyFolderSelect.disabled = !canAdd;
  els.addBookmarkOnlyFolder.disabled = !canAdd;
  renderBookmarkOnlyFolderList();
}

function syncBookmarkFolderSelect(select, options, selectedValue) {
  const selected = String(selectedValue || "").trim();
  const normalizedOptions = options
    .map((option) => ({
      name: String(option?.name || "").trim(),
      count: Number(option?.count || 0),
    }))
    .filter((option) => option.name);
  const hasSelected = normalizedOptions.some((option) => option.name === selected);
  const optionNodes = [];
  if (!normalizedOptions.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = t("settings.bookmarks.none");
    option.disabled = true;
    optionNodes.push(option);
  } else if (selected && !hasSelected) {
    const option = document.createElement("option");
    option.value = selected;
    option.textContent = t("settings.bookmarks.notFound", { name: selected });
    optionNodes.push(option);
  }
  for (const item of normalizedOptions) {
    const option = document.createElement("option");
    option.value = item.name;
    option.textContent = t("settings.bookmarks.folderOption", { name: item.name, count: item.count });
    optionNodes.push(option);
  }
  select.replaceChildren(...optionNodes);
  if (selected && (hasSelected || normalizedOptions.length > 0)) {
    select.value = selected;
  } else {
    select.value = normalizedOptions[0]?.name || "";
  }
}

function bookmarkSourcePayload() {
  return {
    newsBookmarkFolder: els.newsBookmarkFolderSelect.value,
    inspirationBookmarkFolder: els.inspirationBookmarkFolderSelect.value,
    bookmarkOnlyFolders: currentBookmarkOnlyFolders(),
  };
}

function renderBookmarkSourceStatus() {
  const news = els.newsBookmarkFolderSelect.value || "-";
  const inspiration = els.inspirationBookmarkFolderSelect.value || "-";
  const same = news && inspiration && news === inspiration;
  const extra = currentBookmarkOnlyFolders();
  els.bookmarkSourceStatus.textContent = same
    ? t("settings.bookmarks.same")
    : t("settings.bookmarks.summary", {
      news,
      inspiration,
      extra: extra.length ? formatLocaleList(extra) : t("settings.bookmarks.notAdded"),
    });
}

function bookmarkPrimaryFolders() {
  return new Set([
    els.newsBookmarkFolderSelect.value || state.settings?.newsBookmarkFolder || state.settings?.defaultNewsBookmarkFolder || "",
    els.inspirationBookmarkFolderSelect.value || state.settings?.inspirationBookmarkFolder || state.settings?.defaultInspirationBookmarkFolder || "",
  ].filter(Boolean));
}

function currentBookmarkOnlyFolders() {
  const primary = bookmarkPrimaryFolders();
  const folders = Array.isArray(state.settings?.bookmarkOnlyFolders) ? state.settings.bookmarkOnlyFolders : [];
  const seen = new Set();
  const result = [];
  for (const item of folders) {
    const name = String(item || "").trim();
    if (!name || primary.has(name) || seen.has(name)) continue;
    seen.add(name);
    result.push(name);
  }
  return result;
}

function bookmarkOnlyFolderOptions() {
  const selected = new Set(currentBookmarkOnlyFolders());
  const primary = bookmarkPrimaryFolders();
  return (state.settings?.bookmarkFolderOptions || [])
    .filter((option) => option?.name && !selected.has(option.name) && !primary.has(option.name));
}

function addBookmarkOnlyFolder() {
  const folder = els.bookmarkOnlyFolderSelect.value;
  if (!folder) return;
  state.settings = {
    ...(state.settings || {}),
    bookmarkOnlyFolders: [...currentBookmarkOnlyFolders(), folder],
  };
  syncBookmarkOnlyFolderControls();
  renderSettingsStatus();
}

function removeBookmarkOnlyFolder(folder) {
  state.settings = {
    ...(state.settings || {}),
    bookmarkOnlyFolders: currentBookmarkOnlyFolders().filter((name) => name !== folder),
  };
  syncBookmarkOnlyFolderControls();
  renderSettingsStatus();
}

function renderBookmarkOnlyFolderList() {
  const folders = currentBookmarkOnlyFolders();
  if (!folders.length) {
    const empty = document.createElement("div");
    empty.className = "exclude-row";
    const main = document.createElement("div");
    main.className = "exclude-main";
    const title = document.createElement("div");
    title.className = "exclude-title";
    title.textContent = t("settings.bookmarks.noExtra");
    main.append(title);
    empty.append(main);
    els.bookmarkOnlyFolderList.replaceChildren(empty);
    return;
  }
  els.bookmarkOnlyFolderList.replaceChildren(...folders.map((folder) => {
    const row = document.createElement("div");
    row.className = "exclude-row";
    const main = document.createElement("div");
    main.className = "exclude-main";
    const title = document.createElement("div");
    title.className = "exclude-title";
    title.textContent = folder;
    const meta = document.createElement("div");
    meta.className = "exclude-meta";
    meta.textContent = t("settings.bookmarks.panel");
    main.append(title, meta);
    const button = document.createElement("button");
    button.className = "btn";
    button.type = "button";
    setIconLabel(button, "trash-01", t("settings.bookmarks.remove"));
    button.addEventListener("click", () => removeBookmarkOnlyFolder(folder));
    row.append(main, button);
    return row;
  }));
}

function syncAppearanceControls(settings = {}) {
  syncColorModeButtons(normalizeColorMode(settings.colorMode || settings.defaultColorMode));
  const accentTheme = normalizeAccentTheme(settings.accentTheme || settings.defaultAccentTheme);
  const customAccentColor = normalizeHexColor(settings.customAccentColor) || settings.defaultCustomAccentColor || DEFAULT_CUSTOM_ACCENT_COLOR;
  syncAccentThemeButtons(accentTheme);
  els.customAccentInput.value = customAccentColor;
  applyCustomAccentPreview(customAccentColor);
  els.pointerGlowEnabledInput.checked = settings.pointerGlowEnabled !== false;
  els.headerImageEnabledInput.checked = settings.headerImageEnabled === true;
  els.headerImageFixedInput.checked = settings.headerImageFixed === true;
  els.headerImageFullscreenInput.checked = settings.headerImageFixed === true && settings.headerImageFullscreen === true;
  syncHeaderImageFullscreenControl();
  els.headerImageUrlInput.value = settings.headerImageUrl || "";
}

function syncHeaderImageFullscreenControl(busy = els.saveSettings.disabled) {
  const available = els.headerImageFixedInput.checked && !busy;
  els.headerImageFullscreenInput.disabled = !available;
  els.headerImageFullscreenField.setAttribute("aria-disabled", String(!available));
}

function updateAppearancePreview(overrides = {}) {
  state.settings = {
    ...(state.settings || {}),
    ...appearancePayload(),
    ...overrides,
  };
  if (overrides.colorMode) syncColorModeButtons(overrides.colorMode);
  if (overrides.accentTheme) syncAccentThemeButtons(overrides.accentTheme);
  applyAppearanceSettings(state.settings);
  renderSettingsStatus();
}

function appearancePayload() {
  return {
    uiLocale: selectedUiLocale(),
    colorMode: selectedColorMode(),
    accentTheme: selectedAccentTheme(),
    customAccentColor: normalizeHexColor(els.customAccentInput.value) || DEFAULT_CUSTOM_ACCENT_COLOR,
    pointerGlowEnabled: els.pointerGlowEnabledInput.checked,
    headerImageEnabled: els.headerImageEnabledInput.checked,
    headerImageFixed: els.headerImageFixedInput.checked,
    headerImageFullscreen: els.headerImageFixedInput.checked && els.headerImageFullscreenInput.checked,
    headerImageUrl: els.headerImageUrlInput.value.trim(),
  };
}

function selectedUiLocale() {
  return normalizeLocale(els.uiLocaleSelect.value || state.settings?.uiLocale || getLocale());
}

function syncLanguageControls(settings = {}, { render = true } = {}) {
  const locale = normalizeLocale(settings.uiLocale || getLocale());
  els.uiLocaleSelect.value = locale;
  applyUiLocale(locale, { persist: Boolean(settings.uiLocale), render });
}

function applyUiLocale(value, { persist = false, render = true } = {}) {
  const locale = setLocale(value, { persist });
  els.uiLocaleSelect.value = locale;
  translateDocument(document);
  if (els.currentUiLanguage) els.currentUiLanguage.textContent = t("language.name");
  renderTodayMeta();
  if (state.data && render) renderAll();
  syncNavExpandedWidth();
  return locale;
}

function selectedColorMode() {
  const active = els.colorModeGroup.querySelector(".active[data-color-mode]");
  return normalizeColorMode(active?.dataset.colorMode || state.settings?.colorMode);
}

function syncColorModeButtons(colorMode) {
  const mode = normalizeColorMode(colorMode);
  for (const button of els.colorModeGroup.querySelectorAll("[data-color-mode]")) {
    const active = button.dataset.colorMode === mode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  }
  syncSegmentedIndicator(els.colorModeGroup);
}

function selectedAccentTheme() {
  const active = els.accentThemeGroup.querySelector(".active[data-accent-theme]");
  const theme = normalizeAccentTheme(active?.dataset.accentTheme || state.settings?.accentTheme);
  return normalizeHexColor(els.customAccentInput.value) && theme === "custom" ? "custom" : theme;
}

function syncAccentThemeButtons(accentTheme) {
  const theme = normalizeAccentTheme(accentTheme);
  for (const swatch of els.accentThemeGroup.querySelectorAll("[data-accent-theme]")) {
    const active = swatch.dataset.accentTheme === theme;
    swatch.classList.toggle("active", active);
    swatch.setAttribute("aria-pressed", String(active));
  }
}

function applyAppearanceSettings(settings = {}) {
  const colorMode = normalizeColorMode(settings.colorMode || settings.defaultColorMode);
  const accentTheme = normalizeAccentTheme(settings.accentTheme || settings.defaultAccentTheme);
  const customAccentColor = normalizeHexColor(settings.customAccentColor) || DEFAULT_CUSTOM_ACCENT_COLOR;
  const accentColor = accentTheme === "custom"
    ? customAccentColor
    : ACCENT_THEMES[accentTheme] || ACCENT_THEMES.violet;
  const palette = paletteFromAccent(accentColor);
  const root = document.documentElement;
  root.dataset.colorMode = colorMode;
  root.dataset.accentTheme = accentTheme;
  root.dataset.pointerGlow = settings.pointerGlowEnabled === false ? "off" : "on";
  root.style.setProperty("--accent", palette.accent);
  root.style.setProperty("--accent-rgb", palette.accentRgb.join(", "));
  applyCustomAccentPreview(customAccentColor);
  renderHeaderImage(settings);
}

function applyCustomAccentPreview(color) {
  document.documentElement.style.setProperty("--custom-accent-preview", normalizeHexColor(color) || DEFAULT_CUSTOM_ACCENT_COLOR);
}

function renderHeaderImage(settings = {}) {
  const imageUrl = String(settings.headerImageUrl || "").trim();
  const enabled = settings.headerImageEnabled === true;
  const fixed = settings.headerImageFixed === true;
  const fullscreen = fixed && settings.headerImageFullscreen === true;
  const root = document.documentElement;
  if (!enabled || !isHttpUrl(imageUrl)) {
    els.headerImageHero.hidden = true;
    els.headerImageHero.classList.remove("is-loaded");
    els.headerImage.removeAttribute("src");
    root.classList.remove("has-header-cover", "has-fixed-header-cover", "has-fullscreen-header-cover");
    return;
  }
  els.headerImageHero.hidden = false;
  root.classList.add("has-header-cover");
  root.classList.toggle("has-fixed-header-cover", fixed);
  root.classList.toggle("has-fullscreen-header-cover", fullscreen);
  if (els.headerImage.getAttribute("src") !== imageUrl) {
    els.headerImageHero.classList.remove("is-loaded");
    els.headerImage.src = imageUrl;
  }
}

function applyDeepSeekPreset() {
  els.apiBaseUrlInput.value = "https://api.deepseek.com";
  els.apiStyleSelect.value = "chat_completions";
  els.modelInput.value = "deepseek-v4-flash";
  resetAiConsentForProviderChange();
  renderSettingsStatus(t("settings.deepseekApplied"));
}

function resetAiConsentForProviderChange() {
  const savedOrigin = providerOriginForUi(state.settings?.savedBaseUrl || state.settings?.baseUrl || "");
  const draftOrigin = providerOriginForUi(els.apiBaseUrlInput.value);
  if (!savedOrigin || savedOrigin === draftOrigin || !els.aiDisclosureConsent.checked) return;
  els.aiDisclosureConsent.checked = false;
  renderSettingsStatus(t("settings.service.providerConsentReset"));
}

function providerOriginForUi(value) {
  try {
    const url = new URL(String(value || "").trim());
    if (url.protocol === "https:") return url.origin;
    if (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)) return url.origin;
  } catch {
    // The settings validation reports malformed provider URLs.
  }
  return "";
}

function renderSettingsStatus(extra) {
  const settings = state.settings || {};
  const sourceText = t(settings.keySource === "environment"
    ? "settings.keySource.environment"
    : "settings.keySource.local");
  const keyText = settings.hasOpenAIKey
    ? t("settings.key.configured", { source: sourceText, masked: settings.maskedKey ? t("settings.key.masked", { value: settings.maskedKey }) : "" })
    : t("settings.key.notConfigured");
  const baseUrl = els.apiBaseUrlInput.value || settings.baseUrl || settings.defaultBaseUrl || "-";
  const apiStyle = els.apiStyleSelect.value || settings.apiStyle || settings.defaultApiStyle || "-";
  const model = els.modelInput.value || settings.model || settings.defaultModel || "-";
  const dailyLimit = els.dailyLimitInput.value || settings.dailyLimit || settings.defaultDailyLimit || "-";
  const cacheSize = els.cacheSizeInput.value || settings.hotNewsCacheSize || settings.defaultHotNewsCacheSize || "-";
  const perSourceValue = els.hotNewsPerSourceInput.value === ""
    ? (settings.hotNewsEntriesPerSource ?? settings.defaultHotNewsEntriesPerSource ?? "-")
    : els.hotNewsPerSourceInput.value;
  const perSourceLimit = Number(perSourceValue) === 0 ? t("common.unlimited") : perSourceValue;
  const perCategoryValue = els.newsPerCategoryInput.value === ""
    ? (settings.newsEntriesPerCategory ?? settings.defaultNewsEntriesPerCategory ?? "-")
    : els.newsPerCategoryInput.value;
  const perCategoryLimit = Number(perCategoryValue) === 0 ? t("common.unlimited") : perCategoryValue;
  const bookmarkSource = bookmarkSourceStatusText();
  const cardSummary = t(els.cardSummaryEnabledInput.checked ? "common.on" : "common.off");
  const floatingOpen = t(els.floatingOpenInput.checked ? "common.on" : "common.off");
  const readAllOpen = t(els.readingQueueOpenOnReadAllInput.checked ? "common.on" : "common.off");
  const imageSearch = !els.webImageSearchEnabledInput.checked
    ? t("common.off")
    : t((els.imageSearchApiKeyInput.value.trim() || settings.hasImageSearchKey) ? "common.available" : "common.missingKey");
  const retainSeenArchive = t(els.retainSeenArchiveInput.checked ? "common.retain" : "common.clearNextDay");
  const personalized = t(els.personalizedRankingEnabledInput.checked ? "common.on" : "common.off");
  const publicFeed = t(els.publicFeedSupplementEnabledInput.checked ? "common.on" : "common.off");
  const appearance = appearanceStatusText();
  const excludedCount = currentExcludedNewsSources().length;
  const detail = t("settings.status.detail", {
    baseUrl,
    apiStyle: apiStyleLabel(apiStyle),
    model,
    dailyLimit,
    imageSearch,
    cardSummary,
    cacheSize,
    perSourceLimit,
    perCategoryLimit,
    personalized,
    publicFeed,
    bookmarkSource,
    excludedCount,
    floatingOpen,
    readAllOpen,
    retainSeenArchive,
    appearance,
  });
  els.settingsStatus.textContent = extra
    ? t("settings.status.withExtra", { extra, key: keyText, detail })
    : t("settings.status.standard", { key: keyText, detail });
  renderBookmarkSourceStatus();
}

function bookmarkSourceStatusText() {
  const news = els.newsBookmarkFolderSelect.value || state.settings?.newsBookmarkFolder || state.settings?.defaultNewsBookmarkFolder || "-";
  const inspiration = els.inspirationBookmarkFolderSelect.value || state.settings?.inspirationBookmarkFolder || state.settings?.defaultInspirationBookmarkFolder || "-";
  const extraCount = currentBookmarkOnlyFolders().length;
  return t("settings.status.bookmarkSources", { news, inspiration, extraCount });
}

function appearanceStatusText() {
  const colorModeText = colorModeLabel(selectedColorMode());
  const theme = selectedAccentTheme();
  const themeText = theme === "custom" ? t("settings.accent.custom") : themeLabel(theme);
  const glowText = t(els.pointerGlowEnabledInput.checked ? "common.on" : "common.off");
  const coverEnabled = els.headerImageEnabledInput.checked && isHttpUrl(els.headerImageUrlInput.value.trim());
  const coverText = t(coverEnabled ? "common.on" : "common.off");
  const fixedText = coverEnabled && els.headerImageFixedInput.checked ? t("settings.status.fixedSuffix") : "";
  const fullscreenText = fixedText && els.headerImageFullscreenInput.checked ? t("settings.status.fullscreenSuffix") : "";
  return t("settings.status.appearance", { colorModeText, themeText, glowText, coverText, fixedText, fullscreenText });
}

function renderAll() {
  renderStats();
  if (state.settings) renderExclusionList();
  else renderExcludeFolderOptions();
  renderStatus();
  renderTodayMeta();
  renderEfficiencyPanel();
  renderDaily();
  renderSummaries();
  renderSectionFilters();
  renderCategoryFilters();
  renderCategories();
}

function renderStats() {
  const bookmarks = state.data?.bookmarks || [];
  els.settingsTotalStatus.textContent = String(bookmarks.length);
}

function startTodayClock() {
  renderTodayMeta();
  if (todayClockTimer) clearInterval(todayClockTimer);
  todayClockTimer = setInterval(() => {
    renderTodayMeta();
    handleDayRollover();
  }, 1000);
}

function renderTodayMeta() {
  els.todayMeta.textContent = formatFullDateTime();
}

function handleDayRollover() {
  const nextDay = getTodayKey();
  if (nextDay === state.day) return;
  const previousDay = state.day;
  state.day = nextDay;
  state.variants.news = readNumber(`dash.variant.${nextDay}.news`, 0);
  state.variants.inspiration = readNumber(`dash.variant.${nextDay}.inspiration`, readNumber(`dash.variant.${nextDay}`, 0));
  state.variants.summary = readNumber(`dash.variant.${nextDay}.summary`, 0);
  if (!retainSeenArchiveEnabled()) {
    writeJson(`dash.seen.${previousDay}`, []);
    replaceSeenRecords(readSeenRecords(`dash.seen.${nextDay}`));
  }
  renderAll();
  loadDashboard();
}

function renderStatus() {
  const status = state.data?.status || {};
  const ai = state.data?.ai || {};
  const title = status.running ? t("status.backgroundCaching") : localizedStatusMessage(status, "status.waitingUpdate");
  const finished = status.finishedAt
    ? t("status.lastFinished", { time: formatDateTime(status.finishedAt) })
    : t("status.noFinishedRecord");
  const aiText = t(ai.enabled
    ? "status.aiEnabled"
    : !ai.configured
      ? "status.aiNotConfigured"
      : !ai.disclosureAccepted
        ? "status.aiConsentRequired"
        : "status.aiPermissionRequired");
  const excluded = status.excluded || state.data?.cache?.excluded || currentExcludedNewsSources().length || 0;
  const pipeline = state.data?.pipeline || {};
  const stage = currentPipelineStage(status.stages || pipeline.stages);
  const switches = t("status.switches", {
    personalized: t(pipeline.personalizedRankingEnabled === false ? "common.off" : "common.on"),
    publicFeed: t(pipeline.publicFeedSupplementEnabled === false ? "common.off" : "common.on"),
  });
  renderOverviewStatus(title, t("status.overviewMeta", {
    finished,
    aiText,
    switches,
    stage,
    excluded,
    failed: status.failed || 0,
  }));
  els.settingsKeyStatus.textContent = t(ai.enabled
    ? "status.available"
    : !ai.configured
      ? "status.notConfigured"
      : !ai.disclosureAccepted
        ? "status.waitingConsent"
        : "status.waitingPermission");
  els.settingsModelStatus.textContent = ai.configured ? `${apiStyleLabel(ai.apiStyle)} · ${ai.model}` : t("status.notEnabled");
  els.settingsQuotaStatus.textContent = `${ai.usedToday || 0}/${ai.dailyLimit || 50}`;
  renderMeters();
  els.refresh.disabled = Boolean(status.running);
  renderRefreshButton(Boolean(status.running));
}

function renderOverviewStatus(title, meta) {
  els.settingsOverviewTitle.textContent = title || t("status.waitingUpdate");
  els.settingsOverviewMeta.textContent = meta || t("status.noRecord");
}

function renderRefreshButton(isRunning) {
  els.refresh.classList.toggle("is-loading", isRunning);
  els.refresh.disabled = isRunning;
  els.refresh.replaceChildren();
  if (isRunning) {
    setIconLabel(els.refresh, "synchronize", t("status.caching"));
  } else {
    setIconLabel(els.refresh, "refresh-cw-01", t("action.cache"));
  }
}

function renderMeters() {
  const ai = state.data?.ai || {};
  const cache = state.data?.cache || {};
  const status = state.data?.status || {};
  const quotaPercent = percentage(Number(ai.usedToday || 0), Number(ai.dailyLimit || 50));
  const cachePercent = Math.round(Number(cache.progress || 0) * 100);
  const refreshPercent = status.running ? Math.round(Number(cache.refreshProgress || 0) * 100) : 100;
  setMeter(els.quotaMeterBar, els.quotaMeterText, quotaPercent);
  setMeter(els.cacheMeterBar, els.cacheMeterText, cachePercent);
  setMeter(els.refreshMeterBar, els.refreshMeterText, refreshPercent);
  const perSourceValue = ai.hotNewsEntriesPerSource ?? state.settings?.hotNewsEntriesPerSource ?? state.settings?.defaultHotNewsEntriesPerSource ?? 5;
  const perSourceText = Number(perSourceValue) === 0 ? t("common.unlimited") : tc("unit.entries", perSourceValue);
  const perCategoryValue = ai.newsEntriesPerCategory ?? state.settings?.newsEntriesPerCategory ?? state.settings?.defaultNewsEntriesPerCategory ?? 12;
  const perCategoryText = Number(perCategoryValue) === 0 ? t("common.unlimited") : tc("unit.entries", perCategoryValue);
  const pipeline = state.data?.pipeline || {};
  els.settingsCacheStatus.textContent = t("status.cacheDetail", {
    ready: cache.ready || 0,
    target: cache.target || ai.hotNewsCacheSize || 192,
    perCategory: perCategoryText,
    perSource: perSourceText,
    personalized: t(pipeline.personalizedRankingEnabled === false ? "common.off" : "common.on"),
    publicFeed: t(pipeline.publicFeedSupplementEnabled === false ? "common.off" : "common.on"),
    excluded: cache.excluded || 0,
    message: localizedStatusMessage(cache, "status.nextBatchPreparing"),
  });
}

function currentPipelineStage(stages = {}) {
  const labels = {
    discovering: t("pipeline.discovering"),
    fetching: t("pipeline.fetching"),
    extracting: t("pipeline.extracting"),
    deduplicating: t("pipeline.deduplicating"),
    enriching: "AI",
    complete: t("pipeline.complete"),
  };
  for (const key of Object.keys(labels)) if (stages?.[key] === "running") return labels[key];
  return t("pipeline.complete");
}

function setMeter(bar, label, value) {
  const percent = Math.max(0, Math.min(100, Number(value) || 0));
  bar.style.width = `${percent}%`;
  label.textContent = `${percent}%`;
}

function percentage(used, total) {
  if (!Number.isFinite(total) || total <= 0) return 0;
  return Math.round(Math.max(0, Math.min(1, used / total)) * 100);
}

function dailyDigestStatusLabel(digest) {
  if (!digest?.generatedAt) return t("digest.status.waiting");
  if (digest.status === "ai") return t("digest.status.ai");
  if (digest.status === "quota-or-empty") return t("digest.status.quota");
  if (digest.status === "no-api-key") return t("digest.status.noService");
  if (digest.status === "fallback") return t("digest.status.failed");
  if (digest.status === "pending") return t("digest.status.waiting");
  return t("digest.status.notGenerated");
}

function createDailyDigestEmptyState(digest) {
  if (state.dailyDigestRefreshing) {
    return createEmptyState({
      title: t("digest.refreshing.title"),
      body: t("digest.refreshing.body"),
      variant: "compact",
    });
  }
  if (digest?.status === "no-api-key") {
    return createEmptyState({
      title: t("digest.noService.title"),
      body: t("digest.noService.body"),
      variant: "compact",
      actionLabel: t("action.openSettings"),
      onAction: openSettings,
    });
  }
  if (digest?.status === "fallback") {
    return createEmptyState({
      title: t("digest.failed.title"),
      body: t("digest.failed.body"),
      variant: "compact",
      actionLabel: t("action.reorganize"),
      onAction: refreshDailyDigest,
    });
  }
  if (digest?.status === "quota-or-empty") {
    return createEmptyState({
      title: t("digest.retry.title"),
      body: t("digest.retry.body"),
      variant: "compact",
      actionLabel: t("action.reorganize"),
      onAction: refreshDailyDigest,
    });
  }
  return createEmptyState({
    title: t("digest.empty.title"),
    body: t("digest.empty.body"),
    variant: "compact",
    actionLabel: t("action.reorganize"),
    onAction: refreshDailyDigest,
  });
}

function hasGeneratedDailyDigestOverview(digest, lines) {
  if (digest?.status !== "ai") return false;
  const items = Array.isArray(digest?.items) ? digest.items.filter(Boolean) : [];
  if (items.length) return true;
  if (!lines.length) return false;
  return lines.some((line) => !isFallbackDailyDigestOverview(line));
}

function isFallbackDailyDigestOverview(line) {
  const text = String(line || "").trim();
  return [
    ...allTranslations("digest.legacyFallbackPrefix"),
    ...allTranslations("digest.legacyNoAiPrefix"),
  ].some((prefix) => text.startsWith(prefix));
}

function createDailyDigestPanelCard() {
  const digest = state.data?.dailyDigest;
  const card = createEfficiencyCard(t("digest.cardTitle"), dailyDigestStatusLabel(digest), "sparkling");
  const overview = document.createElement("div");
  overview.className = "ai-digest-overview";
  const overviewLines = Array.isArray(digest?.overview)
    ? digest.overview.map((line) => String(line || "").trim()).filter(Boolean)
    : [];
  if (hasGeneratedDailyDigestOverview(digest, overviewLines)) {
    overview.replaceChildren(...dailyDigestBriefNodes(digest));
  } else {
    overview.replaceChildren(createDailyDigestEmptyState(digest));
  }
  card.append(overview);
  return card;
}

function dailyDigestBriefNodes(digest) {
  const nodes = [];
  const items = Array.isArray(digest?.items) ? digest.items.slice(0, 10) : [];
  if (items.length) {
    nodes.push(createDigestLanes(items));
  } else {
    nodes.push(createEmptyState({
      title: t("digest.organized.title"),
      body: t("digest.organized.body"),
      variant: "compact",
    }));
  }
  nodes.push(createDigestRefreshButton());
  return nodes;
}

function createDigestLanes(items) {
  const lanes = document.createElement("div");
  lanes.className = "ai-digest-lanes";
  const sorted = [...items].sort((left, right) => Number(right.importanceScore || 0) - Number(left.importanceScore || 0));
  const topItems = sorted.slice(0, 2);
  const follow = sorted.slice(2, 4);
  const skip = sorted.slice(4, 6);
  lanes.append(
    createDigestLane(t("digest.lane.important"), topItems, t("digest.lane.mustRead")),
    createDigestLane(t("digest.lane.follow"), follow, t("digest.lane.followValue")),
    createDigestLane(t("digest.lane.skip"), skip, t("digest.lane.lowPriority")),
  );
  return lanes;
}

function createDigestLane(titleText, items, emptyText) {
  const lane = document.createElement("div");
  lane.className = "ai-digest-lane";
  const title = document.createElement("div");
  title.className = "ai-digest-lane-title";
  title.textContent = titleText;
  const list = document.createElement("div");
  list.className = "ai-digest-brief-list";
  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "ai-digest-brief-item is-empty";
    empty.textContent = emptyText;
    list.append(empty);
  } else {
    list.append(...items.map(createDigestBriefItem));
  }
  lane.append(title, list);
  return lane;
}

function createDigestBriefItem(item) {
  const row = document.createElement("button");
  row.className = "ai-digest-brief-item";
  row.type = "button";
  row.addEventListener("click", () => openDigestItem(item));
  const title = document.createElement("span");
  title.className = "ai-digest-brief-title";
  const titleText = item.title || item.source || t("digest.importantNews");
  title.textContent = titleText;
  title.addEventListener("pointerenter", () => showDigestTitlePreview(row, title, titleText));
  title.addEventListener("pointerleave", () => hideDigestTitlePreview(row));
  row.addEventListener("focus", () => showDigestTitlePreview(row, row, titleText));
  row.addEventListener("blur", () => hideDigestTitlePreview(row));
  row.append(title);
  return row;
}

function showDigestTitlePreview(row, anchor, text) {
  hideDigestTitlePreview();
  const tooltip = document.createElement("div");
  const id = `digest-title-preview-${++digestTitlePreviewId}`;
  tooltip.className = "digest-title-preview";
  tooltip.id = id;
  tooltip.setAttribute("role", "tooltip");
  tooltip.textContent = text;
  tooltip.style.maxWidth = `${Math.max(160, Math.min(360, window.innerWidth - 24))}px`;
  document.body.append(tooltip);
  row.setAttribute("aria-describedby", id);

  const anchorRect = anchor.getBoundingClientRect();
  const tooltipRect = tooltip.getBoundingClientRect();
  const viewportMargin = 12;
  const gap = 8;
  const idealLeft = anchorRect.left + (anchorRect.width - tooltipRect.width) / 2;
  const maxLeft = Math.max(viewportMargin, window.innerWidth - tooltipRect.width - viewportMargin);
  const left = Math.min(Math.max(idealLeft, viewportMargin), maxLeft);
  let top = anchorRect.top - tooltipRect.height - gap;
  if (top < viewportMargin) top = anchorRect.bottom + gap;
  top = Math.min(Math.max(viewportMargin, top), window.innerHeight - tooltipRect.height - viewportMargin);
  tooltip.style.left = `${Math.round(left)}px`;
  tooltip.style.top = `${Math.round(top)}px`;
  activeDigestTitlePreview = { row, tooltip, id };
  requestAnimationFrame(() => tooltip.classList.add("is-visible"));
}

function hideDigestTitlePreview(row = null) {
  if (!activeDigestTitlePreview) return;
  if (row && activeDigestTitlePreview.row !== row) return;
  const { row: owner, tooltip, id } = activeDigestTitlePreview;
  if (owner.getAttribute("aria-describedby") === id) owner.removeAttribute("aria-describedby");
  tooltip.remove();
  activeDigestTitlePreview = null;
}

function createDigestRefreshButton() {
  const retry = document.createElement("button");
  retry.className = "ai-digest-refresh-mini";
  retry.type = "button";
  retry.disabled = state.dailyDigestRefreshing;
  setIconLabel(retry, "refresh-cw-01", t(state.dailyDigestRefreshing ? "action.organizing" : "action.reorganize"), "inline-icon", "btn-label");
  retry.addEventListener("click", refreshDailyDigest);
  return retry;
}

function openDigestItem(digestItem) {
  const item = findNewsItemByReference(digestItem);
  if (item) {
    openDailyItem(item);
    return;
  }
  if (digestItem?.url) openExternal(digestItem.url, digestItem.title || "");
}

function renderEfficiencyPanel() {
  if (!els.efficiencyPanel) return;
  hideDigestTitlePreview();
  const isSearching = Boolean(state.query);
  els.efficiencyPanel.hidden = isSearching;
  if (isSearching) {
    els.efficiencyPanel.replaceChildren();
    return;
  }
  const queueItems = readingQueueItems();
  const topics = (state.data?.topics || []).slice(0, 4);
  const cards = [
    createTopicsPanelCard(topics),
    createDailyDigestPanelCard(),
    createQueuePanelCard(queueItems),
  ];
  els.efficiencyPanel.replaceChildren(...cards);
}

function createQueuePanelCard(items) {
  const shouldOpen = readingQueueOpenOnReadAll();
  const readAll = document.createElement("button");
  readAll.className = "efficiency-action queue-read-all";
  readAll.type = "button";
  readAll.disabled = !items.length;
  readAll.title = items.length
    ? t(shouldOpen ? "queue.readAllOpen" : "queue.readAllNoOpen", { count: items.length })
    : t("queue.noPending");
  readAll.setAttribute("aria-label", readAll.title);
  readAll.textContent = t("action.readAll");
  readAll.addEventListener("click", () => openAndMarkReadingQueue(items));
  const card = createEfficiencyCard(t("queue.cardTitle"), tc("queue.pending", items.length), "bookmark-ribbon", readAll);
  card.classList.add("queue-card");
  const list = document.createElement("div");
  list.className = "efficiency-list";
  if (!items.length) {
    list.append(createEmptyState({
      title: t("queue.empty.title"),
      body: t("queue.empty.body"),
      variant: "compact",
    }));
  } else {
    list.append(...items.map(createQueuePanelRow));
  }
  card.append(list);
  return card;
}

function createTopicsPanelCard(topics) {
  const card = createEfficiencyCard(t("topics.cardTitle"), tc("topics.groups", topics.length), "news");
  const list = document.createElement("div");
  list.className = "efficiency-list";
  if (!topics.length) {
    list.append(createEmptyState({
      title: t("topics.empty.title"),
      body: t("topics.empty.body"),
      variant: "compact",
    }));
  } else {
    list.append(...topics.map(createTopicPanelRow));
  }
  card.append(list);
  return card;
}

function createEfficiencyCard(titleText, metaText, iconName, action = null) {
  const card = document.createElement("section");
  card.className = "efficiency-card";
  const head = document.createElement("div");
  head.className = "efficiency-head";
  const title = document.createElement("div");
  title.className = "efficiency-title";
  title.append(createIcon(iconName, "card-icon"), document.createTextNode(titleText));
  const meta = document.createElement("span");
  meta.className = "efficiency-meta";
  meta.textContent = metaText;
  const tools = document.createElement("div");
  tools.className = "efficiency-head-tools";
  if (action) tools.append(action);
  tools.append(meta);
  head.append(title, tools);
  card.append(head);
  return card;
}

function createQueuePanelRow(item) {
  const row = document.createElement("button");
  row.className = "efficiency-row queue-row";
  row.type = "button";
  row.title = itemUrl(item);
  row.addEventListener("click", () => openDailyItem(item));
  const main = document.createElement("span");
  main.className = "efficiency-row-main";
  const title = document.createElement("span");
  title.className = "efficiency-row-title";
  title.textContent = isNewsCard(item) ? displaySummaryTitle(item) : displayBookmarkTitle(item);
  const meta = document.createElement("span");
  meta.className = "efficiency-row-meta";
  meta.textContent = [item.host || hostFromUrl(itemUrl(item)), item.category].filter(Boolean).join(" · ");
  main.append(title, meta);
  row.append(createBookmarkFavicon({ ...item, url: itemUrl(item) }), main);
  return row;
}

function createTopicPanelRow(topic) {
  const row = document.createElement("button");
  row.className = "efficiency-row topic-row";
  row.type = "button";
  row.title = topic.representative?.url || "";
  row.addEventListener("click", () => openTopic(topic));
  const main = document.createElement("span");
  main.className = "efficiency-row-main";
  const title = document.createElement("span");
  title.className = "efficiency-row-title";
  title.textContent = topic.title || t("topics.unnamed");
  const meta = document.createElement("span");
  meta.className = "efficiency-row-meta";
  const latest = topic.latestAt ? formatDateTime(topic.latestAt) : "";
  meta.textContent = [tc("topics.sources", topic.sourceCount || 1), tc("unit.entries", topic.itemCount || 1), latest].filter(Boolean).join(" · ");
  main.append(title, meta);
  const badge = document.createElement("span");
  badge.className = "efficiency-score";
  badge.textContent = String(topic.score || topic.sourceCount || 1);
  row.append(main, badge);
  return row;
}

function openTopic(topic) {
  const representative = topic?.representative || {};
  const item = findNewsItemByReference(representative);
  if (item) {
    openDailyItem(item);
    return;
  }
  if (representative.url) openExternal(representative.url, representative.title || topic.title || "");
}

async function refreshDailyDigest(event) {
  event?.preventDefault();
  event?.stopPropagation?.();
  if (state.dailyDigestRefreshing) return;
  state.dailyDigestRefreshing = true;
  renderEfficiencyPanel();
  try {
    const result = await apiPost("/api/daily-summary/refresh");
    if (state.data) state.data.dailyDigest = result;
    renderEfficiencyPanel();
    renderSummaries();
    renderDaily();
  } catch (error) {
    renderOverviewStatus(t("digest.refreshFailed"), localizedErrorMessage(error));
  } finally {
    state.dailyDigestRefreshing = false;
    renderEfficiencyPanel();
  }
}

function renderDaily() {
  const isSearching = Boolean(state.query);
  document.documentElement.classList.toggle("is-dashboard-searching", isSearching);
  els.dailySection.classList.toggle("is-searching", isSearching);
  els.dailySection.hidden = false;
  if (els.efficiencyPanel) els.efficiencyPanel.hidden = isSearching;
  if (isSearching) {
    renderTodayMeta();
    renderDailyBoard([], { hideAfter: true });
    return;
  }
  const newsPage = dailyPageForCardType(NEWS_CARD_TYPE, DAILY_NEWS_COUNT);
  const inspirationPage = dailyPageForCardType(INSPIRATION_CARD_TYPE, DAILY_INSPIRATION_COUNT);
  const newsBase = newsPage.items;
  const inspirationBase = inspirationPage.items;
  const seenItems = seenArchiveItems();
  const columns = [
    { id: "news", label: t("daily.news"), icon: "news", items: newsBase, action: "reshuffle", pageInfo: newsPage },
    { id: "inspiration", label: t("daily.inspiration"), icon: "sparkling", items: inspirationBase, action: "reshuffle", pageInfo: inspirationPage },
    { id: "archive", label: t("daily.archive"), icon: "bookmark-ribbon", items: seenItems, action: "clearSeen", compact: true }
  ];
  renderTodayMeta();
  renderDailyBoard(columns.map(createBoardColumn));
}

function renderDailyBoard(nodes, options = {}) {
  const token = ++dailyBoardRenderToken;
  const board = els.dailyBoard;
  if (options.hideAfter) {
    board.classList.remove("is-transitioning");
    board.replaceChildren();
    board.hidden = true;
    return;
  }
  board.hidden = false;
  if (!board.children.length || prefersReducedMotion()) {
    board.replaceChildren(...nodes);
    return;
  }
  syncDailyBoardColumns(board, nodes, token);
}

function syncDailyBoardColumns(board, nextColumns, token) {
  const currentById = new Map(Array.from(board.children).map((column) => [column.dataset.columnId || "", column]));
  const nextIds = new Set(nextColumns.map((column) => column.dataset.columnId || ""));
  nextColumns.forEach((nextColumn, index) => {
    const columnId = nextColumn.dataset.columnId || "";
    const currentColumn = currentById.get(columnId);
    if (!currentColumn) {
      board.insertBefore(nextColumn, board.children[index] || null);
      animateCardsIn(dailyBoardCards(nextColumn));
      return;
    }
    syncDailyBoardColumn(currentColumn, nextColumn, token);
    if (board.children[index] !== currentColumn) board.insertBefore(currentColumn, board.children[index] || null);
  });
  Array.from(board.children).forEach((column) => {
    if (!nextIds.has(column.dataset.columnId || "")) column.remove();
  });
}

function syncDailyBoardColumn(currentColumn, nextColumn, token) {
  const currentHead = currentColumn.querySelector(":scope > .column-head");
  const nextHead = nextColumn.querySelector(":scope > .column-head");
  if (currentHead && nextHead) currentHead.replaceWith(nextHead);
  const currentList = currentColumn.querySelector(":scope > .card-list");
  const nextList = nextColumn.querySelector(":scope > .card-list");
  if (!currentList || !nextList) {
    currentColumn.replaceChildren(...nextColumn.childNodes);
    animateCardsIn(dailyBoardCards(currentColumn));
    return;
  }
  syncDailyCardList(currentList, nextList, token);
}

function syncDailyCardList(currentList, nextList, token) {
  const currentCards = directDailyCards(currentList);
  const nextCards = directDailyCards(nextList);
  if (!currentCards.length) {
    currentList.className = nextList.className;
    currentList.replaceChildren(...nextList.childNodes);
    animateCardsIn(directDailyCards(currentList));
    return;
  }
  if (!nextCards.length) {
    const finishEmptyState = () => {
      if (token !== dailyBoardRenderToken) return;
      currentList.className = nextList.className;
      currentList.replaceChildren(...nextList.childNodes);
    };
    const leavingCards = currentCards.filter((card) => card.dataset.key);
    if (leavingCards.length && !prefersReducedMotion()) {
      const exitDuration = animateCardsOut(leavingCards);
      window.setTimeout(finishEmptyState, exitDuration);
    } else {
      finishEmptyState();
    }
    return;
  }
  const nextKeys = new Set(nextCards.map((card) => card.dataset.key).filter(Boolean));
  const leavingCards = currentCards.filter((card) => card.dataset.key && !nextKeys.has(card.dataset.key));
  const applyDiff = () => {
    if (token !== dailyBoardRenderToken) return;
    applyDailyCardListDiff(currentList, nextList, nextCards);
  };
  if (leavingCards.length && !prefersReducedMotion()) {
    const exitDuration = animateCardsOut(leavingCards);
    window.setTimeout(applyDiff, exitDuration);
  } else {
    applyDiff();
  }
}

function applyDailyCardListDiff(currentList, nextList, nextCards) {
  const currentByKey = new Map(directDailyCards(currentList)
    .filter((card) => card.dataset.key && !card.classList.contains("is-leaving"))
    .map((card) => [card.dataset.key, card]));
  const fragment = document.createDocumentFragment();
  const enteringCards = [];
  nextCards.forEach((nextCard) => {
    const key = nextCard.dataset.key || "";
    const currentCard = currentByKey.get(key);
    if (currentCard) {
      clearCardAnimationState(nextCard);
      clearCardAnimationState(currentCard);
      fragment.append(canReuseCard(currentCard, nextCard) ? currentCard : nextCard);
      return;
    }
    enteringCards.push(nextCard);
    fragment.append(nextCard);
  });
  currentList.className = nextList.className;
  currentList.replaceChildren(fragment);
  animateCardsIn(enteringCards);
}

function dailyBoardCards(root) {
  return Array.from(root.querySelectorAll(DAILY_BOARD_CARD_SELECTOR));
}

function directDailyCards(root) {
  return Array.from(root.children).filter((node) => node.matches?.(DAILY_BOARD_CARD_SELECTOR));
}

function animateCardsOut(cards) {
  let longest = CARD_EXIT_MS;
  cards.forEach((card) => {
    const delay = 0;
    longest = Math.max(longest, delay + CARD_EXIT_MS);
    card.classList.remove("is-entering");
    card.classList.add("is-leaving");
    card.style.setProperty("--card-motion-delay", `${delay}ms`);
    card.style.setProperty("--card-motion-duration", `${CARD_EXIT_MS}ms`);
  });
  return longest;
}

function animateCardsIn(cards) {
  if (prefersReducedMotion()) return;
  cards.forEach((card) => {
    const delay = 0;
    card.classList.remove("is-leaving");
    card.classList.add("is-entering");
    card.style.setProperty("--card-motion-delay", `${delay}ms`);
    card.style.setProperty("--card-motion-duration", `${CARD_ENTER_MS}ms`);
    card.addEventListener("animationend", () => {
      card.classList.remove("is-entering");
      card.style.removeProperty("--card-motion-delay");
      card.style.removeProperty("--card-motion-duration");
    }, { once: true });
  });
}

function clearCardAnimationState(card) {
  card.classList.remove("is-entering", "is-leaving");
  card.style.removeProperty("--card-motion-delay");
  card.style.removeProperty("--card-motion-duration");
}

function setCardItemIdentity(card, item) {
  card.dataset.key = String(item?.key || "");
  card.dataset.itemVersion = cardItemVersion(item);
}

function canReuseCard(currentCard, nextCard) {
  return Boolean(nextCard.dataset.itemVersion)
    && currentCard.dataset.itemVersion === nextCard.dataset.itemVersion
    && currentCard.isEqualNode(nextCard);
}

function cardItemVersion(item) {
  let text;
  try {
    text = JSON.stringify(item) || "";
  } catch {
    return "";
  }
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function prefersReducedMotion() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;
}

function createDailyColumnEmptyState(column) {
  const emptyStates = {
    news: {
      title: t("daily.empty.newsTitle"),
      body: t("daily.empty.newsBody"),
    },
    inspiration: {
      title: t("daily.empty.inspirationTitle"),
      body: t("daily.empty.inspirationBody"),
    },
    archive: {
      title: t("daily.empty.archiveTitle"),
      body: t("daily.empty.archiveBody"),
    },
  };
  return createEmptyState({
    ...(emptyStates[column.id] || {
      title: t("daily.empty.defaultTitle"),
      body: t("daily.empty.defaultBody"),
    }),
    variant: ["news", "inspiration", "archive"].includes(column.id) ? "compact" : "panel",
  });
}

function createBoardColumn(column) {
  const section = document.createElement("section");
  section.className = `board-column ${column.id ? `is-${column.id}` : ""}`;
  section.dataset.columnId = column.id || "";
  const head = document.createElement("div");
  head.className = "column-head";
  const title = document.createElement("div");
  title.className = "column-title";
  const icon = createIcon(column.icon, "card-icon");
  title.append(icon, document.createTextNode(column.label));
  const tools = document.createElement("div");
  tools.className = "column-tools";
  if (column.pageInfo?.pageCount > 1 && column.action === "reshuffle") {
    const hint = document.createElement("span");
    hint.className = "batch-hint";
    hint.textContent = batchLabel(column.pageInfo);
    tools.append(hint);
  }
  const action = createColumnAction(column);
  if (action) tools.append(action);
  const count = document.createElement("span");
  count.className = "count";
  count.textContent = String(column.items.length);
  tools.append(count);
  head.append(title, tools);
  const list = document.createElement("div");
  list.className = "card-list";
  const renderer = column.id === "news" ? createNewsListCard : (column.compact ? createArchiveCard : createDailyCard);
  if (column.items.length) {
    if (column.id === "news") list.classList.add("link-list");
    list.append(...column.items.map((item) => renderer(item)));
  } else {
    list.classList.add("is-empty");
    list.append(createDailyColumnEmptyState(column));
  }
  section.append(head, list);
  return section;
}

function createColumnAction(column) {
  const type = column.action;
  if (!type) return null;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "column-action";
  if (type === "reshuffle") {
    setIconLabel(button, "shuffle-01", t("action.reshuffle"), "inline-icon", "btn-label");
    button.classList.add("accent");
    button.addEventListener("click", () => reshuffleDailyColumn(column.id));
  } else if (type === "clearSeen") {
    setIconLabel(button, "trash-01", t("action.clear"), "inline-icon", "btn-label");
    button.classList.add("danger");
    button.disabled = column.items.length === 0;
    button.addEventListener("click", clearSeenArchive);
  }
  return button;
}

function reshuffleDailyColumn(columnId) {
  if (!Object.prototype.hasOwnProperty.call(state.variants, columnId)) return;
  const count = columnId === "news" ? DAILY_NEWS_COUNT : DAILY_INSPIRATION_COUNT;
  const page = dailyPageForCardType(columnId === "news" ? NEWS_CARD_TYPE : INSPIRATION_CARD_TYPE, count);
  state.variants[columnId] = (page.variant + 1) % page.pageCount;
  writeValue(`dash.variant.${state.day}.${columnId}`, String(state.variants[columnId]));
  if (columnId === "inspiration") writeValue(`dash.variant.${state.day}`, String(state.variants[columnId]));
  renderDaily();
}

function clearSeenArchive() {
  if (!state.seen.size) return;
  state.seen.clear();
  state.seenMeta.clear();
  persistSeen();
  renderAll();
}

function seenArchiveItems() {
  const byKey = new Map(displayArchiveItems().map((item) => [item.key, item]));
  return Array.from(state.seen)
    .map((key) => archiveItemForSeenKey(key, byKey.get(key)))
    .filter(Boolean);
}

function displayArchiveItems() {
  const bookmarks = state.data?.bookmarks || [];
  return [
    ...bookmarks,
    ...newsSummaryItems(false).filter((item) => item.sourceKey),
  ];
}

function archiveItemForSeenKey(key, item) {
  const meta = state.seenMeta.get(key) || {};
  if (!item && !meta.title && !meta.url) return null;
  return {
    ...(item || fallbackArchiveItem(key, meta)),
    key,
    seenSource: meta.source || inferArchiveSource(item),
    seenTitle: meta.title || "",
    seenUrl: meta.url || "",
  };
}

function fallbackArchiveItem(key, meta) {
  const url = meta.url || "";
  const isNews = meta.source === "news";
  return {
    key,
    title: meta.title || hostFromUrl(url) || url || key,
    url,
    host: hostFromUrl(url),
    section: isNews ? newsSectionName() : t("nav.bookmarks"),
    category: isNews ? t("category.news") : t("category.website"),
    cardType: isNews ? NEWS_CARD_TYPE : "",
  };
}

function inferArchiveSource(item) {
  return item?.sourceKey || isNewsCard(item) ? "news" : "bookmark";
}

function newsSectionName() {
  return state.data?.sections?.find((section) => section.cardType === NEWS_CARD_TYPE)?.name
    || state.settings?.newsBookmarkFolder
    || t("bookmarkFolder.defaultNews");
}

function inspirationSectionName() {
  return state.data?.sections?.find((section) => section.cardType === INSPIRATION_CARD_TYPE)?.name
    || state.settings?.inspirationBookmarkFolder
    || t("bookmarkFolder.defaultInspiration");
}

function isNewsCard(item) {
  return item?.cardType === NEWS_CARD_TYPE || (!item?.cardType && item?.section === LEGACY_NEWS_SECTION);
}

function isInspirationCard(item) {
  return item?.cardType === INSPIRATION_CARD_TYPE || (!item?.cardType && item?.section === LEGACY_INSPIRATION_SECTION);
}

function isBookmarkCard(item) {
  return item?.cardType === BOOKMARK_CARD_TYPE;
}

function cardTone(item) {
  if (isInspirationCard(item)) return "inspiration";
  if (isBookmarkCard(item)) return "bookmark";
  return "news";
}

function cardIconName(item) {
  if (isInspirationCard(item)) return "sparkling";
  if (isBookmarkCard(item)) return "bookmark-ribbon";
  return "news";
}

function dailyPageForCardType(cardType, count) {
  if (cardType === NEWS_CARD_TYPE) {
    const items = selectUnseenPool(dailyNewsItems(), state.seen, count * DAILY_NEWS_BATCH_LIMIT);
    return pageForItems(items, count, state.variants.news);
  }
  const items = selectUnseenPool(dailyInspirationItems(), state.seen, count * DAILY_INSPIRATION_BATCH_LIMIT);
  return pageForItems(items, count, state.variants.inspiration);
}

function dailyInspirationItems() {
  return shuffle(
    (state.data?.bookmarks || []).filter(isInspirationCard),
    `${state.day}.${inspirationSectionName()}`
  );
}

function batchLabel(pageInfo) {
  if (!pageInfo || pageInfo.total <= pageInfo.items.length) return t("batch.label", { page: 1, total: 1 });
  return t("batch.label", { page: pageInfo.page, total: pageInfo.pageCount });
}

function dailyNewsItems() {
  const news = newsSummaryItems(false);
  const ranker = createNewsRanker();
  return mergeRankedUnique([
    news.filter(isHotNewsItem),
    news.filter(isSummaryFillItem),
  ], {
    compare: ranker.compareImportant,
    keyOf: (item) => item.key || item.url,
  });
}

function activateCardFromKeyboard(event, action) {
  if (event.target !== event.currentTarget) return;
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  action();
}

function createNewsListCard(item) {
  const cardTitle = displaySummaryTitle(item);
  const card = document.createElement("article");
  card.className = `news-list-card link-row ${state.seen.has(item.key) ? "seen" : (state.opened.has(item.key) ? "opened" : "")}`;
  setCardItemIdentity(card, item);
  card.tabIndex = 0;
  card.setAttribute("role", "link");
  card.setAttribute("aria-label", t("card.openNews", { title: cardTitle }));
  card.title = cardTitle;
  card.addEventListener("click", () => openDailyItem(item));
  card.addEventListener("keydown", (event) => {
    activateCardFromKeyboard(event, () => openDailyItem(item));
  });
  attachLinkContextMenu(card, () => ({ url: itemUrl(item), title: cardTitle, item }));
  const main = document.createElement("div");
  main.className = "link-main";
  const title = document.createElement("span");
  title.className = "link-title news-list-title";
  title.textContent = cardTitle;
  const meta = document.createElement("div");
  meta.className = "link-host";
  meta.textContent = newsListMetaText(item);
  const actions = document.createElement("div");
  actions.className = "news-list-actions";
  actions.append(
    createReadingActions(item, { source: "news", compact: true, includeRead: false }),
    createSeenButton(item, t("action.markSeen"), t("action.unmarkSeen"), "news"),
  );
  main.append(title, meta);
  card.append(
    createBookmarkFavicon({ ...item, url: itemUrl(item) }),
    main,
    actions,
  );
  return card;
}

function newsListMetaText(item) {
  return [item.externalDiscovery
    ? t("category.externalDiscovery")
    : item.timeUnverified ? t("category.timeUnverified") : localizedCategory(item), item.host || item.url].filter(Boolean).join(" · ");
}

function createDailyCard(item) {
  const cardTitle = isNewsCard(item) ? displaySummaryTitle(item) : displayTitle(item);
  const card = document.createElement("article");
  card.className = `daily-card ${state.seen.has(item.key) ? "seen" : (state.opened.has(item.key) ? "opened" : "")}`;
  setCardItemIdentity(card, item);
  card.tabIndex = 0;
  card.setAttribute("role", "link");
  card.setAttribute("aria-label", t("card.openEntry", { title: cardTitle }));
  card.title = isNewsCard(item) ? cardTitle : itemUrl(item);
  card.addEventListener("click", () => openDailyItem(item));
  card.addEventListener("keydown", (event) => {
    activateCardFromKeyboard(event, () => openDailyItem(item));
  });
  attachLinkContextMenu(card, () => ({ url: itemUrl(item), title: cardTitle, item }));
  const top = document.createElement("div");
  top.className = "daily-top";
  const pill = document.createElement("span");
  pill.className = `pill ${cardTone(item)}`;
  const pillLabel = item.externalDiscovery
    ? t("category.externalDiscovery")
    : item.timeUnverified ? t("category.timeUnverified") : localizedCategory(item);
  pill.append(createIcon(cardIconName(item), "pill-icon"), document.createTextNode(pillLabel));
  top.append(pill);
  const title = document.createElement("span");
  title.className = "item-title";
  title.textContent = cardTitle;
  const host = document.createElement("span");
  host.className = "item-host";
  host.textContent = item.host || item.url;
  if (isInspirationCard(item)) {
    card.classList.add("has-inspiration-thumb");
    card.dataset.previewFingerprint = inspirationPreviews.fingerprint(item);
    card.append(top, title, host, createInspirationThumb(item));
  } else {
    card.append(top, title, host);
  }
  return card;
}

function createInspirationThumb(item) {
  const thumb = document.createElement("div");
  thumb.className = "inspiration-thumb";
  const preview = inspirationPreviews.get(item);
  const imageUrl = preview?.imageUrl || "";
  if (imageUrl) renderInspirationImageThumb(thumb, item, imageUrl);
  else {
    renderInspirationFallbackThumb(thumb, item);
    requestInspirationPreview(item);
  }
  return thumb;
}

function renderInspirationImageThumb(thumb, item, imageUrl) {
  thumb.className = "inspiration-thumb";
  const img = document.createElement("img");
  img.src = imageUrl;
  img.alt = "";
  img.loading = "lazy";
  img.referrerPolicy = "no-referrer";
  img.addEventListener("error", () => {
    inspirationPreviews.reject(item);
    renderInspirationFallbackThumb(thumb, item);
  }, { once: true });
  thumb.replaceChildren(img);
}

function renderInspirationFallbackThumb(thumb, item) {
  const fallback = faviconUrl(item) || "favicon.svg";
  thumb.className = "inspiration-thumb is-fallback";
  const glow = document.createElement("img");
  glow.className = "inspiration-favicon-glow";
  glow.src = fallback;
  glow.alt = "";
  glow.loading = "lazy";
  glow.referrerPolicy = "no-referrer";
  glow.setAttribute("aria-hidden", "true");
  glow.addEventListener("error", () => {
    if (glow.src.endsWith("/favicon.svg")) return;
    glow.src = "favicon.svg";
  }, { once: true });
  thumb.replaceChildren(glow);
}

function requestInspirationPreview(item) {
  inspirationPreviews.request(item);
}

function updateVisibleInspirationThumbs(item, imageUrl, fingerprint) {
  for (const card of els.dailyBoard.querySelectorAll(".daily-card.has-inspiration-thumb")) {
    if (card.dataset.key !== item.key || card.dataset.previewFingerprint !== fingerprint) continue;
    const thumb = card.querySelector(".inspiration-thumb");
    if (thumb) renderInspirationImageThumb(thumb, item, imageUrl);
  }
}

function createArchiveCard(item) {
  const titleText = archiveDisplayTitle(item);
  const url = archiveItemUrl(item);
  const card = document.createElement("article");
  card.className = "daily-card archive-card link-row seen";
  setCardItemIdentity(card, item);
  card.tabIndex = 0;
  card.setAttribute("role", "link");
  card.setAttribute("aria-label", t("card.openArchive", { title: titleText }));
  card.title = archiveSource(item) === "news" ? titleText : url;
  card.addEventListener("click", () => openExternal(url, titleText));
  card.addEventListener("keydown", (event) => {
    activateCardFromKeyboard(event, () => openExternal(url, titleText));
  });
  attachLinkContextMenu(card, () => ({ url, title: titleText }));
  const main = document.createElement("div");
  main.className = "link-main";
  const title = document.createElement("span");
  title.className = "link-title archive-title";
  title.textContent = titleText;
  const meta = document.createElement("span");
  meta.className = "link-host archive-host";
  meta.textContent = archiveMetaText(item, url);
  main.append(title, meta);
  card.append(createBookmarkFavicon({ ...item, url }), main, createSeenButton(item, t("action.markSeen"), t("action.removeArchive"), archiveSource(item)));
  return card;
}

function archiveMetaText(item, url) {
  return [archivePillText(item), hostFromUrl(url)].filter(Boolean).join(" · ");
}

function archiveDisplayTitle(item) {
  if (archiveSource(item) === "news") return displaySummaryTitle(item);
  return displayBookmarkTitle(item);
}

function archiveItemUrl(item) {
  if (archiveSource(item) === "news") return itemUrl(item);
  return item.url || item.seenUrl || itemUrl(item);
}

function archivePillText(item) {
  if (archiveSource(item) === "bookmark" && isNewsCard(item)) return t("category.website");
  return localizedCategory(item) || item.section || t("category.seen");
}

function archiveSource(item) {
  return item.seenSource === "news" ? "news" : "bookmark";
}

function renderSummaries() {
  const token = ++summaryRenderToken;
  const news = newsSummaryItems(true);
  const pool = summaryPoolItems(news);
  const page = pageForItems(pool, HOT_SUMMARY_PAGE_SIZE, state.variants.summary);
  state.variants.summary = page.variant;
  syncSummaryOrderButtons();
  els.summaryBatch.disabled = page.pageCount <= 1;
  els.summaryBatch.textContent = t(page.pageCount <= 1 ? "action.allShown" : "action.nextBatch");
  const visible = page.items;
  els.summaryMeta.textContent = batchLabel(page);
  if (!visible.length) {
    renderSummaryGrid([createEmptyState({
      title: t("summary.empty.title"),
      body: t("summary.empty.body"),
      variant: "panel",
      actionLabel: t("action.cache"),
      onAction: () => triggerRefresh(true),
    })], token);
    return;
  }
  renderSummaryGrid(visible.map(createSummaryCard), token);
}

function renderSummaryGrid(nodes, token) {
  const grid = els.summaryGrid;
  const currentCards = directSummaryCards(grid);
  const nextCards = nodes.filter((node) => node.matches?.(SUMMARY_CARD_SELECTOR));
  if (!currentCards.length || prefersReducedMotion()) {
    grid.replaceChildren(...nodes);
    return;
  }
  if (!nextCards.length) {
    const finishEmptyState = () => {
      if (token !== summaryRenderToken) return;
      grid.replaceChildren(...nodes);
    };
    const exitDuration = animateCardsOut(currentCards);
    window.setTimeout(finishEmptyState, exitDuration);
    return;
  }
  const nextKeys = new Set(nextCards.map((card) => card.dataset.key).filter(Boolean));
  const leavingCards = currentCards.filter((card) => card.dataset.key && !nextKeys.has(card.dataset.key));
  const applyDiff = () => {
    if (token !== summaryRenderToken) return;
    applySummaryGridDiff(grid, nodes);
  };
  if (leavingCards.length && !prefersReducedMotion()) {
    const exitDuration = animateCardsOut(leavingCards);
    window.setTimeout(applyDiff, exitDuration);
  } else {
    applyDiff();
  }
}

function applySummaryGridDiff(grid, nodes) {
  const currentByKey = new Map(directSummaryCards(grid)
    .filter((card) => card.dataset.key && !card.classList.contains("is-leaving"))
    .map((card) => [card.dataset.key, card]));
  const fragment = document.createDocumentFragment();
  const enteringCards = [];
  nodes.forEach((node) => {
    if (!node.matches?.(SUMMARY_CARD_SELECTOR)) {
      fragment.append(node);
      return;
    }
    const currentCard = currentByKey.get(node.dataset.key || "");
    if (currentCard) {
      clearCardAnimationState(node);
      clearCardAnimationState(currentCard);
      fragment.append(canReuseCard(currentCard, node) ? currentCard : node);
      return;
    }
    enteringCards.push(node);
    fragment.append(node);
  });
  grid.replaceChildren(fragment);
  animateCardsIn(enteringCards);
}

function directSummaryCards(root) {
  return Array.from(root.children).filter((node) => node.matches?.(SUMMARY_CARD_SELECTOR));
}

function newsSummaryItems(respectQuery) {
  const unifiedItems = Array.isArray(state.data?.feed?.items) ? state.data.feed.items : [];
  return unifiedItems
    .map(unifiedFeedItem)
    .filter((item) => !state.dismissed.has(item.key))
    .filter((item) => !respectQuery || matchesQuery(item));
}

function unifiedFeedItem(feedItem) {
  const lines = Array.isArray(feedItem.summary) && feedItem.summary.length
    ? feedItem.summary
    : (feedItem.excerpt ? [feedItem.excerpt] : []);
  const publishedAt = feedItem.publishedAt || feedItem.fetchedAt || "";
  return {
    key: feedItem.articleId || feedItem.entryKey,
    sourceKey: feedItem.sourceKey || "",
    section: newsSectionName(),
    cardType: NEWS_CARD_TYPE,
    title: feedItem.source || feedItem.host || t("category.news"),
    host: feedItem.host || hostFromUrl(feedItem.url || ""),
    category: feedItem.category || t("category.news"),
    categoryKey: feedItem.categoryKey || "",
    url: feedItem.url,
    feedItem,
    externalDiscovery: feedItem.externalDiscovery === true,
    timeUnverified: feedItem.timeUnverified === true,
    summary: {
      entryKey: feedItem.articleId || feedItem.entryKey,
      itemUrl: feedItem.url,
      title: feedItem.title,
      sourceTitle: feedItem.source,
      host: feedItem.host,
      category: feedItem.category,
      categoryKey: feedItem.categoryKey || "",
      summary: lines,
      description: feedItem.excerpt || "",
      imageUrl: feedItem.imageUrl || "",
      publishedAt,
      fetchedAt: feedItem.fetchedAt || "",
      hotScore: Number(feedItem.score || 0),
      isHotNews: true,
      newsStatus: "hot",
      summaryStatus: lines.length ? "excerpt" : "raw",
      timeUnverified: feedItem.timeUnverified === true,
      externalDiscovery: feedItem.externalDiscovery === true,
      clusterId: feedItem.clusterId || "",
      scoreBreakdown: feedItem.scoreBreakdown || {},
    },
  };
}

function summaryPoolItems(news) {
  const compare = createNewsRanker().compareByOrder(state.summaryOrder);
  const limit = state.data?.ai?.hotNewsCacheSize || state.settings?.hotNewsCacheSize || 192;
  return mergeRankedUnique([
    news.filter(isHotNewsItem),
    news.filter(isSummaryFillItem),
  ], {
    compare,
    keyOf: (item) => item.key,
    limit,
  });
}

function isHotNewsItem(item) {
  if (!isNewsCard(item)) return false;
  const summary = item.summary;
  if (!summary || summary.error || summary.hidden || summary.advertisement || summary.stale) return false;
  if (summary.newsStatus && summary.newsStatus !== "hot") return false;
  return Boolean(summary.isHotNews || summary.publishedAt || summary.updatedAt);
}

function isSummaryFillItem(item) {
  const summary = item.summary;
  return Boolean(
    isNewsCard(item) &&
    summary &&
    !summary.error &&
    !summary.hidden &&
    !summary.advertisement &&
    !summary.stale
  );
}

function createNewsRanker() {
  return createPriorityRanker({
    digestItems: state.data?.dailyDigest?.items || [],
    digestKeys: (item) => [normalizeUrl(item.url), normalizeComparableText(item.title)],
    itemKeys: (item) => [
      normalizeUrl(itemUrl(item)),
      normalizeUrl(item.summary?.itemUrl),
      normalizeComparableText(displaySummaryTitle(item)),
    ],
    hotScore: (item) => item.summary?.hotScore,
    itemTime: summaryTime,
  });
}

function syncSummaryOrderButtons() {
  for (const button of els.summaryOrder.querySelectorAll("button[data-order]")) {
    button.classList.toggle("active", button.dataset.order === state.summaryOrder);
  }
  syncSegmentedIndicator(els.summaryOrder);
}

function reshuffleSummaries() {
  const pool = summaryPoolItems(newsSummaryItems(true));
  const page = pageForItems(pool, HOT_SUMMARY_PAGE_SIZE, state.variants.summary);
  state.variants.summary = (page.variant + 1) % page.pageCount;
  writeValue(`dash.variant.${state.day}.summary`, String(state.variants.summary));
  renderSummaries();
}

function summaryTime(item) {
  const value = item.summary?.publishedAt || item.summary?.updatedAt || item.summary?.fetchedAt || "";
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : 0;
}

function createSummaryCard(item) {
  const isRefreshing = state.manualRefreshKeys.has(item.key);
  const cardTitle = displaySummaryTitle(item);
  const card = document.createElement("article");
  card.className = `summary-card ${isRefreshing ? "is-refreshing" : ""} ${state.opened.has(item.key) && !state.seen.has(item.key) ? "opened" : ""}`.trim();
  setCardItemIdentity(card, item);
  card.tabIndex = 0;
  card.setAttribute("role", "link");
  card.title = cardTitle;
  card.setAttribute("aria-label", t("card.openStory", { title: cardTitle }));
  card.addEventListener("click", (event) => {
    if (event.target.closest("button")) return;
    openSummaryItem(item);
  });
  card.addEventListener("keydown", (event) => {
    activateCardFromKeyboard(event, () => openSummaryItem(item));
  });
  attachLinkContextMenu(card, () => ({ url: itemUrl(item), title: cardTitle, item }));
  const thumb = createSummaryThumb(item);
  card.append(thumb);
  if (thumb.classList.contains("is-favicon-thumb")) card.classList.add("has-favicon-thumb");
  const body = document.createElement("div");
  body.className = "summary-body";
  const top = document.createElement("div");
  top.className = "summary-top";
  const headMain = document.createElement("div");
  headMain.className = "summary-head-main";
  const pill = document.createElement("span");
  pill.className = "pill news";
  const discoveryLabel = item.externalDiscovery
    ? t("category.externalDiscovery")
    : item.timeUnverified ? t("category.timeUnverified") : localizedCategory(item);
  pill.append(createIcon("news", "pill-icon"), document.createTextNode(discoveryLabel));
  const meta = document.createElement("span");
  meta.className = "summary-meta";
  meta.textContent = item.summary?.publishedAt || item.summary?.updatedAt || item.summary?.fetchedAt
    ? formatDateTime(item.summary.publishedAt || item.summary.updatedAt || item.summary.fetchedAt)
    : "";
  const cardActions = document.createElement("div");
  cardActions.className = "summary-card-actions";
  cardActions.append(createReadingActions(item, { source: "news", compact: true, includeRead: false }));
  if (cardSummaryEnabled() && !isCorrectlySummarized(item)) cardActions.append(createManualSummaryButton(item, isRefreshing));
  headMain.append(pill, meta);
  top.append(headMain, cardActions);
  const title = document.createElement("span");
  title.className = "summary-title";
  title.textContent = cardTitle;
  const source = document.createElement("span");
  source.className = "summary-meta";
  source.textContent = item.host || item.url;
  const lines = document.createElement("div");
  lines.className = "summary-lines";
  const detailText = summaryDetailLines(item, cardTitle).slice(0, 3).join(" ");
  if (detailText) {
    const node = document.createElement("div");
    node.className = "summary-line";
    node.textContent = detailText;
    lines.append(node);
  }
  body.append(top, title, source, lines);
  card.append(body);
  return card;
}

function createSummaryThumb(item) {
  const thumb = document.createElement("div");
  const imageUrl = item.summary?.imageUrl || "";
  const fallbackUrl = faviconUrl({ ...item, url: itemUrl(item) });
  thumb.className = `thumb ${imageUrl ? "" : "is-favicon-thumb"}`.trim();

  if (imageUrl) {
    const img = document.createElement("img");
    img.src = imageUrl;
    img.alt = "";
    img.loading = "lazy";
    img.referrerPolicy = "no-referrer";
    img.addEventListener("error", () => renderSummaryFaviconThumb(thumb, fallbackUrl), { once: true });
    thumb.append(img);
  } else {
    renderSummaryFaviconThumb(thumb, fallbackUrl);
  }

  return thumb;
}

function renderSummaryFaviconThumb(thumb, fallbackUrl) {
  const favicon = fallbackUrl || "favicon.svg";
  thumb.className = "thumb is-favicon-thumb";
  thumb.closest(".summary-card")?.classList.add("has-favicon-thumb");
  const glow = document.createElement("img");
  glow.className = "thumb-favicon-glow";
  glow.src = favicon;
  glow.alt = "";
  glow.loading = "lazy";
  glow.referrerPolicy = "no-referrer";
  glow.setAttribute("aria-hidden", "true");
  glow.addEventListener("error", () => {
    if (glow.src.endsWith("/favicon.svg")) return;
    glow.src = "favicon.svg";
  }, { once: true });
  thumb.replaceChildren(glow);
}

async function refreshSummaryItem(item, event) {
  event.preventDefault();
  event.stopPropagation();
  if (state.manualRefreshKeys.has(item.key)) return;

  let latestItem = item;
  state.manualRefreshKeys.add(item.key);
  updateSummaryCard(item);
  try {
    const result = await apiPost("/api/summary/refresh", { key: item.sourceKey || item.key });
    if (!result.ok) throw new Error(localizedResponseMessage(result, "error.requestFailed"));
    await loadDashboard();
    latestItem = findNewsItemByReference({
      articleId: item.feedItem?.articleId || item.key,
      sourceKey: item.sourceKey,
      url: itemUrl(item),
      title: displaySummaryTitle(item),
    }) || item;
    if (state.data?.ai && result.quota) {
      state.data.ai.usedToday = result.quota.usedToday;
      state.data.ai.dailyLimit = result.quota.dailyLimit;
      renderStatus();
    }
  } catch (error) {
    renderOverviewStatus(t("summary.manualFailed"), localizedErrorMessage(error));
  } finally {
    state.manualRefreshKeys.delete(item.key);
    updateSummaryCard(latestItem);
  }
}

function updateSummaryCard(item) {
  if (!isHotNewsItem(item) || !matchesQuery(item)) {
    renderSummaries();
    return;
  }
  const current = [...els.summaryGrid.querySelectorAll(".summary-card")]
    .find((node) => node.dataset.key === item.key);
  if (current) current.replaceWith(createSummaryCard(item));
  else renderSummaries();
}

function renderSectionFilters() {
  const sections = state.data?.sections || [];
  const allowed = new Set([ALL_FILTER, ...sections.map((section) => section.name)]);
  if (!allowed.has(state.filter)) {
    state.filter = ALL_FILTER;
    state.categoryFilter = ALL_FILTER;
  }
  const buttons = [
    createSectionFilterButton(ALL_FILTER, t("filter.all"), "filter-lines"),
    ...sections.map((section) => createSectionFilterButton(section.name, section.name, cardIconName(section))),
  ];
  els.sectionFilter.replaceChildren(...buttons);
  syncSegmentedIndicator(els.sectionFilter);
}

function createSectionFilterButton(value, label, icon) {
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.section = value;
  setIconLabel(button, icon || "folder", label, "segment-icon", "segment-label");
  button.classList.toggle("active", state.filter === value);
  return button;
}

function renderCategoryFilters() {
  els.categoryFilter.hidden = false;
  if (state.filter === ALL_FILTER) {
    state.categoryFilter = ALL_FILTER;
    els.categoryFilter.classList.remove("is-open");
    els.categoryFilter.setAttribute("aria-hidden", "true");
    for (const button of els.categoryFilter.querySelectorAll("button")) button.tabIndex = -1;
    syncSegmentedIndicator(els.categoryFilter);
    return;
  }
  const categories = availableCategories();
  const buttons = [
    createCategoryFilterButton(ALL_FILTER, t("filter.allCategories"), "filter-lines"),
    ...categories.map((category) => createCategoryFilterButton(category.name, category.name)),
  ];
  els.categoryFilter.replaceChildren(...buttons);
  for (const button of buttons) button.tabIndex = 0;
  els.categoryFilter.setAttribute("aria-hidden", "false");
  els.categoryFilter.classList.add("is-open");
  syncSegmentedIndicator(els.categoryFilter);
}

function availableCategories() {
  const categories = [];
  const seen = new Set();
  for (const section of state.data?.sections || []) {
    if (state.filter !== ALL_FILTER && state.filter !== section.name) continue;
    for (const category of section.categories || []) {
      if (seen.has(category.name)) continue;
      seen.add(category.name);
      categories.push({ section: section.name, name: category.name });
    }
  }
  return categories;
}

function createCategoryFilterButton(value, label, icon = "folder") {
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.category = value;
  setIconLabel(button, icon, label, "segment-icon", "segment-label");
  button.classList.toggle("active", state.categoryFilter === value);
  return button;
}

function renderCategories() {
  els.categoryGrid.classList.toggle("is-filtered-category", state.categoryFilter !== ALL_FILTER);
  const groups = [];
  const bookmarksByCategory = groupItemsByKey(
    state.data?.bookmarks || [],
    (item) => `${item.section}\u0000${item.category}`,
    matchesQuery,
  );
  for (const section of state.data?.sections || []) {
    if (state.filter !== ALL_FILTER && state.filter !== section.name) continue;
    for (const category of section.categories) {
      if (state.categoryFilter !== ALL_FILTER && state.categoryFilter !== category.name) continue;
      const items = bookmarksByCategory.get(`${section.name}\u0000${category.name}`) || [];
      if (items.length > 0) groups.push({ section: section.name, cardType: section.cardType, category: category.name, items });
    }
  }
  if (!groups.length) {
    els.categoryGrid.replaceChildren(createEmptyState({
      title: t("empty.noMatches.title"),
      body: t("empty.noMatches.body"),
      variant: "panel",
    }));
    return;
  }
  els.categoryGrid.replaceChildren(...groups.map(createCategoryBlock));
}

function createCategoryBlock(group) {
  const block = document.createElement("section");
  block.className = "category";
  const header = document.createElement("div");
  header.className = "category-header";
  const title = document.createElement("div");
  title.className = "category-title";
  const name = document.createElement("span");
  name.textContent = group.category;
  const pill = document.createElement("span");
  const groupCard = { cardType: group.cardType, section: group.section };
  pill.className = `pill ${cardTone(groupCard)}`;
  pill.textContent = group.section;
  title.append(createIcon(cardIconName(groupCard), "card-icon"), name, pill);
  const count = document.createElement("span");
  count.className = "count";
  count.textContent = String(group.items.length);
  header.append(title, count);
  attachGroupContextMenu(header, () => group);
  const list = document.createElement("div");
  list.className = "link-list";
  list.append(...group.items.map(createLinkRow));
  block.append(header, list);
  return block;
}

function createLinkRow(item) {
  const row = document.createElement("div");
  row.className = `link-row ${state.seen.has(item.key) ? "seen" : (state.opened.has(item.key) ? "opened" : "")}`;
  const bookmarkUrl = item.url || itemUrl(item);
  const bookmarkTitle = displayBookmarkTitle(item);
  const main = document.createElement("a");
  main.className = "link-main";
  main.href = bookmarkUrl;
  main.target = "_blank";
  main.rel = "noreferrer";
  main.title = bookmarkUrl;
  main.addEventListener("click", (event) => {
    event.preventDefault();
    openExternal(bookmarkUrl, bookmarkTitle, item);
  });
  const title = document.createElement("span");
  title.className = "link-title";
  title.textContent = bookmarkTitle;
  const host = document.createElement("span");
  host.className = "link-host";
  host.textContent = item.host || item.url;
  main.append(title, host);
  row.append(createBookmarkFavicon(item), main, createSeenButton(item, t("action.markSeen"), t("action.unmarkSeen"), "bookmark"));
  attachLinkContextMenu(row, () => ({ url: bookmarkUrl, title: bookmarkTitle, item }));
  return row;
}

function displayBookmarkTitle(item) {
  const title = String(item.title || "").trim();
  return title || item.host || item.url;
}

function createBookmarkFavicon(item) {
  const icon = document.createElement("img");
  icon.className = "bookmark-favicon";
  icon.src = faviconUrl(item);
  icon.alt = "";
  icon.loading = "lazy";
  icon.referrerPolicy = "no-referrer";
  icon.setAttribute("aria-hidden", "true");
  icon.addEventListener("error", () => {
    icon.src = "favicon.svg";
  }, { once: true });
  return icon;
}

function createSeenButton(item, uncheckedLabel, checkedLabel, source = defaultSeenSource(item)) {
  const isSeen = state.seen.has(item.key);
  const button = document.createElement("button");
  const label = isSeen ? checkedLabel : uncheckedLabel;
  button.className = `seen-toggle ${isSeen ? "is-seen" : ""}`;
  button.type = "button";
  button.title = label;
  button.setAttribute("aria-label", label);
  button.setAttribute("aria-pressed", String(isSeen));
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    toggleSeen(item, !state.seen.has(item.key), source);
  });
  button.append(createThemedIcon("checkmark", "seen-mark"), srOnly(label));
  return button;
}

function createReadingActions(item, options = {}) {
  const actions = document.createElement("div");
  actions.className = `reading-actions ${options.compact ? "is-compact" : ""}`.trim();
  const active = isQueued(item);
  actions.append(
    createActionToggleButton({
      active,
      icon: active ? "bookmark-filled" : "bookmark-ribbon",
      label: t(active ? "action.removeReadingQueue" : "action.addReadingQueue"),
      readingQueueKey: actionKey(item),
      onClick: () => toggleReadingQueue(item),
    }),
  );
  if (options.includeRead !== false) {
    const read = state.seen.has(actionKey(item));
    actions.append(createActionToggleButton({
      active: read,
      icon: "checkmark",
      label: t(read ? "action.unmarkRead" : "action.markRead"),
      onClick: () => toggleSeen(item, !read, options.source || defaultSeenSource(item)),
    }));
  }
  return actions;
}

function createManualSummaryButton(item, isRefreshing) {
  const button = document.createElement("button");
  const label = t(isRefreshing ? "action.organizing" : "action.manualSummary");
  button.className = `action-toggle ${isRefreshing ? "is-active is-loading" : ""}`.trim();
  button.type = "button";
  button.disabled = isRefreshing;
  button.title = label;
  button.setAttribute("aria-label", label);
  button.append(createIcon(isRefreshing ? "synchronize" : "sparkling", "action-toggle-icon"), srOnly(label));
  button.addEventListener("click", (event) => refreshSummaryItem(item, event));
  return button;
}

function createActionToggleButton({ active, icon, label, className, readingQueueKey, onClick }) {
  const button = document.createElement("button");
  button.className = `action-toggle ${className || ""} ${active ? "is-active" : ""}`.trim();
  button.type = "button";
  button.title = label;
  button.setAttribute("aria-label", label);
  button.setAttribute("aria-pressed", String(Boolean(active)));
  if (readingQueueKey) button.dataset.readingQueueKey = readingQueueKey;
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onClick();
  });
  button.append(createThemedIcon(icon, "action-toggle-icon"), srOnly(label));
  return button;
}

function renderConnectionError(error) {
  const detail = localizedErrorMessage(error);
  renderOverviewStatus(t("connection.unavailable"), t("connection.retryMeta", { detail }));
  els.settingsKeyStatus.textContent = t("connection.backgroundPaused");
  els.settingsModelStatus.textContent = "-";
  els.settingsQuotaStatus.textContent = "0/50";
  els.settingsTotalStatus.textContent = "0";
  els.dailyBoard.replaceChildren(createEmptyState({
    title: t("connection.recoveringTitle"),
    body: t("connection.recoveringBody"),
    variant: "error",
  }));
  els.summaryGrid.replaceChildren(createEmptyState({
    title: t("connection.cacheTitle"),
    body: t("connection.cacheBody"),
    variant: "error",
  }));
  els.categoryGrid.replaceChildren(createEmptyState({
    title: t("connection.entriesTitle"),
    body: t("connection.entriesBody"),
    variant: "error",
  }));
}

function readingQueueItems() {
  const byKey = actionItemsByKey();
  return Array.from(state.readingQueue)
    .map((key) => actionItemForKey(key, byKey.get(key), state.readingQueueMeta.get(key)))
    .filter((item) => item && !state.seen.has(item.key));
}

function openAndMarkReadingQueue(items) {
  if (!items.length) return;
  if (readingQueueOpenOnReadAll()) {
    for (const item of items) {
      const url = itemUrl(item);
      if (url) openExternalWindow(url);
    }
  }
  for (const item of items) {
    const key = seenKey(item);
    if (!key) continue;
    state.seen.add(key);
    upsertSeenMeta(key, seenDetailsForItem(item, defaultSeenSource(item)));
    state.readingQueue.delete(key);
    state.readingQueueMeta.delete(key);
    sendFeedback(item, "read");
  }
  persistSeen();
  persistReadingQueue();
  renderAll();
}

function readingQueueOpenOnReadAll() {
  return state.settings?.readingQueueOpenOnReadAll !== false;
}

function actionItemsByKey() {
  const items = [
    ...(state.data?.bookmarks || []),
    ...newsSummaryItems(false),
  ];
  return new Map(items.map((item) => [item.key, item]));
}

function actionItemForKey(key, item, meta = {}) {
  if (item) return item;
  if (!meta.title && !meta.url) return null;
  const source = normalizeSeenSource(meta.source || "news");
  return {
    key,
    title: meta.title || meta.host || meta.url || key,
    url: meta.url || "",
    host: meta.host || hostFromUrl(meta.url || ""),
    category: meta.category || (source === "news" ? t("category.news") : t("category.website")),
    section: source === "news" ? newsSectionName() : t("nav.bookmarks"),
    cardType: source === "news" ? NEWS_CARD_TYPE : "",
    sourceKey: source === "news" ? key : "",
  };
}

function findNewsItemByReference(reference = {}) {
  return findNewsItemReference(newsSummaryItems(false), reference);
}

function isQueued(item) {
  return state.readingQueue.has(actionKey(item));
}

function actionKey(item) {
  return seenKey(item);
}

function toggleReadingQueue(item) {
  const key = actionKey(item);
  if (!key) return;
  if (state.readingQueue.has(key)) {
    state.readingQueue.delete(key);
    state.readingQueueMeta.delete(key);
  } else {
    state.readingQueue.add(key);
    state.readingQueueMeta.set(key, actionDetailsForItem(item));
    sendFeedback(item, "queued");
  }
  persistReadingQueue();
  syncReadingQueueButtons(key);
  renderEfficiencyPanel();
}

function syncReadingQueueButtons(key) {
  const active = state.readingQueue.has(key);
  const label = t(active ? "action.removeReadingQueue" : "action.addReadingQueue");
  document.querySelectorAll("[data-reading-queue-key]").forEach((button) => {
    if (button.dataset.readingQueueKey !== key) return;
    button.classList.toggle("is-active", active);
    button.title = label;
    button.setAttribute("aria-label", label);
    button.setAttribute("aria-pressed", String(active));
    button.replaceChildren(
      createThemedIcon(active ? "bookmark-filled" : "bookmark-ribbon", "action-toggle-icon"),
      srOnly(label),
    );
  });
}

function actionDetailsForItem(item) {
  const source = defaultSeenSource(item);
  const url = source === "news" ? itemUrl(item) : (item.url || itemUrl(item));
  return {
    key: actionKey(item),
    source,
    title: String(source === "news" ? displaySummaryTitle(item) : displayBookmarkTitle(item)).slice(0, 300),
    url: String(url || "").slice(0, 2048),
    host: String(item.host || hostFromUrl(url) || "").slice(0, 255),
    category: String(item.category || "").slice(0, 200),
    addedAt: new Date().toISOString(),
  };
}

function persistReadingQueue() {
  writeJson(READING_QUEUE_STORAGE_KEY, Array.from(state.readingQueue).slice(-ACTION_RECORD_LIMIT).map((key) => ({
    key,
    ...(state.readingQueueMeta.get(key) || {}),
  })));
}

function openDailyItem(item) {
  openExternal(itemUrl(item), isNewsCard(item) ? displaySummaryTitle(item) : displayTitle(item), item);
  renderEfficiencyPanel();
}

function openSummaryItem(item) {
  openExternal(itemUrl(item), displaySummaryTitle(item), item);
  renderEfficiencyPanel();
}

function matchesQuery(item) {
  if (!state.query) return true;
  return `${item.title} ${item.host} ${item.url} ${item.section} ${item.category} ${summaryText(item)}`.toLowerCase().includes(state.query);
}

function toggleSeen(item, checked, source = defaultSeenSource(item)) {
  const key = seenKey(item);
  if (!key) return;
  if (checked) {
    state.seen.add(key);
    upsertSeenMeta(key, seenDetailsForItem(item, source));
    removeFromReadingQueue(key);
    sendFeedback(item, "read");
  } else {
    state.seen.delete(key);
    state.seenMeta.delete(key);
  }
  persistSeen();
  renderAll();
}

function markOpenedItem(item) {
  const key = actionKey(item);
  if (!key || state.opened.has(key) || state.seen.has(key)) return false;
  state.opened.add(key);
  state.openedMeta.set(key, actionDetailsForItem(item));
  persistActionRecords(OPENED_STORAGE_KEY, state.opened, state.openedMeta);
  sendFeedback(item, "opened");
  return true;
}

function dismissItem(item) {
  const key = actionKey(item);
  if (!key) return;
  state.dismissed.add(key);
  state.dismissedMeta.set(key, actionDetailsForItem(item));
  removeFromReadingQueue(key);
  persistActionRecords(DISMISSED_STORAGE_KEY, state.dismissed, state.dismissedMeta);
  sendFeedback(item, "dismissed");
  renderAll();
}

function sendFeedback(item, action) {
  const article = item?.feedItem;
  if (!article?.articleId) return;
  if (action === "opened" && state.settings?.personalizedRankingEnabled === false) return;
  apiPost("/api/feedback", {
    articleId: article.articleId,
    action,
    source: article.source || item.title || "",
    category: article.category || item.category || "",
    topics: article.topics || [],
  }).catch(() => {});
}

function persistActionRecords(storageKey, keys, meta) {
  writeJson(storageKey, Array.from(keys).slice(-ACTION_RECORD_LIMIT).map((key) => ({ key, ...(meta.get(key) || {}) })));
}

function removeFromReadingQueue(key) {
  if (!state.readingQueue.has(key)) return;
  state.readingQueue.delete(key);
  state.readingQueueMeta.delete(key);
  persistReadingQueue();
}

function retainSeenArchiveEnabled() {
  return state.settings?.retainSeenArchive === true;
}

function syncSeenArchiveRetention({ render = true } = {}) {
  const enabled = retainSeenArchiveEnabled();
  if (seenRetentionMode === enabled) return false;
  seenRetentionMode = enabled;
  if (enabled) {
    replaceSeenRecords(mergeSeenRecords(
      readSeenRecords(RETAINED_SEEN_STORAGE_KEY),
      currentSeenRecords(),
    ));
  } else {
    const todayRecords = mergeSeenRecords(
      readSeenRecords(`dash.seen.${state.day}`),
      currentSeenRecords().filter((record) => seenRecordDay(record) === state.day),
    );
    writeJson(RETAINED_SEEN_STORAGE_KEY, []);
    replaceSeenRecords(todayRecords);
  }
  persistSeen();
  if (state.data && render) renderAll();
  return true;
}

function readSeenRecords(key) {
  const value = readJson(key, []);
  if (!Array.isArray(value)) return [];
  return mergeSeenRecords(value.map((item) => typeof item === "string" ? { key: item } : item));
}

function mergeSeenRecords(...groups) {
  const records = new Map();
  for (const item of groups.flat()) {
    const key = String(item?.key || "").trim();
    if (!key) continue;
    const previous = records.get(key) || {};
    const source = item?.source || previous.source || "";
    records.set(key, {
      ...previous,
      ...item,
      key,
      ...(source ? { source: normalizeSeenSource(source) } : {}),
    });
  }
  return Array.from(records.values());
}

function currentSeenRecords() {
  return Array.from(state.seen).map((key) => ({
    key,
    ...(state.seenMeta.get(key) || {}),
  }));
}

function replaceSeenRecords(records) {
  state.seen = new Set(records.map((record) => record.key));
  state.seenMeta = new Map(records.map((record) => [record.key, record]));
}

function seenRecordDay(record) {
  const date = new Date(record?.addedAt || "");
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function persistSeen() {
  writeJson(
    retainSeenArchiveEnabled() ? RETAINED_SEEN_STORAGE_KEY : `dash.seen.${state.day}`,
    currentSeenRecords().slice(-ACTION_RECORD_LIMIT),
  );
}

function upsertSeenMeta(key, details = {}) {
  const previous = state.seenMeta.get(key) || {};
  const source = normalizeSeenSource(details.source || previous.source);
  state.seenMeta.set(key, {
    ...previous,
    ...details,
    key,
    source,
    addedAt: previous.addedAt || details.addedAt || new Date().toISOString(),
  });
}

function seenDetailsForItem(item, source = defaultSeenSource(item)) {
  const normalizedSource = normalizeSeenSource(source);
  return {
    source: normalizedSource,
    title: String(normalizedSource === "news" ? displaySummaryTitle(item) : displayBookmarkTitle(item)).slice(0, 300),
    url: String(normalizedSource === "news" ? itemUrl(item) : (item.url || itemUrl(item)) || "").slice(0, 2048),
    addedAt: new Date().toISOString(),
  };
}

function defaultSeenSource(item) {
  return item?.sourceKey ? "news" : "bookmark";
}

function normalizeSeenSource(source) {
  return source === "news" ? "news" : "bookmark";
}

function seenKey(item) {
  return typeof item === "string" ? item : item?.key;
}

function displayTitle(item) {
  const title = item.summary && !item.summary.hidden
    ? (organizedSummaryTitle(item) || item.summary.title)
    : item.title;
  return title && title.trim() ? title.trim() : (item.host || item.url);
}

function displaySummaryTitle(item) {
  const candidates = item.summary && !item.summary.hidden
    ? [organizedSummaryTitle(item), item.summary.title, item.title]
    : [item.title];
  for (const candidate of candidates) {
    const title = cleanSummaryTitle(candidate);
    if (title) return title;
  }
  return item.host || item.url;
}

function cleanSummaryTitle(value) {
  return cleanTitleText(value);
}

function itemUrl(item) {
  return item.summary && !item.summary.hidden ? (item.summary.itemUrl || item.url) : item.url;
}

function summaryText(item) {
  return summaryLines(item).join(" ");
}

function summaryDetailLines(item, displayTitleText = "") {
  const lines = summaryLines(item);
  const fullTitles = [
    organizedSummaryTitle(item),
    item.summary?.title,
    item.title,
  ].map(cleanTitleText).filter(Boolean);
  const filtered = lines
    .map((line) => stripTitlePrefix(line, fullTitles))
    .filter((line) => line && !fullTitles.some((candidate) => isRepeatedSummaryLine(line, candidate)));
  const expanded = expandSummaryDetailLines(filtered.length ? filtered : lines);
  if (expanded.some((line) => textLength(line) >= 12)) return expanded;
  const fallback = summaryDescriptionLines(item);
  return fallback.length ? expandSummaryDetailLines(fallback) : expanded;
}

function stripTitlePrefix(line, titles) {
  let text = String(line || "").trim();
  for (const title of titles.sort((a, b) => textLength(b) - textLength(a))) {
    if (!title || !text.startsWith(title)) continue;
    text = text
      .slice(title.length)
      .replace(/^[\s:：,，.。;；|｜—–-]+/, "")
      .trim();
    break;
  }
  return text;
}

function summaryDescriptionLines(item) {
  return item.summary?.description ? cleanSummaryLines([item.summary.description]) : [];
}

function expandSummaryDetailLines(lines) {
  const expanded = [];
  for (const line of lines) {
    const parts = String(line || "")
      .split(/(?<=[。！？!?；;])\s*/u)
      .map((part) => part.trim())
      .filter(Boolean);
    expanded.push(...(parts.length > 1 ? parts : [line]));
  }
  return expanded;
}

function isRepeatedSummaryLine(line, title) {
  const lineKey = normalizeComparableText(line);
  const titleKey = normalizeComparableText(title);
  if (!lineKey || !titleKey) return false;
  if (lineKey === titleKey) return true;
  if (titleKey.length >= 8 && lineKey.includes(titleKey)) return true;
  if (lineKey.length >= 8 && titleKey.includes(lineKey)) return true;
  return similarityScore(lineKey, titleKey) >= .72;
}

function summaryLines(item) {
  if (item.summary?.hidden) return [];
  if (item.summary?.error) return [];
  if (Array.isArray(item.summary?.summary) && item.summary.summary.length) return cleanSummaryLines(item.summary.summary);
  if (item.summary?.description) return cleanSummaryLines([item.summary.description]);
  return [];
}

function organizedSummaryTitle(item) {
  if (!item.summary || item.summary.hidden || item.summary.error || item.summary.summaryStatus !== "ai") return "";
  return Array.isArray(item.summary.summary) ? (cleanSummaryLines(item.summary.summary)[0] || "") : "";
}

function isCorrectlySummarized(item) {
  const summary = item.summary;
  if (!summary || summary.error || summary.hidden || summary.advertisement || summary.stale) return false;
  if (summary.newsStatus && summary.newsStatus !== "hot") return false;
  if (summary.summaryStatus !== "ai") return false;
  return cleanSummaryLines(Array.isArray(summary.summary) ? summary.summary : []).length >= 2;
}

function cardSummaryEnabled() {
  return state.settings?.cardSummaryEnabled !== false && state.data?.ai?.cardSummaryEnabled !== false;
}

function cleanSummaryLines(lines) {
  return lines
    .map((line) => String(line || "").trim())
    .filter((line) => line && !QUICK_REFERENCE_LINES.has(line) && !isSummaryStatusLine(line));
}

function isSummaryStatusLine(line) {
  return isQuotaOrContentLimitLine(line) || isBasicExcerptLine(line);
}

function isQuotaOrContentLimitLine(line) {
  return [
    ...allTranslations("summary.status.quotaReached"),
    ...allTranslations("summary.status.noContent"),
  ].some((value) => line.includes(value));
}

function isBasicExcerptLine(line) {
  return [
    ...allTranslations("summary.status.noService"),
    ...allTranslations("summary.status.basicExcerpt"),
  ].some((value) => line.includes(value));
}

function localizedResponseMessage(value, fallbackKey = "error.requestFailed") {
  if (value?.messageKey) return t(value.messageKey, value.messageParams || value.params || {});
  return String(value?.message || "").trim() || t(fallbackKey);
}

function localizedErrorMessage(error) {
  if (error?.messageKey) return t(error.messageKey, error.messageParams || error.params || {});
  return String(error?.message || error || t("error.requestFailed"));
}

function localizedStatusMessage(value, fallbackKey) {
  if (value?.messageKey) return t(value.messageKey, value.messageParams || {});
  const legacyKey = legacyStatusMessageKey(value?.message);
  if (legacyKey) return t(legacyKey.key, legacyKey.params);
  return String(value?.message || "").trim() || t(fallbackKey);
}

function legacyStatusMessageKey(message) {
  const text = String(message || "");
  if (!text) return null;
  if (text === "等待首次刷新") return { key: "background.waitingFirstRefresh", params: {} };
  if (text === "本地缓存已准备") return { key: "background.cacheReady", params: {} };
  if (text === "没有已授权的资讯来源") return { key: "background.noAuthorizedSources", params: {} };
  const reading = text.match(/^正在读取 (\d+) 个已授权来源$/);
  if (reading) return { key: "background.readingSources", params: { count: reading[1] } };
  const processed = text.match(/^已处理 (\d+)\/(\d+) 个来源$/);
  if (processed) return { key: "background.processedSources", params: { completed: processed[1], total: processed[2] } };
  const cached = text.match(/^已缓存 (\d+) 条资讯$/);
  if (cached) return { key: "background.cachedItems", params: { count: cached[1] } };
  return null;
}

function localizedCategory(item = {}) {
  const key = String(item.categoryKey || item.summary?.categoryKey || "").trim();
  if (key) return t(`category.${key}`);
  if (item.externalDiscovery) {
    const aliases = {
      "全球热点": "global",
      "国际": "international",
      "科技": "technology",
      "消费科技": "consumerTechnology",
    };
    const alias = aliases[item.category];
    if (alias) return t(`category.${alias}`);
  }
  return item.category || t("category.news");
}

function localizedSourceLabel(label, labelKey = "") {
  if (labelKey) return t(labelKey);
  const aliases = {
    "建议检查": "sourceQuality.review",
    "保留": "sourceQuality.keep",
  };
  return aliases[label] ? t(aliases[label]) : (label || "");
}

function localizedSourceReason(reason, reasonKey = "") {
  if (reasonKey) return t(reasonKey);
  const aliases = {
    "未读取到可用内容": "sourceQuality.empty",
    "最近抓取失败": "sourceQuality.failed",
  };
  return aliases[reason] ? t(aliases[reason]) : (reason || "");
}

function localizedExclusionReason(item = {}) {
  if (item.reasonKey === "exclusion.reason.suggestion") {
    return t("exclusion.reason.suggestionDetail", { detail: item.reasonDetail || "" });
  }
  if (item.reasonKey) return t(item.reasonKey);
  const aliases = {
    "手动屏蔽": "exclusion.reason.manual",
    "手动屏蔽文件夹": "exclusion.reason.manualFolder",
  };
  if (aliases[item.reason]) return t(aliases[item.reason]);
  return item.reason || t("exclusion.noReason");
}

function apiStyleLabel(value) {
  return value === "chat_completions" ? t("settings.service.chatCompletions") : "Responses";
}

function colorModeLabel(value) {
  return {
    system: t("settings.colorMode.system"),
    dark: t("settings.colorMode.dark"),
    light: t("settings.colorMode.light"),
  }[value] || t("settings.colorMode.system");
}

function themeLabel(value) {
  return {
    violet: t("settings.accent.violet"),
    cyan: t("settings.accent.cyan"),
    emerald: t("settings.accent.emerald"),
    amber: t("settings.accent.amber"),
    rose: t("settings.accent.rose"),
  }[value] || t("settings.accent.violet");
}
