import { createCardSummaryPolicy, validateCardSummaryOutput } from "./card-summary-policy.mjs";
import { automaticSummaryCandidates as selectSummaryCandidates, runAutomaticAiWorkflow } from "./automatic-ai-workflow.mjs";
import { cardSummaryContextKey, isAiContentError, nextSummaryRetry, withoutSummaryRetry } from "../core/card-summary-retry.mjs";
import { createFeedImageService, feedImageCacheFresh, selectFeedImageEnrichmentTargets } from "./feed-image-service.mjs";
import { aiOutputPartsMatchLocale } from "../core/ai-output-language.mjs";
import { botGeneratesBrief, botOrganizesNews, isBotMode } from "../core/bot-mode.mjs";
import { createLocalization } from "../core/feed-localization.mjs";
import { translateFeedBatch } from "./feed-translation-batch.mjs";
import { CARD_SUMMARY_WRITING_RULES } from "../core/card-summary-format.mjs";
import { createNewsOrganizationService } from "./news-organization-service.mjs";
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
    selectRefreshBatch, getRecord, setRecord, setRecords,
    setRefreshStatus, pipelineStages, broadcast, fetchSourceArticles, sourceFetchOptions,
    mapWithConcurrency, summarizeQuality, retainActiveUnrefreshedItems, rankAndDedupe,
    assertFeedItemsStillPermitted, withFeedCacheMetadata, cacheMutations, aiConfigured,
    getAiAutoStatus, setAiAutoStatus, defaultAiAutoStatus, readQuota, runAiWithinQuota, runAiBatchWithinQuota,
    callProvider, translate, translateAiPrompt, settingsLocale, parseGeneratedDailyDigest, dailyDigestEvidence, buildFallbackDigest,
    digestCachePermitted, filterFeedItemsBySources, presentableFeedItems = (items) => items,
    resultMessage,
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
  const cardSummaryOutputMatchesLocale = validateCardSummaryOutput;
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
  const organization = createNewsOrganizationService({
    getSettings, getStatus: getAiAutoStatus, organizeBot: options.organizeBot || (async () => ({ started: false })),
    organizeNative: ({ allowDigest = false, retryFailed = false }) => {
      const epoch = cacheMutations.capture();
      return runAutomaticAiAfterFailedRefresh(() => cacheMutations.isCurrent(epoch), undefined, allowDigest, retryFailed);
    },
    summarizeNative: refreshSingleSummary, onComplete: options.onOrganizationComplete,
  });
  const isWorkCurrent = generation => typeof generation === "function" ? generation() : refreshCoordinator.isCurrent(generation);
  return {
    startRefresh, runRefresh, refreshSource, refreshDailyDigest, refreshSingleSummary: organization.summarize,
    organizeNews: () => organization.start({ retryFailed: true }), waitForOrganization: organization.wait, isOrganizingNews: organization.isRunning,
    generatedCardSummary, preserveCardAiSummary, sanitizeCardAiSummaries,
  };
async function startRefresh(force, options = {}) {
  return refreshCoordinator.start(force === true, options);
}

async function runRefresh(generation, options = {}) {
  try {
    return await performRefresh(generation, options);
  } catch (error) {
    if (!isWorkCurrent(generation)) return;
    try {
      const automaticFallback = options.organize === false ? null : await organization.start({ allowDigest: true });
      if (!isWorkCurrent(generation)) return;
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
      broadcast("refresh.progress", failed);
    } catch {
      // Preserve the original refresh failure when status persistence also fails.
    }
    return null;
  }
}

