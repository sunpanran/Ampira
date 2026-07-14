const AI_DIGEST_MAX_TOKENS = 2400;
const AI_ARTICLE_SUMMARY_MAX_TOKENS = 1200;
const CARD_SUMMARY_EXCERPT_MAX_CHARS = 2000;
const FEED_IMAGE_ENRICH_LIMIT = 12;
const FEED_IMAGE_PER_SOURCE_LIMIT = 2;
const FEED_IMAGE_CONCURRENCY = 3;
const FEED_IMAGE_HIT_CACHE_MS = 24 * 60 * 60 * 1000;
const FEED_IMAGE_MISS_CACHE_MS = 2 * 60 * 60 * 1000;
const FEED_IMAGE_ERROR_CACHE_MS = 15 * 60 * 1000;

export function sourceStatusForFetch(result, itemCount) {
  if (Number(itemCount) > 0) return "healthy";
  return result?.pendingFeed ? "permissionRequired" : "empty";
}

export function selectFeedImageEnrichmentTargets(items, {
  limit = FEED_IMAGE_ENRICH_LIMIT,
  perSourceLimit = FEED_IMAGE_PER_SOURCE_LIMIT,
} = {}) {
  const sourceCounts = new Map();
  return [...(items || [])]
    .filter((item) => !item.imageUrl && sameOriginValue(item.url, item.sourceOrigin))
    .sort((left, right) => Number(right.score || 0) - Number(left.score || 0)
      || Date.parse(right.publishedAt || right.fetchedAt || 0) - Date.parse(left.publishedAt || left.fetchedAt || 0))
    .filter((item) => {
      const key = String(item.sourceKey || "");
      const count = sourceCounts.get(key) || 0;
      if (!key || count >= perSourceLimit) return false;
      sourceCounts.set(key, count + 1);
      return true;
    })
    .slice(0, limit);
}

export function feedImageCacheFresh(record, item, now = Date.now()) {
  if (record?.strategyVersion !== 1 || record?.capability !== "feed-image") return false;
  if (record.requestedUrl !== item?.url || record.sourceKey !== item?.sourceKey) return false;
  if (record.sourceOrigin !== safeOriginValue(item?.sourceOrigin || "")) return false;
  const checkedAt = Date.parse(record.checkedAt || "");
  const maxAge = record.outcome === "hit"
    ? FEED_IMAGE_HIT_CACHE_MS
    : record.outcome === "miss" ? FEED_IMAGE_MISS_CACHE_MS : FEED_IMAGE_ERROR_CACHE_MS;
  return ["hit", "miss", "error"].includes(record.outcome)
    && Number.isFinite(checkedAt)
    && now - checkedAt >= 0
    && now - checkedAt < maxAge;
}

function sameOriginValue(left, right) {
  try {
    return new URL(left).origin === new URL(right).origin;
  } catch {
    return false;
  }
}

function safeOriginValue(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)
      ? url.origin
      : "";
  } catch {
    return "";
  }
}
const CARD_SUMMARY_MAX_CHARS = 280;

