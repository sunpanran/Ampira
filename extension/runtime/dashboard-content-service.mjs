export function createDashboardContentService(options) {
  const {
    cacheMutations, capturePermissionEpoch, isPermissionEpochCurrent, getSettings,
    settingsLocale, secretStatus, currentBookmarkModel, emptyBookmarkModel,
    feedCacheOrEmpty, getRecord, getRefreshStatus, readQuota, emptySourceQuality,
    getAiAutoStatus, filterFeedItemsBySources, originsFromUrls, buildPermissionRows,
    originPattern, sanitizeCardAiSummaries, buildFallbackDigest, summarizeQuality,
    buildDailyCandidates, dailyCandidateFingerprint, digestSchemaVersion, rankingPolicyVersion, localDateKey,
    pipelineStages, publicFeedsForLocale, chrome, safeOrigin, typedError,
    uniqueStrings, normalizeUserUrl, aiSearchResultPermitted,
  } = options;

  return {
    buildDashboardPayload,
    configuredFeedSources,
    currentFeedPermissionState,
    withFeedCacheMetadata,
    cacheSourceIdentitiesPermitted,
    assertFeedItemsStillPermitted,
    assertUrlsStillPermitted,
    digestCachePermitted,
    filterSourceQuality,
    sanitizeDailyDigest,
  };

async function buildDashboardPayload(attempt = 0) {
  const expectedCacheEpoch = cacheMutations.capture();
  const expectedPermissionEpoch = capturePermissionEpoch();
  const settings = await getSettings();
  const locale = settingsLocale(settings);
  const secrets = await secretStatus();
  const model = settings.bookmarkConsentGranted ? await currentBookmarkModel(settings) : emptyBookmarkModel();
  let feed = feedCacheOrEmpty(await getRecord("feed", null));
  const [status, cachedDigest, quota, rawSourceQuality, autoAiStatus] = await Promise.all([
    getRefreshStatus(),
    getRecord("daily-digest", null),
    readQuota(settings.dailyAiLimit),
    getRecord("source-quality", emptySourceQuality()),
    getAiAutoStatus(),
  ]);
  const feedPermissions = await currentFeedPermissionState(settings, model);
  const visibleFeedItems = filterFeedItemsBySources(feed.items || [], feedPermissions.permitted, feedPermissions.grantedOrigins);
  feed = {
    ...feed,
    items: visibleFeedItems,
    localCount: visibleFeedItems.filter((item) => !item.externalDiscovery).length,
    publicCount: visibleFeedItems.filter((item) => item.externalDiscovery).length,
    deniedOrigins: originsFromUrls(feedPermissions.denied.map((source) => source.url)),
  };
  let aiPermissionGranted = buildPermissionRows(
    [originPattern(settings.openaiBaseUrl)],
    feedPermissions.grantedOrigins,
  ).some((row) => row.required && row.granted);
  let configuredForAi = settings.aiDisclosureAccepted === true
    && secrets.hasOpenAIKey
    && aiPermissionGranted;
  feed = { ...feed, items: sanitizeCardAiSummaries(feed.items, settings, configuredForAi) };
  const digestCandidates = buildDailyCandidates(feed.items, {
    limit: 12,
    recentLimit: 3,
    publisherLimit: settings.todayNewsPerPublisherLimit,
    aiRankingEnabled: configuredForAi,
  });
  const fallbackDigest = withFeedCacheMetadata(
    buildFallbackDigest(digestCandidates, secrets.hasOpenAIKey ? "pending" : "no-api-key", locale, {
      preselected: true,
      publisherLimit: settings.todayNewsPerPublisherLimit,
    }),
    digestCandidates,
    "daily-digest",
  );
  let digest = cachedDigest?.locale === locale
    && digestCachePermitted(cachedDigest, feed.items, feedPermissions, settings, configuredForAi)
    ? cachedDigest
    : fallbackDigest;
  let sourceQuality = filterSourceQuality(rawSourceQuality, feedPermissions);
  let ready = feed.items.length;
  if (!cacheMutations.isCurrent(expectedCacheEpoch) || !isPermissionEpochCurrent(expectedPermissionEpoch)) {
    if (attempt < 2) return buildDashboardPayload(attempt + 1);
    feed = {
      ...feed,
      items: [],
      localCount: 0,
      publicCount: 0,
      deniedOrigins: originsFromUrls(feedPermissions.sources.map((source) => source.url)),
    };
    aiPermissionGranted = false;
    configuredForAi = false;
    digest = withFeedCacheMetadata(buildFallbackDigest([], "local", locale, {
      preselected: true,
      publisherLimit: settings.todayNewsPerPublisherLimit,
    }), [], "daily-digest");
    sourceQuality = summarizeQuality({}, feedPermissions.sources, feedPermissions.sources);
    ready = 0;
  }
  return {
    generatedAt: new Date().toISOString(),
    source: "Chrome Bookmarks API",
    total: model.bookmarks.length,
    sections: model.sections,
    bookmarks: model.bookmarks,
    feed: { schemaVersion: 2, ...feed },
    dailyDigest: digest,
    ai: {
      enabled: configuredForAi,
      configured: secrets.hasOpenAIKey,
      disclosureAccepted: settings.aiDisclosureAccepted === true,
      permissionGranted: aiPermissionGranted,
      model: settings.openaiSummaryModel,
      baseUrl: settings.openaiBaseUrl,
      apiStyle: settings.openaiApiStyle,
      keySource: "local-extension-storage",
      maskedKey: secrets.hasOpenAIKey ? "••••••••" : "",
      dailyLimit: settings.dailyAiLimit,
      usedToday: quota.used,
      autoStatus: autoAiStatus,
      hotNewsCacheSize: settings.hotNewsCacheSize,
      hotNewsEntriesPerSource: settings.hotNewsEntriesPerSource,
      newsEntriesPerCategory: settings.newsEntriesPerCategory,
      cardSummaryEnabled: settings.cardSummaryEnabled !== false,
    },
    cache: {
      ready,
      target: settings.hotNewsCacheSize,
      progress: Math.min(1, ready / Math.max(1, settings.hotNewsCacheSize)),
      refreshProgress: status.running ? Number(status.progress || 0) : 1,
      excluded: model.bookmarks.filter((item) => item.feedExcluded).length,
      message: status.message || "",
      messageKey: status.messageKey || "background.cacheReady",
      messageParams: status.messageParams || {},
    },
    readingQueue: { storage: "indexedDB", queueKey: "dash.readingQueue", importantKey: "dash.important" },
    sourceQuality,
    pipeline: {
      schemaVersion: 2,
      retentionDays: 30,
      personalizedRankingEnabled: settings.personalizedRankingEnabled !== false,
      publicFeedSupplementEnabled: settings.publicFeedSupplementEnabled !== false,
      stages: status.stages || pipelineStages("complete"),
      sourceHealth: { healthy: sourceQuality.healthy || 0, warning: sourceQuality.warnings || 0 },
      shadowRuns: [],
    },
    status,
    onboarding: {
      completed: settings.onboardingCompleted === true,
      bookmarkConsentGranted: settings.bookmarkConsentGranted === true,
    },
  };
}

function configuredFeedSources(settings, model) {
  if (settings.bookmarkConsentGranted !== true) return [];
  const localSources = (model?.bookmarks || []).filter((item) => item.cardType === "news" && !item.feedExcluded);
  const publicSources = settings.publicFeedSupplementEnabled === false
    ? []
    : publicFeedsForLocale(settingsLocale(settings)).map((feed) => ({ ...feed, externalDiscovery: true }));
  return [...localSources, ...publicSources];
}

async function currentFeedPermissionState(settings, model) {
  const sources = configuredFeedSources(settings, model);
  const requiredOrigins = [];
  for (const source of sources) {
    const pattern = originPattern(source.url);
    if (pattern) requiredOrigins.push(pattern);
  }
  let grantedOrigins = [];
  try {
    const granted = await chrome.permissions.getAll();
    grantedOrigins = granted.origins || [];
  } catch {
    grantedOrigins = [];
  }
  const grantedPatterns = new Set(buildPermissionRows(requiredOrigins, grantedOrigins)
    .filter((row) => row.required && row.granted)
    .map((row) => row.origin));
  const permitted = [];
  const denied = [];
  for (const source of sources) {
    (grantedPatterns.has(originPattern(source.url)) ? permitted : denied).push(source);
  }
  return {
    sources,
    permitted,
    denied,
    grantedOrigins,
    permittedByKey: new Map(permitted.map((source) => [String(source.key || ""), originPattern(source.url)]).filter(([key, pattern]) => key && pattern)),
  };
}

function withFeedCacheMetadata(value, items, capability, providerUrl = "") {
  const identities = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    const sourceKey = String(item?.sourceKey || "");
    const sourceOrigin = safeOrigin(item?.sourceOrigin || "");
    const fetchOrigin = safeOrigin(item?.fetchOrigin || item?.sourceOrigin || "");
    if (!sourceKey || !sourceOrigin) continue;
    identities.set(`${sourceKey}|${sourceOrigin}|${fetchOrigin}`, { sourceKey, sourceOrigin, fetchOrigin });
  }
  const result = {
    ...value,
    capability,
    sourceIdentities: [...identities.values()],
  };
  if (providerUrl) result.providerOrigin = safeOrigin(providerUrl);
  return result;
}

