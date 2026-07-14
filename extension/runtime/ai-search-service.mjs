const AI_CONNECTION_TEST_MAX_TOKENS = 900;
const AI_SEARCH_MAX_TOKENS = 1400;
const AI_SEARCH_CACHE_VERSION = 4;

export function createAiSearchService(options) {
  const {
    getRecord, setRecord, searchFeed, settingsLocale, translate, translateAiPrompt, normalizeUserUrl,
    hasOriginPermission, originPattern, secretStatus, currentFeedPermissionState,
    getSettings, currentBookmarkModel, emptyBookmarkModel, assertUrlsStillPermitted,
    cacheSourceIdentitiesPermitted, configuredFeedSources, readArticle, readWebsiteOverview,
    hashText, aiConfigured, requestAiCompletion, providerOrigin, readProviderProfile,
    readDeviceConsent, readSecrets, providerTestApiKey, providerTestConsentAllowed,
    isValidServiceUrl, typedError, resultMessage, errorResult, testImageSearchConnection,
    safeOrigin, uniqueStrings, withFeedCacheMetadata,
    filterFeedItemsBySources, cacheMutations, hasOriginPermissions, cacheUrlsPermitted,
    localDateKey, readerTextFromBlocks, assertFeedItemsStillPermitted, normalizeSettings,
  } = options;
  return {
    loadQuestionSearchContext, currentProviderCapability, aiSearchResultPermitted,
    answerAiSearch, callProvider, testOpenAISettings, testImageSearchSettings,
  };
async function loadQuestionSearchContext(settings, query) {
  const model = settings.bookmarkConsentGranted ? await currentBookmarkModel(settings) : emptyBookmarkModel();
  const feed = await getRecord("feed", { items: [] });
  const permissions = await currentFeedPermissionState(settings, model);
  const permittedItems = filterFeedItemsBySources(feed.items || [], permissions.permitted, permissions.grantedOrigins);
  return {
    permissions,
    candidates: searchFeed(permittedItems, query).slice(0, 8),
  };
}

function localQuestionSearchResult(locale, query, candidates) {
  const answer = candidates.length
    ? [translate(locale, "background.search.localSignals", { query }), ...candidates.map((item, index) => `${index + 1}. ${item.title} — ${item.excerpt || item.source}`)].join("\n")
    : translate(locale, "background.search.noLocalResults", { query });
  return withFeedCacheMetadata({
    ok: true,
    locale,
    type: "question",
    mode: "dashboard",
    answer,
    links: candidates.map((item) => ({ title: item.title, url: item.url })),
    usedAi: false,
  }, candidates, "ai-search");
}

function websitePermissionSearchResult(locale, url) {
  return {
    ok: true,
    locale,
    type: "url",
    mode: "website",
    answer: translate(locale, "background.search.noWebsitePermission"),
    links: [{ title: url, url }],
    usedAi: false,
  };
}

async function currentProviderCapability(settings) {
  const provider = await readProviderProfile(settings);
  const consent = await readDeviceConsent(provider.openaiBaseUrl);
  return {
    provider,
    configured: consent.aiDisclosureAccepted === true
      && Boolean(provider.openaiApiKey)
      && provider.openaiBaseUrl === settings.openaiBaseUrl
      && provider.openaiApiStyle === settings.openaiApiStyle
      && provider.openaiSummaryModel === settings.openaiSummaryModel
      && provider.credentialGeneration === settings.credentialGeneration,
  };
}

async function aiSearchResultPermitted(
  result,
  asUrl,
  settings,
  feedPermissions = null,
  expectedEpoch = null,
  providerCapability = null,
) {
  if (!result?.usedAi || !result.providerOrigin) return false;
  const capability = providerCapability || await currentProviderCapability(settings);
  const { provider } = capability;
  const providerMatches = capability.configured
    && originPattern(result.providerOrigin) === originPattern(provider.openaiBaseUrl);
  if (!providerMatches || expectedEpoch !== null && !cacheMutations.isCurrent(expectedEpoch)) return false;

  const requiredOrigins = [provider.openaiBaseUrl];
  if (asUrl) {
    const rawUrls = uniqueStrings([asUrl, result.requestedUrl, ...(result.links || []).map((link) => link?.url)].filter(Boolean));
    const normalized = rawUrls.map(normalizeUserUrl);
    if (normalized.some((url) => !url)) return false;
    requiredOrigins.push(...normalized);
  } else {
    if (!feedPermissions || !cacheSourceIdentitiesPermitted(result, feedPermissions, true)) return false;
    requiredOrigins.push(...result.sourceIdentities.flatMap((identity) => [identity.sourceOrigin, identity.fetchOrigin]).filter(Boolean));
  }
  const granted = await hasOriginPermissions(requiredOrigins);
  return granted && (expectedEpoch === null || cacheMutations.isCurrent(expectedEpoch));
}

async function sanitizeSearchResult(result, { asUrl, query, nonAiFallback }) {
  const latestSettings = await getSettings();
  const latestLocale = settingsLocale(latestSettings);
  if (asUrl) {
    const contextUrls = [asUrl, ...(result?.links || []).map((link) => link?.url)];
    if (!await cacheUrlsPermitted(contextUrls)) {
      return websitePermissionSearchResult(latestLocale, asUrl);
    }
    if (result?.usedAi && !await aiSearchResultPermitted(result, asUrl, latestSettings)) {
      if (!await cacheUrlsPermitted(contextUrls)) return websitePermissionSearchResult(latestLocale, asUrl);
      return withFeedCacheMetadata({ ...(nonAiFallback || websitePermissionSearchResult(latestLocale, asUrl)), locale: latestLocale }, [], "ai-search");
    }
    return { ...result, locale: latestLocale };
  }

  const latestContext = await loadQuestionSearchContext(latestSettings, query);
  const sourceContextPermitted = cacheSourceIdentitiesPermitted(result, latestContext.permissions, true);
  const aiPermitted = !result?.usedAi || await aiSearchResultPermitted(result, "", latestSettings, latestContext.permissions);
  if (latestLocale !== result?.locale || !sourceContextPermitted || !aiPermitted) {
    const fallbackSettings = await getSettings();
    const fallbackContext = await loadQuestionSearchContext(fallbackSettings, query);
    return localQuestionSearchResult(settingsLocale(fallbackSettings), query, fallbackContext.candidates);
  }
  return result;
}

async function answerAiSearch(body) {
  const cacheEpoch = cacheMutations.capture();
  const query = String(body.query || "").trim().slice(0, 2000);
  const settings = await getSettings();
  const locale = settingsLocale(settings);
  if (!query) return resultMessage(settings, false, "background.error.searchRequired");
  const asUrl = normalizeUserUrl(query);
  const providerIdentity = `${settings.openaiBaseUrl}|${settings.openaiApiStyle}|${settings.openaiSummaryModel}|${settings.credentialGeneration}`;
  const cacheKey = `search-${locale}-${hashText(`${AI_SEARCH_CACHE_VERSION}:${localDateKey()}:${providerIdentity}:${query}`)}`;
  let feedPermissions = null;
  let candidates = [];
  if (!asUrl) {
    const context = await loadQuestionSearchContext(settings, query);
    feedPermissions = context.permissions;
    candidates = context.candidates;
  }
  const cached = await getRecord(cacheKey, null);
  if (cached?.usedAi && await aiSearchResultPermitted(cached, asUrl, settings, feedPermissions, cacheEpoch)) {
    return { ...cached, cached: true };
  }
  let result;
  let nonAiFallback = null;
  if (asUrl) {
    if (!await hasOriginPermission(asUrl)) {
      result = websitePermissionSearchResult(locale, asUrl);
    } else {
      let reader;
      try {
        reader = await readArticle(asUrl);
      } catch (error) {
        if (error?.code !== "READER_EXTRACTION_EMPTY") throw error;
        reader = await readWebsiteOverview(asUrl);
      }
      const readerText = readerTextFromBlocks(reader.blocks);
      const isArticle = readerText.trim().length >= 80;
      const mode = isArticle ? "article" : "website";
      const fallbackText = isArticle
        ? readerText.slice(0, 1200)
        : reader.description || translate(locale, "background.search.noWebsiteDescription");
      nonAiFallback = {
        ok: true,
        locale,
        type: "url",
        mode,
        answer: `${reader.title}\n\n${fallbackText}`,
        links: [{ title: reader.title, url: reader.url }],
        usedAi: false,
      };
      result = await answerWithOptionalAi(settings, {
        locale,
        type: "url",
        mode,
        fallback: nonAiFallback.answer,
        system: translateAiPrompt(locale, isArticle ? "background.prompt.webSummary" : "background.prompt.websiteIntro"),
        input: translate(locale, isArticle ? "background.prompt.webInput" : "background.prompt.websiteInput", {
          url: reader.url,
          title: reader.title,
          text: readerText.slice(0, 12000),
          siteName: reader.siteName,
          description: reader.description,
        }),
        links: [{ title: reader.title, url: reader.url }],
        validateRequest: () => assertUrlsStillPermitted([asUrl, reader.requestedUrl, reader.url, reader.canonicalUrl]),
      });
    }
  } else {
    nonAiFallback = localQuestionSearchResult(locale, query, candidates);
    result = await answerWithOptionalAi(settings, {
      locale,
      type: "question",
      mode: "dashboard",
      fallback: nonAiFallback.answer,
      system: translateAiPrompt(locale, "background.prompt.dashboardAnswer"),
      input: translate(locale, "background.prompt.dashboardInput", {
        query,
        content: candidates.length
          ? candidates.map((item, index) => `${index + 1}. ${item.title}｜${item.excerpt}｜${item.url}`).join("\n")
          : translate(locale, "background.search.noLocalResults", { query }),
      }),
      links: candidates.map((item) => ({ title: item.title, url: item.url })),
      validateRequest: () => assertFeedItemsStillPermitted(candidates),
    });
  }
  result = withFeedCacheMetadata(
    { ...result, locale, ...(asUrl ? { requestedUrl: asUrl } : {}) },
    asUrl ? [] : candidates,
    "ai-search",
    result.usedAi ? settings.openaiBaseUrl : "",
  );
  result = await sanitizeSearchResult(result, { asUrl, query, nonAiFallback });
  if (result.usedAi) {
    await cacheMutations.run(async (isCurrent) => {
      if (!isCurrent()) return;
      await setRecord(cacheKey, result, "cache");
    }, cacheEpoch);
  }
  return sanitizeSearchResult(result, { asUrl, query, nonAiFallback });
}

async function answerWithOptionalAi(settings, options) {
  if (!await aiConfigured(settings)) return { ok: true, locale: options.locale, type: options.type, mode: options.mode, answer: options.fallback, links: options.links, usedAi: false };
  try {
    const value = await callProvider(settings, options.system, options.input, AI_SEARCH_MAX_TOKENS, "", options.validateRequest);
    return { ok: true, locale: options.locale, type: options.type, mode: options.mode, answer: value, links: options.links, usedAi: true };
  } catch (error) {
    const messageKey = error?.messageKey || "background.error.aiNetwork";
    const messageParams = error?.messageParams || {};
    return {
      ok: true,
      locale: options.locale,
      type: options.type,
      mode: options.mode,
      answer: options.fallback,
      links: options.links,
      usedAi: false,
      error: translate(options.locale, messageKey, messageParams),
      errorKey: messageKey,
      errorParams: messageParams,
    };
  }
}

async function callProvider(settings, system, input, maxTokens, apiKeyOverride = "", validateRequest = null, completionOptions = {}) {
  let providerSettings = settings;
  let apiKey = apiKeyOverride;
  if (!apiKeyOverride) {
    const provider = await readProviderProfile(settings);
    const consent = await readDeviceConsent(provider.openaiBaseUrl);
    if (!consent.aiDisclosureAccepted) throw typedError("AI_CONSENT_REQUIRED", "background.error.aiConsentRequired", {}, false);
    providerSettings = normalizeSettings({
      ...settings,
      openaiBaseUrl: provider.openaiBaseUrl,
      openaiApiStyle: provider.openaiApiStyle,
      openaiSummaryModel: provider.openaiSummaryModel,
      credentialGeneration: provider.credentialGeneration,
      ...consent,
    });
    apiKey = provider.openaiApiKey;
  }
  if (!apiKey) throw typedError("AI_KEY_MISSING", "background.error.aiKeyMissing", {}, false);
  const expectedProvider = {
    openaiBaseUrl: providerSettings.openaiBaseUrl,
    openaiApiStyle: providerSettings.openaiApiStyle,
    openaiSummaryModel: providerSettings.openaiSummaryModel,
    credentialGeneration: providerSettings.credentialGeneration,
    openaiApiKey: apiKey,
  };
  const validateCurrentRequest = async () => {
    if (!apiKeyOverride) {
      const latestProvider = await readProviderProfile(settings);
      const latestConsent = await readDeviceConsent(latestProvider.openaiBaseUrl);
      const unchanged = latestConsent.aiDisclosureAccepted === true
        && latestProvider.openaiBaseUrl === expectedProvider.openaiBaseUrl
        && latestProvider.openaiApiStyle === expectedProvider.openaiApiStyle
        && latestProvider.openaiSummaryModel === expectedProvider.openaiSummaryModel
        && latestProvider.credentialGeneration === expectedProvider.credentialGeneration
        && latestProvider.openaiApiKey === expectedProvider.openaiApiKey;
      if (!unchanged) throw typedError("AI_CONFIGURATION_CHANGED", "background.error.aiConfigurationChanged", {}, false);
    }
    return typeof validateRequest === "function" ? validateRequest() : null;
  };
  return requestAiCompletion(providerSettings, {
    system,
    input,
    maxTokens,
    apiKey,
    hasOriginPermission,
    hasOriginPermissions,
    validateRequest: validateCurrentRequest,
    ...completionOptions,
  });
}

async function testOpenAISettings(body) {
  try {
    const savedSettings = await getSettings();
    const settings = normalizeSettings({ ...savedSettings,
      openaiBaseUrl: body.openaiBaseUrl || undefined,
      openaiApiStyle: body.openaiApiStyle || undefined,
      openaiSummaryModel: body.openaiSummaryModel || undefined,
    });
    if (!providerTestConsentAllowed({
      payloadHasConsent: Object.hasOwn(body, "aiDisclosureAccepted"),
      payloadAccepted: body.aiDisclosureAccepted === true,
      savedAccepted: savedSettings.aiDisclosureAccepted === true,
      draftBaseUrl: settings.openaiBaseUrl,
      savedBaseUrl: savedSettings.openaiBaseUrl,
    })) {
      return resultMessage(settings, false, "background.error.aiConsentRequired");
    }
    const storedProvider = await readProviderProfile(savedSettings);
    const apiKey = providerTestApiKey({
      draftKey: body.openaiApiKey,
      storedKey: storedProvider.openaiApiKey,
      draftBaseUrl: settings.openaiBaseUrl,
      storedBaseUrl: storedProvider.openaiBaseUrl,
    });
    if (!apiKey) return resultMessage(settings, false, "background.error.aiKeyMissing");
    const locale = settingsLocale(settings);
    const sample = await callProvider(
      settings,
      translate(locale, "background.prompt.connectionSystem"),
      translate(locale, "background.prompt.connectionInput"),
      AI_CONNECTION_TEST_MAX_TOKENS,
      apiKey,
    );
    return resultMessage(settings, /^ok\b/i.test(sample.trim()) || Boolean(sample), "background.connectionAvailable");
  } catch (error) {
    return errorResult(await getSettings(), error);
  }
}

async function testImageSearchSettings(body) {
  const settings = await getSettings();
  try {
    const secrets = await readSecrets();
    const apiKey = String(body.braveSearchApiKey || secrets.braveSearchApiKey || "").trim();
    const result = await testImageSearchConnection(apiKey, hasOriginPermission);
    return resultMessage(settings, true, "background.imageConnectionAvailable", { count: result.count });
  } catch (error) {
    return errorResult(settings, error);
  }
}
}
