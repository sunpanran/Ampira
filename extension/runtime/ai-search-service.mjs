import {
  AI_ARTICLE_CONTEXT_MAX_CHARS, AI_FOLLOWUP_QUERY_MAX_CHARS,
  limitArticleSummary, limitCodePoints, normalizeArticleContext, normalizeQuestionContext,
} from "../core/ai-search.mjs";
import { aiOutputMatchesLocale } from "../core/ai-output-language.mjs";

const AI_CONNECTION_TEST_MAX_TOKENS = 900;
const AI_SEARCH_MAX_TOKENS = 1400;
const AI_ARTICLE_MAX_TOKENS = 900;
const AI_SEARCH_CACHE_VERSION = 6;

function articleHistoryText(turns) {
  return (turns || []).map((turn, index) => [
    `Turn ${index + 1} question: ${turn.question}`,
    `Turn ${index + 1} answer: ${turn.answer}`,
  ].join("\n")).join("\n");
}

export function createAiSearchService(options) {
  const {
    getRecord, setRecord, searchFeed, settingsLocale, translate, translateAiPrompt, normalizeUserUrl,
    hasOriginPermission, secretStatus, currentFeedPermissionState,
    getSettings, currentBookmarkModel, emptyBookmarkModel, assertUrlsStillPermitted,
    cacheSourceIdentitiesPermitted, configuredFeedSources, readArticle, readCachedArticle, readWebsiteOverview,
    hashText, aiConfigured, requestAiCompletion, providerOrigin, readProviderProfile,
    readDeviceConsent, readSecrets, providerTestApiKey, providerTestConsentAllowed,
    isValidServiceUrl, typedError, resultMessage, errorResult, testImageSearchConnection,
    safeOrigin, withFeedCacheMetadata,
    filterFeedItemsBySources, presentableFeedItems = (items) => items,
    feedCacheOrEmpty = (value) => value?.schemaVersion === 3 ? value : { schemaVersion: 3, items: [] },
    cacheMutations, hasOriginPermissions, cacheUrlsPermitted,
    localDateKey, readerTextFromBlocks, assertFeedItemsStillPermitted, normalizeSettings,
    providerCredentialAvailable, providerRequiresApiKey,
  } = options;
  const { currentProviderCapability, aiSearchResultPermitted } = options.aiAccessPolicy;
  return {
    loadQuestionSearchContext, currentProviderCapability, aiSearchResultPermitted,
    answerAiSearch, callProvider, testOpenAISettings, testImageSearchSettings,
  };
async function loadQuestionSearchContext(settings, query) {
  const model = settings.bookmarkConsentGranted ? await currentBookmarkModel(settings) : emptyBookmarkModel();
  const feed = feedCacheOrEmpty(await getRecord("feed", null));
  const permissions = await currentFeedPermissionState(settings, model);
  const permittedItems = filterFeedItemsBySources(feed.items, permissions.permitted, permissions.grantedOrigins);
  const visibleItems = presentableFeedItems(permittedItems, settings, await aiConfigured(settings));
  return {
    permissions,
    candidates: searchFeed(visibleItems, query).slice(0, 8),
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

function localeChangedSearchResult(locale, result = {}) {
  return {
    ok: true,
    locale,
    type: result.type || "question",
    mode: result.mode || "dashboard",
    answer: translate(locale, "background.error.aiLocaleChanged"),
    links: Array.isArray(result.links) ? result.links : [],
    usedAi: false,
    errorKey: "background.error.aiLocaleChanged",
    errorParams: {},
  };
}

async function sanitizeSearchResult(result, { asUrl, query, nonAiFallback }) {
  const latestSettings = await getSettings();
  const latestLocale = settingsLocale(latestSettings);
  if (asUrl) {
    const contextUrls = [asUrl, ...(result?.links || []).map((link) => link?.url)];
    if (!await cacheUrlsPermitted(contextUrls)) {
      return websitePermissionSearchResult(latestLocale, asUrl);
    }
    if (latestLocale !== result?.locale) return localeChangedSearchResult(latestLocale, result);
    if (result?.usedAi && !await aiSearchResultPermitted(result, asUrl, latestSettings)) {
      if (!await cacheUrlsPermitted(contextUrls)) return websitePermissionSearchResult(latestLocale, asUrl);
      return withFeedCacheMetadata({ ...(nonAiFallback || websitePermissionSearchResult(latestLocale, asUrl)), locale: latestLocale }, [], "ai-search");
    }
    return result;
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
  const settings = await getSettings();
  const locale = settingsLocale(settings);
  const articleContext = normalizeArticleContext(body.articleContext, locale, normalizeUserUrl);
  const questionContext = normalizeQuestionContext(body.questionContext);
  const followupContext = articleContext || questionContext;
  const queryLimit = followupContext ? AI_FOLLOWUP_QUERY_MAX_CHARS : 2000;
  const query = limitCodePoints(String(body.query || "").trim(), queryLimit);
  if (!query) return resultMessage(settings, false, "background.error.searchRequired");
  const asUrl = normalizeUserUrl(query);
  if (articleContext && !asUrl) {
    const result = await answerArticleFollowup(settings, locale, query, articleContext);
    const latestLocale = settingsLocale(await getSettings());
    return latestLocale === result.locale ? result : localeChangedSearchResult(latestLocale, result);
  }
  if (questionContext && !asUrl) {
    const result = await answerQuestionFollowup(settings, locale, query, questionContext);
    const latestLocale = settingsLocale(await getSettings());
    return latestLocale === result.locale ? result : localeChangedSearchResult(latestLocale, result);
  }
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
  if (cached?.usedAi
    && aiOutputMatchesLocale(cached.answer, locale)
    && await aiSearchResultPermitted(cached, asUrl, settings, feedPermissions, cacheEpoch)) {
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
        ? limitArticleSummary(readerText, locale)
        : reader.description || translate(locale, "background.search.noWebsiteDescription");
      const fallbackAnswer = isArticle
        ? limitArticleSummary(`${reader.title}\n\n${fallbackText}`, locale)
        : `${reader.title}\n\n${fallbackText}`;
      nonAiFallback = {
        ok: true,
        locale,
        type: "url",
        mode,
        answer: fallbackAnswer,
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
          text: limitCodePoints(readerText, AI_ARTICLE_CONTEXT_MAX_CHARS),
          siteName: reader.siteName,
          description: reader.description,
        }),
        links: [{ title: reader.title, url: reader.url }],
        validateRequest: () => assertUrlsStillPermitted([asUrl, reader.requestedUrl, reader.url, reader.canonicalUrl]),
        maxTokens: isArticle ? AI_ARTICLE_MAX_TOKENS : AI_SEARCH_MAX_TOKENS,
        completionOptions: isArticle ? { preferVisibleOutput: true } : {},
        transformAnswer: isArticle ? (value) => limitArticleSummary(value, locale) : null,
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

async function answerArticleFollowup(settings, locale, query, context) {
  let reader;
  try {
    reader = await readCachedArticle(context.url);
  } catch (error) {
    const messageKey = error?.messageKey || "background.error.aiNetwork";
    return {
      ok: true,
      locale,
      type: "question",
      mode: "article-followup",
      answer: translate(locale, messageKey, error?.messageParams || {}),
      links: [],
      usedAi: false,
      errorKey: messageKey,
      errorParams: error?.messageParams || {},
    };
  }
  const readerText = readerTextFromBlocks(reader.blocks);
  const contextUrls = [context.url, reader.requestedUrl, reader.url, reader.canonicalUrl];
  return answerWithOptionalAi(settings, {
    locale,
    type: "question",
    mode: "article-followup",
    fallback: translate(locale, "background.search.followupUnavailable"),
    system: translateAiPrompt(locale, "background.prompt.articleFollowup"),
    input: translate(locale, "background.prompt.articleFollowupInput", {
      url: reader.url,
      title: reader.title,
      summary: context.summary,
      text: limitCodePoints(readerText, AI_ARTICLE_CONTEXT_MAX_CHARS),
      history: articleHistoryText(context.turns),
      query,
    }),
    links: [],
    validateRequest: () => assertUrlsStillPermitted(contextUrls),
    maxTokens: AI_ARTICLE_MAX_TOKENS,
    completionOptions: { preferVisibleOutput: true },
  });
}

async function answerQuestionFollowup(settings, locale, query, context) {
  const searchContext = await loadQuestionSearchContext(settings, query);
  const candidates = searchContext.candidates;
  const nonAiFallback = localQuestionSearchResult(locale, query, candidates);
  const result = await answerWithOptionalAi(settings, {
    locale,
    type: "question",
    mode: "question-followup",
    fallback: nonAiFallback.answer,
    system: translateAiPrompt(locale, "background.prompt.questionFollowup"),
    input: translate(locale, "background.prompt.questionFollowupInput", {
      initialQuery: context.initialQuery,
      initialAnswer: context.initialAnswer,
      history: articleHistoryText(context.turns),
      content: candidates.length
        ? candidates.map((item, index) => `${index + 1}. ${item.title}｜${item.excerpt}｜${item.url}`).join("\n")
        : translate(locale, "background.search.noLocalResults", { query }),
      query,
    }),
    links: candidates.map((item) => ({ title: item.title, url: item.url })),
    validateRequest: () => assertFeedItemsStillPermitted(candidates),
  });
  const guardedResult = withFeedCacheMetadata(
    result,
    candidates,
    "ai-search",
    result.usedAi ? settings.openaiBaseUrl : "",
  );
  return sanitizeSearchResult(guardedResult, { asUrl: "", query, nonAiFallback });
}

async function answerWithOptionalAi(settings, options) {
  if (!await aiConfigured(settings)) return { ok: true, locale: options.locale, type: options.type, mode: options.mode, answer: options.fallback, links: options.links, usedAi: false };
  try {
    const rawValue = await callProvider(
      settings,
      options.system,
      options.input,
      options.maxTokens || AI_SEARCH_MAX_TOKENS,
      "",
      options.validateRequest,
      {
        ...(options.completionOptions || {}),
        expectedLocale: options.locale,
        ...(typeof options.outputValidator === "function" ? { outputValidator: options.outputValidator } : {}),
      },
    );
    const value = typeof options.transformAnswer === "function" ? options.transformAnswer(rawValue) : rawValue;
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

async function callProvider(
  settings,
  system,
  input,
  maxTokens,
  apiKeyOverride = "",
  validateRequest = null,
  completionOptions = {},
  providerOverride = false,
) {
  const {
    expectedLocale = "",
    outputValidator = null,
    ...providerCompletionOptions
  } = completionOptions || {};
  let providerSettings = settings;
  let apiKey = apiKeyOverride;
  const useProviderOverride = providerOverride || Boolean(apiKeyOverride);
  if (!useProviderOverride) {
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
  if (providerRequiresApiKey(providerSettings.openaiBaseUrl) && !apiKey) {
    throw typedError("AI_KEY_MISSING", "background.error.aiKeyMissing", {}, false);
  }
  const expectedProvider = {
    openaiBaseUrl: providerSettings.openaiBaseUrl,
    openaiApiStyle: providerSettings.openaiApiStyle,
    openaiSummaryModel: providerSettings.openaiSummaryModel,
    credentialGeneration: providerSettings.credentialGeneration,
    openaiApiKey: apiKey,
  };
  const assertExpectedLocale = async () => {
    if (!expectedLocale) return;
    const latestLocale = settingsLocale(await getSettings());
    if (latestLocale !== expectedLocale) {
      throw typedError("AI_LOCALE_CHANGED", "background.error.aiLocaleChanged", {}, true);
    }
  };
  const validateCurrentRequest = async () => {
    await assertExpectedLocale();
    if (!useProviderOverride) {
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
  const validateOutput = typeof outputValidator === "function" ? outputValidator : aiOutputMatchesLocale;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await requestAiCompletion(providerSettings, {
      ...providerCompletionOptions,
      system: attempt === 0
        ? system
        : `${system}\n\n${translate(expectedLocale, "background.prompt.outputLanguageRepair")}`,
      input,
      maxTokens,
      apiKey,
      hasOriginPermission,
      hasOriginPermissions,
      validateRequest: validateCurrentRequest,
    });
    await assertExpectedLocale();
    if (!expectedLocale || validateOutput(response, expectedLocale)) return response;
  }
  throw typedError("AI_WRONG_LANGUAGE", "background.error.aiWrongLanguage", {}, true);
}

async function testOpenAISettings(body) {
  try {
    const savedSettings = await getSettings();
    if (Object.hasOwn(body, "openaiSummaryModel") && !String(body.openaiSummaryModel || "").trim()) {
      return resultMessage(savedSettings, false, "background.error.aiModelRequired");
    }
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
    if (!String(settings.openaiSummaryModel || "").trim()) {
      return resultMessage(settings, false, "background.error.aiModelRequired");
    }
    if (!providerCredentialAvailable(settings.openaiBaseUrl, apiKey)) {
      return resultMessage(settings, false, "background.error.aiKeyMissing");
    }
    const locale = settingsLocale(settings);
    const sample = await callProvider(
      settings,
      translate(locale, "background.prompt.connectionSystem"),
      translate(locale, "background.prompt.connectionInput"),
      AI_CONNECTION_TEST_MAX_TOKENS,
      apiKey,
      null,
      {},
      true,
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