function cacheSourceIdentitiesPermitted(value, permissionState, requireMetadata = false) {
  if (!Array.isArray(value?.sourceIdentities)) return !requireMetadata;
  return value.sourceIdentities.every((identity) => {
    const expected = permissionState.permittedByKey.get(String(identity?.sourceKey || ""));
    if (!expected || expected !== originPattern(identity?.sourceOrigin || "")) return false;
    const fetchPattern = originPattern(identity?.fetchOrigin || identity?.sourceOrigin || "");
    if (!fetchPattern) return false;
    return buildPermissionRows([fetchPattern], permissionState.grantedOrigins)
      .some((row) => row.required && row.granted);
  });
}

async function assertFeedItemsStillPermitted(items) {
  const settings = await getSettings();
  const model = settings.bookmarkConsentGranted ? await currentBookmarkModel(settings) : emptyBookmarkModel();
  const permissionState = await currentFeedPermissionState(settings, model);
  const context = withFeedCacheMetadata({}, items, "ai-context");
  if (!cacheSourceIdentitiesPermitted(context, permissionState, true)) {
    throw typedError("SOURCE_PERMISSION_CHANGED", "background.error.sourcePermission", {}, false);
  }
  return {
    origins: uniqueStrings(context.sourceIdentities.flatMap((identity) => [identity.sourceOrigin, identity.fetchOrigin])),
    code: "SOURCE_PERMISSION_CHANGED",
    messageKey: "background.error.sourcePermission",
  };
}

