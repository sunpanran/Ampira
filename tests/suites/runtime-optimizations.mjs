import assert from "node:assert/strict";
import { createDashboardController } from "../../assets/client/dashboard-controller.mjs";
import { createLazyController } from "../../assets/client/lazy-controller.mjs";
import { createBookmarkModelCache } from "../../extension/core/bookmark-model-cache.mjs";
import { createRefreshCoordinator } from "../../extension/core/refresh-coordinator.mjs";
import { fetchSourceArticles } from "../../extension/core/feed.mjs";
import { fetchSourceImageCandidateRecords } from "../../extension/core/preview.mjs";
import { buildPermissionRows, filterFeedItemsBySources, originPattern } from "../../extension/core/permission-state.mjs";
import { createRefreshService } from "../../extension/runtime/refresh-service.mjs";
import { createDashboardContentService } from "../../extension/runtime/dashboard-content-service.mjs";
import { createRuntimeStatusStore } from "../../extension/runtime/status-store.mjs";
import { mapWithConcurrency, safeOrigin, hostOf, pipelineStages, updateSourceQualityRecord } from "../../extension/runtime/runtime-utils.mjs";

export async function runRuntimeOptimizationTests() {
  await testDashboardLoads();
  await testContentPermissions();
  await testStatusBroadcast();
  await testBookmarkModels();
  await testRefreshCancellation();
  await testFeedCancellation();
  await testLazyController();
}

async function testDashboardLoads() {
  const pending = [];
  const renders = [];
  const errors = [];
  const bookmarks = [{ key: "synthetic-bookmark" }];
  const state = { data: { bookmarks, ai: {} } };
  const noop = () => {};
  const controller = createDashboardController({
    state,
    els: { dailyBoard: { removeAttribute: noop }, summaryGrid: { removeAttribute: noop } },
    apiGet: (url) => new Promise((resolve, reject) => pending.push({ url, resolve, reject })),
    renderConnectionError: (error) => errors.push(error),
    t: (key) => key, localizedErrorMessage: (error) => error.message,
    renderOverviewStatus: () => renders.push("notice"),
    renderStatus: () => renders.push("status"),
    renderEfficiencyPanel: () => renders.push("efficiency"),
    renderDaily: () => renders.push("daily"),
    renderSummaries: () => renders.push("summaries"),
    renderExclusionList: noop, renderExcludeFolderOptions: noop,
    renderTodayMetaValue: noop, formatTodayMeta: noop, renderWebsiteShortcuts: noop,
    renderSectionFilters: noop, renderCategoryFilters: noop,
    renderCategories: () => renders.push("bookmarks"), preloadDailyInspiration: noop,
  });
  const burst = Array.from({ length: 12 }, () => controller.loadDashboard({ scope: "news" }));
  await Promise.resolve();
  assert.equal(pending.length, 1, "a burst of twelve notifications must share one dashboard request");
  assert.equal(pending[0].url, "/api/dashboard?scope=news");
  pending[0].resolve({ feed: { items: [] }, ai: {} });
  await Promise.all(burst);
  assert.equal(state.data.bookmarks, bookmarks, "content reloads must preserve the bookmark snapshot");
  assert(!renders.includes("bookmarks"), "content reloads must not render the bookmark tree");

  renders.length = 0;
  controller.applyAiProgress({ autoStatus: { processed: 2 }, usedToday: 4 });
  assert.deepEqual(renders, ["status"], "status-only notifications must only update status controls");
  assert.equal(pending.length, 1, "status-only notifications must not read dashboard data");
  assert.equal(state.data.ai.usedToday, 4);
  renders.length = 0;
  controller.applyAiProgress({ autoStatus: { running: true, phase: "running-digest" } });
  assert.deepEqual(renders, ["status", "efficiency"], "brief generation must update its visible state without reloading data");
  renders.length = 0;
  controller.applyAiProgress({ autoStatus: { running: true, phase: "running-digest", processed: 1 } });
  assert.deepEqual(renders, ["status"], "unchanged brief phases must not repaint the card");
  renders.length = 0;
  controller.applyAiProgress({ autoStatus: { running: false, phase: "completed" } });
  assert.deepEqual(renders, ["status", "efficiency"], "finished generation must release the busy brief");
  assert.equal(pending.length, 1);

  const first = controller.loadDashboard({ scope: "news", render: false });
  await Promise.resolve();
  const newer = Array.from({ length: 12 }, () => controller.loadDashboard({ render: false }));
  assert.equal(pending.length, 2);
  pending[1].resolve({ marker: "stale" });
  await Promise.resolve();
  assert.equal(state.data.marker, undefined);
  assert.equal(pending.length, 3, "notifications during a request must coalesce into one fresh follow-up");
  assert.equal(pending[2].url, "/api/dashboard", "a full invalidation must take precedence over a news update");
  controller.applyAiProgress({ autoStatus: { processed: 3 }, usedToday: 5 });
  pending[2].resolve({ marker: "fresh", bookmarks, ai: { usedToday: 4, autoStatus: { processed: 2 } } });
  await Promise.all([first, ...newer]);
  assert.equal(state.data.marker, "fresh");
  assert.equal(state.data.ai.autoStatus.processed, 3, "late dashboard snapshots must preserve newer progress");
  assert.equal(state.data.ai.usedToday, 5);

  const failed = controller.loadDashboard({ render: false });
  await Promise.resolve();
  pending.at(-1).reject(new Error("synthetic failure"));
  assert.equal(await failed, false);
  const retry = controller.loadDashboard({ render: false });
  await Promise.resolve();
  pending.at(-1).resolve({ marker: "retry" });
  assert.equal(await retry, true, "failed requests must release the loading slot");
  assert.equal(errors.length, 1);

  const partialFailure = controller.loadDashboard({ scope: "news" });
  await Promise.resolve();
  pending.at(-1).reject(new Error("synthetic content failure"));
  await partialFailure;
  assert.equal(errors.length, 1, "a content-only failure must preserve the visible dashboard");
  assert.equal(renders.at(-1), "notice");
  const fullFailure = controller.loadDashboard({ render: false });
  await Promise.resolve();
  pending.at(-1).reject(new Error("synthetic full failure"));
  await fullFailure;
  const recovery = controller.loadDashboard({ scope: "news", render: false });
  await Promise.resolve();
  assert.equal(pending.at(-1).url, "/api/dashboard", "recovery from a full error surface must restore every region");
  pending.at(-1).resolve({ bookmarks });
  await recovery;
}