async function performRefresh(generation, { signal, organize = true } = {}) {
  const cacheEpoch = cacheMutations.capture();
  const settings = await getSettings();
  if (!isWorkCurrent(generation)) return;
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
  if (!isWorkCurrent(generation)) return;
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
    if (!isWorkCurrent(generation) || signal?.aborted) return;
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
        signal,
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
      if (!isWorkCurrent(generation) || signal?.aborted) return;
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
      if (isWorkCurrent(generation)) {
        await setRefreshStatus(status);
        broadcast("refresh.progress", status);
      }
    }
  }, { signal, isCurrent: () => isWorkCurrent(generation) });
  if (!isWorkCurrent(generation)) return;
  await enrichMissingFeedImages(articles, { cacheEpoch, generation, signal });
  updateImageQualityMetrics(quality, articles);
  if (!isWorkCurrent(generation)) return;
  const aiReadyForRefresh = await aiConfigured(settings);
  const committed = await cacheMutations.run(async (isCurrent) => {
    if (!isCurrent() || !isWorkCurrent(generation)) return null;
    const [previous, previousQuality, previousDigest, feedback] = await Promise.all([
      getRecord("feed", { items: [] }),
      getRecord("source-quality", emptySourceQuality()),
      getRecord("daily-digest", null),
      getRecord("feedback", []),
    ]);
    if (!isCurrent() || !isWorkCurrent(generation)) return null;
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
    if (!isCurrent() || !isWorkCurrent(generation)) return null;
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
    return { items };
  }, cacheEpoch);
  if (!committed || !isWorkCurrent(generation)) return;
  broadcast("dashboard.updated", { reason: "feed" });
  const items = committed.items;
  if (!isWorkCurrent(generation)) return;
  const finished = {
    ...status,
    running: false,
    finishedAt: new Date().toISOString(),
    progress: 1,
    message: "",
    messageKey: items.length
      ? "background.cachedItems"
      : "background.noItems",
    messageParams: items.length ? { count: items.length } : {},
    stages: pipelineStages("complete"),
  };
  await setRefreshStatus(finished);
  if (!isWorkCurrent(generation)) return;
  broadcast("dashboard.updated", { reason: "refresh-complete" });
  if (organize) await organization.start({ allowDigest: true });
}