export function createRefreshService(options) {
  const {
    refreshCoordinator, getSettings, currentBookmarkModel, emptyBookmarkModel, currentFeedPermissionState,
    configuredFeedSources, selectRefreshBatch, getRecord, setRecord, setRecords,
    setRefreshStatus, pipelineStages, broadcast, fetchSourceArticles, sourceFetchOptions,
    mapWithConcurrency, summarizeQuality, retainActiveUnrefreshedItems, rankAndDedupe,
    assertFeedItemsStillPermitted, withFeedCacheMetadata, cacheMutations, aiConfigured,
    getAiAutoStatus, setAiAutoStatus, defaultAiAutoStatus, readQuota, runAiWithinQuota,
    callProvider, translate, settingsLocale, cleanGeneratedSummaryLine,
    extractGeneratedSummaryTitle, limitGeneratedSummaryLines, parseGeneratedDailyDigest, dailyDigestEvidence, buildFallbackDigest,
    digestCachePermitted, filterFeedItemsBySources, resultMessage, errorResult,
    emptySourceQuality, localDateKey, uniqueStrings, safeOrigin, originPattern,
    sanitizeDailyDigest, typedError, feedCacheOrEmpty, getRefreshStatus, hostOf,
    originsFromUrls, isPermissionEpochCurrent, buildDailyCandidates,
    dailyCandidateFingerprint, rankingPolicyVersion, updateSourceQualityRecord,
    cardSummaryPolicyVersion, fetchSourceImageCandidates, hasOriginPermission, hashText,
  } = options;
  return {
    startRefresh, runRefresh, refreshSource, refreshDailyDigest, refreshSingleSummary,
    generatedCardSummary, preserveCardAiSummary, sanitizeCardAiSummaries,
  };
async function startRefresh(force) {
  return refreshCoordinator.start(force === true);
}

async function runRefresh(generation, options = {}) {
  try {
    return await performRefresh(generation, options);
  } catch (error) {
    if (!refreshCoordinator.isCurrent(generation)) return;
    try {
      const previous = await getRefreshStatus();
      const failed = {
        ...previous,
        running: false,
        finishedAt: new Date().toISOString(),
        failed: Math.max(1, Number(previous.failed || 0)),
        message: "",
        messageKey: "background.refreshFailed",
        messageParams: {},
        stages: pipelineStages("complete"),
      };
      await setRefreshStatus(failed);
      const autoStatus = await getAiAutoStatus();
      if (autoStatus.running) await setAiAutoStatus({
        ...autoStatus,
        phase: "error",
        running: false,
        lastRunAt: new Date().toISOString(),
        errorKey: error?.messageKey || "background.error.aiNetwork",
        errorParams: error?.messageParams || {},
        errorStage: autoStatus.phase === "running-digest"
          ? "digest"
          : autoStatus.phase === "running-cards" ? "cards" : "refresh",
      });
      broadcast("refresh.progress", failed);
    } catch {
      // Preserve the original refresh failure when status persistence also fails.
    }
    return null;
  }
}

async function performRefresh(generation, { prioritizeAutomaticAi = false } = {}) {
  const cacheEpoch = cacheMutations.capture();
  const settings = await getSettings();
  if (!refreshCoordinator.isCurrent(generation)) return;
  const locale = settingsLocale(settings);
  if (!settings.bookmarkConsentGranted) return;
  const model = await currentBookmarkModel(settings);
  const feedPermissions = await currentFeedPermissionState(settings, model);
  const { permitted, denied } = feedPermissions;
  const localSources = feedPermissions.sources.filter((source) => !source.externalDiscovery);
  const refreshCursor = await getRecord("refresh-source-cursor", 0);
  const refreshBatch = selectRefreshBatch(permitted, refreshCursor);
  const refreshSources = refreshBatch.sources;
  const status = {
    running: true,
    startedAt: new Date().toISOString(),
    finishedAt: "",
    total: refreshSources.length,
    completed: 0,
    failed: 0,
    excluded: localSources.length - permitted.filter((source) => !source.externalDiscovery).length,
    progress: 0,
    message: "",
    messageKey: refreshSources.length ? "background.readingSources" : "background.noAuthorizedSources",
    messageParams: refreshSources.length ? { count: refreshSources.length } : {},
    stages: pipelineStages("fetching"),
  };
  if (!refreshCoordinator.isCurrent(generation)) return;
  await setRefreshStatus(status);
  broadcast("refresh.progress", status);
  if (prioritizeAutomaticAi) {
    await runAutomaticAiFromCache({ settings, feedPermissions, cacheEpoch, generation });
  }
  if (!refreshCoordinator.isCurrent(generation)) return;
  const [previousFeedSnapshot, previousQualitySnapshot] = await Promise.all([
    getRecord("feed", { items: [] }),
    getRecord("source-quality", emptySourceQuality()),
  ]);
  const quality = {};
  const articles = [];
  const replacedSources = [];
  await mapWithConcurrency(refreshSources, 4, async (source) => {
    const previousRecord = previousQualitySnapshot.records?.[source.key] || {};
    const previousItems = (previousFeedSnapshot.items || []).filter((item) => item.sourceKey === source.key);
    try {
      const nextEligibleAt = Date.parse(String(previousRecord.nextEligibleAt || ""));
      if (Number.isFinite(nextEligibleAt) && nextEligibleAt > Date.now()) {
        quality[source.key] = previousRecord;
        return;
      }
      const result = await fetchSourceArticles(source, {
        ...sourceFetchOptions(settings.hotNewsEntriesPerSource),
        profile: previousRecord,
      });
      const items = result.items || [];
      if (result.outcome !== "notModified") replacedSources.push(source);
      articles.push(...items.map((item) => ({ ...item, externalDiscovery: source.externalDiscovery === true })));
      const itemCount = result.outcome === "notModified"
        ? previousItems.length
        : Number(result.displayableItemCount ?? items.length);
      const sourceStatus = sourceStatusForFetch(result, itemCount);
      const checkedAt = new Date().toISOString();
      quality[source.key] = updateSourceQualityRecord(previousRecord, {
        sourceKey: source.key,
        sourceOrigin: safeOrigin(source.url),
        title: source.title,
        host: source.host || hostOf(source.url),
        sourceType: source.externalDiscovery === true ? "public" : "bookmark",
        status: sourceStatus,
        method: result.method || previousRecord.method || "",
        itemCount,
        lastCheckedAt: checkedAt,
        lastSuccessAt: sourceStatus === "healthy" ? checkedAt : previousRecord.lastSuccessAt || "",
        resolvedUrl: result.outcome === "empty" ? "" : result.resolvedUrl || previousRecord.resolvedUrl || "",
        fetchOrigin: result.outcome === "empty" ? "" : result.fetchOrigin || previousRecord.fetchOrigin || safeOrigin(source.url),
        validators: result.outcome === "empty" ? { etag: "", lastModified: "" } : result.validators || previousRecord.validators,
        pendingFeed: result.pendingFeed || null,
        nextEligibleAt: "",
        reason: "",
        reasonKey: "",
      });
    } catch (error) {
      status.failed += 1;
      const terminal = [404, 410].includes(Number(error?.details?.status));
      quality[source.key] = updateSourceQualityRecord(previousRecord, {
        sourceKey: source.key,
        sourceOrigin: safeOrigin(source.url),
        title: source.title,
        host: source.host || hostOf(source.url),
        sourceType: source.externalDiscovery === true ? "public" : "bookmark",
        status: "error",
        reason: error?.messageKey ? "" : (error.message || String(error)),
        reasonKey: error?.messageKey || "",
        itemCount: previousItems.length,
        lastCheckedAt: new Date().toISOString(),
        resolvedUrl: terminal ? "" : previousRecord.resolvedUrl || "",
        fetchOrigin: terminal ? "" : previousRecord.fetchOrigin || "",
        validators: terminal ? { etag: "", lastModified: "" } : previousRecord.validators,
        nextEligibleAt: nextEligibleAtForError(error),
      });
    } finally {
      status.completed += 1;
      status.progress = status.total ? status.completed / status.total : 1;
      status.message = "";
      status.messageKey = "background.processedSources";
      status.messageParams = { completed: status.completed, total: status.total };
      if (refreshCoordinator.isCurrent(generation)) {
        await setRefreshStatus(status);
        broadcast("refresh.progress", status);
      }
    }
  });
  if (!refreshCoordinator.isCurrent(generation)) return;
  await enrichMissingFeedImages(articles, { cacheEpoch, generation });
  updateImageQualityMetrics(quality, articles);
  if (!refreshCoordinator.isCurrent(generation)) return;
  const aiReadyForRefresh = await aiConfigured(settings);
  const committed = await cacheMutations.run(async (isCurrent) => {
    if (!isCurrent() || !refreshCoordinator.isCurrent(generation)) return null;
    const [previous, previousQuality, previousDigest, feedback] = await Promise.all([
      getRecord("feed", { items: [] }),
      getRecord("source-quality", emptySourceQuality()),
      getRecord("daily-digest", null),
      getRecord("feedback", []),
    ]);
    if (!isCurrent() || !refreshCoordinator.isCurrent(generation)) return null;
    const retained = filterFeedItemsBySources(
      retainActiveUnrefreshedItems(previous.items, permitted, replacedSources),
      permitted,
      feedPermissions.grantedOrigins,
    );
    const previousByArticle = new Map((previous.items || []).map((item) => [item.articleId || item.entryKey || item.url, item]));
    const refreshed = articles.map((item) => preserveCardAiSummary(item, previousByArticle.get(item.articleId || item.entryKey || item.url), settings));
    const items = rankAndDedupe([...refreshed, ...retained], settings.hotNewsCacheSize, {
      feedback,
      personalizedRankingEnabled: settings.personalizedRankingEnabled !== false,
      aiRankingEnabled: aiReadyForRefresh,
      now: Date.now(),
    });
    const feed = {
      schemaVersion: 2,
      generatedAt: new Date().toISOString(),
      items,
      localCount: items.filter((item) => !item.externalDiscovery).length,
      publicCount: items.filter((item) => item.externalDiscovery).length,
      deniedOrigins: originsFromUrls(denied.map((source) => source.url)),
    };
    const unrefreshedPermittedKeys = new Set(permitted.filter((source) => !refreshSources.includes(source)).map((source) => source.key));
    const retainedQuality = Object.fromEntries(Object.entries(previousQuality.records || {}).filter(([key, record]) => (
      unrefreshedPermittedKeys.has(key)
      && originPattern(record?.sourceOrigin || "") === feedPermissions.permittedByKey.get(key)
    )));
    const qualitySummary = summarizeQuality({ ...retainedQuality, ...quality }, denied, feedPermissions.sources);
    const digestCandidates = buildDailyCandidates(items, {
      limit: 12,
      recentLimit: 3,
      publisherLimit: settings.todayNewsPerPublisherLimit,
      aiRankingEnabled: aiReadyForRefresh,
    });
    const preservedDigest = previousDigest?.locale === locale
      && previousDigest?.date === localDateKey()
      && digestCachePermitted(previousDigest, items, feedPermissions, settings, aiReadyForRefresh)
      ? previousDigest
      : withFeedCacheMetadata(buildFallbackDigest(digestCandidates, "local", locale, {
          preselected: true,
          publisherLimit: settings.todayNewsPerPublisherLimit,
        }), digestCandidates, "daily-digest");
    if (!isCurrent() || !refreshCoordinator.isCurrent(generation)) return null;
    await setRecords([
      { key: "feed", value: feed, kind: "cache" },
      { key: "source-quality", value: qualitySummary, kind: "cache" },
      {
        key: "daily-digest",
        value: preservedDigest,
        kind: "cache",
      },
      { key: "refresh-source-cursor", value: refreshBatch.nextCursor, kind: "state" },
    ]);
    return { items, needsDigest: Boolean(items.length && aiReadyForRefresh && preservedDigest.status !== "ai") };
  }, cacheEpoch);
  if (!committed || !refreshCoordinator.isCurrent(generation)) return;
  const automaticRun = await runAutomaticAiAfterRefresh({
    settings,
    items: committed.items,
    needsDigest: committed.needsDigest,
    aiReady: aiReadyForRefresh,
    cacheEpoch,
    generation,
  });
  const { items, errorKey: autoSummaryErrorKey } = automaticRun;
  const finished = {
    ...status,
    running: false,
    finishedAt: new Date().toISOString(),
    progress: 1,
    message: "",
    messageKey: items.length
      ? (autoSummaryErrorKey ? "background.cachedItemsAiDeferred" : "background.cachedItems")
      : "background.noItems",
    messageParams: items.length ? { count: items.length } : {},
    stages: pipelineStages("complete"),
  };
  await setRefreshStatus(finished);
  if (!refreshCoordinator.isCurrent(generation)) return;
  broadcast("dashboard.updated", { reason: "refresh-complete" });
}

async function enrichMissingFeedImages(items, { cacheEpoch, generation = null } = {}) {
  if (typeof fetchSourceImageCandidates !== "function" || typeof hasOriginPermission !== "function") return;
  const targets = selectFeedImageEnrichmentTargets(items);
  await mapWithConcurrency(targets, FEED_IMAGE_CONCURRENCY, async (item) => {
    if (!refreshStillCurrent(generation) || !cacheMutations.isCurrent(cacheEpoch)) return;
    const record = await loadFeedImageRecord(item, { cacheEpoch, generation });
    if (record?.outcome === "hit") applyFeedImageRecord(item, record);
  });
}

async function loadFeedImageRecord(item, { cacheEpoch, generation = null } = {}) {
  const requestedUrl = String(item.url || "");
  const sourceOrigin = safeOrigin(item.sourceOrigin || "");
  if (!requestedUrl || !sourceOrigin || !sameOrigin(requestedUrl, sourceOrigin)) return null;
  if (!await hasOriginPermission(requestedUrl)) return null;
  const cacheKey = `feed-image-v1-${hashText(requestedUrl)}`;
  const cached = await getRecord(cacheKey, null);
  if (feedImageCacheFresh(cached, item, Date.now()) && await hasOriginPermission(requestedUrl)) return cached;

  let imageUrls = [];
  let outcome = "miss";
  try {
    imageUrls = await fetchSourceImageCandidates(requestedUrl, {
      validateResponse: async (response) => {
        const finalUrl = String(response?.url || requestedUrl);
        if (!sameOrigin(finalUrl, sourceOrigin) || !await hasOriginPermission(finalUrl)) {
          const error = new Error("SOURCE_PERMISSION_CHANGED");
          error.code = "SOURCE_PERMISSION_CHANGED";
          throw error;
        }
      },
    });
    outcome = imageUrls.length ? "hit" : "miss";
  } catch (error) {
    if (!await hasOriginPermission(requestedUrl)) return null;
    outcome = "error";
  }
  if (!refreshStillCurrent(generation) || !cacheMutations.isCurrent(cacheEpoch)) return null;
  if (!await hasOriginPermission(requestedUrl) || !sameOrigin(requestedUrl, sourceOrigin)) return null;
  const record = {
    strategyVersion: 1,
    capability: "feed-image",
    outcome,
    requestedUrl,
    sourceKey: String(item.sourceKey || ""),
    sourceOrigin,
    imageUrl: imageUrls[0] || "",
    imageUrls: imageUrls.slice(0, 3),
    checkedAt: new Date().toISOString(),
    requiredOrigins: [sourceOrigin],
  };
  const stored = await cacheMutations.run(async (isCurrent) => {
    if (!isCurrent() || !refreshStillCurrent(generation) || !await hasOriginPermission(requestedUrl)) return null;
    await setRecord(cacheKey, record, "cache");
    return record;
  }, cacheEpoch);
  return stored;
}

function applyFeedImageRecord(item, record) {
  const imageUrls = [...new Set((Array.isArray(record.imageUrls) ? record.imageUrls : [record.imageUrl])
    .map((value) => String(value || "").trim()).filter(Boolean))].slice(0, 3);
  if (!imageUrls.length) return;
  item.imageUrl = imageUrls[0];
  item.imageUrls = imageUrls;
  item.imageSource = "origin";
}

function updateImageQualityMetrics(quality, items) {
  for (const [sourceKey, record] of Object.entries(quality || {})) {
    const sourceItems = (items || []).filter((item) => String(item.sourceKey || "") === sourceKey);
    if (!sourceItems.length && Number(record.itemCount || 0) > 0) continue;
    const imageCount = sourceItems.filter((item) => Boolean(item.imageUrl)).length;
    quality[sourceKey] = {
      ...record,
      imageCount,
      feedImageCount: sourceItems.filter((item) => item.imageSource === "feed").length,
      enrichedImageCount: sourceItems.filter((item) => item.imageSource === "origin").length,
      missingImageCount: Math.max(0, sourceItems.length - imageCount),
    };
  }
}

function imageQualityMetrics(items) {
  const list = Array.isArray(items) ? items : [];
  const imageCount = list.filter((item) => Boolean(item.imageUrl)).length;
  return {
    imageCount,
    feedImageCount: list.filter((item) => item.imageSource === "feed").length,
    enrichedImageCount: list.filter((item) => item.imageSource === "origin").length,
    missingImageCount: Math.max(0, list.length - imageCount),
  };
}

function refreshStillCurrent(generation) {
  return generation === null || generation === undefined || refreshCoordinator.isCurrent(generation);
}

function sameOrigin(left, right) {
  return sameOriginValue(left, right);
}

async function refreshSource(body = {}) {
  const sourceKey = String(body.sourceKey || "").trim();
  if (!sourceKey) throw typedError("SOURCE_NOT_FOUND", "background.error.sourceNotFound", {}, false);
  const cacheEpoch = cacheMutations.invalidate();
  refreshCoordinator.invalidate();
  const settings = await getSettings();
  if (!settings.bookmarkConsentGranted) throw typedError("SOURCE_NOT_FOUND", "background.error.sourceNotFound", {}, false);
  const model = await currentBookmarkModel(settings);
  const permissions = await currentFeedPermissionState(settings, model);
  const source = permissions.permitted.find((candidate) => String(candidate.key || "") === sourceKey);
  if (!source) throw typedError("SOURCE_PERMISSION_REQUIRED", "background.error.sourcePermission", {}, false);
  const [previousFeed, previousQuality, feedback] = await Promise.all([
    getRecord("feed", { items: [] }),
    getRecord("source-quality", emptySourceQuality()),
    getRecord("feedback", []),
  ]);
  const previousRecord = previousQuality.records?.[sourceKey] || {};
  const previousItems = (previousFeed.items || []).filter((item) => item.sourceKey === sourceKey);
  let result;
  try {
    result = await fetchSourceArticles(source, {
      ...sourceFetchOptions(settings.hotNewsEntriesPerSource),
      profile: previousRecord,
    });
  } catch (error) {
    const terminal = [404, 410].includes(Number(error?.details?.status));
    const failedRecord = updateSourceQualityRecord(previousRecord, {
      sourceKey,
      sourceOrigin: safeOrigin(source.url),
      title: source.title,
      host: source.host || hostOf(source.url),
      sourceType: source.externalDiscovery === true ? "public" : "bookmark",
      status: "error",
      itemCount: previousItems.length,
      lastCheckedAt: new Date().toISOString(),
      reason: error?.messageKey ? "" : (error.message || String(error)),
      reasonKey: error?.messageKey || "",
      resolvedUrl: terminal ? "" : previousRecord.resolvedUrl || "",
      fetchOrigin: terminal ? "" : previousRecord.fetchOrigin || "",
      validators: terminal ? { etag: "", lastModified: "" } : previousRecord.validators,
      nextEligibleAt: nextEligibleAtForError(error),
    });
    await cacheMutations.run(async (isCurrent) => {
      if (!isCurrent()) return;
      const latestQuality = await getRecord("source-quality", emptySourceQuality());
      await setRecord("source-quality", summarizeQuality({
        ...(latestQuality.records || {}),
        [sourceKey]: failedRecord,
      }, permissions.denied, permissions.sources), "cache");
    }, cacheEpoch);
    broadcast("settings.changed", { sourceQualityChanged: true });
    throw error;
  }

  const checkedAt = new Date().toISOString();
  const newItems = result.items || [];
  if (result.outcome !== "notModified") await enrichMissingFeedImages(newItems, { cacheEpoch });
  const itemCount = result.outcome === "notModified"
    ? previousItems.length
    : Number(result.displayableItemCount ?? newItems.length);
  const sourceStatus = sourceStatusForFetch(result, itemCount);
  const imageMetrics = imageQualityMetrics(newItems.length ? newItems : previousItems);
  const nextRecord = updateSourceQualityRecord(previousRecord, {
    sourceKey,
    sourceOrigin: safeOrigin(source.url),
    title: source.title,
    host: source.host || hostOf(source.url),
    sourceType: source.externalDiscovery === true ? "public" : "bookmark",
    status: sourceStatus,
    method: result.method || previousRecord.method || "",
    itemCount,
    lastCheckedAt: checkedAt,
    lastSuccessAt: sourceStatus === "healthy" ? checkedAt : previousRecord.lastSuccessAt || "",
    resolvedUrl: result.outcome === "empty" ? "" : result.resolvedUrl || previousRecord.resolvedUrl || "",
    fetchOrigin: result.outcome === "empty" ? "" : result.fetchOrigin || previousRecord.fetchOrigin || safeOrigin(source.url),
    validators: result.outcome === "empty" ? { etag: "", lastModified: "" } : result.validators || previousRecord.validators,
    pendingFeed: result.pendingFeed || null,
    nextEligibleAt: "",
    reason: "",
    reasonKey: "",
    ...imageMetrics,
  });
  const committed = await cacheMutations.run(async (isCurrent) => {
    if (!isCurrent()) return null;
    const [latestFeed, latestQuality] = await Promise.all([
      getRecord("feed", previousFeed),
      getRecord("source-quality", previousQuality),
    ]);
    const retained = filterFeedItemsBySources(
      (latestFeed.items || []).filter((item) => item.sourceKey !== sourceKey),
      permissions.permitted,
      permissions.grantedOrigins,
    );
    const sourceItems = result.outcome === "notModified"
      ? filterFeedItemsBySources(
        (latestFeed.items || []).filter((item) => item.sourceKey === sourceKey),
        permissions.permitted,
        permissions.grantedOrigins,
      )
      : newItems.map((item) => preserveCardAiSummary(
        { ...item, externalDiscovery: source.externalDiscovery === true },
        previousItems.find((entry) => (entry.articleId || entry.entryKey) === (item.articleId || item.entryKey)),
        settings,
      ));
    const aiReady = await aiConfigured(settings);
    const items = rankAndDedupe([...sourceItems, ...retained], settings.hotNewsCacheSize, {
      feedback,
      personalizedRankingEnabled: settings.personalizedRankingEnabled !== false,
      aiRankingEnabled: aiReady,
      now: Date.now(),
    });
    const qualitySummary = summarizeQuality({
      ...(latestQuality.records || {}),
      [sourceKey]: nextRecord,
    }, permissions.denied, permissions.sources);
    const locale = settingsLocale(settings);
    const candidates = buildDailyCandidates(items, {
      limit: 12,
      recentLimit: 3,
      publisherLimit: settings.todayNewsPerPublisherLimit,
      aiRankingEnabled: aiReady,
    });
    const feed = {
      ...latestFeed,
      schemaVersion: 2,
      generatedAt: checkedAt,
      items,
      localCount: items.filter((item) => !item.externalDiscovery).length,
      publicCount: items.filter((item) => item.externalDiscovery).length,
      deniedOrigins: originsFromUrls(permissions.denied.map((entry) => entry.url)),
    };
    await setRecords([
      { key: "feed", value: feed, kind: "cache" },
      { key: "source-quality", value: qualitySummary, kind: "cache" },
      {
        key: "daily-digest",
        value: withFeedCacheMetadata(buildFallbackDigest(candidates, "local", locale, {
          preselected: true,
          publisherLimit: settings.todayNewsPerPublisherLimit,
        }), candidates, "daily-digest"),
        kind: "cache",
      },
    ]);
    return { feed, sourceQuality: qualitySummary };
  }, cacheEpoch);
  if (!committed) throw typedError("SOURCE_REFRESH_STALE", "background.error.sourcePermission", {}, false);
  broadcast("dashboard.updated", { reason: "single-source-refresh" });
  broadcast("settings.changed", { sourceQualityChanged: true });
  return { ok: true, itemCount, outcome: result.outcome, sourceQuality: committed.sourceQuality };
}

function nextEligibleAtForError(error) {
  const status = Number(error?.details?.status);
  if (![429, 503].includes(status)) return "";
  const raw = String(error?.details?.retryAfter || "").trim();
  const seconds = Number(raw);
  const parsed = Number.isFinite(seconds) ? Date.now() + seconds * 1000 : Date.parse(raw);
  const delay = Number.isFinite(parsed) ? parsed - Date.now() : 15 * 60 * 1000;
  const bounded = Math.max(15 * 60 * 1000, Math.min(6 * 60 * 60 * 1000, delay));
  return new Date(Date.now() + bounded).toISOString();
}

async function runAutomaticAiAfterRefresh({ settings, items, needsDigest, aiReady, cacheEpoch, generation }) {
  const previous = await getAiAutoStatus();
  const quota = await readQuota(settings.dailyAiLimit);
  const remainingQuota = Math.max(0, settings.dailyAiLimit - quota.used);
  const availableCards = settings.cardSummaryEnabled
    ? items.filter((item) => !isCurrentCardSummary(item) && String(item.excerpt || "").trim()).length
    : 0;
  const digestEligible = needsDigest && remainingQuota > 0;
  const cardEligible = Math.min(availableCards, Math.max(0, remainingQuota - Number(digestEligible)));
  const total = Number(digestEligible) + cardEligible;
  const hasPendingWork = needsDigest || availableCards > 0;
  const startedAt = new Date().toISOString();
  const base = {
    processed: 0,
    total,
    eligible: cardEligible,
    startedAt,
    lastRunAt: previous.lastRunAt || "",
    errorKey: "",
    errorParams: {},
    errorStage: "",
  };
  if (!aiReady) {
    await setAiAutoStatus({ ...base, phase: "not-ready", running: false, lastRunAt: startedAt });
    return { items, errorKey: "" };
  }
  if (!remainingQuota && hasPendingWork) {
    await setAiAutoStatus({ ...base, phase: "quota", running: false, lastRunAt: startedAt });
    return { items, errorKey: "" };
  }
  if (!total) {
    await setAiAutoStatus({ ...base, phase: "no-candidates", running: false, lastRunAt: startedAt });
    return { items, errorKey: "" };
  }

  let processed = 0;
  let phase = digestEligible ? "running-digest" : "running-cards";
  let errorKey = "";
  let errorParams = {};
  let errorStage = "";
  await setAiAutoStatus({ ...base, phase, running: true });

  if (digestEligible && refreshCoordinator.isCurrent(generation)) {
    const digest = await refreshDailyDigest({ automatic: true });
    if (digest.status === "ai") processed += 1;
    else if (digest.status === "quota-or-empty") phase = "quota";
    else {
      errorKey = digest.errorKey || "background.error.aiNetwork";
      errorParams = digest.errorParams || {};
      errorStage = "digest";
    }
  }

  if (phase !== "quota" && cardEligible && refreshCoordinator.isCurrent(generation)) {
    phase = "running-cards";
    await setAiAutoStatus({ ...base, phase, running: true, processed });
    const automatic = await automaticallySummarizeCards(settings, items, cacheEpoch, generation, cardEligible, async (cardProcessed) => {
      await setAiAutoStatus({ ...base, phase, running: true, processed: processed + cardProcessed });
    });
    items = automatic.items;
    processed += automatic.processed;
    if (automatic.quotaReached) phase = "quota";
    if (automatic.errorKey) {
      if (!errorKey) {
        errorKey = automatic.errorKey;
        errorParams = automatic.errorParams || {};
        errorStage = "cards";
      }
    }
  }

  if (errorKey) phase = "error";
  else if (phase !== "quota") phase = "completed";
  await setAiAutoStatus({
    ...base,
    phase,
    running: false,
    processed,
    lastRunAt: new Date().toISOString(),
    errorKey,
    errorParams,
    errorStage,
  });
  return { items, errorKey, errorParams, errorStage };
}

async function runAutomaticAiFromCache({ settings, feedPermissions, cacheEpoch, generation }) {
  const [feed, digest, aiReady] = await Promise.all([
    getRecord("feed", { items: [] }),
    getRecord("daily-digest", null),
    aiConfigured(settings),
  ]);
  if (!refreshCoordinator.isCurrent(generation)) return null;
  const items = filterFeedItemsBySources(feed.items, feedPermissions.permitted, feedPermissions.grantedOrigins);
  const needsDigest = Boolean(items.length && aiReady && (
    digest?.status !== "ai"
    || !digestCachePermitted(digest, items, feedPermissions, settings, aiReady)
  ));
  return runAutomaticAiAfterRefresh({
    settings,
    items,
    needsDigest,
    aiReady,
    cacheEpoch,
    generation,
  });
}

async function automaticallySummarizeCards(settings, items, cacheEpoch, generation, candidateLimit, onProgress = null) {
  if (!await aiConfigured(settings)) return { items, errorKey: "", errorParams: {}, processed: 0, eligible: 0, quotaReached: false };
  const locale = settingsLocale(settings);
  let currentItems = items;
  let errorKey = "";
  let errorParams = {};
  let processed = 0;
  let quotaReached = false;
  const candidates = items.filter((item) => (
    !isCurrentCardSummary(item)
    && String(item.excerpt || "").trim()
  )).slice(0, candidateLimit);

  for (const candidate of candidates) {
    if (!cacheMutations.isCurrent(cacheEpoch) || !refreshCoordinator.isCurrent(generation)) break;
    let result;
    try {
      const context = await automaticCardSummaryContext(candidate);
      result = await runAiWithinQuota(settings, () => callProvider(
        settings,
        translate(locale, "background.prompt.cardSummary"),
        translate(locale, "background.prompt.webInput", {
          url: candidate.url,
          title: candidate.title,
          text: context.text,
        }),
        AI_ARTICLE_SUMMARY_MAX_TOKENS,
        "",
        async () => {
          const validation = await assertFeedItemsStillPermitted([candidate]);
          return { ...validation, origins: uniqueStrings([...validation.origins, ...context.origins]) };
        },
      ));
    } catch (error) {
      errorKey = error?.messageKey || "background.error.aiNetwork";
      errorParams = error?.messageParams || {};
      break;
    }
    if (!result.usedAi) {
      quotaReached = true;
      break;
    }
    const organized = generatedCardSummary(result.value);
    if (!organized.title || !organized.summary.length) {
      errorKey = "background.error.aiNoText";
      break;
    }
    const summarizedAt = new Date().toISOString();
    const providerOrigin = safeOrigin(settings.openaiBaseUrl);
    const committedItem = await cacheMutations.run(async (isCurrent) => {
      if (!isCurrent() || !refreshCoordinator.isCurrent(generation)) return null;
      const latestSettings = await getSettings();
      if (!latestSettings.cardSummaryEnabled || !await aiConfigured(latestSettings)) return null;
      if (safeOrigin(latestSettings.openaiBaseUrl) !== providerOrigin) return null;
      const latestModel = latestSettings.bookmarkConsentGranted ? await currentBookmarkModel(latestSettings) : emptyBookmarkModel();
      const latestPermissions = await currentFeedPermissionState(latestSettings, latestModel);
      if (latestPermissions.permittedByKey.get(String(candidate.sourceKey || "")) !== originPattern(candidate.sourceOrigin || "")) return null;
      const feed = feedCacheOrEmpty(await getRecord("feed", null));
      let updatedItem = null;
      const updatedItems = feed.items.map((item) => {
        if ((item.articleId || item.entryKey) !== (candidate.articleId || candidate.entryKey) || item.url !== candidate.url) return item;
        if (isCurrentCardSummary(item)) return item;
        updatedItem = { ...item, summaryTitle: organized.title, summary: organized.summary, summaryStatus: "ai", summaryPolicyVersion: cardSummaryPolicyVersion, summarizedAt, summaryProviderOrigin: providerOrigin };
        return updatedItem;
      });
      if (!updatedItem || !isCurrent()) return null;
      await setRecord("feed", { ...feed, items: updatedItems }, "cache");
      return updatedItem;
    }, cacheEpoch);
    if (!committedItem) break;
    currentItems = currentItems.map((item) => item.url === committedItem.url ? committedItem : item);
    processed += 1;
    if (typeof onProgress === "function") await onProgress(processed);
  }
  return { items: currentItems, errorKey, errorParams, processed, eligible: candidates.length, quotaReached };
}

function automaticCardSummaryContext(candidate) {
  return {
    text: String(candidate.excerpt || "").trim().slice(0, CARD_SUMMARY_EXCERPT_MAX_CHARS),
    origins: [],
  };
}

function preserveCardAiSummary(item, previous, settings) {
  if (!isCurrentCardSummary(previous) || !previous.summaryTitle || !Array.isArray(previous.summary) || !previous.summary.length) return item;
  if (originPattern(previous.summaryProviderOrigin || "") !== originPattern(settings.openaiBaseUrl)) return item;
  return {
    ...item,
    summaryTitle: previous.summaryTitle,
    summary: previous.summary,
    summaryStatus: "ai",
    summaryPolicyVersion: cardSummaryPolicyVersion,
    summarizedAt: previous.summarizedAt || "",
    summaryProviderOrigin: previous.summaryProviderOrigin,
  };
}

function sanitizeCardAiSummaries(items, settings, configuredForAi) {
  return (items || []).map((item) => {
    if (item.summaryStatus !== "ai") return item;
    if (configuredForAi && originPattern(item.summaryProviderOrigin || "") === originPattern(settings.openaiBaseUrl)) return item;
    const { summarizedAt, summaryPolicyVersion, summaryProviderOrigin, summaryTitle, ...rest } = item;
    const excerpt = String(item.excerpt || "").trim();
    return { ...rest, summary: excerpt ? [excerpt] : [], summaryStatus: excerpt ? "excerpt" : "raw" };
  });
}

async function refreshDailyDigest({ automatic = false } = {}) {
  const cacheEpoch = cacheMutations.capture();
  const settings = await getSettings();
  const locale = settingsLocale(settings);
  const model = settings.bookmarkConsentGranted ? await currentBookmarkModel(settings) : emptyBookmarkModel();
  const feed = feedCacheOrEmpty(await getRecord("feed", null));
  const feedPermissions = await currentFeedPermissionState(settings, model);
  const permittedItems = filterFeedItemsBySources(feed.items, feedPermissions.permitted, feedPermissions.grantedOrigins);
  const configuredForAi = await aiConfigured(settings);
  const contextItems = buildDailyCandidates(permittedItems, {
    limit: 12,
    recentLimit: 3,
    publisherLimit: settings.todayNewsPerPublisherLimit,
    aiRankingEnabled: configuredForAi,
  });
  let digest = withFeedCacheMetadata(buildFallbackDigest(contextItems, "local", locale, {
    preselected: true,
    publisherLimit: settings.todayNewsPerPublisherLimit,
  }), contextItems, "daily-digest");
  if (contextItems.length && cacheMutations.isCurrent(cacheEpoch) && configuredForAi) {
    const eventItems = new Map();
    for (const item of permittedItems) {
      const eventId = String(item.eventId || "");
      if (!eventId) continue;
      if (!eventItems.has(eventId)) eventItems.set(eventId, []);
      eventItems.get(eventId).push(item);
    }
    const context = contextItems.map((item, index) => {
      const related = (eventItems.get(String(item.eventId || "")) || [item]).slice(0, 3);
      const publishers = [...new Set(related.map((entry) => entry.publisher || entry.source).filter(Boolean))].join(", ");
      const evidence = related.map((entry) => {
        const detail = dailyDigestEvidence(entry.title, entry.excerpt);
        return `${entry.title}${detail ? ` — ${detail}` : " — [no detail beyond headline]"}`;
      }).join(" / ");
      return `${index + 1}. time=${item.publishedAt || "unverified"}｜publishers=${publishers}｜sources=${Number(item.eventSourceCount || 1)}｜evidence=${evidence}`;
    }).join("\n");
    try {
      const operation = () => callProvider(
        settings,
        translate(locale, "background.prompt.dailyDigest"),
        context,
        AI_DIGEST_MAX_TOKENS,
        "",
        () => assertFeedItemsStillPermitted(contextItems),
        { preferVisibleOutput: true },
      );
      const result = automatic
        ? await runAiWithinQuota(settings, operation)
        : { usedAi: true, value: await operation() };
      if (result.usedAi) {
        const organized = parseGeneratedDailyDigest(result.value, digest.items.length);
        const rankedItems = digest.items.map((item, index) => {
          const aiTitle = organized.eventTitles[index] || "";
          const aiImportanceScore = organized.rankingValid ? organized.aiScores[index] : null;
          return {
            ...item,
            ...(aiTitle ? { originalTitle: item.title, title: aiTitle, aiTitle } : {}),
            ...(Number.isFinite(aiImportanceScore) ? { aiImportanceScore } : {}),
            importanceScore: Number.isFinite(aiImportanceScore)
              ? aiImportanceScore
              : Number(item.localImportanceScore || item.importanceScore || 0),
          };
        }).sort((left, right) => Number(right.importanceScore || 0) - Number(left.importanceScore || 0)
          || Number(right.localImportanceScore || 0) - Number(left.localImportanceScore || 0));
        digest = withFeedCacheMetadata({
          ...digest,
          locale,
          status: "ai",
          overview: organized.overview,
          items: rankedItems,
          aiRankingApplied: organized.rankingValid,
          candidateFingerprint: dailyCandidateFingerprint(contextItems, {
            policyVersion: rankingPolicyVersion,
            publisherLimit: settings.todayNewsPerPublisherLimit,
          }),
        }, contextItems, "daily-digest", settings.openaiBaseUrl);
      } else {
        digest = { ...digest, status: "quota-or-empty" };
      }
    } catch (error) {
      const errorKey = error?.messageKey || "background.error.aiNetwork";
      digest = {
        ...digest,
        status: "fallback",
        error: translate(locale, errorKey, error?.messageParams || {}),
        errorKey,
        errorParams: error?.messageParams || {},
      };
    }
  }
  const sanitized = await sanitizeDailyDigest(digest);
  digest = sanitized.digest;
  const committed = await cacheMutations.run(async (isCurrent) => {
    if (!isCurrent() || !isPermissionEpochCurrent(sanitized.permissionEpoch)) return null;
    await setRecord("daily-digest", digest, "cache");
    return digest;
  }, sanitized.cacheEpoch);
  if (committed
    && cacheMutations.isCurrent(sanitized.cacheEpoch)
    && isPermissionEpochCurrent(sanitized.permissionEpoch)) {
    broadcast("dashboard.updated", { reason: "digest" });
  }
  return (await sanitizeDailyDigest(committed || digest)).digest;
}

async function refreshSingleSummary(body) {
  const cacheEpoch = cacheMutations.capture();
  const settings = await getSettings();
  const locale = settingsLocale(settings);
  if (!settings.bookmarkConsentGranted) return resultMessage(settings, false, "background.error.sourceNotFound");
  const model = await currentBookmarkModel(settings);
  const feed = feedCacheOrEmpty(await getRecord("feed", null));
  const target = feed.items.find((item) => (
    String(item.sourceKey || "") === String(body.sourceKey || "")
    && (String(item.articleId || item.entryKey || "") === String(body.articleId || "") || item.url === body.url)
  ));
  const permissions = await currentFeedPermissionState(settings, model);
  const permittedSourceOrigin = target ? permissions.permittedByKey.get(String(target.sourceKey || "")) : "";
  if (!target || !permittedSourceOrigin || permittedSourceOrigin !== originPattern(target.sourceOrigin || "")) {
    return resultMessage(settings, false, "background.error.sourceNotFound");
  }
  const excerptText = String(target.excerpt || "").trim().slice(0, CARD_SUMMARY_EXCERPT_MAX_CHARS);
  if (!excerptText) throw typedError("SUMMARY_CONTENT_MISSING", "summary.status.noContent", {}, false);
  const summaryText = await callProvider(
    settings,
    translate(locale, "background.prompt.cardSummary"),
    translate(locale, "background.prompt.webInput", {
      url: target.url,
      title: target.title,
      text: excerptText,
    }),
    AI_ARTICLE_SUMMARY_MAX_TOKENS,
    "",
    () => assertFeedItemsStillPermitted([target]),
  );
  const organized = generatedCardSummary(summaryText);
  if (!organized.title || !organized.summary.length) throw typedError("AI_EMPTY_RESPONSE", "background.error.aiNoText", {}, true);
  const committed = await cacheMutations.run(async (isCurrent) => {
    if (!isCurrent()) return null;
    const latestSettings = await getSettings();
    if (!latestSettings.bookmarkConsentGranted) return null;
    const latestModel = await currentBookmarkModel(latestSettings);
    const latestPermissions = await currentFeedPermissionState(latestSettings, latestModel);
    if (!isCurrent() || latestPermissions.permittedByKey.get(String(target.sourceKey || "")) !== permittedSourceOrigin) return null;
    const previous = await getRecord("feed", { items: [] });
    const permittedPrevious = filterFeedItemsBySources(previous.items || [], latestPermissions.permitted, latestPermissions.grantedOrigins);
    const items = permittedPrevious.map((item) => (
      item.sourceKey === target.sourceKey
      && (item.articleId || item.entryKey) === (target.articleId || target.entryKey)
      && item.url === target.url
        ? {
          ...item,
          summaryTitle: organized.title,
          summary: organized.summary,
          summaryStatus: "ai",
          summaryPolicyVersion: cardSummaryPolicyVersion,
          summarizedAt: new Date().toISOString(),
          summaryProviderOrigin: safeOrigin(settings.openaiBaseUrl),
        }
        : item
    ));
    if (!items.some((item) => item.summaryStatus === "ai" && item.url === target.url)) return null;
    const feed = {
      ...previous,
      generatedAt: new Date().toISOString(),
      items,
      localCount: items.filter((item) => !item.externalDiscovery).length,
      publicCount: items.filter((item) => item.externalDiscovery).length,
      deniedOrigins: originsFromUrls(latestPermissions.denied.map((item) => item.url)),
    };
    if (!isCurrent()) return null;
    await setRecords([
      { key: "feed", value: feed, kind: "cache" },
      {
        key: "daily-digest",
        value: (() => {
          const candidates = buildDailyCandidates(items, {
            limit: 12,
            recentLimit: 3,
            publisherLimit: latestSettings.todayNewsPerPublisherLimit,
            aiRankingEnabled: true,
          });
          return withFeedCacheMetadata(buildFallbackDigest(candidates, "local", locale, {
            preselected: true,
            publisherLimit: latestSettings.todayNewsPerPublisherLimit,
          }), candidates, "daily-digest");
        })(),
        kind: "cache",
      },
    ]);
    return true;
  }, cacheEpoch);
  if (!committed || !cacheMutations.isCurrent(cacheEpoch)) return resultMessage(settings, false, "background.error.sourcePermission");
  broadcast("dashboard.updated", { reason: "single-source" });
  const quota = await readQuota(settings.dailyAiLimit);
  return { ok: true, locale, item: target, quota: { usedToday: quota.used, dailyLimit: settings.dailyAiLimit } };
}

function generatedCardSummary(value) {
  const text = String(value || "").trim();
  if (!text) return { title: "", summary: [] };
  const rawLines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const title = rawLines.map((line) => extractGeneratedSummaryTitle(line)).find(Boolean) || "";
  const lines = rawLines.map(cleanGeneratedSummaryLine).filter(Boolean);
  const summaryLines = lines.length > 1
    ? lines.slice(0, 3)
    : (lines[0]?.match(/[^。！？.!?]+[。！？.!?]?/g) || lines).map((line) => line.trim()).filter(Boolean).slice(0, 3);
  return { title, summary: limitGeneratedSummaryLines(summaryLines, CARD_SUMMARY_MAX_CHARS, 3) };
}

function isCurrentCardSummary(item) {
  return item?.summaryStatus === "ai" && item?.summaryPolicyVersion === cardSummaryPolicyVersion;
}
}
