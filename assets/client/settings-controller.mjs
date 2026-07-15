import { applyContentSyncSettings, contentSyncSettingsPayload, setContentSyncControlsBusy } from "./content-sync-settings.mjs";
import { createAiConnectionTest } from "./ai-connection-test.mjs";
import { newlyRequiredUngrantedOrigins } from "./permission-ui-model.mjs";
import { createSavedSourcePermissionController, personalSourcePermissionScope } from "./saved-source-permission-controller.mjs";
export function createSettingsController(options) {
  const {
    state, els, t, apiGet, apiPost, localizedResponseMessage, localizedErrorMessage,
    applyUiLocale, selectedUiLocale, syncLanguageControls, applyAppearanceSettings, syncAppearanceControls,
    renderExcludeFolderOptions, renderExclusionList, renderSourceSuggestionList, syncBookmarkFolderControls,
    syncPublicFeedSupplementControl, syncWebsiteShortcutControls, syncAiSetupControls, refreshAiSetupPermission,
    prepareAiProviderUi,
    getAiSetupState, clearAiSetupFeedback, focusAiSetupRequirement, currentExcludedNewsSources,
    bookmarkSourcePayload, appearancePayload, snapshotSettingsDraft, cloneSettingsDraft, diffSettingsDraft,
    syncSeenArchiveRetention, loadDashboard, triggerRefresh, renderStatus, renderEfficiencyPanel, renderAll,
    resetToDailyView, syncNavToCurrentSection, getLocale, setLocale, settingsSaveCloseDelayMs, settingsCloseMotionMs,
    inspirationPreviews, syncHeaderImageFullscreenControl, syncHeaderImageBlurControl, syncHeaderImageHeightControl, headerCoverController, availableNewsFolders,
    syncSourceSuggestionActionState, syncSegmentedIndicator, websiteShortcutsPayload,
    setWebsiteShortcutControlsBusy, aiSetupStage, requestSourcePermissions,
  } = options;
  let settingsLoadToken = 0, settingsLocaleAtOpen = getLocale(), settingsSnapshot = null, settingsSession = 0;
  let settingsCloseTimer = 0, settingsActionGeneration = 0, settingsBusy = false, settingsTabScrollPositions = new Map();
  const captureSettingsSnapshot = () => { settingsLocaleAtOpen = getLocale(); settingsSnapshot = snapshotSettingsDraft(state.settings, selectedUiLocale()); };
  const savedSourcePermission = createSavedSourcePermissionController({
    els, t, selectSettingsTab, requestSourcePermissions, loadDashboard, triggerRefresh,
    renderSettingsStatus, setSettingsBusy, isSettingsBusy: () => settingsBusy,
    closeSettings, getSettingsSession: () => settingsSession,
    settingsSaveCloseDelayMs, wait,
  });
  const { testKey, renderStatus: renderAiConnectionStatus } = createAiConnectionTest({
    els, t, apiPost, localizedResponseMessage, localizedErrorMessage,
    getAiSetupState, focusAiSetupRequirement, runSettingsAction,
    currentSettingsHaveUnsavedChanges, renderSettingsStatus,
  });
  return {
    loadSettings, saveSettings,
    grantSavedSourcePermissions: savedSourcePermission.grant,
    dismissSavedSourcePermissions: savedSourcePermission.dismiss,
    testKey, testImageSearchKey, clearImageSearchKey,
    clearKey, clearCache, resetQuota, resetPreferences, openSettings,
    captureSettingsSnapshot,
    focusSettingsStart, closeSettings, requestCloseSettings, resetSecretDrafts,
    setSettingsBusy, runSettingsAction, selectSettingsTab, renderSettingsStatus,
    isBusy: () => settingsBusy,
  };
async function loadSettings() {
  const token = ++settingsLoadToken;
  try {
    const [settings] = await Promise.all([apiGet("/api/settings"), headerCoverController.load()]);
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
    els.todayNewsPerPublisherInput.value = state.settings.savedTodayNewsPerPublisherLimit === ""
      ? (state.settings.todayNewsPerPublisherLimit ?? state.settings.defaultTodayNewsPerPublisherLimit ?? 0)
      : (state.settings.savedTodayNewsPerPublisherLimit ?? state.settings.todayNewsPerPublisherLimit ?? state.settings.defaultTodayNewsPerPublisherLimit ?? 0);
    els.todayNewsPerPublisherInput.placeholder = state.settings.defaultTodayNewsPerPublisherLimit ?? "0";
    syncBookmarkFolderControls(state.settings);
    syncWebsiteShortcutControls(state.settings);
    els.cardSummaryEnabledInput.checked = state.settings.cardSummaryEnabled !== false;
    els.floatingOpenInput.checked = state.settings.floatingWebOpenEnabled === true;
    els.readingQueueOpenOnReadAllInput.checked = state.settings.readingQueueOpenOnReadAll !== false;
    els.retainSeenArchiveInput.checked = state.settings.retainSeenArchive === true;
    applyContentSyncSettings(els, state.settings);
    els.personalizedRankingEnabledInput.checked = state.settings.personalizedRankingEnabled !== false;
    els.publicFeedSupplementEnabledInput.checked = state.settings.publicFeedSupplementEnabled !== false;
    syncPublicFeedSupplementControl();
    els.webImageSearchEnabledInput.checked = state.settings.webImageSearchEnabled === true; els.imageSearchStrategy.hidden = !els.webImageSearchEnabledInput.checked;
    els.aiDisclosureConsent.checked = state.settings.aiDisclosureAccepted === true;
    prepareAiProviderUi();
    await refreshAiSetupPermission();
    if (token !== settingsLoadToken) return false;
    syncSeenArchiveRetention({ render: false });
    syncAppearanceControls(state.settings);
    applyAppearanceSettings(state.settings);
    els.apiKeyInput.placeholder = state.settings.maskedKey || "sk-...";
    renderAiConnectionStatus();
    els.imageSearchApiKeyInput.placeholder = state.settings.maskedImageSearchKey || "BSA...";
    renderExcludeFolderOptions();
    renderExclusionList();
    renderSettingsStatus(t("settings.status.ready"));
    return true;
  } catch (error) {
    if (token !== settingsLoadToken) return false;
    els.settingsStatus.textContent = t("settings.status.loadFailed", { message: error.message || error });
    return false;
  }
}
async function saveSettings() {
  const session = settingsSession;
  settingsActionGeneration += 1;
  const draft = currentSettingsDraft();
  if (!String(draft.openaiSummaryModel || "").trim()) {
    renderAiConnectionStatus(t("background.error.aiModelRequired"), "error");
    if (getAiSetupState().formUnlocked) els.modelInput.focus({ preventScroll: true });
    else focusAiSetupRequirement();
    return renderSettingsStatus(t("background.error.aiModelRequired"));
  }
  if (draft.newsSourceMode === "bookmarks" && draft.inspirationSourceMode === "bookmarks" && draft.newsBookmarkFolder === draft.inspirationBookmarkFolder) return renderSettingsStatus(t("settings.bookmarks.same"));
  savedSourcePermission.clear();
  setSettingsBusy(true);
  try {
    const payload = diffSettingsDraft(draft, settingsSnapshot);
    Object.assign(payload, headerCoverController.savePayload());
    const sourcePermissionScope = personalSourcePermissionScope(draft, payload);
    const previousSourcePermissions = settingsSnapshot?.sourcePermissions || [];
    const savedSettings = await apiPost("/api/settings", payload);
    if (session !== settingsSession) return;
    state.settings = savedSettings;
    syncAiSetupControls();
    if (savedSettings.headerCoverChanged === true) headerCoverController.commit();
    syncSeenArchiveRetention();
    const bookmarkSourceChanged = state.settings?.bookmarkSourceChanged === true;
    const rankingChanged = state.settings?.rankingChanged === true;
    const localeChanged = state.settings?.localeChanged === true;
    const imageSearchChanged = state.settings?.imageSearchChanged === true;
    const automaticAiStarted = state.settings?.automaticAiStarted === true, sourceRefreshScheduled = state.settings?.sourceRefreshScheduled === true;
    const pendingOrigins = bookmarkSourceChanged && sourcePermissionScope
      ? newlyRequiredUngrantedOrigins(state.settings?.sourcePermissions, previousSourcePermissions)
      : [];
    resetSecretDrafts();
    if (bookmarkSourceChanged || imageSearchChanged) {
      inspirationPreviews.invalidate();
    }
    syncBookmarkFolderControls(state.settings);
    syncWebsiteShortcutControls(state.settings);
    syncAppearanceControls(state.settings);
    applyAppearanceSettings(state.settings);
    applyUiLocale(state.settings.uiLocale || selectedUiLocale(), { persist: true });
    settingsLocaleAtOpen = getLocale();
    renderExclusionList();
    settingsSnapshot = snapshotSettingsDraft(state.settings, selectedUiLocale());
    if (pendingOrigins.length) {
      savedSourcePermission.show(pendingOrigins, sourcePermissionScope);
      renderSettingsStatus(t("settings.status.savedNeedsPermission"));
      await loadDashboard();
      return;
    }
    renderSettingsStatus(t(bookmarkSourceChanged || rankingChanged || automaticAiStarted
      ? "settings.status.savedRefreshing"
      : localeChanged ? "settings.status.savedLocale" : "settings.status.saved"));
    await wait(settingsSaveCloseDelayMs);
    if (session === settingsSession && els.settingsModal.classList.contains("open")) closeSettings(true);
    await loadDashboard();
    if ((bookmarkSourceChanged || rankingChanged) && !automaticAiStarted && !sourceRefreshScheduled) await triggerRefresh(true);
  } catch (error) {
    if (session !== settingsSession) return;
    renderSettingsStatus(t("settings.status.saveFailed", { message: error.message || error }));
  } finally {
    if (session === settingsSession || !els.settingsModal.classList.contains("open")) setSettingsBusy(false);
  }
}

function currentSettingsDraft() {
  const aiSetupState = getAiSetupState();
  return {
    openaiApiKey: aiSetupState.formUnlocked ? els.apiKeyInput.value : "",
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
    todayNewsPerPublisherLimit: els.todayNewsPerPublisherInput.value,
    ...bookmarkSourcePayload(),
    floatingWebOpenEnabled: els.floatingOpenInput.checked,
    readingQueueOpenOnReadAll: els.readingQueueOpenOnReadAllInput.checked, readingQueueReadAllPrompted: state.settings?.readingQueueReadAllPrompted === true,
    retainSeenArchive: els.retainSeenArchiveInput.checked,
    ...contentSyncSettingsPayload(els),
    personalizedRankingEnabled: els.personalizedRankingEnabledInput.checked,
    publicFeedSupplementEnabled: els.publicFeedSupplementEnabledInput.checked,
    ...websiteShortcutsPayload(),
    ...appearancePayload(),
    excludedNewsSources: currentExcludedNewsSources()
  };
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
      syncAiSetupControls();
      renderAiConnectionStatus(t("settings.key.cleared"), "success");
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
      inspirationPreviews.invalidate();
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

async function openSettings() {
  const session = ++settingsSession;
  if (settingsCloseTimer) window.clearTimeout(settingsCloseTimer);
  settingsCloseTimer = 0;
  els.settingsModal.classList.remove("closing");
  settingsActionGeneration += 1;
  savedSourcePermission.clear();
  clearAiSetupFeedback();
  settingsLocaleAtOpen = getLocale();
  settingsSnapshot = snapshotSettingsDraft(state.settings, selectedUiLocale());
  resetSecretDrafts();
  document.querySelectorAll(".nav-btn").forEach((item) => item.classList.toggle("active", item.id === "settingsNav"));
  els.settingsModal.classList.add("open");
  els.closeSettings.focus({ preventScroll: true });
  setSettingsBusy(true);
  try {
    if (await loadSettings() && session === settingsSession) settingsSnapshot = snapshotSettingsDraft(state.settings, selectedUiLocale());
  } finally {
    if (session === settingsSession) {
      setSettingsBusy(false);
      focusSettingsStart();
    }
  }
}

function focusSettingsStart({ reveal = false } = {}) {
  const servicePanel = els.settingsForm.querySelector('[data-settings-panel="service"]');
  if (!servicePanel?.classList.contains("active")) {
    els.settingsTabs.querySelector("button.active")?.focus({ preventScroll: true });
    return;
  }
  syncAiSetupControls();
  const aiSetupState = getAiSetupState();
  const target = aiSetupState.stage === aiSetupStage.INVALID_ORIGIN
    ? els.apiBaseUrlInput
    : (aiSetupState.stage === aiSetupStage.NEEDS_CONSENT || aiSetupState.stage === aiSetupStage.NEEDS_PERMISSION
      ? els.grantAiOrigin
      : (els.aiProviderEditor.hidden ? els.testKey : (els.aiProviderKeyField.hidden ? els.modelInput : els.apiKeyInput)));
  target.focus({ preventScroll: true });
  if (reveal) {
    target.scrollIntoView({
      block: "center",
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    });
  }
}

function closeSettings(commit = false) {
  if (!els.settingsModal.classList.contains("open") || els.settingsModal.classList.contains("closing")) return;
  const shouldCommit = commit === true;
  settingsSession += 1;
  settingsActionGeneration += 1;
  savedSourcePermission.clear();
  resetSecretDrafts();
  els.settingsModal.classList.add("closing");
  const closeDelay = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : settingsCloseMotionMs;
  settingsCloseTimer = window.setTimeout(() => {
    settingsCloseTimer = 0;
    els.settingsModal.classList.remove("open", "closing");
  }, closeDelay);
  setSettingsBusy(false);
  if (!shouldCommit && settingsSnapshot) {
    state.settings = cloneSettingsDraft(settingsSnapshot); headerCoverController.restore();
    syncBookmarkFolderControls(state.settings);
    syncWebsiteShortcutControls(state.settings);
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
function requestCloseSettings() {
  if (settingsBusy) return;
  const hasUnsavedChanges = currentSettingsHaveUnsavedChanges();
  if (!hasUnsavedChanges) {
    closeSettings();
    return;
  }
  if (window.confirm(t("settings.unsaved.confirm"))) saveSettings(); else closeSettings();
}
function resetSecretDrafts() {
  els.apiKeyInput.value = "";
  els.imageSearchApiKeyInput.value = "";
}
function currentSettingsHaveUnsavedChanges() { return Boolean(settingsSnapshot) && (Object.keys(diffSettingsDraft(currentSettingsDraft(), settingsSnapshot)).length > 0 || headerCoverController.hasChanges()); }
function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function setSettingsBusy(busy) {
  settingsBusy = busy;
  els.saveSettings.disabled = busy;
  els.testKey.disabled = busy;
  els.clearKey.disabled = busy;
  els.testImageSearchKey.disabled = busy;
  els.clearImageSearchKey.disabled = busy;
  els.clearCache.disabled = busy;
  els.resetQuota.disabled = busy;
  els.resetPreferences.disabled = busy;
  savedSourcePermission.syncBusy(busy);
  els.cardSummaryEnabledInput.disabled = busy;
  els.todayNewsPerPublisherInput.disabled = busy;
  els.floatingOpenInput.disabled = busy;
  els.readingQueueOpenOnReadAllInput.disabled = busy;
  els.retainSeenArchiveInput.disabled = busy;
  setContentSyncControlsBusy(els, busy);
  els.personalizedRankingEnabledInput.disabled = busy;
  syncPublicFeedSupplementControl(busy);
  els.uiLocaleSelect.disabled = busy;
  els.webImageSearchEnabledInput.disabled = busy;
  els.aiDisclosureConsent.disabled = busy;
  els.newsBookmarkFolderSelect.disabled = busy;
  els.inspirationBookmarkFolderSelect.disabled = busy;
  els.bookmarkOnlyFolderSelect.disabled = busy || !els.bookmarkOnlyFolderSelect.value;
  els.addBookmarkOnlyFolder.disabled = busy || !els.bookmarkOnlyFolderSelect.value;
  els.customAccentInput.disabled = busy;
  els.pointerGlowEnabledInput.disabled = busy;
  els.headerImageEnabledInput.disabled = busy; els.headerImageBlurEnabledInput.disabled = busy;
  syncHeaderImageBlurControl(busy); syncHeaderImageHeightControl(busy);
  els.headerImageFixedInput.disabled = busy; syncHeaderImageFullscreenControl(busy);
  els.headerImageUrlInput.disabled = busy; headerCoverController.setBusy(busy);
  els.exportSettings.disabled = busy;
  els.importSettings.disabled = busy;
  els.settingsImportFile.disabled = busy;
  setWebsiteShortcutControlsBusy(busy);
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
  els.settingsForm.querySelectorAll("#bookmarkOnlyFolderList button, #hiddenBookmarkCategoryList button, #restoreAllBookmarkCategories").forEach((button) => {
    button.disabled = busy;
  });
  syncAiSetupControls();
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
  const panels = Array.from(els.settingsForm.querySelectorAll("[data-settings-panel]"));
  const currentPanel = panels.find((panel) => panel.classList.contains("active"));
  const nextPanel = panels.find((panel) => panel.dataset.settingsPanel === tab);
  if (!nextPanel) return;
  if (currentPanel && currentPanel !== nextPanel) settingsTabScrollPositions.set(currentPanel.dataset.settingsPanel, els.settingsForm.scrollTop);
  for (const button of els.settingsTabs.querySelectorAll("button[data-settings-tab]")) {
    const active = button.dataset.settingsTab === tab;
    button.classList.toggle("active", active);
  }
  for (const panel of panels) {
    panel.classList.toggle("active", panel.dataset.settingsPanel === tab);
    panel.classList.remove("is-entering");
  }
  if (currentPanel !== nextPanel) els.settingsForm.scrollTop = settingsTabScrollPositions.get(tab) || 0;
  if (nextPanel && currentPanel && nextPanel !== currentPanel
    && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    nextPanel.classList.add("is-entering");
    const finishPanelEntrance = (event) => {
      if (event.target !== nextPanel || event.animationName !== "settingsPanelIn") return;
      nextPanel.classList.remove("is-entering");
      nextPanel.removeEventListener("animationend", finishPanelEntrance);
      nextPanel.removeEventListener("animationcancel", finishPanelEntrance);
    };
    nextPanel.addEventListener("animationend", finishPanelEntrance);
    nextPanel.addEventListener("animationcancel", finishPanelEntrance);
  }
  if (tab === "appearance") { syncSegmentedIndicator(els.colorModeGroup); syncSegmentedIndicator(els.headerImageLayoutGroup); }
}

function renderSettingsStatus(extra) {
  els.settingsStatus.textContent = extra || t("settings.status.unsaved");
  els.settingsStatus.dataset.state = extra ? "notice" : "pending";
}

}
