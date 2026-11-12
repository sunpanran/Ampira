import { hashText } from "../core/bookmarks.mjs";
import { botGeneratesBrief } from "../core/bot-mode.mjs";
import { boundedReferences, briefContext, taskReference } from "../core/bot-task-context.mjs";
import { localizationFingerprint } from "../core/feed-localization.mjs";
import { normalizeBotModule } from "../core/bot-board.mjs";

export function createBotNativeWorkflow({ storage, getSettings, settingsLocale, getRecord, setRecord, botBoard, cacheMutations,
  capturePermissionEpoch, isPermissionEpochCurrent, readPermittedFeed, buildDailyCandidates, loadQuestionSearchContext,
  normalizeUserUrl, hasOriginPermission, readArticle, readerTextFromBlocks, assertUrlsStillPermitted, assertFeedItemsStillPermitted,
  getRefreshStatus, localDateKey, uuid = () => crypto.randomUUID() }) {
  let running, ownerPromise;
  const owner = () => ownerPromise ||= (async () => {
    const key = "ampira.mcp.context-owner.v1", saved = (await storage.get(key))[key];
    if (typeof saved === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(saved)) return saved;
    const value = uuid(); await storage.set({ [key]: value }); return value;
  })().catch(error => { ownerPromise = null; throw error; });
  const sync = force => {
    if (running && !force) return running;
    const operation = running ? running.catch(() => {}).then(() => syncBrief(force)) : syncBrief(force);
    running = operation;
    operation.finally(() => { if (running === operation) running = null; }).catch(() => {});
    return operation;
  };
  return { prepareMessage, validateMessage, sanitizeBoard, syncBrief: sync, refreshBoard: async (payload = {}) => {
    const brief = await sync();
    return sanitizeBoard({ ...await botBoard.refresh(payload), brief });
  } };

  async function prepareMessage(action, settings) {
    const locale = settingsLocale(settings), url = normalizeUserUrl(action.text);
    if (url) {
      if (await hasOriginPermission(url)) {
        try {
          const article = await readArticle(url);
          const origins = [article.requestedUrl, article.url, article.canonicalUrl].filter(Boolean);
          await checkUrls(origins);
          const references = boundedReferences([taskReference({ url: article.url, title: article.title,
            excerpt: readerTextFromBlocks(article.blocks), source: new URL(article.url).hostname })]);
          return { data: { locale, references }, evidence: { urls: origins } };
        } catch { /* A question can still be sent without claiming that a page was read. */ }
      }
      return { data: { locale, references: [], contextNotice: "No authorized readable page text is available. Do not claim the URL was read." } };
    }
    const { candidates } = await loadQuestionSearchContext(settings, action.text);
    const selected = candidates.slice(0, 3);
    const references = boundedReferences(selected.map(taskReference));
    if (selected.length) await assertFeedItemsStillPermitted(selected);
    return { data: { locale, references }, evidence: { items: selected.map(item => ({ articleId: item.articleId, sourceKey: item.sourceKey,
      url: item.url, sourceOrigin: item.sourceOrigin, fetchOrigin: item.fetchOrigin })) } };
  }
  async function validateMessage(evidence) {
    if (evidence?.urls?.length) await checkUrls(evidence.urls);
    if (evidence?.items?.length) await assertFeedItemsStillPermitted(evidence.items);
  }
  async function checkUrls(urls) {
    const validation = await assertUrlsStillPermitted(urls);
    if (!(await Promise.all((validation?.origins || urls).map(url => hasOriginPermission(url)))).every(Boolean)) {
      throw Object.assign(new Error("source-permission-changed"), { code: "SOURCE_PERMISSION_CHANGED", messageKey: "background.error.sourcePermission" });
    }
  }
  function recordKey(connectionId) { return `bot-native-brief:${hashText(connectionId)}`; }
  function sourceFingerprint(item) { return hashText(`${localizationFingerprint(item)}|${item.publishedAt || ""}`); }
  function validRecord(record, settings, feed) {
    return record?.date === localDateKey() && record.locale === settingsLocale(settings) && sourcesCurrent(record, feed);
  }
  function sourcesCurrent(record, feed) {
    return record?.sources?.length > 0 && record.sources.every(source => feed.raw.some(item => item.url === source.url
      && item.sourceKey === source.sourceKey && sourceFingerprint(item) === source.fingerprint));
  }
  async function displayRecordValid(record, settings, feed) {
    // Freshness triggers replacement work; saved content still requires its original source access.
    return record?.locale === settingsLocale(settings) && await sourcesAvailable(record, feed);
  }
  async function sourcesAvailable(record, feed) {
    if (!record?.sources?.length) return false;
    const sources = record.sources.map(source => source.sourceOrigin ? source
      : feed.raw.find(item => item.url === source.url && item.sourceKey === source.sourceKey));
    if (sources.some(source => !source?.sourceKey || !source.sourceOrigin)) return false;
    try { await assertFeedItemsStillPermitted(sources); return true; } catch { return false; }
  }
  async function sanitizeBoard(board) {
    if (!board.connection || !botGeneratesBrief(await getSettings())) return board;
    const records = await getRecord(recordKey(board.connectionId), { jobs: [] });
    board = { ...board, brief: board.brief || { status: records.lastJob?.status || "empty" } };
    const marker = board.modules?.today?.data?.nativeBrief;
    if (!marker && board.modules?.today?.data?.brief) return { ...board,
      brief: { status: board.brief.status === "pending" ? "pending" : "published" } };
    const own = records.lastJob?.snapshot || records.completedSnapshot;
    if (!marker && !own) return board;
    const permission = capturePermissionEpoch(), epoch = cacheMutations.capture();
    const settings = await getSettings(), publisher = await owner();
    const record = records.jobs.find(job => job.id === marker?.taskId);
    const feed = await readPermittedFeed(settings);
    if (marker?.owner === publisher && await displayRecordValid(record, settings, feed) && isPermissionEpochCurrent(permission) && cacheMutations.isCurrent(epoch)) {
      const status = records.lastJob?.status === "pending" && records.lastJob.id !== marker.taskId ? "pending" : "completed";
      return { ...board, brief: { status } };
    }
    if (marker?.owner !== publisher && own?.data?.nativeBrief?.owner === publisher
      && await displayRecordValid(records.jobs.find(job => job.id === own.data.nativeBrief.taskId), settings, feed)
      && isPermissionEpochCurrent(permission) && cacheMutations.isCurrent(epoch)) {
      const status = records.lastJob?.status === "pending" ? "pending" : "completed";
      return { ...board, brief: { status }, modules: { ...board.modules, today: {
        ...own, data: { ...own.data, ...board.modules?.today?.data, brief: own.data.brief, nativeBrief: own.data.nativeBrief },
      } } };
    }
    if (marker?.owner === publisher && record && !await sourcesAvailable(record, feed)) {
      await botBoard.syncBrief({ owner: publisher, invalidateIds: [marker.taskId] }, true).catch(() => {});
    }
    if (!board.modules?.today) return { ...board, briefStatus: "stale" };
    return { ...board, modules: { ...board.modules, today: { ...board.modules.today,
      data: { ...board.modules.today.data, brief: "", nativeBrief: undefined } } }, briefStatus: "stale" };
  }
  async function syncBrief(force = false) {
    const configuration = await botBoard.config();
    if (!configuration.connection) return { status: "unpaired" };
    const publisher = await owner(), key = recordKey(configuration.connectionId);
    const settings = await getSettings();
    if (!botGeneratesBrief(settings)) {
      const previous = await getRecord(key, { jobs: [] });
      if (previous.jobs.length && previous.lastJob?.status !== "disabled") {
        try {
          await botBoard.syncBrief({ owner: publisher, cancel: true }, true);
          await cacheMutations.run(() => setRecord(key, { ...previous, lastJob: { status: "disabled" } }, "cache"));
        } catch { /* An unavailable companion will expire the previous task lease. */ }
      }
      return { status: "disabled" };
    }
    if ((await getRefreshStatus()).running) return { status: "collecting" };
    const epoch = cacheMutations.capture(), permission = capturePermissionEpoch(), locale = settingsLocale(settings), date = localDateKey();
    const current = async () => cacheMutations.isCurrent(epoch) && isPermissionEpochCurrent(permission)
      && botGeneratesBrief(await getSettings()) && settingsLocale(await getSettings()) === locale
      && (await botBoard.config()).connectionId === configuration.connectionId;
    const feed = await readPermittedFeed(settings);
    const previous = await getRecord(key, { jobs: [] });
    const cachedBoard = await botBoard.read?.();
    const cachedToday = cachedBoard?.modules?.today;
    if (!force && cachedToday?.data?.brief && !cachedToday.data.nativeBrief && localDateKey(Date.parse(cachedToday.updatedAt)) === date) {
      if (previous.lastJob?.status === "pending") await botBoard.syncBrief({ owner: publisher, cancel: true }, true).catch(() => {});
      if (previous.lastJob?.status !== "published") await cacheMutations.run(async check => {
        if (check() && await current()) await setRecord(key, { ...previous, lastJob: { status: "published" } }, "cache");
      }, epoch);
      return { status: "published" };
    }
    if (!force && previous.lastJob?.status === "completed" && previous.lastJob.snapshot
      && validRecord(previous.jobs.find(job => job.id === previous.lastJob.id), settings, feed)) return { status: "completed", taskId: previous.lastJob.id };
    const selected = buildDailyCandidates(feed.visible, { limit: 12, recentLimit: 3, publisherLimit: settings.todayNewsPerPublisherLimit, aiRankingEnabled: false });
    const material = briefContext(selected);
    if (!material.context.length) {
      await botBoard.syncBrief({ owner: publisher, cancel: true }, true).catch(() => {});
      if (previous.lastJob?.status !== "empty") await cacheMutations.run(async check => {
        if (check() && await current()) await setRecord(key, { ...previous, lastJob: { status: "empty" } }, "cache");
      }, epoch);
      return { status: "empty" };
    }
    const fingerprint = hashText(JSON.stringify([locale, material.context]));
    const id = `brief-${hashText(`${publisher}|${date}|${fingerprint}`)}`;
    const sources = selected.filter(item => material.references.some(ref => ref.url === item.url || ref.id === taskReference(item).id)).map(item => {
      const raw = feed.raw.find(value => value.url === item.url && value.sourceKey === item.sourceKey);
      return { url: item.url, sourceKey: item.sourceKey, sourceOrigin: (raw || item).sourceOrigin,
        fetchOrigin: (raw || item).fetchOrigin, fingerprint: sourceFingerprint(raw || item) };
    });
    const jobs = [...previous.jobs.filter(job => job.id !== id), { id, date, locale, sources, fingerprint }].slice(-30);
    if (!await current()) return { status: "cancelled" };
    await cacheMutations.run(async check => {
      if (check() && await current() && JSON.stringify(jobs) !== JSON.stringify(previous.jobs)) await setRecord(key, { ...previous, jobs }, "cache");
    }, epoch);
    if (!await current()) return { status: "cancelled" };
    try {
      let response = await botBoard.syncBrief({ owner: publisher, force: Boolean(force), request: { id, date, locale, fingerprint, ...material } });
      const returned = jobs.find(job => job.id === response.job?.id);
      if (response.job?.status === "completed" && !validRecord(returned, settings, feed) && await current()) {
        response = await botBoard.syncBrief({ owner: publisher, force: true, request: { id, date, locale, fingerprint, ...material } });
      }
      if (!await current()) return { status: "cancelled" };
      if (response.job?.snapshot) {
        response.job.snapshot = normalizeBotModule("today", response.job.snapshot);
        if (response.job.snapshot.data.nativeBrief?.taskId !== response.job.id || response.job.snapshot.data.nativeBrief?.owner !== publisher) throw new Error("invalid-brief-owner");
      }
      if (JSON.stringify(previous.lastJob) !== JSON.stringify(response.job)) await cacheMutations.run(async check => {
        if (check() && await current()) await setRecord(key, { ...previous, jobs, lastJob: response.job,
          completedSnapshot: response.job?.snapshot || previous.lastJob?.snapshot || previous.completedSnapshot }, "cache");
      }, epoch);
      return { status: response.job?.status || "empty", taskId: response.job?.id || "" };
    } catch (error) { return { status: "unavailable", errorKey: error.messageKey || "background.bot.networkFailed" }; }
  }
}
