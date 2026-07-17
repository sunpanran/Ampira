import { createCardSummaryPolicy } from "./card-summary-policy.mjs";
import { createFeedImageService, feedImageCacheFresh, selectFeedImageEnrichmentTargets } from "./feed-image-service.mjs";
import { aiOutputPartsMatchLocale } from "../core/ai-output-language.mjs";
import { localizedSummaryMatchesLocale } from "../core/feed-language-policy.mjs";
import {
  selectDistinctEventEvidence,
  shouldRetainPreviousItemsAfterEmpty,
  sourceFetchProfile,
  sourceStatusForFetch,
} from "./refresh-policy.mjs";

export { feedImageCacheFresh, selectFeedImageEnrichmentTargets };
export {
  selectDistinctEventEvidence,
  shouldRetainPreviousItemsAfterEmpty,
  sourceFetchProfile,
  sourceStatusForFetch,
} from "./refresh-policy.mjs";

const AI_DIGEST_MAX_TOKENS = 2400;
const AI_ARTICLE_SUMMARY_MAX_TOKENS = 1200;

export function createRefreshService(options) {
  const {
    refreshCoordinator, getSettings, currentBookmarkModel, emptyBookmarkModel, currentFeedPermissionState,
    configuredFeedSources, selectRefreshBatch, getRecord, setRecord, setRecords,
    setRefreshStatus, pipelineStages, broadcast, fetchSourceArticles, sourceFetchOptions,
    mapWithConcurrency, summarizeQuality, retainActiveUnrefreshedItems, rankAndDedupe,
    assertFeedItemsStillPermitted, withFeedCacheMetadata, cacheMutations, aiConfigured,
    getAiAutoStatus, setAiAutoStatus, defaultAiAutoStatus, readQuota, runAiWithinQuota,
    callProvider, translate, translateAiPrompt, settingsLocale, parseGeneratedDailyDigest, dailyDigestEvidence, buildFallbackDigest,
    digestCachePermitted, filterFeedItemsBySources, presentableFeedItems = (items) => items,
    resultMessage, errorResult,
    emptySourceQuality, localDateKey, uniqueStrings, safeOrigin, originPattern,
    sanitizeDailyDigest, typedError, feedCacheOrEmpty, getRefreshStatus, hostOf,
    originsFromUrls, isPermissionEpochCurrent, buildDailyCandidates,
    dailyCandidateFingerprint, updateSourceQualityRecord,
  } = options;
  const cardSummaryPolicy = options.cardSummaryPolicy || createCardSummaryPolicy({
    settingsLocale,
    originPattern,
  });
  const {
    automaticCardSummaryContext,
    generatedCardSummary,
    isCurrentCardSummary,
    preserveCardAiSummary,
    sanitizeCardAiSummaries,
  } = cardSummaryPolicy;
  const cardSummaryOutputMatchesLocale = (value, locale) => {
    const organized = generatedCardSummary(value);
    const parts = [organized.title, ...organized.summary].filter(Boolean);
    return aiOutputPartsMatchLocale(parts.length ? parts : [value], locale);
  };
  const dailyDigestOutputMatchesLocale = (value, itemCount, locale) => {
    const organized = parseGeneratedDailyDigest(value, itemCount);
    const parts = [...organized.overview, ...organized.eventTitles.filter(Boolean)];
    return aiOutputPartsMatchLocale(parts.length ? parts : [value], locale);
  };
  const {
    enrichMissingFeedImages,
    updateImageQualityMetrics,
    imageQualityMetrics,
  } = options.feedImageService || createFeedImageService({
    fetchSourceImageCandidates: options.fetchSourceImageCandidates,
    hasOriginPermission: options.hasOriginPermission,
    mapWithConcurrency,
    cacheMutations,
    getRecord,
    setRecord,
    hashText: options.hashText,
    refreshCoordinator,
  });
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
      const automaticFallback = await runAutomaticAiAfterFailedRefresh(generation);
      if (!refreshCoordinator.isCurrent(generation)) return;
      if (automaticFallback) broadcast("dashboard.updated", { reason: "refresh-failed-ai-fallback" });
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

async function performRefresh(generation) {
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
  const refreshBatch = selectRefreshBatch(permitted, refreshCursor, undefined, {
    priority: (source) => source?.externalDiscovery === true,
  });
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
  const [rawPreviousFeedSnapshot, previousQualitySnapshot] = await Promise.all([
    getRecord("feed", { items: [] }),
    getRecord("source-quality", emptySourceQuality()),
  ]);
  const previousFeedSnapshot = feedCacheOrEmpty(rawPreviousFeedSnapshot);
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
        profile: sourceFetchProfile(previousRecord, previousItems),
      });
      const items = result.items || [];
      const retainPreviousAfterEmpty = shouldRetainPreviousItemsAfterEmpty(result, previousItems, previousRecord);
      if (result.outcome !== "notModified" && !retainPreviousAfterEmpty) replacedSources.push(source);
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
        resolvedUrl: result.outcome === "empty"
          ? (retainPreviousAfterEmpty ? previousRecord.resolvedUrl || "" : "")
          : result.resolvedUrl || previousRecord.resolvedUrl || "",
        fetchOrigin: result.outcome === "empty"
          ? (retainPreviousAfterEmpty ? previousRecord.fetchOrigin || safeOrigin(source.url) : "")
          : result.fetchOrigin || previousRecord.fetchOrigin || safeOrigin(source.url),
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
    const previousFeed = feedCacheOrEmpty(previous);
    const retained = filterFeedItemsBySources(
      retainActiveUnrefreshedItems(previousFeed.items, permitted, replacedSources),
      permitted,
      feedPermissions.grantedOrigins,
    );
    const previousByArticle = new Map(previousFeed.items.map((item) => [item.articleId || item.entryKey || item.url, item]));
    const refreshed = articles.map((item) => preserveCardAiSummary(item, previousByArticle.get(item.articleId || item.entryKey || item.url), settings));
    const items = rankAndDedupe([...refreshed, ...retained], settings.hotNewsCacheSize, {
      feedback,
      personalizedRankingEnabled: settings.personalizedRankingEnabled !== false,
      aiRankingEnabled: aiReadyForRefresh,
      now: Date.now(),
    });
    const visibleItems = presentableFeedItems(items, settings, aiReadyForRefresh);
    const feed = {
      generatedAt: new Date().toISOString(),
      items,
      localCount: visibleItems.filter((item) => !item.externalDiscovery).length,
      publicCount: visibleItems.filter((item) => item.externalDiscovery).length,
      deniedOrigins: originsFromUrls(denied.map((source) => source.url)),
    };
    const unrefreshedPermittedKeys = new Set(permitted.filter((source) => !refreshSources.includes(source)).map((source) => source.key));
    const retainedQuality = Object.fromEntries(Object.entries(previousQuality.records || {}).filter(([key, record]) => (
      unrefreshedPermittedKeys.has(key)
      && originPattern(record?.sourceOrigin || "") === feedPermissions.permittedByKey.get(key)
    )));
    const qualitySummary = summarizeQuality({ ...retainedQuality, ...quality }, denied, feedPermissions.sources);
    const digestCandidates = buildDailyCandidates(visibleItems, {
      limit: 12,
      recentLimit: 3,
      publisherLimit: settings.todayNewsPerPublisherLimit,
      aiRankingEnabled: aiReadyForRefresh,
    });
    const preservedDigest = previousDigest?.locale === locale
      && previousDigest?.date === localDateKey()
      && digestCachePermitted(previousDigest, visibleItems, feedPermissions, settings, aiReadyForRefresh)
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
    return { items, needsDigest: Boolean(visibleItems.length && aiReadyForRefresh && preservedDigest.status !== "ai") };
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

