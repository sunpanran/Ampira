const AI_DIGEST_MAX_TOKENS = 900;
const AI_ARTICLE_SUMMARY_MAX_TOKENS = 1200;
const CARD_SUMMARY_EXCERPT_MAX_CHARS = 2000;

export function createRefreshService(options) {
  const {
    refreshCoordinator, getSettings, currentBookmarkModel, emptyBookmarkModel, currentFeedPermissionState,
    configuredFeedSources, selectRefreshBatch, getRecord, setRecord, setRecords,
    setRefreshStatus, pipelineStages, broadcast, fetchSourceArticles, sourceFetchOptions,
    mapWithConcurrency, summarizeQuality, retainActiveUnrefreshedItems, rankAndDedupe,
    assertFeedItemsStillPermitted, withFeedCacheMetadata, cacheMutations, aiConfigured,
    getAiAutoStatus, setAiAutoStatus, defaultAiAutoStatus, readQuota, runAiWithinQuota,
    callProvider, translate, settingsLocale, cleanGeneratedSummaryLine,
    extractGeneratedSummaryTitle, parseGeneratedDailyDigest, buildFallbackDigest,
    digestCachePermitted, filterFeedItemsBySources, resultMessage, errorResult,
    emptySourceQuality, localDateKey, uniqueStrings, safeOrigin, originPattern,
    sanitizeDailyDigest, typedError, feedCacheOrEmpty, getRefreshStatus, hostOf,
    originsFromUrls, isPermissionEpochCurrent,
  } = options;
  return {
    startRefresh, runRefresh, refreshDailyDigest, refreshSingleSummary,
    generatedCardSummary, preserveCardAiSummary, sanitizeCardAiSummaries,
  };
async function startRefresh(force) {
  return refreshCoordinator.start(force === true);
}

async function runRefresh(generation) {
  try {
    return await performRefresh(generation);
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
  const quality = {};
  const articles = [];
  const successfullyRefreshedSources = [];
  await mapWithConcurrency(refreshSources, 4, async (source) => {
    try {
      const items = await fetchSourceArticles(source, sourceFetchOptions(settings.hotNewsEntriesPerSource));
      successfullyRefreshedSources.push(source);
      articles.push(...items.map((item) => ({ ...item, externalDiscovery: source.externalDiscovery === true })));
      quality[source.key] = {
        sourceKey: source.key,
        sourceOrigin: safeOrigin(source.url),
        title: source.title,
        host: source.host || hostOf(source.url),
        status: items.length ? "healthy" : "empty",
        count: items.length,
      };
    } catch (error) {
      status.failed += 1;
      quality[source.key] = {
        sourceKey: source.key,
        sourceOrigin: safeOrigin(source.url),
        title: source.title,
        host: source.host || hostOf(source.url),
        status: "error",
        reason: error?.messageKey ? "" : (error.message || String(error)),
        reasonKey: error?.messageKey || "",
        count: 0,
      };
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
  const aiReadyForRefresh = await aiConfigured(settings);
  const committed = await cacheMutations.run(async (isCurrent) => {
    if (!isCurrent() || !refreshCoordinator.isCurrent(generation)) return null;
    const [previous, previousQuality, previousDigest] = await Promise.all([
      getRecord("feed", { items: [] }),
      getRecord("source-quality", emptySourceQuality()),
      getRecord("daily-digest", null),
    ]);
    if (!isCurrent() || !refreshCoordinator.isCurrent(generation)) return null;
    const retained = filterFeedItemsBySources(
      retainActiveUnrefreshedItems(previous.items, permitted, successfullyRefreshedSources),
      permitted,
    );
    const previousByArticle = new Map((previous.items || []).map((item) => [item.articleId || item.entryKey || item.url, item]));
    const refreshed = articles.map((item) => preserveCardAiSummary(item, previousByArticle.get(item.articleId || item.entryKey || item.url), settings));
    const items = rankAndDedupe([...refreshed, ...retained], settings.hotNewsCacheSize);
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
    const qualitySummary = summarizeQuality({ ...retainedQuality, ...quality }, denied);
    const preservedDigest = previousDigest?.locale === locale
      && previousDigest?.date === localDateKey()
      && digestCachePermitted(previousDigest, items, feedPermissions, settings, aiReadyForRefresh)
      ? previousDigest
      : withFeedCacheMetadata(buildFallbackDigest(items, "local", locale), items, "daily-digest");
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

async function runAutomaticAiAfterRefresh({ settings, items, needsDigest, aiReady, cacheEpoch, generation }) {
  const previous = await getAiAutoStatus();
  const quota = await readQuota(settings.dailyAiLimit);
  const remainingQuota = Math.max(0, settings.dailyAiLimit - quota.used);
  const availableCards = settings.cardSummaryEnabled
    ? items.filter((item) => item.summaryStatus !== "ai" && String(item.excerpt || "").trim()).length
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
  await setAiAutoStatus({ ...base, phase, running: true });

  if (digestEligible && refreshCoordinator.isCurrent(generation)) {
    const digest = await refreshDailyDigest({ automatic: true });
    if (digest.status === "ai") processed += 1;
    else if (digest.status === "quota-or-empty") phase = "quota";
    else {
      phase = "error";
      errorKey = digest.errorKey || "background.error.aiNetwork";
    }
  }

  if (!errorKey && phase !== "quota" && cardEligible && refreshCoordinator.isCurrent(generation)) {
    phase = "running-cards";
    await setAiAutoStatus({ ...base, phase, running: true, processed });
    const automatic = await automaticallySummarizeCards(settings, items, cacheEpoch, generation, cardEligible, async (cardProcessed) => {
      await setAiAutoStatus({ ...base, phase, running: true, processed: processed + cardProcessed });
    });
    items = automatic.items;
    processed += automatic.processed;
    if (automatic.quotaReached) phase = "quota";
    if (automatic.errorKey) {
      phase = "error";
      errorKey = automatic.errorKey;
    }
  }

  if (!errorKey && phase !== "quota") phase = "completed";
  await setAiAutoStatus({
    ...base,
    phase,
    running: false,
    processed,
    lastRunAt: new Date().toISOString(),
    errorKey,
  });
  return { items, errorKey };
}

async function automaticallySummarizeCards(settings, items, cacheEpoch, generation, candidateLimit, onProgress = null) {
  if (!await aiConfigured(settings)) return { items, errorKey: "", processed: 0, eligible: 0, quotaReached: false };
  const locale = settingsLocale(settings);
  let currentItems = items;
  let errorKey = "";
  let processed = 0;
  let quotaReached = false;
  const candidates = items.filter((item) => (
    item.summaryStatus !== "ai"
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
        if (item.summaryStatus === "ai") return item;
        updatedItem = { ...item, summaryTitle: organized.title, summary: organized.summary, summaryStatus: "ai", summarizedAt, summaryProviderOrigin: providerOrigin };
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
  return { items: currentItems, errorKey, processed, eligible: candidates.length, quotaReached };
}

function automaticCardSummaryContext(candidate) {
  return {
    text: String(candidate.excerpt || "").trim().slice(0, CARD_SUMMARY_EXCERPT_MAX_CHARS),
    origins: [],
  };
}

function preserveCardAiSummary(item, previous, settings) {
  if (previous?.summaryStatus !== "ai" || !previous.summaryTitle || !Array.isArray(previous.summary) || !previous.summary.length) return item;
  if (originPattern(previous.summaryProviderOrigin || "") !== originPattern(settings.openaiBaseUrl)) return item;
  return {
    ...item,
    summaryTitle: previous.summaryTitle,
    summary: previous.summary,
    summaryStatus: "ai",
    summarizedAt: previous.summarizedAt || "",
    summaryProviderOrigin: previous.summaryProviderOrigin,
  };
}

function sanitizeCardAiSummaries(items, settings, configuredForAi) {
  return (items || []).map((item) => {
    if (item.summaryStatus !== "ai") return item;
    if (configuredForAi && originPattern(item.summaryProviderOrigin || "") === originPattern(settings.openaiBaseUrl)) return item;
    const { summarizedAt, summaryProviderOrigin, summaryTitle, ...rest } = item;
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
  const permittedItems = filterFeedItemsBySources(feed.items, feedPermissions.permitted);
  const contextItems = permittedItems.slice(0, 12);
  let digest = withFeedCacheMetadata(buildFallbackDigest(permittedItems, "local", locale), contextItems, "daily-digest");
  if (contextItems.length && cacheMutations.isCurrent(cacheEpoch) && await aiConfigured(settings)) {
    const context = contextItems.map((item, index) => `${index + 1}. ${item.title}｜${item.excerpt}｜${item.url}`).join("\n");
    try {
      const operation = () => callProvider(
        settings,
        translate(locale, "background.prompt.dailyDigest"),
        context,
        AI_DIGEST_MAX_TOKENS,
        "",
        () => assertFeedItemsStillPermitted(contextItems),
      );
      const result = automatic
        ? await runAiWithinQuota(settings, operation)
        : { usedAi: true, value: await operation() };
      if (result.usedAi) {
        const organized = parseGeneratedDailyDigest(result.value, digest.items.length);
        digest = withFeedCacheMetadata({
          ...digest,
          locale,
          status: "ai",
          overview: organized.overview,
          items: digest.items.map((item, index) => {
            const aiTitle = organized.eventTitles[index] || "";
            return aiTitle ? { ...item, originalTitle: item.title, title: aiTitle, aiTitle } : item;
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
    const permittedPrevious = filterFeedItemsBySources(previous.items || [], latestPermissions.permitted);
    const items = permittedPrevious.map((item) => (
      item.sourceKey === target.sourceKey
      && (item.articleId || item.entryKey) === (target.articleId || target.entryKey)
      && item.url === target.url
        ? {
          ...item,
          summaryTitle: organized.title,
          summary: organized.summary,
          summaryStatus: "ai",
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
        value: withFeedCacheMetadata(buildFallbackDigest(items, "local", locale), items, "daily-digest"),
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
  const summary = lines.length > 1
    ? lines.slice(0, 3)
    : (lines[0]?.match(/[^。！？.!?]+[。！？.!?]?/g) || lines).map((line) => line.trim()).filter(Boolean).slice(0, 3);
  return { title, summary };
}
}
