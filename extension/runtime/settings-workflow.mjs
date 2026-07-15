export function createSettingsWorkflow(options) {
  const {
    getSettings, settingsLocale, secretStatus,
    currentBookmarkModel, emptyBookmarkModel, selectedOrigins, currentFeedPermissionState,
    filterSourceQuality, getRecord, emptySourceQuality, defaultSettings, settingsService,
    readProviderProfile, bindProviderPatchToOrigin, isValidServiceUrl, typedError,
    providerTestConsentAllowed, providerRequiresApiKey, hasOriginPermission, updateProviderProfile, updateSecrets,
    setAiDisclosureConsent, captureCredentialState, restoreCredentialState,
    captureDeviceConsentState, restoreDeviceConsentState, cacheMutations, refreshCoordinator, setRecord,
    contentSyncService,
    pruneStalePreviewCaches, pruneBravePreviewCaches, aiConfigured, setAiAutoStatus,
    defaultAiAutoStatus, startRefresh, broadcast,
    createSettingsTransferDocument, parseSettingsTransferDocument, getAppVersion, now,
    headerCoverStore,
  } = options;

  return { publicSettings, saveSettings, exportSettings, importSettings };

async function publicSettings() {
  const settings = await getSettings();
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
    savedTodayNewsPerPublisherLimit: settings.todayNewsPerPublisherLimit,
    dailyLimit: settings.dailyAiLimit,
    hotNewsCacheSize: settings.hotNewsCacheSize,
    hotNewsEntriesPerSource: settings.hotNewsEntriesPerSource,
    newsEntriesPerCategory: settings.newsEntriesPerCategory,
    todayNewsPerPublisherLimit: settings.todayNewsPerPublisherLimit,
    defaultBaseUrl: defaultSettings.openaiBaseUrl,
    defaultApiStyle: defaultSettings.openaiApiStyle,
    defaultModel: defaultSettings.openaiSummaryModel,
    defaultDailyLimit: defaultSettings.dailyAiLimit,
    defaultHotNewsCacheSize: defaultSettings.hotNewsCacheSize,
    defaultHotNewsEntriesPerSource: defaultSettings.hotNewsEntriesPerSource,
    defaultNewsEntriesPerCategory: defaultSettings.newsEntriesPerCategory,
    defaultTodayNewsPerPublisherLimit: defaultSettings.todayNewsPerPublisherLimit,
    bookmarkFolderOptions: model.folderOptions,
    availableNewsFolders: model.availableNewsFolders,
    missingBookmarkFolders: model.missingFolders,
    sourcePermissions: permission,
    sourceQuality: filterSourceQuality(await getRecord("source-quality", emptySourceQuality()), feedPermissions),
  };
}

function saveSettings(body) {
  return settingsService.mutate((transaction) => performSaveSettings(body, transaction));
}

async function exportSettings() {
  return createSettingsTransferDocument(await getSettings(), {
    appVersion: getAppVersion(),
    exportedAt: now(),
  });
}

async function importSettings(body = {}) {
  const current = await getSettings();
  let transfer;
  try {
    transfer = parseSettingsTransferDocument(body.config, current);
  } catch (error) {
    throw settingsTransferTypedError(error);
  }
  const saved = await saveSettings(transfer.patch);
  return {
    ...saved,
    importedFieldCount: transfer.fieldCount,
    importFormatVersion: transfer.formatVersion,
  };
}