async function testContentPermissions() {
  const source = { key: "synthetic", url: "https://source.example/feed", cardType: "news" };
  const article = { articleId: "article", sourceKey: source.key, sourceOrigin: "https://source.example", url: "https://source.example/article" };
  let origins = ["https://source.example/*"];
  let epoch = 0;
  let invalidateDuringRead = false;
  const settings = { bookmarkConsentGranted: true, publicFeedSupplementEnabled: false };
  const service = createDashboardContentService({
    cacheMutations: { capture: () => epoch, isCurrent: (value) => value === epoch },
    capturePermissionEpoch: () => epoch, isPermissionEpochCurrent: (value) => value === epoch,
    getSettings: async () => ({ ...settings }),
    settingsLocale: () => "en", secretStatus: async () => ({}),
    currentBookmarkModel: async () => ({ bookmarks: [source], sections: [{ name: "Synthetic" }] }),
    feedCacheOrEmpty: (value) => value,
    getRecord: async (key, fallback) => {
      if (invalidateDuringRead) epoch += 1;
      return key === "feed" ? { items: [article] } : fallback;
    },
    getRefreshStatus: async () => ({}), readQuota: async () => ({ used: 0 }),
    emptySourceQuality: () => ({ records: {} }), getAiAutoStatus: async () => ({}),
    filterFeedItemsBySources, originsFromUrls: (urls) => urls.map(safeOrigin), buildPermissionRows, originPattern,
    withFeedCacheMetadata: (value) => value, sanitizeCardAiSummaries: (items) => items,
    presentableFeedItems: (items) => items, buildFallbackDigest: () => ({ status: "local" }),
    summarizeQuality: (records) => ({ records }), buildDailyCandidates: (items) => items,
    pipelineStages, providerCredentialAvailable: () => false,
    chrome: { permissions: { getAll: async () => ({ origins }) } },
  });
  const full = await service.buildDashboardPayload();
  const news = await service.buildDashboardPayload(0, "news");
  assert.equal(full.bookmarks.length, 1);
  assert.equal(Object.hasOwn(news, "bookmarks"), false);
  assert.equal(Object.hasOwn(news, "sections"), false);
  assert.equal(news.feed.items.length, 1);
  for (const mcpEnabled of [false, true]) {
    for (const dashboardMode of ["standard", "bot"]) {
      for (const cardSummaryEnabled of [true, false]) {
        Object.assign(settings, { mcpEnabled, dashboardMode, cardSummaryEnabled });
        for (const scope of ["all", "news"]) {
          assert.equal((await service.buildDashboardPayload(0, scope)).ai.cardSummaryEnabled, cardSummaryEnabled,
            "MCP or Bot mode must not hide native manual summary actions in full or incremental dashboard responses");
        }
      }
    }
  }
  origins = [];
  assert.equal((await service.buildDashboardPayload(0, "news")).feed.items.length, 0, "news-only responses must recheck current permissions");
  origins = ["https://source.example/*"];
  invalidateDuringRead = true;
  const unstable = await service.buildDashboardPayload(0, "news");
  assert.equal(unstable.feed.items.length, 0, "repeated permission invalidation must fail closed");
  assert.equal(Object.hasOwn(unstable, "bookmarks"), false, "retries must preserve the response scope");
}

