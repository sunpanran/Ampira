import { hashText } from "../core/bookmarks.mjs";
import { botOrganizesNews } from "../core/bot-mode.mjs";
import { botError } from "../core/bot-board.mjs";
import { createLocalization, localizationFingerprint, withLocalization } from "../core/feed-localization.mjs";
import { automaticSummaryCandidates } from "./automatic-ai-workflow.mjs";
import { createCardSummaryPolicy } from "./card-summary-policy.mjs";

const identity = item => String(item.articleId || item.entryKey || "");
const activeJob = job => ["queued", "pending"].includes(job.status);
const cardPending = job => job.status === "pending" || job.status === "queued" && job.manual;

export function createBotSummaryService({ getSettings, settingsLocale, getRecord, setRecord, botBoard, cacheMutations,
  selectPermitted, presentable, broadcast, capturePermissionEpoch, isPermissionEpochCurrent, quotaManager,
  setAiAutoStatus = async () => {}, onComplete = async () => {}, now = () => new Date().toISOString() }) {
  let queue = Promise.resolve();
  const policy = createCardSummaryPolicy({ settingsLocale });
  const enqueue = operation => { const result = queue.then(operation); queue = result.catch(() => {}); return result; };
  const keyFor = configuration => `bot-summaries:${hashText(configuration.connectionId)}`;
  const read = configuration => getRecord(keyFor(configuration), { jobs: [] });
  return { organize: options => enqueue(() => organize(options)), sync: () => enqueue(sync), status };

  async function status() {
    const configuration = { ...await botBoard.config() }, record = await read(configuration);
    return { provider: "bot", available: Boolean(configuration.connection), ...record.ui,
      pendingIds: record.jobs.filter(cardPending).map(job => job.articleId),
      queuedIds: record.jobs.filter(job => job.status === "queued" && !job.manual).map(job => job.articleId),
      failedIds: record.jobs.filter(job => job.status === "failed").map(job => job.articleId) };
  }
  async function organize({ item = null, allowDigest = false } = {}) {
    const settings = await getSettings(), configuration = { ...await botBoard.config() };
    if (!botOrganizesNews(settings)) throw botError("inactive");
    if (!configuration.connection) throw botError("credentialRequired");
    const epoch = cacheMutations.capture(), permission = capturePermissionEpoch(), locale = settingsLocale(settings);
    const feed = await getRecord("feed", { items: [] }), allowed = await selectPermitted(settings, feed.items || []);
    const original = item && allowed.find(value => value.sourceKey === item.sourceKey
      && (identity(value) === item.articleId || value.url === item.url));
    if (item && !original) throw botError("invalidData");
    if (original && !policy.automaticCardSummaryContext(original).text.trim()) {
      throw Object.assign(new Error("No source excerpt"), { code: "SUMMARY_CONTENT_MISSING", messageKey: "summary.status.noContent" });
    }
    if (original && policy.isCurrentCardSummary(original, locale)) return { ok: true, status: "completed" };
    const selectionSettings = { ...settings, botOrganizeNews: false };
    const candidates = original ? [original] : ["required", "optional"].flatMap(mode => automaticSummaryCandidates(
      allowed, selectionSettings, locale, policy.isCurrentCardSummary, mode, { includeCooling: true }));
    const record = await read(configuration);
    const jobs = record.jobs.filter(job => activeJob(job) || candidates.some(value => identity(value) === job.articleId));
    for (const candidate of candidates) {
      const fingerprint = localizationFingerprint(candidate), id = `summary-${hashText(`${configuration.connectionId}|${locale}|${fingerprint}`)}`;
      let job = jobs.find(value => value.id === id);
      if (!job) {
        job = { id, articleId: identity(candidate), sourceKey: candidate.sourceKey, fingerprint, locale,
          title: String(candidate.title || "").slice(0, 200), excerpt: policy.automaticCardSummaryContext(candidate).text.slice(0, 2000),
          status: "queued", manual: Boolean(item) };
        if (job.title && job.excerpt) jobs.push(job);
      } else {
        job.manual ||= Boolean(item);
        if (job.status === "cancelled" || job.status === "failed" && !allowDigest) {
          job.status = "queued"; job.retry = true; delete job.reservation;
        }
      }
    }
    const current = async () => cacheMutations.isCurrent(epoch) && isPermissionEpochCurrent(permission)
      && botOrganizesNews(await getSettings()) && settingsLocale(await getSettings()) === locale
      && (await botBoard.config()).connectionId === configuration.connectionId;
    await cacheMutations.run(async check => {
      if (check() && await current()) await setRecord(keyFor(configuration), { jobs, retry: !allowDigest, allowDigest: record.allowDigest || allowDigest, startedAt: now() }, "cache");
    }, epoch);
    if (!await current()) return { ok: false, status: "cancelled" };
    const result = await sync();
    return { ok: true, started: result.running === true, status: result.phase || "pending", organization: result };
  }
  async function sync() {
    const settings = await getSettings(), configuration = { ...await botBoard.config() };
    if (!configuration.connection) return { provider: "bot", available: false, running: false };
    const key = keyFor(configuration), record = await read(configuration);
    if (!botOrganizesNews(settings)) {
      const ids = record.jobs.filter(activeJob).map(job => job.id);
      if (ids.length) {
        try { for (let i = 0; i < ids.length; i += 100) await botBoard.syncSummaries({ cancelIds: ids.slice(i, i + 100) }, true); }
        catch { return { running: false, cleanupPending: true }; }
        await setRecord(key, { jobs: [] }, "cache");
      }
      return { running: false };
    }
    if (!record.jobs.length) {
      const ui = { provider: "bot", available: true, phase: "no-candidates", running: false, total: 0, pending: 0, processed: 0, deferred: 0 };
      if (record.startedAt) { await setRecord(key, { ...record, ui }, "cache"); await setAiAutoStatus(ui, true); }
      return { ...ui, pendingIds: [], failedIds: [] };
    }
    const epoch = cacheMutations.capture(), permission = capturePermissionEpoch(), locale = settingsLocale(settings);
    const current = async () => cacheMutations.isCurrent(epoch) && isPermissionEpochCurrent(permission)
      && botOrganizesNews(await getSettings()) && settingsLocale(await getSettings()) === locale
      && (await botBoard.config()).connectionId === configuration.connectionId;
    const feed = await getRecord("feed", { items: [] }), allowed = await selectPermitted(settings, feed.items || []);
    const valid = job => job.locale === locale && allowed.some(item => identity(item) === job.articleId && localizationFingerprint(item) === job.fingerprint);
    const cancelIds = record.jobs.filter(job => activeJob(job) && !valid(job)).map(job => job.id);
    const jobs = record.jobs.filter(valid), work = jobs.filter(job => job.status === "pending");
    for (const job of jobs.filter(job => job.status === "queued").sort((a, b) => Number(b.manual) - Number(a.manual))) {
      if (work.length >= 5) break;
      if (!job.manual && !job.reservation) {
        job.reservation = await quotaManager.reserve(settings.dailyAiLimit);
        if (!job.reservation) continue;
      }
      job.status = "pending"; work.push(job);
    }
    if (!await current()) return { running: false };
    record.jobs = jobs;
    const save = async () => cacheMutations.run(async check => { if (check() && await current()) await setRecord(key, record, "cache"); }, epoch);
    await save(); // Persist reservations before an uncertain transport can be retried.
    let response = { results: [] }, unavailable = false, errorKey = "";
    if (work.length || cancelIds.length) {
      try {
        for (let i = 100; i < cancelIds.length; i += 100) await botBoard.syncSummaries({ cancelIds: cancelIds.slice(i, i + 100) }, true);
        response = await botBoard.syncSummaries({ cancelIds: cancelIds.slice(0, 100), resultIds: work.map(job => job.id),
          retry: record.retry || work.some(job => job.retry), requests: work.map(({ id, locale, title, excerpt, manual }) => ({ id, locale, title, excerpt, manual })) });
        record.retry = false;
        work.forEach(job => { job.retry = false; });
        if (response.runner?.mode === "codex" && response.runner.status === "failed") {
          unavailable = true;
          const code = ["auth", "quota", "timeout", "invalidResult", "interrupted", "unavailable"].includes(response.runner.error) ? response.runner.error : "failed";
          errorKey = `bot.runner.error.${code}`;
        }
      } catch (error) { unavailable = true; errorKey = error.messageKey || "background.bot.networkFailed"; }
    }
    if (!await current()) return { running: false };
    let changed = false;
    const results = new Map((response.results || []).map(value => [value.id, value]));
    await cacheMutations.run(async check => {
      if (!check() || !await current()) return;
      const latest = await getRecord("feed", { items: [] }), permitted = await selectPermitted(await getSettings(), latest.items || []);
      const items = (latest.items || []).map(item => {
        const job = work.find(value => identity(item) === value.articleId && localizationFingerprint(item) === value.fingerprint);
        const result = job && results.get(job.id);
        if (result?.status === "failed") job.status = "failed";
        if (result?.status !== "completed" || !permitted.some(value => identity(value) === identity(item)
          && localizationFingerprint(value) === job.fingerprint) || result.result?.locale !== locale) return item;
        try {
          const localization = createLocalization(item, result.result, locale, "bot", now());
          job.status = "completed"; changed = true;
          return withLocalization(item, localization);
        } catch { job.status = "failed"; return item; }
      });
      if (!check() || !await current()) return;
      if (changed) {
        const visible = await presentable(items, await getSettings());
        if (!check() || !await current()) return;
        await setRecord("feed", { ...latest, items, localCount: visible.filter(item => !item.externalDiscovery).length,
          publicCount: visible.filter(item => item.externalDiscovery).length }, "cache");
      }
    }, epoch);
    if (!await current()) return { running: false };
    const pending = jobs.filter(job => job.status === "pending").length, queued = jobs.filter(job => job.status === "queued").length;
    const failed = jobs.filter(job => job.status === "failed").length, processed = jobs.filter(job => job.status === "completed").length;
    const quota = await quotaManager.read(settings.dailyAiLimit);
    const phase = unavailable ? "error" : pending ? "running-cards" : queued ? quota.used >= settings.dailyAiLimit ? "quota" : "running-cards"
      : failed ? "partial" : jobs.length ? "completed" : "no-candidates";
    const next = { provider: "bot", available: true, phase, running: !unavailable && (pending > 0 || queued > 0 && phase !== "quota"),
      processed, attempted: processed + failed, failed, deferred: pending + queued, total: jobs.length,
      pending: pending + queued, unavailable, errorKey, startedAt: record.startedAt || "", lastRunAt: record.ui?.lastRunAt || "" };
    const changedStatus = JSON.stringify({ ...record.ui, lastRunAt: "" }) !== JSON.stringify({ ...next, lastRunAt: "" });
    if (changedStatus) next.lastRunAt = now();
    record.ui = next;
    await save();
    if (changedStatus) await setAiAutoStatus(next, true, { contentChanged: changed });
    if (changed) broadcast("dashboard.updated", { reason: "news-organization" });
    if (record.allowDigest && !pending && !queued && !unavailable) { record.allowDigest = false; await save(); await onComplete(); }
    return { ...next, pendingIds: jobs.filter(cardPending).map(job => job.articleId),
      queuedIds: jobs.filter(job => job.status === "queued" && !job.manual).map(job => job.articleId), failedIds: jobs.filter(job => job.status === "failed").map(job => job.articleId) };
  }
}
