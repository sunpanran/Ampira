import { publicFeedsForLocale } from "../core/public-feeds.mjs";
import { providerOrigin } from "../core/settings.mjs";

const IMPORT_PROVIDER_FIELDS = ["openaiBaseUrl", "openaiApiStyle", "openaiSummaryModel", "credentialGeneration"];

export function createSettingsWorkflow(options) {
  const {
    getSettings, settingsLocale, secretStatus, readTransferCredentials,
    currentBookmarkModel, emptyBookmarkModel, selectedOrigins, currentFeedPermissionState,
    filterSourceQuality, getRecord, emptySourceQuality, defaultSettings, settingsService,
    readProviderProfile, bindProviderPatchToOrigin, isValidServiceUrl, typedError,
    providerTestConsentAllowed, providerRequiresApiKey, hasOriginPermission, updateCredentials,
    setAiDisclosureConsent, captureCredentialState, restoreCredentialState,
    captureDeviceConsentState, restoreDeviceConsentState, cacheMutations, refreshCoordinator, setRecord,
    contentSyncService,
    pruneStalePreviewCaches, pruneBravePreviewCaches, aiConfigured, setAiAutoStatus,
    defaultAiAutoStatus, startRefresh, broadcast,
    createSettingsTransferDocument, parseSettingsTransferDocument, getAppVersion, now,
    headerCoverStore, browserSearchEnabled = async () => false,
    getOptionalPermissions = async () => ({ origins: [], permissions: [] }),
  } = options;

  return { publicSettings, saveSettings, exportSettings, importSettings, authorizeImportedSettings, reconcileImportedSettings };

async function publicSettings() {
  const settings = await getSettings();
  const [secrets, searchEnabled] = await Promise.all([secretStatus(), browserSearchEnabled()]);
  const model = settings.bookmarkConsentGranted ? await currentBookmarkModel(settings) : emptyBookmarkModel();
  const permission = await selectedOrigins(model, settings);
  const feedPermissions = await currentFeedPermissionState(settings, model);
  return {
    ...settings,
    newTabOverrideEnabled: true,
    browserSearchEnabled: searchEnabled === true,
    hasOpenAIKey: secrets.hasOpenAIKey,
    syncAiSettingsEnabled: secrets.syncAiSettingsEnabled === true,
    keySource: secrets.syncAiSettingsEnabled ? "browser-account-sync" : "local-extension-storage",
    maskedKey: secrets.hasOpenAIKey ? "••••••••" : "",
    hasImageSearchKey: secrets.hasImageSearchKey,
    imageSearchKeySource: secrets.syncAiSettingsEnabled ? "browser-account-sync" : "local-extension-storage",
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
    onboardingSourcePermissions: await selectedOrigins(model, settings, { sourcesOnly: true }),
    onboardingPublicSources: publicFeedsForLocale(settingsLocale(settings)).map(({ title, url }) => ({ title, url })),
    sourceQuality: filterSourceQuality(await getRecord("source-quality", emptySourceQuality()), feedPermissions),
  };
}

function saveSettings(body) {
  return settingsService.mutate((transaction) => performSaveSettings(body, transaction));
}

async function exportSettings() {
  const settings = await getSettings();
  const credentials = await readTransferCredentials();
  try {
    return createSettingsTransferDocument({ ...settings, ...credentials }, {
      appVersion: getAppVersion(),
      exportedAt: now(),
      credentials,
      permissions: await getOptionalPermissions(),
    });
  } catch (error) { throw settingsTransferTypedError(error); }
}

async function importSettings(body = {}) {
  return settingsService.mutate(async (transaction) => {
    const current = await getSettings();
    let transfer;
    try {
      transfer = parseSettingsTransferDocument(body.config, current);
    } catch (error) {
      throw settingsTransferTypedError(error);
    }
    const patch = { ...transfer.patch, ...transfer.credentials };
    if (typeof transfer.syncAiSettingsEnabled === "boolean") {
      const currentSyncEnabled = (await secretStatus()).syncAiSettingsEnabled === true;
      if (transfer.syncAiSettingsEnabled !== currentSyncEnabled && body.restoreCredentialSync !== true) {
        throw typedError("SETTINGS_IMPORT_SYNC_CONFIRMATION_REQUIRED", "settings.transfer.error.syncConfirmation", {}, false);
      }
      if (body.restoreCredentialSync === true) patch.syncAiSettingsEnabled = transfer.syncAiSettingsEnabled;
    }
    if (transfer.providerOriginChanged) {
      patch.aiDisclosureAccepted = false;
    }
    // Consent stays device-local and bound to the recipient origin. Reimporting
    // the same provider preserves valid consent; a new origin needs a new gesture.
    const committed = await commitSettings(patch, transaction, { importing: true });
    const saved = await completeImportedCommit(committed);
    const origins = new Set([...saved.sourcePermissions.map(row => row.origin), ...transfer.permissions.origins]);
    const permissions = transfer.permissions.permissions;
    let aiProvider = null;
    if (saved.hasOpenAIKey || !providerRequiresApiKey(saved.openaiBaseUrl)) {
      origins.add(`${providerOrigin(saved.openaiBaseUrl)}/*`);
      aiProvider = Object.fromEntries(IMPORT_PROVIDER_FIELDS.map(field => [field, saved[field]]));
    }
    return {
      ...saved,
      importedFieldCount: transfer.fieldCount,
      importFormatVersion: transfer.formatVersion,
      importAuthorization: { origins: [...origins], permissions, aiProvider,
        bookmarkConsent: transfer.permissions.bookmarkConsent
          || saved.newsSourceMode === "bookmarks" || saved.inspirationSourceMode === "bookmarks" },
    };
  });
}

function authorizeImportedSettings(body = {}) {
  return settingsService.mutate(async (transaction) => {
    const current = await getSettings();
    assertImportProvider(current, body);
    if (!await hasOriginPermission(current.openaiBaseUrl)) {
      throw typedError("ORIGIN_PERMISSION_REQUIRED", "background.error.aiOriginPermission", {}, false);
    }
    const committed = await commitSettings({ aiDisclosureAccepted: true }, transaction, { expectedProvider: body });
    return completeImportedCommit(committed);
  });
}

function assertImportProvider(current, expected) {
  if (!IMPORT_PROVIDER_FIELDS.every(field => current[field] === expected[field])) {
    throw typedError("AI_CONFIGURATION_CHANGED", "background.error.aiConfigurationChanged", {}, false);
  }
}

async function performSaveSettings(body, transaction, options) {
  const committed = await commitSettings(body, transaction, options);
  const changes = await applySettingsEffects(committed);
  return { ...(await publicSettings()), ...changes };
}

async function commitSettings(body, transaction, { importing = false, expectedProvider = null } = {}) {
  const previous = await getSettings();
  if (expectedProvider) assertImportProvider(previous, expectedProvider);
  const next = { ...previous };
  const headerCoverOperation = Object.hasOwn(body, "headerCoverOperation")
    ? await headerCoverStore.validateOperation(body.headerCoverOperation)
    : null;
  const allowed = [
    "mcpEnabled", "dashboardMode", "dashboardCardOrder", "botOrganizeNews", "botGenerateBrief", "botAnswerQuestions",
    "webImageSearchEnabled", "dailyAiLimit",
    "cardSummaryEnabled", "hotNewsCacheSize", "hotNewsEntriesPerSource", "newsEntriesPerCategory", "todayNewsPerPublisherLimit",
    "newsBookmarkFolder", "newsSourceMode", "inspirationBookmarkFolder", "inspirationSourceMode", "bookmarkOnlyFolders", "hiddenBookmarkCategories", "floatingWebOpenEnabled",
    "readingQueueOpenOnReadAll", "readingQueueReadAllPrompted", "retainSeenArchive", "personalizedRankingEnabled", "publicFeedSupplementEnabled",
    "syncReadingQueueEnabled", "syncTodosEnabled", "syncWeatherLocationEnabled",
    "syncStockWatchlistEnabled", "syncCountdownsEnabled", "syncTrackedTopicsEnabled", "syncCalendarEnabled",
    "syncNotesEnabled", "syncWorldClockEnabled",
    "sectionTitleOpacity",
    "uiLocale", "colorMode", "navPosition", "navAutoHideEnabled", "accentTheme", "customAccentColor", "pointerGlowEnabled", "dashboardGlassBlurEnabled", "headerImageEnabled",
    "headerImageFixed", "headerImageFullscreen", "headerImageBlurEnabled", "headerImageBlurAmount", "headerImageHeightScale", "headerImageUrl", "headerImageMediaType", "headerImageFit",
    "bookmarkSectionEnabled", "websiteShortcutsEnabled", "websiteShortcuts", "keyboardShortcutsEnabled", "keyboardShortcuts",
    "excludedNewsSources", "customFeeds",
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
    if (!importing && (submittedOpenAIKey || configuringNoKeyProvider)) {
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
  const credentialsChanged = Object.keys(providerPatch).length || Object.keys(bravePatch).length
    || typeof body.syncAiSettingsEnabled === "boolean";

  let headerCoverMutation = null;
  let credentialSnapshot = null;
  let consentSnapshot = null;
  let normalized, credentialStatus;
  let settingsWriteAttempted = false;
  try {
    if (credentialsChanged) {
      credentialSnapshot = await captureCredentialState();
    }
    if (Object.hasOwn(body, "aiDisclosureAccepted")) consentSnapshot = await captureDeviceConsentState();
    let provider = credentialsChanged
      ? await updateCredentials({ providerPatch, secretsPatch: bravePatch, syncEnabled: body.syncAiSettingsEnabled }, previous)
      : null;
    if (Object.hasOwn(body, "aiDisclosureAccepted")) {
      provider = provider || await readProviderProfile(previous);
      if (expectedProvider) assertImportProvider(provider, expectedProvider);
      await setAiDisclosureConsent(body.aiDisclosureAccepted === true, provider.openaiBaseUrl);
    }
    if (headerCoverOperation) headerCoverMutation = await headerCoverStore.apply(headerCoverOperation);
    if (importing || expectedProvider) credentialStatus = await secretStatus();
    settingsWriteAttempted = true;
    await transaction.write(next);
    normalized = await getSettings();
    await contentSyncService.applySettings(previous, normalized);
  } catch (error) {
    if (settingsWriteAttempted) {
      try {
        await transaction.write(previous);
        if (normalized) await contentSyncService.applySettings(normalized, previous);
      } catch (rollbackError) { recordRollbackFailure(error, rollbackError, "SETTINGS_ROLLBACK_FAILED"); }
    }
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
  if (headerCoverMutation) await headerCoverStore.finalize?.(headerCoverMutation).catch(() => {});
  return { previous, normalized, credentialStatus,
    layoutOnly: Object.keys(body).length === 1 && Object.hasOwn(body, "dashboardCardOrder"),
    imageSearchKeyChanged: Object.hasOwn(bravePatch, "braveSearchApiKey"), headerCoverChanged: Boolean(headerCoverOperation) };
}

async function applySettingsEffects(committed) {
  const { previous, normalized } = committed;
  if (committed.layoutOnly) {
    broadcast("settings.changed", { dashboardLayoutOnly: true, dashboardCardOrder: normalized.dashboardCardOrder });
    return {};
  }
  const localeChanged = settingsLocale(previous) !== settingsLocale(normalized);
  const primarySourceChanged = [
    "newsBookmarkFolder", "newsSourceMode", "inspirationBookmarkFolder", "inspirationSourceMode",
  ].some((key) => JSON.stringify(previous[key]) !== JSON.stringify(normalized[key]));
  const bookmarkSourceChanged = committed.forceReconcile === true || [
    "newsBookmarkFolder", "newsSourceMode", "inspirationBookmarkFolder", "inspirationSourceMode", "bookmarkOnlyFolders", "excludedNewsSources",
    "publicFeedSupplementEnabled", "hotNewsCacheSize", "hotNewsEntriesPerSource", "newsEntriesPerCategory", "customFeeds",
  ]
    .some((key) => JSON.stringify(previous[key]) !== JSON.stringify(normalized[key]))
    || localeChanged && (previous.publicFeedSupplementEnabled !== false || normalized.publicFeedSupplementEnabled !== false);
  const rankingChanged = previous.todayNewsPerPublisherLimit !== normalized.todayNewsPerPublisherLimit;
  const imageSearchChanged = previous.webImageSearchEnabled !== normalized.webImageSearchEnabled
    || committed.imageSearchKeyChanged;
  const headerCoverChanged = committed.headerCoverChanged;
  const aiConfigurationChanged = previous.aiDisclosureAccepted !== normalized.aiDisclosureAccepted
    || previous.credentialGeneration !== normalized.credentialGeneration;
  const automaticAiChanged = committed.forceReconcile === true || aiConfigurationChanged
    || previous.cardSummaryEnabled !== normalized.cardSummaryEnabled
    || previous.dailyAiLimit !== normalized.dailyAiLimit;
  const mcpSettingsChanged = previous.mcpEnabled !== normalized.mcpEnabled || previous.dashboardMode !== normalized.dashboardMode
    || previous.botOrganizeNews !== normalized.botOrganizeNews || previous.botGenerateBrief !== normalized.botGenerateBrief
    || previous.botAnswerQuestions !== normalized.botAnswerQuestions;
  const changes = committed.changes = { primarySourceChanged, sourceRefreshScheduled: false, bookmarkSourceChanged, rankingChanged,
    localeChanged, imageSearchChanged, headerCoverChanged, automaticAiChanged, automaticAiStarted: false, mcpSettingsChanged };
  if (mcpSettingsChanged) {
    refreshCoordinator.invalidate();
    cacheMutations.invalidate();
  }
  if (localeChanged || bookmarkSourceChanged || rankingChanged || aiConfigurationChanged || imageSearchChanged) {
    cacheMutations.invalidate();
    if (bookmarkSourceChanged || rankingChanged) refreshCoordinator.invalidate();
    await cacheMutations.run(() => setRecord("daily-digest", null, "cache"));
    if (bookmarkSourceChanged) await pruneStalePreviewCaches(normalized);
    if (imageSearchChanged) await pruneBravePreviewCaches();
  }
  const sourceRefreshScheduled = bookmarkSourceChanged;
  if (sourceRefreshScheduled) startRefresh(true).catch(() => {});
  changes.sourceRefreshScheduled = sourceRefreshScheduled;
  let automaticAiStarted = false;
  if (automaticAiChanged) {
    const ready = await aiConfigured(normalized);
    await setAiAutoStatus(ready ? defaultAiAutoStatus() : { ...defaultAiAutoStatus(), phase: "not-ready" }, false);
    if (ready) {
      automaticAiStarted = true;
      changes.automaticAiStarted = true;
      if (!sourceRefreshScheduled) startRefresh(true).catch(() => {});
    }
  }
  broadcast("settings.changed", { primarySourceChanged, sourceRefreshScheduled, bookmarkSourceChanged, rankingChanged, localeChanged, imageSearchChanged, headerCoverChanged, automaticAiChanged, automaticAiStarted, mcpSettingsChanged });
  return changes;
}

async function completeImportedCommit(committed) {
  const failedSteps = [];
  let changes;
  try { changes = await applySettingsEffects(committed); }
  catch {
    failedSteps.push("effects"); changes = committed.changes || {};
    try { broadcast("settings.changed", { ...changes, postCommitPending: true }); }
    catch { failedSteps.push("notify"); }
  }
  let settings;
  try { settings = await publicSettings(); }
  catch {
    failedSteps.push("settings-view");
    const status = committed.credentialStatus || {};
    settings = { ...committed.normalized, sourcePermissions: [],
      hasOpenAIKey: status.hasOpenAIKey === true, hasImageSearchKey: status.hasImageSearchKey === true,
      syncAiSettingsEnabled: status.syncAiSettingsEnabled === true };
  }
  return { ...settings, ...changes, committed: true,
    postCommit: { status: failedSteps.length ? "pending" : "complete", failedSteps } };
}

function reconcileImportedSettings() {
  return settingsService.mutate(async () => {
    const settings = await getSettings();
    const credentialStatus = await secretStatus();
    return completeImportedCommit({ previous: settings, normalized: settings, credentialStatus,
      forceReconcile: true, imageSearchKeyChanged: true, headerCoverChanged: false, layoutOnly: false });
  });
}

function recordRollbackFailure(error, rollbackError, fallbackCode) {
  error.rollbackFailed = true;
  const code = rollbackError?.code || fallbackCode;
  error.rollbackCode = error.rollbackCode ? `${error.rollbackCode},${code}` : code;
}

function settingsTransferTypedError(error) {
  if (error?.name !== "SettingsTransferError") return error;
  return typedError(error.code, error.messageKey, error.messageParams, false);
}

}