async function testStatusBroadcast() {
  const messages = [];
  const status = createRuntimeStatusStore({
    setRecord: async () => {}, readUsage: async () => 7,
    broadcast: (type, payload) => messages.push({ type, payload }),
  });
  await status.setAiAutoStatus({ processed: 2 });
  await status.setAiAutoStatus({ processed: 3 }, true, { contentChanged: true });
  await status.setAiAutoStatus({ processed: 0 }, false);
  assert.equal(messages.length, 2);
  assert(messages.every((message) => message.type === "dashboard.ai-progress"));
  assert.equal(messages[0].payload.usedToday, 7);
  assert.equal(messages[0].payload.contentChanged, false);
  assert.equal(messages[1].payload.contentChanged, true);
}

async function testBookmarkModels() {
  let reads = 0;
  let builds = 0;
  let date = new Date(2026, 8, 7);
  const cache = createBookmarkModelCache({
    readTree: async () => { reads += 1; return [{ id: reads }]; },
    buildModel: (tree, settings, locale) => { builds += 1; return { tree, settings, locale }; },
    now: () => date,
  });
  const settings = { newsBookmarkFolder: "Synthetic", bookmarkOnlyFolders: ["Archive"] };
  const models = await Promise.all(Array.from({ length: 12 }, () => cache.get(settings, "en")));
  assert.equal(reads, 1);
  assert.equal(builds, 1);
  assert(models.every((model) => model === models[0]));
  await cache.get({ ...settings, colorMode: "light" }, "en");
  assert.equal(builds, 1, "appearance changes must not rebuild bookmarks");
  settings.bookmarkOnlyFolders.push("Second");
  await cache.get(settings, "en");
  assert.equal(builds, 2, "in-place source-setting edits must invalidate the derived model");
  await cache.get(settings, "zh-CN");
  date = new Date(2026, 8, 8);
  await cache.get(settings, "zh-CN");
  assert.equal(builds, 4);
  assert.equal(reads, 1, "locale, settings and day changes must reuse the unchanged raw tree");
  cache.invalidate();
  await cache.get(settings, "zh-CN");
  assert.equal(reads, 2);

  const pending = [];
  const raced = createBookmarkModelCache({
    readTree: () => new Promise((resolve) => pending.push(resolve)),
    buildModel: (tree) => tree,
  });
  const old = raced.get({}, "en");
  await Promise.resolve();
  raced.invalidate();
  const current = raced.get({}, "en");
  await Promise.resolve();
  pending[0](["stale"]);
  pending[1](["current"]);
  assert.deepEqual(await old, ["current"], "a bookmark change during getTree must never publish the old tree");
  assert.deepEqual(await current, ["current"]);

  let fail = true;
  const retry = createBookmarkModelCache({
    readTree: async () => { if (fail) throw new Error("synthetic failure"); return ["recovered"]; },
    buildModel: (tree) => tree,
  });
  await assert.rejects(retry.get({}, "en"));
  fail = false;
  assert.deepEqual(await retry.get({}, "en"), ["recovered"]);
}