async function runAutomaticAiAfterFailedRefresh(generation) {
  try {
    const settings = await getSettings();
    if (!settings.bookmarkConsentGranted || !refreshCoordinator.isCurrent(generation)) return null;
    const model = await currentBookmarkModel(settings);
    const feedPermissions = await currentFeedPermissionState(settings, model);
    const cacheEpoch = cacheMutations.capture();
    const [feed, digest, aiReady] = await Promise.all([
      getRecord("feed", { items: [] }),
      getRecord("daily-digest", null),
      aiConfigured(settings),
    ]);
    if (!refreshCoordinator.isCurrent(generation)) return null;
    const rawFeed = feedCacheOrEmpty(feed);
    const permittedItems = filterFeedItemsBySources(rawFeed.items, feedPermissions.permitted, feedPermissions.grantedOrigins);
    const items = presentableFeedItems(permittedItems, settings, aiReady);
    if (!permittedItems.length) return null;
    const needsDigest = Boolean(aiReady && (
      digest?.status !== "ai"
      || !digestCachePermitted(digest, items, feedPermissions, settings, aiReady)
    ));
    return await runAutomaticAiAfterRefresh({
      settings,
      items: permittedItems,
      needsDigest,
      aiReady,
      cacheEpoch,
      generation,
    });
  } catch {
    return null;
  }
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
  const normalizedPreviousFeed = feedCacheOrEmpty(previousFeed);
  const previousRecord = previousQuality.records?.[sourceKey] || {};
  const previousItems = normalizedPreviousFeed.items.filter((item) => item.sourceKey === sourceKey);
  let result;
  try {
    result = await fetchSourceArticles(source, {
      ...sourceFetchOptions(settings.hotNewsEntriesPerSource),
      profile: sourceFetchProfile(previousRecord, previousItems),
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
  const retainPreviousAfterEmpty = shouldRetainPreviousItemsAfterEmpty(result, previousItems, previousRecord);
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
    resolvedUrl: result.outcome === "empty"
      ? (retainPreviousAfterEmpty ? previousRecord.resolvedUrl || "" : "")
      : result.resolvedUrl || previousRecord.resolvedUrl || "",
    fetchOrigin: result.outcome === "empty"
      ? (retainPreviousAfterEmpty ? previousRecord.fetchOrigin || safeOrigin(source.url) : "")
      : result.fetchOrigin || previousRecord.fetchOrigin || safeOrigin(source.url),
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
      getRecord("feed", normalizedPreviousFeed),
      getRecord("source-quality", previousQuality),
    ]);
    const normalizedLatestFeed = feedCacheOrEmpty(latestFeed);
    const retained = filterFeedItemsBySources(
      normalizedLatestFeed.items.filter((item) => item.sourceKey !== sourceKey),
      permissions.permitted,
      permissions.grantedOrigins,
    );
    const sourceItems = result.outcome === "notModified" || retainPreviousAfterEmpty
      ? filterFeedItemsBySources(
        normalizedLatestFeed.items.filter((item) => item.sourceKey === sourceKey),
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
    const visibleItems = presentableFeedItems(items, settings, aiReady);
    const qualitySummary = summarizeQuality({
      ...(latestQuality.records || {}),
      [sourceKey]: nextRecord,
    }, permissions.denied, permissions.sources);
    const locale = settingsLocale(settings);
    const candidates = buildDailyCandidates(visibleItems, {
      limit: 12,
      recentLimit: 3,
      publisherLimit: settings.todayNewsPerPublisherLimit,
      aiRankingEnabled: aiReady,
    });
    const feed = {
      ...normalizedLatestFeed,
      generatedAt: checkedAt,
      items,
      localCount: visibleItems.filter((item) => !item.externalDiscovery).length,
      publicCount: visibleItems.filter((item) => item.externalDiscovery).length,
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
  const locale = settingsLocale(settings);
  const remainingQuota = Math.max(0, settings.dailyAiLimit - quota.used);
  const requiredCandidates = automaticSummaryCandidates(items, locale, "required");
  const optionalCandidates = settings.cardSummaryEnabled
    ? automaticSummaryCandidates(items, locale, "optional")
    : [];
  const requiredEligible = Math.min(requiredCandidates.length, remainingQuota);
  const digestEligible = (needsDigest || requiredEligible > 0) && remainingQuota > requiredEligible;
  const optionalEligible = Math.min(
    optionalCandidates.length,
    Math.max(0, remainingQuota - requiredEligible - Number(digestEligible)),
  );
  const total = requiredEligible + Number(digestEligible) + optionalEligible;
  const hasPendingWork = requiredCandidates.length > 0 || needsDigest || optionalCandidates.length > 0;
  const startedAt = new Date().toISOString();
  const base = {
    processed: 0,
    total,
    eligible: requiredEligible + optionalEligible,
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
  let phase = requiredEligible ? "running-cards" : digestEligible ? "running-digest" : "running-cards";
  let errorKey = "";
  let errorParams = {};
  let errorStage = "";
  await setAiAutoStatus({ ...base, phase, running: true });

  if (requiredEligible && refreshCoordinator.isCurrent(generation)) {
    const automatic = await automaticallySummarizeCards(
      settings,
      items,
      cacheEpoch,
      generation,
      requiredEligible,
      async (cardProcessed) => {
        await setAiAutoStatus({ ...base, phase: "running-cards", running: true, processed: processed + cardProcessed });
      },
      { mode: "required" },
    );
    items = automatic.items;
    processed += automatic.processed;
    if (automatic.quotaReached
      || automatic.processed < requiredEligible
      || requiredCandidates.length > automatic.processed) phase = "quota";
    if (automatic.errorKey) {
      errorKey = automatic.errorKey;
      errorParams = automatic.errorParams || {};
      errorStage = "cards";
    }
  }

  const digestRequiredAfterLocalization = needsDigest || processed > 0;
  const remainingAfterRequired = Math.max(0, remainingQuota - processed);
  if (!errorKey
    && phase !== "quota"
    && digestRequiredAfterLocalization
    && remainingAfterRequired > 0
    && refreshCoordinator.isCurrent(generation)) {
    phase = "running-digest";
    await setAiAutoStatus({ ...base, phase, running: true, processed });
    const digest = await refreshDailyDigest({ automatic: true });
    if (digest.status === "ai") processed += 1;
    else if (digest.status === "quota-or-empty") phase = "quota";
    else {
      errorKey = digest.errorKey || "background.error.aiNetwork";
      errorParams = digest.errorParams || {};
      errorStage = "digest";
    }
  }

  const remainingAfterDigest = Math.max(0, remainingQuota - processed);
  const optionalLimit = Math.min(optionalCandidates.length, remainingAfterDigest);
  if ((!errorKey || errorStage === "digest")
    && phase !== "quota"
    && optionalLimit
    && refreshCoordinator.isCurrent(generation)) {
    phase = "running-cards";
    await setAiAutoStatus({ ...base, phase, running: true, processed });
    const automatic = await automaticallySummarizeCards(
      settings,
      items,
      cacheEpoch,
      generation,
      optionalLimit,
      async (cardProcessed) => {
        await setAiAutoStatus({ ...base, phase, running: true, processed: processed + cardProcessed });
      },
      { mode: "optional" },
    );
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

function requiresCrossLanguageLocalization(item, locale) {
  return item?.externalDiscovery === true
    && Boolean(String(item?.contentLocale || "").trim())
    && String(item.contentLocale) !== String(locale);
}

function automaticSummaryCandidates(items, locale, mode) {
  return (Array.isArray(items) ? items : []).filter((item) => {
    if (isCurrentCardSummary(item, locale)) return false;
    const required = requiresCrossLanguageLocalization(item, locale);
    if (mode === "required") return required && Boolean(String(item?.title || item?.excerpt || "").trim());
    return !required && Boolean(String(item?.excerpt || "").trim());
  });
}

async function automaticallySummarizeCards(
  settings,
  items,
  cacheEpoch,
  generation,
  candidateLimit,
  onProgress = null,
  { mode = "optional" } = {},
) {
  if (!await aiConfigured(settings)) return { items, errorKey: "", errorParams: {}, processed: 0, eligible: 0, quotaReached: false };
  const locale = settingsLocale(settings);
  let currentItems = items;
  let errorKey = "";
  let errorParams = {};
  let processed = 0;
  let quotaReached = false;
  const candidates = automaticSummaryCandidates(items, locale, mode).slice(0, candidateLimit);

  for (const candidate of candidates) {
    if (!cacheMutations.isCurrent(cacheEpoch) || !refreshCoordinator.isCurrent(generation)) break;
    let result;
    try {
      const context = await automaticCardSummaryContext(candidate);
      result = await runAiWithinQuota(settings, () => callProvider(
        settings,
        translateAiPrompt(locale, "background.prompt.cardSummary"),
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
        {
          expectedLocale: locale,
          outputValidator: (value) => cardSummaryOutputMatchesLocale(value, locale),
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
    if (!localizedSummaryMatchesLocale(organized.title, organized.summary, locale)) {
      errorKey = "background.error.aiWrongLanguage";
      break;
    }
    const summarizedAt = new Date().toISOString();
    const providerOrigin = safeOrigin(settings.openaiBaseUrl);
    const committedItem = await cacheMutations.run(async (isCurrent) => {
      if (!isCurrent() || !refreshCoordinator.isCurrent(generation)) return null;
      const latestSettings = await getSettings();
      if ((mode !== "required" && !latestSettings.cardSummaryEnabled) || !await aiConfigured(latestSettings)) return null;
      if (settingsLocale(latestSettings) !== locale) return null;
      if (safeOrigin(latestSettings.openaiBaseUrl) !== providerOrigin) return null;
      const latestModel = latestSettings.bookmarkConsentGranted ? await currentBookmarkModel(latestSettings) : emptyBookmarkModel();
      const latestPermissions = await currentFeedPermissionState(latestSettings, latestModel);
      if (latestPermissions.permittedByKey.get(String(candidate.sourceKey || "")) !== originPattern(candidate.sourceOrigin || "")) return null;
      const feed = feedCacheOrEmpty(await getRecord("feed", null));
      let updatedItem = null;
      const updatedItems = feed.items.map((item) => {
        if ((item.articleId || item.entryKey) !== (candidate.articleId || candidate.entryKey) || item.url !== candidate.url) return item;
        if (isCurrentCardSummary(item, locale)) return item;
        updatedItem = { ...item, summaryTitle: organized.title, summary: organized.summary, summaryStatus: "ai", summaryLocale: locale, summarizedAt, summaryProviderOrigin: providerOrigin };
        return updatedItem;
      });
      if (!updatedItem || !isCurrent()) return null;
      const visibleItems = presentableFeedItems(updatedItems, latestSettings, true);
      await setRecord("feed", {
        ...feed,
        items: updatedItems,
        localCount: visibleItems.filter((item) => !item.externalDiscovery).length,
        publicCount: visibleItems.filter((item) => item.externalDiscovery).length,
      }, "cache");
      return updatedItem;
    }, cacheEpoch);
    if (!committedItem) break;
    currentItems = currentItems.map((item) => item.url === committedItem.url ? committedItem : item);
    processed += 1;
    if (typeof onProgress === "function") await onProgress(processed);
  }
  return { items: currentItems, errorKey, errorParams, processed, eligible: candidates.length, quotaReached };
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
  const visibleItems = presentableFeedItems(permittedItems, settings, configuredForAi);
  const contextItems = buildDailyCandidates(visibleItems, {
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
    for (const item of visibleItems) {
      const eventId = String(item.eventId || "");
      if (!eventId) continue;
      if (!eventItems.has(eventId)) eventItems.set(eventId, []);
      eventItems.get(eventId).push(item);
    }
    const context = contextItems.map((item, index) => {
      const related = selectDistinctEventEvidence(eventItems.get(String(item.eventId || "")) || [item], 3);
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
        translateAiPrompt(locale, "background.prompt.dailyDigest"),
        context,
        AI_DIGEST_MAX_TOKENS,
        "",
        () => assertFeedItemsStillPermitted(contextItems),
        {
          preferVisibleOutput: true,
          expectedLocale: locale,
          outputValidator: (value) => dailyDigestOutputMatchesLocale(value, digest.items.length, locale),
        },
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
  const excerptText = automaticCardSummaryContext(target).text;
  if (!excerptText) throw typedError("SUMMARY_CONTENT_MISSING", "summary.status.noContent", {}, false);
  const summaryText = await callProvider(
    settings,
    translateAiPrompt(locale, "background.prompt.cardSummary"),
    translate(locale, "background.prompt.webInput", {
      url: target.url,
      title: target.title,
      text: excerptText,
    }),
    AI_ARTICLE_SUMMARY_MAX_TOKENS,
    "",
    () => assertFeedItemsStillPermitted([target]),
    {
      expectedLocale: locale,
      outputValidator: (value) => cardSummaryOutputMatchesLocale(value, locale),
    },
  );
  const organized = generatedCardSummary(summaryText);
  if (!organized.title || !organized.summary.length) throw typedError("AI_EMPTY_RESPONSE", "background.error.aiNoText", {}, true);
  if (!localizedSummaryMatchesLocale(organized.title, organized.summary, locale)) {
    throw typedError("AI_WRONG_LANGUAGE", "background.error.aiWrongLanguage", {}, true);
  }
  const committed = await cacheMutations.run(async (isCurrent) => {
    if (!isCurrent()) return null;
    const latestSettings = await getSettings();
    if (!latestSettings.bookmarkConsentGranted) return null;
    const latestModel = await currentBookmarkModel(latestSettings);
    const latestPermissions = await currentFeedPermissionState(latestSettings, latestModel);
    if (!isCurrent() || latestPermissions.permittedByKey.get(String(target.sourceKey || "")) !== permittedSourceOrigin) return null;
    const previous = feedCacheOrEmpty(await getRecord("feed", null));
    if (settingsLocale(latestSettings) !== locale) return null;
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
          summaryLocale: locale,
          summarizedAt: new Date().toISOString(),
          summaryProviderOrigin: safeOrigin(settings.openaiBaseUrl),
        }
        : item
    ));
    if (!items.some((item) => item.summaryStatus === "ai" && item.url === target.url)) return null;
    const visibleItems = presentableFeedItems(items, latestSettings, true);
    const feed = {
      ...previous,
      generatedAt: new Date().toISOString(),
      items,
      localCount: visibleItems.filter((item) => !item.externalDiscovery).length,
      publicCount: visibleItems.filter((item) => item.externalDiscovery).length,
      deniedOrigins: originsFromUrls(latestPermissions.denied.map((item) => item.url)),
    };
    if (!isCurrent()) return null;
    await setRecords([
      { key: "feed", value: feed, kind: "cache" },
      {
        key: "daily-digest",
        value: (() => {
          const candidates = buildDailyCandidates(visibleItems, {
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

}