async function runAutomaticAiAfterFailedRefresh(generation, signal, allowDigest = true, retryFailed = false) {
  try {
    const settings = await getSettings();
    if (!settings.bookmarkConsentGranted || !isWorkCurrent(generation)) return null;
    const model = await currentBookmarkModel(settings);
    const feedPermissions = await currentFeedPermissionState(settings, model);
    const cacheEpoch = cacheMutations.capture();
    const [feed, digest, aiReady] = await Promise.all([
      getRecord("feed", { items: [] }),
      getRecord("daily-digest", null),
      aiConfigured(settings),
    ]);
    if (!isWorkCurrent(generation)) return null;
    const rawFeed = feedCacheOrEmpty(feed);
    const permittedItems = filterFeedItemsBySources(rawFeed.items, feedPermissions.permitted, feedPermissions.grantedOrigins);
    const items = presentableFeedItems(permittedItems, settings, aiReady);
    if (!permittedItems.length) {
      await setAiAutoStatus({ ...defaultAiAutoStatus(), phase: "no-candidates", lastRunAt: new Date().toISOString() }, true);
      return { items: [], errorKey: "" };
    }
    const needsDigest = Boolean(aiReady && (
      digest?.status !== "ai"
      || !digestCachePermitted(digest, items, feedPermissions, settings, aiReady)
    ));
    return await runAutomaticAiAfterRefresh({
      settings,
      items: permittedItems,
      needsDigest,
      aiReady,
      allowDigest,
      retryFailed,
      cacheEpoch,
      generation,
      signal,
    });
  } catch (error) {
    if (isWorkCurrent(generation)) await setAiAutoStatus({ ...defaultAiAutoStatus(), phase: "error",
      errorKey: error.messageKey || "background.error.aiNetwork", errorParams: error.messageParams || {} }, true);
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

async function runAutomaticAiAfterRefresh(input) {
  const { settings, cacheEpoch, generation, signal } = input;
  return runAutomaticAiWorkflow({ ...input, allowDigest: input.allowDigest !== false && !botGeneratesBrief(settings) }, {
    getAiAutoStatus, setAiAutoStatus, readQuota, automaticallySummarizeCards, refreshDailyDigest,
    selectCandidates: (items, mode, options = {}) => automaticSummaryCandidates(items, settings, mode,
      { ...options, includeCooling: input.retryFailed === true || options.includeCooling === true }),
    isCurrent: () => !signal?.aborted && cacheMutations.isCurrent(cacheEpoch) && isWorkCurrent(generation),
  });
}

function automaticSummaryCandidates(items, settings, mode, options) {
  const locale = settingsLocale(settings);
  const sanitized = sanitizeCardAiSummaries(items, settings, true);
  return selectSummaryCandidates(sanitized, settings, locale, isCurrentCardSummary, mode, options);
}

async function automaticallySummarizeCards(
  settings, items, cacheEpoch, generation, candidateLimit, onProgress = null,
  { mode = "optional", signal, includeCooling = false } = {},
) {
  if (mode === "required" && isBotMode(settings)) return automaticallyTranslateCards(settings, items, cacheEpoch, generation, candidateLimit, onProgress, signal, includeCooling);
  const outcome = { items, errorKey: "", errorParams: {}, processed: 0, attempted: 0, failed: 0, quotaReached: false, stopped: false };
  if (!await aiConfigured(settings)) return { ...outcome, stopped: true };
  const locale = settingsLocale(settings);
  const candidates = automaticSummaryCandidates(items, settings, mode, { includeCooling }).slice(0, candidateLimit);
  const active = () => !signal?.aborted && cacheMutations.isCurrent(cacheEpoch) && isWorkCurrent(generation);
  for (const candidate of candidates) {
    if (!active()) break;
    try {
      const context = await automaticCardSummaryContext(candidate);
      const result = await runAiWithinQuota(settings, async () => {
        outcome.attempted += 1;
        const value = await callProvider(
          settings,
          translateAiPrompt(locale, "background.prompt.cardSummary"),
          translate(locale, "background.prompt.webInput", { url: candidate.url, title: candidate.title, text: context.text }),
          AI_ARTICLE_SUMMARY_MAX_TOKENS, "",
          async () => {
            const latest = await getSettings();
            if (botOrganizesNews(latest)) throw typedError("AI_CONFIGURATION_CHANGED", "background.error.aiConfigurationChanged", {}, true);
            if (mode === "optional" && !latest.cardSummaryEnabled) throw typedError("AI_CONFIGURATION_CHANGED", "background.error.aiConfigurationChanged", {}, true);
            const validation = await assertFeedItemsStillPermitted([candidate]);
            return { ...validation, origins: uniqueStrings([...validation.origins, ...context.origins]) };
          },
          { signal, expectedLocale: locale, outputValidator: (value) => cardSummaryOutputMatchesLocale(value, locale), preferVisibleOutput: true },
        );
        const validation = cardSummaryOutputMatchesLocale(value, locale);
        if (!validation.valid) throw typedError(validation.code, validation.messageKey, {}, true);
        return generatedCardSummary(value);
      });
      if (!result.usedAi) { outcome.quotaReached = true; break; }
      if (!active()) break;
      const organized = result.value;
      const committedItem = await commitCardOutcome(candidate, settings, cacheEpoch, generation, mode, signal, (item) => ({
        ...withoutSummaryRetry(item), summaryTitle: organized.title, summary: organized.summary,
        ...(mode === "required" ? { localization: createLocalization(item, organized, locale, "native", new Date().toISOString(), safeOrigin(settings.openaiBaseUrl)) } : {}),
        summaryStatus: "ai", summaryLocale: locale, summarizedAt: new Date().toISOString(),
        summaryProviderOrigin: safeOrigin(settings.openaiBaseUrl),
      }));
      if (!committedItem) { outcome.stopped = true; break; }
      outcome.items = outcome.items.map((item) => item.url === committedItem.url ? committedItem : item);
      outcome.processed += 1;
      if (onProgress) await onProgress({ ...outcome, contentChanged: true });
    } catch (error) {
      if (!active()) break;
      if (!isAiContentError(error)) {
        outcome.errorKey = error?.messageKey || "background.error.aiNetwork";
        outcome.errorParams = error?.messageParams || {};
        break;
      }
      const committedItem = await commitCardOutcome(candidate, settings, cacheEpoch, generation, mode, signal, (item) => ({
        ...item, summaryRetry: nextSummaryRetry(item, settings, locale, error),
      }));
      if (!committedItem) { outcome.stopped = true; break; }
      outcome.items = outcome.items.map((item) => item.url === committedItem.url ? committedItem : item);
      outcome.failed += 1;
      if (onProgress) await onProgress({ ...outcome, contentChanged: false });
    }
  }
  return outcome;
}

async function automaticallyTranslateCards(settings, items, cacheEpoch, generation, candidateLimit, onProgress, signal, includeCooling = false) {
  const outcome = { items, errorKey: "", errorParams: {}, processed: 0, attempted: 0, failed: 0, stopped: false, quotaReached: false };
  const locale = settingsLocale(settings), candidates = automaticSummaryCandidates(items, settings, "required", { includeCooling }).slice(0, candidateLimit);
  const active = () => !signal?.aborted && cacheMutations.isCurrent(cacheEpoch) && isWorkCurrent(generation);
  for (let offset = 0; offset < candidates.length && active();) {
    let group = [];
    let reserved;
    try { reserved = await runAiBatchWithinQuota(settings, Math.min(5, candidates.length - offset), async units => {
      group = candidates.slice(offset, offset + units); outcome.attempted += units;
      return translateFeedBatch(group, locale, inputs => callProvider(settings,
        `${translateAiPrompt(locale, "background.prompt.feedTranslationBatch")}\n\n${CARD_SUMMARY_WRITING_RULES}`, JSON.stringify({ locale, translations: inputs }), Math.min(3600, 300 + inputs.length * 650), "",
        async () => {
          const latest = await getSettings();
          if (!active() || !isBotMode(latest) || botOrganizesNews(latest)) throw typedError("AI_CONFIGURATION_CHANGED", "background.error.aiConfigurationChanged", {}, true);
          return assertFeedItemsStillPermitted(group);
        }, { signal, expectedLocale: locale, enforceOutputLocale: false, outputValidator: () => true, preferVisibleOutput: true }));
    }); } catch (error) {
      outcome.errorKey = error.messageKey || "background.error.aiNetwork"; outcome.errorParams = error.messageParams || {};
      outcome.stopped = true; break;
    }
    if (!reserved.usedAi) { outcome.quotaReached = true; break; }
    offset += group.length;
    for (const candidate of group) {
      if (!active()) { outcome.stopped = true; break; }
      const organized = reserved.value.results.get(candidate.articleId || candidate.entryKey);
      if (!organized && reserved.value.error && !isAiContentError(reserved.value.error)) continue;
      const failure = reserved.value.error || typedError("AI_INVALID_OUTPUT", "background.error.aiInvalidOutput", {}, true);
      const committed = await commitCardOutcome(candidate, settings, cacheEpoch, generation, "required", signal, item => organized ? ({
        ...withoutSummaryRetry(item), summaryTitle: organized.title, summary: organized.summary, summaryStatus: "ai", summaryLocale: locale,
        summarizedAt: new Date().toISOString(), summaryProviderOrigin: safeOrigin(settings.openaiBaseUrl),
        localization: createLocalization(item, organized, locale, "native", new Date().toISOString(), safeOrigin(settings.openaiBaseUrl)),
      }) : ({ ...item, summaryRetry: nextSummaryRetry(item, settings, locale, failure) }));
      if (!committed) { outcome.stopped = true; break; }
      outcome.items = outcome.items.map(item => (item.articleId || item.entryKey) === (committed.articleId || committed.entryKey) ? committed : item);
      if (organized) outcome.processed++; else outcome.failed++;
    }
    if (onProgress) await onProgress({ ...outcome, contentChanged: outcome.processed > 0 });
    if (reserved.value.error && !isAiContentError(reserved.value.error)) {
      outcome.errorKey = reserved.value.error.messageKey || "background.error.aiNetwork";
      outcome.errorParams = reserved.value.error.messageParams || {}; break;
    }
    if (outcome.stopped) break;
  }
  return outcome;
}

async function commitCardOutcome(candidate, settings, cacheEpoch, generation, mode, signal, update) {
  const locale = settingsLocale(settings);
  const contextKey = cardSummaryContextKey(candidate, settings, locale);
  return cacheMutations.run(async (isCurrent) => {
    const active = () => isCurrent() && !signal?.aborted && isWorkCurrent(generation);
    if (!active()) return null;
    const latestSettings = await getSettings();
    if (botOrganizesNews(latestSettings)) return null;
    if ((mode !== "required" && !latestSettings.cardSummaryEnabled) || !await aiConfigured(latestSettings)) return null;
    if (settingsLocale(latestSettings) !== locale || cardSummaryContextKey(candidate, latestSettings, locale) !== contextKey) return null;
    const latestModel = latestSettings.bookmarkConsentGranted ? await currentBookmarkModel(latestSettings) : emptyBookmarkModel();
    const permissions = await currentFeedPermissionState(latestSettings, latestModel);
    if (permissions.permittedByKey.get(String(candidate.sourceKey || "")) !== originPattern(candidate.sourceOrigin || "")) return null;
    const feed = feedCacheOrEmpty(await getRecord("feed", null));
    let updatedItem = null;
    const updatedItems = feed.items.map((item) => {
      if ((item.articleId || item.entryKey) !== (candidate.articleId || candidate.entryKey) || item.url !== candidate.url) return item;
      if (cardSummaryContextKey(item, latestSettings, locale) !== contextKey || isCurrentCardSummary(item, locale)) return item;
      const [sanitized] = sanitizeCardAiSummaries([item], latestSettings, true);
      updatedItem = update(sanitized);
      return updatedItem;
    });
    if (!updatedItem || !active()) return null;
    // Also recheck fetch origins before either a successful summary or retry metadata is committed.
    await assertFeedItemsStillPermitted([candidate]);
    if (!active()) return null;
    const visibleItems = presentableFeedItems(updatedItems, latestSettings, true);
    await setRecord("feed", {
      ...feed, items: updatedItems,
      localCount: visibleItems.filter((item) => !item.externalDiscovery).length,
      publicCount: visibleItems.filter((item) => item.externalDiscovery).length,
    }, "cache");
    return updatedItem;
  }, cacheEpoch);
}

async function refreshDailyDigest({ automatic = false, signal } = {}) {
  signal?.throwIfAborted();
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
          signal,
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
      signal?.throwIfAborted();
      const errorKey = error?.messageKey || "background.error.aiNetwork";
      digest = {
        ...digest,
        status: "fallback",
        error: translate(locale, errorKey, error?.messageParams || {}),
        errorKey,
        errorParams: error?.messageParams || {},
        errorCode: error?.code || "",
      };
    }
  }
  signal?.throwIfAborted();
  const sanitized = await sanitizeDailyDigest(digest);
  digest = sanitized.digest;
  const committed = await cacheMutations.run(async (isCurrent) => {
    signal?.throwIfAborted();
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
  if (isCurrentCardSummary(sanitizeCardAiSummaries([target], settings, await aiConfigured(settings))[0], locale)) return { ok: true, status: "completed" };
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
    async () => {
      if (botOrganizesNews(await getSettings())) throw typedError("AI_CONFIGURATION_CHANGED", "background.error.aiConfigurationChanged", {}, true);
      return assertFeedItemsStillPermitted([target]);
    },
    {
      expectedLocale: locale,
      outputValidator: (value) => cardSummaryOutputMatchesLocale(value, locale),
      preferVisibleOutput: true,
    },
  );
  const organized = generatedCardSummary(summaryText);
  const validation = cardSummaryOutputMatchesLocale(summaryText, locale);
  if (!validation.valid) throw typedError(validation.code, validation.messageKey, {}, true);
  const committed = await cacheMutations.run(async (isCurrent) => {
    if (!isCurrent()) return null;
    const latestSettings = await getSettings();
    if (!latestSettings.bookmarkConsentGranted || botOrganizesNews(latestSettings)) return null;
    const latestModel = await currentBookmarkModel(latestSettings);
    const latestPermissions = await currentFeedPermissionState(latestSettings, latestModel);
    if (!isCurrent() || latestPermissions.permittedByKey.get(String(target.sourceKey || "")) !== permittedSourceOrigin) return null;
    const previous = feedCacheOrEmpty(await getRecord("feed", null));
    if (settingsLocale(latestSettings) !== locale) return null;
    const contextKey = cardSummaryContextKey(target, settings, locale);
    if (cardSummaryContextKey(target, latestSettings, locale) !== contextKey) return null;
    const permittedPrevious = filterFeedItemsBySources(previous.items || [], latestPermissions.permitted, latestPermissions.grantedOrigins);
    const items = permittedPrevious.map((item) => (
      item.sourceKey === target.sourceKey
      && (item.articleId || item.entryKey) === (target.articleId || target.entryKey)
      && item.url === target.url
      && cardSummaryContextKey(item, latestSettings, locale) === contextKey
        ? {
          ...withoutSummaryRetry(sanitizeCardAiSummaries([item], latestSettings, true)[0]),
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