async function testRefreshCancellation() {
  const firstWave = deferred();
  const gate = deferred();
  const sources = Array.from({ length: 12 }, (_, index) => ({ key: `synthetic-${index}`, url: `https://source${index}.example/feed` }));
  let calls = 0;
  let running;
  let signal;
  const coordinator = createRefreshCoordinator();
  const service = createRefreshService({
    refreshCoordinator: coordinator, cacheMutations: { capture: () => 0 },
    getSettings: async () => ({ bookmarkConsentGranted: true }), settingsLocale: () => "en",
    currentBookmarkModel: async () => ({ bookmarks: sources }),
    currentFeedPermissionState: async () => ({ sources, permitted: sources, denied: [] }),
    selectRefreshBatch: () => ({ sources }), getRecord: async (_key, fallback) => fallback,
    setRefreshStatus: async () => {}, broadcast: () => {}, pipelineStages,
    emptySourceQuality: () => ({ records: {} }), feedCacheOrEmpty: (value) => value,
    sourceFetchOptions: () => ({}), mapWithConcurrency, safeOrigin, hostOf, updateSourceQualityRecord,
    fetchSourceArticles: async (_source, options) => {
      calls += 1;
      assert.equal(options.signal, signal);
      if (calls === 4) firstWave.resolve();
      await gate.promise;
      return { items: [], outcome: "empty" };
    },
    cardSummaryPolicy: {}, feedImageService: {},
  });
  coordinator.setRun((generation, options) => {
    signal = options.signal;
    running = service.runRefresh(generation, options);
    return running;
  });
  await coordinator.start(true);
  await firstWave.promise;
  coordinator.invalidate();
  assert.equal(signal.aborted, true, "invalidation must abort in-flight network operations");
  gate.resolve();
  await running;
  assert.equal(calls, 4, "eight queued sources must never start after invalidation");
}

async function testFeedCancellation() {
  const originalFetch = globalThis.fetch;
  const controller = new AbortController();
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    controller.abort();
    throw controller.signal.reason;
  };
  try {
    await assert.rejects(fetchSourceArticles({ url: "https://source.example" }, { signal: controller.signal }), (error) => error.name === "AbortError");
    assert.equal(calls, 1, "cancellation must not fall through to another discovery candidate");
    await assert.rejects(fetchSourceArticles({ url: "https://source.example" }, { signal: controller.signal }));
    assert.equal(calls, 1, "already-aborted work must never call fetch");
    await assert.rejects(fetchSourceImageCandidateRecords("https://source.example/article", { signal: controller.signal }));
    assert.equal(calls, 1, "image enrichment must propagate the refresh cancellation signal");
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function testLazyController() {
  const gate = deferred();
  let loads = 0;
  const calls = [];
  const lazy = createLazyController({
    load: async () => { loads += 1; await gate.promise; return { open: (...args) => calls.push(args), close() {}, syncLocale() {} }; },
  });
  lazy.call("syncLocale");
  assert.equal(loads, 0, "initial status and locale sync must not load an unopened feature");
  const first = lazy.open("older");
  const second = lazy.open("latest", true);
  await Promise.resolve();
  assert.equal(loads, 1);
  gate.resolve();
  assert.equal(await first, false);
  assert.equal(await second, true);
  assert.deepEqual(calls, [["latest", true]]);
  await lazy.open("reopen");
  assert.equal(loads, 1);
  const waiting = deferred();
  const closed = createLazyController({ load: () => waiting.promise });
  const opening = closed.open();
  closed.close();
  waiting.resolve({ open: () => assert.fail("closed lazy feature reopened") });
  assert.equal(await opening, false);
  let failures = 0;
  const retry = createLazyController({
    load: async () => { if (!failures) throw new Error("synthetic failure"); return { open() {} }; },
    onError: () => { failures += 1; },
  });
  assert.equal(await retry.open(), false);
  assert.equal(await retry.open(), true, "failed lazy imports must be retryable");
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}