async function assertUrlsStillPermitted(urls) {
  const raw = uniqueStrings((urls || []).filter((value) => String(value || "").trim()));
  const parsed = raw.map(normalizeUserUrl);
  if (!parsed.length || parsed.some((value) => !value)) {
    throw typedError("ORIGIN_PERMISSION_REQUIRED", "background.error.websitePermission", {}, false);
  }
  return {
    origins: uniqueStrings(parsed),
    code: "ORIGIN_PERMISSION_REQUIRED",
    messageKey: "background.error.websitePermission",
  };
}

function digestCachePermitted(digest, visibleItems, permissionState, settings, configuredForAi) {
  const candidates = buildDailyCandidates(visibleItems, {
    limit: 12,
    recentLimit: 3,
    publisherLimit: settings.todayNewsPerPublisherLimit,
    aiRankingEnabled: configuredForAi,
  });
  const expectedFingerprint = dailyCandidateFingerprint(candidates, {
    policyVersion: rankingPolicyVersion,
    publisherLimit: settings.todayNewsPerPublisherLimit,
  });
  if (digest?.schemaVersion !== digestSchemaVersion
    || digest?.rankingPolicyVersion !== rankingPolicyVersion
    || digest?.date !== localDateKey()
    || digest?.candidateFingerprint !== expectedFingerprint) return false;
  const visibleIds = new Set((visibleItems || []).flatMap((item) => [item?.articleId, item?.entryKey, item?.url]).filter(Boolean));
  const digestItemsVisible = (Array.isArray(digest?.items) ? digest.items : []).every((item) => (
    visibleIds.has(item?.id) || visibleIds.has(item?.url)
  ));
  if (!digestItemsVisible) return false;
  if (digest.status !== "ai") return cacheSourceIdentitiesPermitted(digest, permissionState, false);
  return configuredForAi
    && originPattern(digest.providerOrigin || "") === originPattern(settings.openaiBaseUrl)
    && cacheSourceIdentitiesPermitted(digest, permissionState, true);
}

