export function createSettingsWorkflow(options) {
  const {
    getSettings, settingsLocale, defaultBookmarkFoldersForLocale, secretStatus,
    currentBookmarkModel, emptyBookmarkModel, selectedOrigins, currentFeedPermissionState,
    filterSourceQuality, getRecord, emptySourceQuality, defaultSettings, settingsService,
    readProviderProfile, bindProviderPatchToOrigin, isValidServiceUrl, typedError,
    providerTestConsentAllowed, hasOriginPermission, updateProviderProfile, updateSecrets,
    setAiDisclosureConsent, cacheMutations, refreshCoordinator, setRecord,
    pruneStalePreviewCaches, pruneBravePreviewCaches, aiConfigured, setAiAutoStatus,
    defaultAiAutoStatus, startRefresh, broadcast,
  } = options;

  return { publicSettings, saveSettings };

async function publicSettings() {
  const settings = await getSettings();
  const locale = settingsLocale(settings);
  const bookmarkDefaults = defaultBookmarkFoldersForLocale(locale);
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
    defaultNewsBookmarkFolder: bookmarkDefaults.news,
    defaultInspirationBookmarkFolder: bookmarkDefaults.inspiration,
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

async function performSaveSettings(body, transaction) {
  const previous = await getSettings();
  const next = { ...previous };
  const allowed = [
    "webImageSearchEnabled", "dailyAiLimit",
    "cardSummaryEnabled", "hotNewsCacheSize", "hotNewsEntriesPerSource", "newsEntriesPerCategory", "todayNewsPerPublisherLimit",
    "newsBookmarkFolder", "inspirationBookmarkFolder", "bookmarkOnlyFolders", "floatingWebOpenEnabled",
    "readingQueueOpenOnReadAll", "retainSeenArchive", "personalizedRankingEnabled", "publicFeedSupplementEnabled",
    "uiLocale", "colorMode", "accentTheme", "customAccentColor", "pointerGlowEnabled", "headerImageEnabled",
    "headerImageFixed", "headerImageFullscreen", "headerImageUrl", "websiteShortcutsEnabled", "websiteShortcuts",
    "excludedNewsSources",
  ];
  for (const key of allowed) if (Object.hasOwn(body, key)) next[key] = body[key];
  let providerPatch = {};
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
    if (submittedOpenAIKey) {
      const candidateBaseUrl = providerPatch.openaiBaseUrl || currentProvider.openaiBaseUrl;
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
  let provider = Object.keys(providerPatch).length
    ? await updateProviderProfile(providerPatch, previous)
    : null;

  const bravePatch = {};
  if (typeof body.braveSearchApiKey === "string" && body.braveSearchApiKey.trim()) bravePatch.braveSearchApiKey = body.braveSearchApiKey.trim();
  if (body.clearBraveSearchApiKey === true) bravePatch.braveSearchApiKey = "";
  if (Object.keys(bravePatch).length) await updateSecrets(bravePatch);

  if (Object.hasOwn(body, "aiDisclosureAccepted")) {
    provider = provider || await readProviderProfile(previous);
    await setAiDisclosureConsent(body.aiDisclosureAccepted === true, provider.openaiBaseUrl);
  }

  await transaction.write(next);
  const normalized = await getSettings();
  const localeChanged = settingsLocale(previous) !== settingsLocale(normalized);
  const bookmarkSourceChanged = [
    "newsBookmarkFolder", "inspirationBookmarkFolder", "bookmarkOnlyFolders", "excludedNewsSources",
    "publicFeedSupplementEnabled", "hotNewsCacheSize", "hotNewsEntriesPerSource", "newsEntriesPerCategory",
  ]
    .some((key) => JSON.stringify(previous[key]) !== JSON.stringify(normalized[key]))
    || localeChanged && (previous.publicFeedSupplementEnabled !== false || normalized.publicFeedSupplementEnabled !== false);
  const rankingChanged = previous.todayNewsPerPublisherLimit !== normalized.todayNewsPerPublisherLimit;
  const imageSearchChanged = previous.webImageSearchEnabled !== normalized.webImageSearchEnabled
    || Object.hasOwn(bravePatch, "braveSearchApiKey");
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
  let automaticAiStarted = false;
  if (automaticAiChanged) {
    const ready = normalized.cardSummaryEnabled !== false && await aiConfigured(normalized);
    await setAiAutoStatus(ready ? defaultAiAutoStatus() : { ...defaultAiAutoStatus(), phase: "not-ready" }, false);
    if (ready) {
      automaticAiStarted = true;
      startRefresh(true).catch(() => {});
    }
  }
  broadcast("settings.changed", { bookmarkSourceChanged, rankingChanged, localeChanged, imageSearchChanged, automaticAiChanged, automaticAiStarted });
  return {
    ...(await publicSettings()),
    bookmarkSourceChanged,
    rankingChanged,
    localeChanged,
    imageSearchChanged,
    automaticAiChanged,
    automaticAiStarted,
  };
}

}