async function performSaveSettings(body, transaction) {
  const previous = await getSettings();
  const next = { ...previous };
  const headerCoverOperation = Object.hasOwn(body, "headerCoverOperation")
    ? headerCoverStore.validateOperation(body.headerCoverOperation)
    : null;
  const allowed = [
    "webImageSearchEnabled", "dailyAiLimit",
    "cardSummaryEnabled", "hotNewsCacheSize", "hotNewsEntriesPerSource", "newsEntriesPerCategory", "todayNewsPerPublisherLimit",
    "newsBookmarkFolder", "newsSourceMode", "inspirationBookmarkFolder", "inspirationSourceMode", "bookmarkOnlyFolders", "hiddenBookmarkCategories", "floatingWebOpenEnabled",
    "readingQueueOpenOnReadAll", "readingQueueReadAllPrompted", "retainSeenArchive", "personalizedRankingEnabled", "publicFeedSupplementEnabled",
    "syncReadingQueueEnabled", "syncTodosEnabled", "syncWeatherLocationEnabled",
    "uiLocale", "colorMode", "accentTheme", "customAccentColor", "pointerGlowEnabled", "headerImageEnabled",
    "headerImageFixed", "headerImageFullscreen", "headerImageBlurEnabled", "headerImageBlurAmount", "headerImageHeightScale", "headerImageUrl",
    "websiteShortcutsEnabled", "websiteShortcuts",
    "excludedNewsSources",
  ];
  for (const key of allowed) if (Object.hasOwn(body, key)) next[key] = body[key];
  let providerPatch = {};
  if (Object.hasOwn(body, "openaiSummaryModel") && !String(body.openaiSummaryModel || "").trim()) {
    throw typedError("AI_MODEL_REQUIRED", "background.error.aiModelRequired", {}, false);
  }
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
    const candidateBaseUrl = providerPatch.openaiBaseUrl || currentProvider.openaiBaseUrl;
    const configuringNoKeyProvider = !providerRequiresApiKey(candidateBaseUrl)
      && body.aiDisclosureAccepted === true;
    if (submittedOpenAIKey || configuringNoKeyProvider) {
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
  const bravePatch = {};
  if (typeof body.braveSearchApiKey === "string" && body.braveSearchApiKey.trim()) bravePatch.braveSearchApiKey = body.braveSearchApiKey.trim();
  if (body.clearBraveSearchApiKey === true) bravePatch.braveSearchApiKey = "";

  let headerCoverMutation = null;
  let credentialSnapshot = null;
  let consentSnapshot = null;
  let normalized;
  try {
    if (Object.keys(providerPatch).length || Object.keys(bravePatch).length) {
      credentialSnapshot = await captureCredentialState();
    }
    if (Object.hasOwn(body, "aiDisclosureAccepted")) consentSnapshot = await captureDeviceConsentState();
    let provider = Object.keys(providerPatch).length
      ? await updateProviderProfile(providerPatch, previous)
      : null;
    if (Object.keys(bravePatch).length) await updateSecrets(bravePatch);
    if (Object.hasOwn(body, "aiDisclosureAccepted")) {
      provider = provider || await readProviderProfile(previous);
      await setAiDisclosureConsent(body.aiDisclosureAccepted === true, provider.openaiBaseUrl);
    }
    if (headerCoverOperation) headerCoverMutation = await headerCoverStore.apply(headerCoverOperation);
    await transaction.write(next);
    normalized = await getSettings();
    try {
      await contentSyncService.applySettings(previous, normalized);
    } catch (error) {
      try {
        await transaction.write(previous);
        await contentSyncService.applySettings(normalized, previous);
      } catch (rollbackError) {
        error.rollbackFailed = true;
        error.rollbackCode = rollbackError?.code || "SETTINGS_ROLLBACK_FAILED";
      }
      throw error;
    }
  } catch (error) {
    if (consentSnapshot) {
      try {
        await restoreDeviceConsentState(consentSnapshot);
      } catch (rollbackError) {
        recordRollbackFailure(error, rollbackError, "DEVICE_CONSENT_ROLLBACK_FAILED");
      }
    }
    if (credentialSnapshot) {
      try {
        await restoreCredentialState(credentialSnapshot);
      } catch (rollbackError) {
        recordRollbackFailure(error, rollbackError, "CREDENTIAL_ROLLBACK_FAILED");
      }
    }
    if (headerCoverMutation) {
      try {
        await headerCoverStore.restore(headerCoverMutation.previous);
      } catch (rollbackError) {
        recordRollbackFailure(error, rollbackError, "HEADER_COVER_ROLLBACK_FAILED");
      }
    }
    throw error;
  }
  const localeChanged = settingsLocale(previous) !== settingsLocale(normalized);
  const primarySourceChanged = [
    "newsBookmarkFolder", "newsSourceMode", "inspirationBookmarkFolder", "inspirationSourceMode",
  ].some((key) => JSON.stringify(previous[key]) !== JSON.stringify(normalized[key]));
  const bookmarkSourceChanged = [
    "newsBookmarkFolder", "newsSourceMode", "inspirationBookmarkFolder", "inspirationSourceMode", "bookmarkOnlyFolders", "excludedNewsSources",
    "publicFeedSupplementEnabled", "hotNewsCacheSize", "hotNewsEntriesPerSource", "newsEntriesPerCategory",
  ]
    .some((key) => JSON.stringify(previous[key]) !== JSON.stringify(normalized[key]))
    || localeChanged && (previous.publicFeedSupplementEnabled !== false || normalized.publicFeedSupplementEnabled !== false);
  const rankingChanged = previous.todayNewsPerPublisherLimit !== normalized.todayNewsPerPublisherLimit;
  const imageSearchChanged = previous.webImageSearchEnabled !== normalized.webImageSearchEnabled
    || Object.hasOwn(bravePatch, "braveSearchApiKey");
  const headerCoverChanged = Boolean(headerCoverOperation);
  const aiConfigurationChanged = previous.aiDisclosureAccepted !== normalized.aiDisclosureAccepted
    || previous.credentialGeneration !== normalized.credentialGeneration;
  const automaticAiChanged = aiConfigurationChanged
    || previous.cardSummaryEnabled !== normalized.cardSummaryEnabled
    || previous.dailyAiLimit !== normalized.dailyAiLimit;
  if (localeChanged || bookmarkSourceChanged || rankingChanged || aiConfigurationChanged || imageSearchChanged) {
    cacheMutations.invalidate();
    if (bookmarkSourceChanged || rankingChanged) refreshCoordinator.invalidate();
    await cacheMutations.run(() => setRecord("daily-digest", null, "cache"));
    if (bookmarkSourceChanged) await pruneStalePreviewCaches(normalized);
    if (imageSearchChanged) await pruneBravePreviewCaches();
  }
  const sourceRefreshScheduled = bookmarkSourceChanged;
  if (sourceRefreshScheduled) startRefresh(true).catch(() => {});
  let automaticAiStarted = false;
  if (automaticAiChanged) {
    const ready = await aiConfigured(normalized);
    await setAiAutoStatus(ready ? defaultAiAutoStatus() : { ...defaultAiAutoStatus(), phase: "not-ready" }, false);
    if (ready) {
      automaticAiStarted = true;
      if (!sourceRefreshScheduled) startRefresh(true).catch(() => {});
    }
  }
  broadcast("settings.changed", { primarySourceChanged, sourceRefreshScheduled, bookmarkSourceChanged, rankingChanged, localeChanged, imageSearchChanged, headerCoverChanged, automaticAiChanged, automaticAiStarted });
  return {
    ...(await publicSettings()),
    primarySourceChanged,
    sourceRefreshScheduled,
    bookmarkSourceChanged,
    rankingChanged,
    localeChanged,
    imageSearchChanged,
    headerCoverChanged,
    automaticAiChanged,
    automaticAiStarted,
  };
}

function recordRollbackFailure(error, rollbackError, fallbackCode) {
  error.rollbackFailed = true;
  const code = rollbackError?.code || fallbackCode;
  error.rollbackCode = error.rollbackCode ? `${error.rollbackCode},${code}` : code;
}

function settingsTransferTypedError(error) {
  if (error?.name !== "SettingsTransferError") return error;
  const messageKeys = {
    SETTINGS_IMPORT_INVALID_FORMAT: "settings.transfer.error.invalidFormat",
    SETTINGS_IMPORT_UNSUPPORTED_VERSION: "settings.transfer.error.unsupportedVersion",
    SETTINGS_IMPORT_FILE_TOO_LARGE: "settings.transfer.error.tooLarge",
    SETTINGS_IMPORT_EMPTY: "settings.transfer.error.empty",
    SETTINGS_IMPORT_INVALID_VALUE: "settings.transfer.error.invalidValue",
  };
  const messageKey = messageKeys[error.code] || "settings.transfer.error.invalidFormat";
  return typedError(error.code || "SETTINGS_IMPORT_INVALID_FORMAT", messageKey, {
    field: error.details?.field || "",
    version: error.details?.version ?? "",
  }, false);
}

}