function filterSourceQuality(sourceQuality, permissionState) {
  const records = Object.fromEntries(Object.entries(sourceQuality?.records || {}).filter(([key, record]) => {
    const expected = permissionState.permittedByKey.get(String(key || ""));
    return Boolean(expected && expected === originPattern(record?.sourceOrigin || ""));
  }).map(([key, record]) => {
    const fetchPattern = originPattern(record?.fetchOrigin || record?.sourceOrigin || "");
    const fetchGranted = !fetchPattern || buildPermissionRows([fetchPattern], permissionState.grantedOrigins)
      .some((row) => row.required && row.granted);
    if (fetchGranted) return [key, record];
    return [key, {
      ...record,
      status: "permissionRequired",
      pendingFeed: record.resolvedUrl && record.fetchOrigin
        ? { url: record.resolvedUrl, origin: record.fetchOrigin }
        : record.pendingFeed || null,
      resolvedUrl: "",
      fetchOrigin: "",
      validators: { etag: "", lastModified: "" },
    }];
  }));
  return summarizeQuality(records, permissionState.denied, permissionState.sources);
}

async function sanitizeDailyDigest(digest, attempt = 0) {
  const expectedCacheEpoch = cacheMutations.capture();
  const expectedPermissionEpoch = capturePermissionEpoch();
  const settings = await getSettings();
  const locale = settingsLocale(settings);
  const model = settings.bookmarkConsentGranted ? await currentBookmarkModel(settings) : emptyBookmarkModel();
  const feed = await getRecord("feed", { items: [] });
  const permissions = await currentFeedPermissionState(settings, model);
  const items = filterFeedItemsBySources(feed.items || [], permissions.permitted, permissions.grantedOrigins);
  const aiPermitted = digest?.status === "ai"
    ? await aiSearchResultPermitted({
      usedAi: true,
      providerOrigin: digest.providerOrigin,
      sourceIdentities: digest.sourceIdentities,
    }, "", settings, permissions)
    : false;
  const sanitized = digest?.locale === locale && digestCachePermitted(digest, items, permissions, settings, aiPermitted)
    ? digest
    : (() => {
        const candidates = buildDailyCandidates(items, {
          limit: 12,
          recentLimit: 3,
          publisherLimit: settings.todayNewsPerPublisherLimit,
          aiRankingEnabled: aiPermitted,
        });
        return withFeedCacheMetadata(buildFallbackDigest(candidates, "local", locale, {
          preselected: true,
          publisherLimit: settings.todayNewsPerPublisherLimit,
        }), candidates, "daily-digest");
      })();
  if (!cacheMutations.isCurrent(expectedCacheEpoch) || !isPermissionEpochCurrent(expectedPermissionEpoch)) {
    if (attempt < 2) return sanitizeDailyDigest(digest, attempt + 1);
    return {
      digest: withFeedCacheMetadata(buildFallbackDigest([], "local", locale, {
        preselected: true,
        publisherLimit: settings.todayNewsPerPublisherLimit,
      }), [], "daily-digest"),
      cacheEpoch: expectedCacheEpoch,
      permissionEpoch: expectedPermissionEpoch,
    };
  }
  return {
    digest: sanitized,
    cacheEpoch: expectedCacheEpoch,
    permissionEpoch: expectedPermissionEpoch,
  };
}

}
