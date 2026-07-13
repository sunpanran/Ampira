export function createMaintenanceService(options) {
  let feedbackMutationQueue = Promise.resolve();
  const {
    grantBookmarkConsent, publicSettings, markOnboardingComplete, startRefresh, getSettings,
    cacheMutations, refreshCoordinator, clearRecords, setRecord, setRefreshStatus,
    defaultRefreshStatus, setAiAutoStatus, defaultAiAutoStatus, broadcast, resultMessage,
    quotaManager, getAiAutoStatus, emptySourceQuality, normalizeFeedback, getRecord,
  } = options;
  return { recordBookmarkConsent, completeOnboarding, clearGeneratedCache, resetQuota, resetPreferences, resetSourceQuality, recordFeedback };
async function recordBookmarkConsent() {
  await grantBookmarkConsent();
  return publicSettings();
}

async function completeOnboarding() {
  await markOnboardingComplete();
  startRefresh(true).catch(() => {});
  return publicSettings();
}

async function clearGeneratedCache() {
  const settings = await getSettings();
  cacheMutations.invalidate();
  refreshCoordinator.invalidate();
  await cacheMutations.run(async () => {
    await clearRecords("cache");
    await setRecord("refresh-source-cursor", 0, "state");
    await setRefreshStatus(defaultRefreshStatus("background.cacheClearedWaiting"));
    await setAiAutoStatus(defaultAiAutoStatus(), false);
  });
  broadcast("dashboard.updated", { reason: "cache-cleared" });
  return resultMessage(settings, true, "background.cacheClearSuccess");
}

async function resetQuota() {
  const settings = await getSettings();
  await quotaManager.reset();
  const previous = await getAiAutoStatus();
  await setAiAutoStatus({ ...defaultAiAutoStatus(), lastRunAt: previous.lastRunAt || "" });
  return resultMessage(settings, true, "background.quotaReset", {}, { quota: { usedToday: 0, dailyLimit: settings.dailyAiLimit } });
}

async function resetPreferences() {
  const settings = await getSettings();
  await setRecord("feedback", [], "state");
  return resultMessage(settings, true, "background.preferencesReset");
}

async function resetSourceQuality() {
  const settings = await getSettings();
  const summary = emptySourceQuality();
  await cacheMutations.run(() => setRecord("source-quality", summary, "cache"));
  return resultMessage(settings, true, "background.sourceQualityReset", {}, { sourceQuality: summary });
}

async function recordFeedback(body) {
  const operation = feedbackMutationQueue.then(async () => {
    const settings = await getSettings();
    const record = normalizeFeedback(body);
    if (record.action === "opened" && settings.personalizedRankingEnabled === false) return { ok: true, recorded: false };
    const feedback = await getRecord("feedback", []);
    feedback.push({ ...record, recordedAt: new Date().toISOString() });
    await setRecord("feedback", feedback.slice(-2000), "state");
    return { ok: true, recorded: true };
  });
  feedbackMutationQueue = operation.catch(() => {});
  return operation;
}
}
