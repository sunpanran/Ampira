export function createSettingsController(options) {
  const {
    state, els, t, apiGet, apiPost, localizedResponseMessage, localizedErrorMessage,
    applyUiLocale, selectedUiLocale, syncLanguageControls, applyAppearanceSettings,
    syncAppearanceControls, renderExcludeFolderOptions, renderExclusionList,
    renderSourceSuggestionList, syncBookmarkFolderControls,
    syncAiSetupControls, refreshAiSetupPermission, getAiSetupState,
    clearAiSetupFeedback, focusAiSetupRequirement, currentExcludedNewsSources,
    bookmarkSourcePayload, appearancePayload, snapshotSettingsDraft, cloneSettingsDraft,
    diffSettingsDraft, selectedColorMode, selectedAccentTheme, colorModeLabel, themeLabel,
    currentBookmarkOnlyFolders, renderBookmarkSourceStatus, syncSeenArchiveRetention,
    loadDashboard, triggerRefresh, renderStatus, renderEfficiencyPanel, renderAll,
    resetToDailyView, syncNavToCurrentSection,
    getLocale, setLocale, settingsSaveCloseDelayMs, settingsCloseMotionMs,
    inspirationPreviews, syncHeaderImageFullscreenControl, availableNewsFolders,
    syncSourceSuggestionActionState, syncSegmentedIndicator, isHttpUrl,
    aiSetupStage,
  } = options;
  let settingsLoadToken = 0;
  let settingsLocaleAtOpen = getLocale();
  let settingsSnapshot = null;
  let settingsSession = 0;
  let settingsCloseTimer = 0;
  let settingsActionGeneration = 0;
  let settingsBusy = false;

  return {
    loadSettings, saveSettings, testKey, testImageSearchKey, clearImageSearchKey,
    clearKey, clearCache, resetQuota, resetPreferences, openSettings,
    focusSettingsStart, closeSettings, requestCloseSettings, resetSecretDrafts,
    setSettingsBusy, runSettingsAction, selectSettingsTab, renderSettingsStatus,
    bookmarkSourceStatusText, appearanceStatusText, isBusy: () => settingsBusy,
  };

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
    els.floatingOpenInput.checked = state.settings.floatingWebOpenEnabled === true;
    els.readingQueueOpenOnReadAllInput.checked = state.settings.readingQueueOpenOnReadAll !== false;
    els.retainSeenArchiveInput.checked = state.settings.retainSeenArchive === true;
    els.personalizedRankingEnabledInput.checked = state.settings.personalizedRankingEnabled !== false;
    els.publicFeedSupplementEnabledInput.checked = state.settings.publicFeedSupplementEnabled !== false;
    els.webImageSearchEnabledInput.checked = state.settings.webImageSearchEnabled !== false;
    els.aiDisclosureConsent.checked = state.settings.aiDisclosureAccepted === true;
    await refreshAiSetupPermission();
    if (token !== settingsLoadToken) return false;
    syncSeenArchiveRetention({ render: false });
    syncAppearanceControls(state.settings);
    applyAppearanceSettings(state.settings);
    els.apiKeyInput.placeholder = state.settings.maskedKey || "sk-...";
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
  setSettingsBusy(true);
  try {
    const draft = currentSettingsDraft();
    const payload = diffSettingsDraft(draft, settingsSnapshot);
    const savedSettings = await apiPost("/api/settings", payload);
    if (session !== settingsSession) return;
    state.settings = savedSettings;
    syncSeenArchiveRetention();
    const bookmarkSourceChanged = state.settings?.bookmarkSourceChanged === true;
    const localeChanged = state.settings?.localeChanged === true;
    const imageSearchChanged = state.settings?.imageSearchChanged === true;
    const automaticAiStarted = state.settings?.automaticAiStarted === true;
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
    renderSettingsStatus(t(bookmarkSourceChanged || automaticAiStarted
      ? "settings.status.savedRefreshing"
      : localeChanged ? "settings.status.savedLocale" : "settings.status.saved"));
    await wait(settingsSaveCloseDelayMs);
    if (session === settingsSession && els.settingsModal.classList.contains("open")) closeSettings(true);
    await loadDashboard();
    if (bookmarkSourceChanged && !automaticAiStarted) await triggerRefresh(true);
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
    ...bookmarkSourcePayload(),
    floatingWebOpenEnabled: els.floatingOpenInput.checked,
    readingQueueOpenOnReadAll: els.readingQueueOpenOnReadAllInput.checked,
    retainSeenArchive: els.retainSeenArchiveInput.checked,
    personalizedRankingEnabled: els.personalizedRankingEnabledInput.checked,
    publicFeedSupplementEnabled: els.publicFeedSupplementEnabledInput.checked,
    ...appearancePayload(),
    excludedNewsSources: currentExcludedNewsSources()
  };
}

function testKey() {
  const aiSetupState = getAiSetupState();
  if (!aiSetupState.formUnlocked) {
    focusAiSetupRequirement();
    return;
  }
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
      const hasUnsavedChanges = Object.keys(diffSettingsDraft(currentSettingsDraft(), settingsSnapshot)).length > 0;
      renderSettingsStatus(result.ok
        ? t(hasUnsavedChanges ? "settings.test.successSaveHint" : "settings.test.success")
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
    : (aiSetupState.stage === aiSetupStage.NEEDS_CONSENT
      ? els.aiDisclosureConsent
      : (aiSetupState.stage === aiSetupStage.NEEDS_PERMISSION ? els.grantAiOrigin : els.apiKeyInput));
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
  resetSecretDrafts();
  els.settingsModal.classList.add("closing");
  const closeDelay = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : settingsCloseMotionMs;
  settingsCloseTimer = window.setTimeout(() => {
    settingsCloseTimer = 0;
    els.settingsModal.classList.remove("open", "closing");
  }, closeDelay);
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

function requestCloseSettings() {
  if (settingsBusy) return;
  const hasUnsavedChanges = settingsSnapshot
    && Object.keys(diffSettingsDraft(currentSettingsDraft(), settingsSnapshot)).length > 0;
  if (!hasUnsavedChanges) {
    closeSettings();
    return;
  }
  if (window.confirm(t("settings.unsaved.confirm"))) saveSettings();
}

function resetSecretDrafts() {
  els.apiKeyInput.value = "";
  els.imageSearchApiKeyInput.value = "";
}


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
  for (const button of els.settingsTabs.querySelectorAll("button[data-settings-tab]")) {
    const active = button.dataset.settingsTab === tab;
    button.classList.toggle("active", active);
  }
  for (const panel of els.settingsForm.querySelectorAll("[data-settings-panel]")) {
    panel.classList.toggle("active", panel.dataset.settingsPanel === tab);
  }
  if (tab === "appearance") syncSegmentedIndicator(els.colorModeGroup);
}


function renderSettingsStatus(extra) {
  els.settingsStatus.textContent = extra || t("settings.status.unsaved");
  els.settingsStatus.dataset.state = extra ? "notice" : "pending";
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

}
