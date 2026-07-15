export function createPermissionWorkflow(options) {
  let permissionCleanupTimer = 0;
  let permissionCleanupAttempts = 0;
  let permissionReconcileTimer = 0;
  let permissionReconcileAttempts = 0;
  const pendingRemovedOrigins = new Set();
  const {
    broadcast, getSettings, currentBookmarkModel, emptyBookmarkModel, currentFeedPermissionState,
    revokedSourceKeys, getRefreshStatus, originPattern, aiConfigured, setAiAutoStatus,
    defaultAiAutoStatus, startRefresh, cacheMutations, setRefreshStatus,
    defaultRefreshStatus, setRecords, getRecord, deleteRecord, listRecords, filterFeedItemsBySources,
    feedCacheOrEmpty = (value) => value?.schemaVersion === 3 ? value : { schemaVersion: 3, items: [] },
    presentableFeedItems = (items) => items,
    previewCacheKeysOutsideTargets, bravePreviewCacheKeys, uniqueStrings,
    normalizeOriginPattern, filterSourceQuality, emptySourceQuality, originsFromUrls, secretStatus,
    settingsLocale, digestCachePermitted, withFeedCacheMetadata, buildFallbackDigest, buildDailyCandidates,
    inspirationPreviewTargets, newsPreviewTargets,
    permissionEpoch, aiAccessPolicy, cacheAccessPolicy,
  } = options;
  const nextPermissionEpoch = permissionEpoch.next;
  const capturePermissionEpoch = permissionEpoch.capture;
  const isPermissionEpochCurrent = permissionEpoch.isCurrent;
  return {
    nextPermissionEpoch, capturePermissionEpoch, isPermissionEpochCurrent,
    handleAddedOrigins, handleRemovedOrigins, reconcilePermissionCache,
    pruneStalePreviewCaches, pruneBravePreviewCaches, schedulePermissionCleanup, schedulePermissionReconcile,
  };
async function handleAddedOrigins(values) {
  const addedOrigins = uniqueStrings(values.map(normalizeOriginPattern).filter(Boolean));
  broadcast("settings.changed", { permissionsChanged: true });
  if (!addedOrigins.length) return;
  const settings = await getSettings();
  const model = settings.bookmarkConsentGranted ? await currentBookmarkModel(settings) : emptyBookmarkModel();
  const feedPermissions = await currentFeedPermissionState(settings, model);
  const addedSourceKeys = revokedSourceKeys(feedPermissions.permitted, addedOrigins);
  const status = await getRefreshStatus();
  const aiOriginAdded = addedOrigins.includes(originPattern(settings.openaiBaseUrl));
  const aiAutoReady = aiOriginAdded && await aiConfigured(settings);
  if (aiAutoReady) {
    await setAiAutoStatus(defaultAiAutoStatus(), false);
  }
  if (addedSourceKeys.size || status.running || aiAutoReady) startRefresh(true).catch(() => {});
}

async function handleRemovedOrigins(
  values,
  expectedEpoch = cacheMutations.capture(),
  expectedPermissionEpoch = capturePermissionEpoch(),
) {
  const removedOrigins = uniqueStrings(values.map(normalizeOriginPattern).filter(Boolean));
  if (!removedOrigins.length) {
    broadcast("settings.changed", { permissionsChanged: true });
    return;
  }
  const mutation = await cacheMutations.run(
    (isQueueCurrent) => applyEffectivePermissionCachePolicy(
      removedOrigins,
      () => isQueueCurrent() && isPermissionEpochCurrent(expectedPermissionEpoch),
    ),
    expectedEpoch,
  );
  if (!mutation) {
    schedulePermissionCleanup(removedOrigins);
    schedulePermissionReconcile(true);
    broadcast("settings.changed", { permissionsChanged: true });
    return;
  }
  if (mutation.statusRunning || mutation.feedAffected) {
    await setRefreshStatus(defaultRefreshStatus("background.waitingFirstRefresh"));
  }
  broadcast("settings.changed", { permissionsChanged: true });
  broadcast("dashboard.updated", { reason: "permissions-removed" });
  if (mutation.statusRunning || mutation.feedAffected) startRefresh(true).catch(() => {});
}

async function reconcilePermissionCache() {
  const expectedEpoch = cacheMutations.capture();
  try {
    const result = await cacheMutations.run(
      (isCurrent) => applyEffectivePermissionCachePolicy([], isCurrent),
      expectedEpoch,
    );
    if (result) permissionReconcileAttempts = 0;
    else schedulePermissionReconcile();
    return result;
  } catch (error) {
    schedulePermissionReconcile();
    throw error;
  }
}

async function applyEffectivePermissionCachePolicy(removedOrigins, isCurrent) {
  if (!isCurrent()) return null;
  const settings = await getSettings();
  const locale = settingsLocale(settings);
  const model = settings.bookmarkConsentGranted ? await currentBookmarkModel(settings) : emptyBookmarkModel();
  const feedPermissions = await currentFeedPermissionState(settings, model);
  const [providerCapability, secrets, status] = await Promise.all([
    aiAccessPolicy.currentProviderCapability(settings),
    secretStatus(),
    getRefreshStatus(),
  ]);
  if (!isCurrent()) return null;

  const [feed, sourceQuality, dailyDigest, cacheRecords] = await Promise.all([
    getRecord("feed", { schemaVersion: 3, items: [] }),
    getRecord("source-quality", emptySourceQuality()),
    getRecord("daily-digest", null),
    listRecords("cache"),
  ]);
  if (!isCurrent()) return null;
  const normalizedFeed = feedCacheOrEmpty(feed);
  const items = filterFeedItemsBySources(normalizedFeed.items, feedPermissions.permitted, feedPermissions.grantedOrigins);
  const configuredForAi = await aiConfigured(settings);
  const visibleItems = presentableFeedItems(items, settings, configuredForAi);
  const previewTargets = [
    ...inspirationPreviewTargets(model.bookmarks),
    ...newsPreviewTargets(visibleItems),
  ];
  const feedContentChanged = JSON.stringify(items) !== JSON.stringify(normalizedFeed.items);
  const nextFeed = {
    ...normalizedFeed,
    schemaVersion: 3,
    generatedAt: feedContentChanged ? new Date().toISOString() : normalizedFeed.generatedAt,
    items,
    localCount: visibleItems.filter((item) => !item.externalDiscovery).length,
    publicCount: visibleItems.filter((item) => item.externalDiscovery).length,
    deniedOrigins: originsFromUrls(feedPermissions.denied.map((source) => source.url)),
  };
  const nextQuality = filterSourceQuality(sourceQuality, feedPermissions);
  const directKeys = new Set();
  for (const record of cacheRecords) {
    if (!isCurrent()) return null;
    const permitted = await cacheAccessPolicy.isRecordPermitted(record, {
      settings, model, secrets, previewTargets, feedPermissions, providerCapability,
    });
    if (!permitted) directKeys.add(record.key);
  }
  for (const record of cacheRecords) {
    if (directKeys.has(String(record.value?.contentKey || ""))) directKeys.add(record.key);
  }
  if (!isCurrent()) return null;
  for (const key of directKeys) {
    if (!isCurrent()) return null;
    await deleteRecord(key);
  }

  const aiDigestPermitted = dailyDigest?.status === "ai"
    && await aiAccessPolicy.aiSearchResultPermitted({
      usedAi: true,
      providerOrigin: dailyDigest.providerOrigin,
      sourceIdentities: dailyDigest.sourceIdentities,
    }, "", settings, feedPermissions, null, providerCapability);
  const digestPermitted = dailyDigest?.locale === locale
    && digestCachePermitted(dailyDigest, visibleItems, feedPermissions, settings, aiDigestPermitted);
  const digestCandidates = buildDailyCandidates(visibleItems, {
    limit: 12,
    recentLimit: 3,
    publisherLimit: settings.todayNewsPerPublisherLimit,
  });
  const matchedSourceKeys = revokedSourceKeys(feedPermissions.sources, removedOrigins);
  const sourceKeys = new Set([...matchedSourceKeys].filter((key) => !feedPermissions.permittedByKey.has(key)));
  const entries = [
    { key: "feed", value: nextFeed, kind: "cache" },
    { key: "source-quality", value: nextQuality, kind: "cache" },
    ...(!digestPermitted ? [{
      key: "daily-digest",
      value: withFeedCacheMetadata(buildFallbackDigest(digestCandidates, "local", locale, {
        preselected: true,
        publisherLimit: settings.todayNewsPerPublisherLimit,
      }), digestCandidates, "daily-digest"),
      kind: "cache",
    }] : []),
  ];
  if (sourceKeys.size || feedContentChanged) entries.push({ key: "refresh-source-cursor", value: 0, kind: "state" });
  if (!isCurrent()) return null;
  await setRecords(entries);
  return {
    feedAffected: Boolean(sourceKeys.size || feedContentChanged),
    statusRunning: status.running === true,
    feedItems: items.length,
    deleted: directKeys.size,
  };
}

async function pruneStalePreviewCaches(settings, expectedEpoch = cacheMutations.capture()) {
  return cacheMutations.run(async (isCurrent) => {
    if (!isCurrent()) return null;
    const model = settings.bookmarkConsentGranted ? await currentBookmarkModel(settings) : emptyBookmarkModel();
    if (!isCurrent()) return null;
    const [cacheRecords, feed, feedPermissions] = await Promise.all([
      listRecords("cache"),
      getRecord("feed", { schemaVersion: 3, items: [] }),
      currentFeedPermissionState(settings, model),
    ]);
    if (!isCurrent()) return null;
    const permittedItems = filterFeedItemsBySources(feedCacheOrEmpty(feed).items, feedPermissions.permitted, feedPermissions.grantedOrigins);
    const items = presentableFeedItems(permittedItems, settings, await aiConfigured(settings));
    const staleKeys = previewCacheKeysOutsideTargets(
      cacheRecords,
      [...inspirationPreviewTargets(model.bookmarks), ...newsPreviewTargets(items)],
    );
    for (const key of staleKeys) {
      if (!isCurrent()) return null;
      await deleteRecord(key);
    }
    return staleKeys.length;
  }, expectedEpoch);
}

async function pruneBravePreviewCaches(expectedEpoch = cacheMutations.capture()) {
  return cacheMutations.run(async (isCurrent) => {
    if (!isCurrent()) return null;
    const staleKeys = bravePreviewCacheKeys(await listRecords("cache"));
    if (!isCurrent()) return null;
    for (const key of staleKeys) {
      if (!isCurrent()) return null;
      await deleteRecord(key);
    }
    return staleKeys.length;
  }, expectedEpoch);
}

function schedulePermissionCleanup(values, resetAttempts = false) {
  for (const value of values || []) {
    const normalized = normalizeOriginPattern(value);
    if (normalized) pendingRemovedOrigins.add(normalized);
  }
  if (resetAttempts) permissionCleanupAttempts = 0;
  if (permissionCleanupTimer || !pendingRemovedOrigins.size || permissionCleanupAttempts >= 3) return;
  const delay = Math.min(8000, 1000 * 2 ** permissionCleanupAttempts);
  permissionCleanupTimer = setTimeout(async () => {
    permissionCleanupTimer = 0;
    const origins = [...pendingRemovedOrigins];
    pendingRemovedOrigins.clear();
    try {
      await handleRemovedOrigins(origins);
      permissionCleanupAttempts = 0;
    } catch {
      permissionCleanupAttempts += 1;
      origins.forEach((origin) => pendingRemovedOrigins.add(origin));
      schedulePermissionCleanup([]);
    }
  }, delay);
}

function schedulePermissionReconcile(resetAttempts = false) {
  if (resetAttempts) permissionReconcileAttempts = 0;
  if (permissionReconcileTimer || permissionReconcileAttempts >= 3) return;
  const delay = Math.min(8000, 1000 * 2 ** permissionReconcileAttempts);
  permissionReconcileTimer = setTimeout(async () => {
    permissionReconcileTimer = 0;
    permissionReconcileAttempts += 1;
    try {
      const result = await reconcilePermissionCache();
      if (result) permissionReconcileAttempts = 0;
    } catch {
      schedulePermissionReconcile();
    }
  }, delay);
}
}
