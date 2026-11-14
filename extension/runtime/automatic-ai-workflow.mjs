import { feedItemNeedsLocalization } from "../core/feed-language-policy.mjs";
import { currentSummaryRetry, isAiContentError } from "../core/card-summary-retry.mjs";
import { botOrganizesNews } from "../core/bot-mode.mjs";
import { articleContentText } from "../core/feed-content.mjs";

export function automaticSummaryCandidates(items, settings, locale, isCurrentSummary, mode, {
  now = Date.now(), includeCooling = false,
} = {}) {
  if (botOrganizesNews(settings)) return [];
  const pool = Array.isArray(items) ? items : [];
  return pool.filter((item) => {
    if (isCurrentSummary(item, locale)) return false;
    const required = feedItemNeedsLocalization(item, locale);
    if (mode === "required" ? !required : required || !settings.cardSummaryEnabled) return false;
    if (!String(required ? item?.title || articleContentText(item) : articleContentText(item)).trim()) return false;
    const retry = currentSummaryRetry(item, settings, locale);
    return includeCooling || !retry || Date.parse(retry.nextEligibleAt) <= now;
  }).sort((left, right) => {
    const a = currentSummaryRetry(left, settings, locale);
    const b = currentSummaryRetry(right, settings, locale);
    return Number(Boolean(a)) - Number(Boolean(b))
      || (a && b ? Date.parse(a.nextEligibleAt) - Date.parse(b.nextEligibleAt) : 0);
  });
}

export async function runAutomaticAiWorkflow(input, dependencies) {
  let { items } = input;
  const { settings, needsDigest, aiReady, cacheEpoch, generation, signal, allowDigest = true, retryFailed = false } = input;
  const {
    getAiAutoStatus, setAiAutoStatus, readQuota, selectCandidates,
    automaticallySummarizeCards, refreshDailyDigest, isCurrent,
  } = dependencies;
  const active = () => !signal?.aborted && isCurrent();
  const remaining = async () => Math.max(0, settings.dailyAiLimit - (await readQuota(settings.dailyAiLimit)).used);
  const previous = await getAiAutoStatus();
  const remainingQuota = await remaining();
  if (!active()) return { items, errorKey: "" };
  const pendingCards = () => ["required", "optional"].reduce((count, mode) => (
    count + selectCandidates(items, mode, { includeCooling: true }).length
  ), 0);
  const required = selectCandidates(items, "required");
  const optional = selectCandidates(items, "optional");
  const digestPlanned = allowDigest && (needsDigest || required.length > 0);
  const status = {
    processed: 0, attempted: 0, failed: 0, deferred: pendingCards(),
    total: Math.min(remainingQuota, required.length + optional.length + Number(digestPlanned)),
    eligible: required.length + optional.length,
    startedAt: new Date().toISOString(), lastRunAt: previous.lastRunAt || "",
    errorKey: "", errorParams: {}, errorStage: "",
  };
  let stopped = false;
  let digestDeferred = Boolean(allowDigest && needsDigest);
  const report = async (phase, running, contentChanged = false, progress = {}) => {
    if (!active()) return;
    await setAiAutoStatus({ ...status, ...progress, phase, running }, true, { contentChanged });
  };
  const result = () => ({ items, errorKey: status.errorKey, errorParams: status.errorParams, errorStage: status.errorStage });
  if (!aiReady) {
    status.lastRunAt = status.startedAt;
    await report("not-ready", false);
    return result();
  }

  const runCards = async (mode) => {
    const limit = Math.min(selectCandidates(items, mode).length, await remaining());
    if (!limit || !active() || stopped || status.errorKey) return;
    await report("running-cards", true);
    const base = { processed: status.processed, attempted: status.attempted, failed: status.failed };
    const automatic = await automaticallySummarizeCards(settings, items, cacheEpoch, generation, limit,
      async (progress) => {
        await report("running-cards", true, progress.contentChanged, {
          processed: base.processed + progress.processed,
          attempted: base.attempted + progress.attempted,
          failed: base.failed + progress.failed,
          deferred: Math.max(0, status.deferred - progress.processed),
        });
      }, { mode, signal, includeCooling: retryFailed });
    items = automatic.items;
    status.processed += automatic.processed;
    status.attempted += automatic.attempted;
    status.failed += automatic.failed;
    status.deferred = pendingCards();
    stopped = automatic.stopped;
    if (automatic.errorKey) {
      status.errorKey = automatic.errorKey;
      status.errorParams = automatic.errorParams || {};
      status.errorStage = "cards";
    }
  };

  await runCards("required");
  const digestRequiredAfterLocalization = allowDigest && (needsDigest || status.processed > 0);
  const omitDigest = () => {
    digestDeferred = false;
    status.total = Math.max(status.attempted, Math.min(remainingQuota, required.length + optional.length));
  };
  digestDeferred = digestRequiredAfterLocalization;
  if (!digestRequiredAfterLocalization) omitDigest();
  if (digestRequiredAfterLocalization && !stopped && !status.errorKey && active() && await remaining() > 0) {
    await report("running-digest", true);
    const digest = await refreshDailyDigest({ automatic: true, signal });
    if (!active()) return result();
    if (digest.status === "ai") {
      status.processed += 1;
      status.attempted += 1;
      digestDeferred = false;
    } else if (digest.status !== "quota-or-empty") {
      // An empty candidate pool needs no provider request or retry.
      if (!digest.errorKey && !(digest.items || []).length) {
        omitDigest();
      } else {
        status.attempted += 1;
        status.failed += 1;
        if (!isAiContentError({ code: digest.errorCode })) {
          status.errorKey = digest.errorKey || "background.error.aiNetwork";
          status.errorParams = digest.errorParams || {};
          status.errorStage = "digest";
        }
      }
    }
  }
  await runCards("optional");
  if (!active()) return result();
  status.deferred = pendingCards() + Number(digestDeferred);
  status.lastRunAt = new Date().toISOString();
  const phase = status.errorKey ? "error"
    : status.deferred && !await remaining() ? "quota"
      : status.failed || status.deferred ? "partial"
        : status.attempted ? "completed" : "no-candidates";
  await report(phase, false);
  return result();
}
