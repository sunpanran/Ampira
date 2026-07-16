import assert from "node:assert/strict";
import { createCardTransition } from "../../assets/client/card-transition.mjs";
import { createDashboardController } from "../../assets/client/dashboard-controller.mjs";
import { refreshAvailability } from "../../assets/client/status-view.mjs";

export async function runDashboardControllerTests() {
  testHiddenDocumentDisablesDeferredCardTransitions();
  testRefreshAvailability();
  await testRefreshRequestShowsImmediateFeedback();
  await testUnavailableAutomaticRefreshIsSkipped();
  await testRefreshStatusRendersDaily();
  const pending = [];
  const apiGet = () => new Promise((resolve) => pending.push(resolve));
  const state = { data: null, variants: {}, seen: new Set(), pollTimer: null };
  const noop = () => {};
  const controller = createDashboardController({
    state,
    els: {
      refresh: { disabled: false },
      dailyBoard: { removeAttribute: noop },
      summaryGrid: { removeAttribute: noop },
    },
    t: (key) => key,
    apiGet,
    apiPost: async () => ({}),
    preloadDailyInspiration: noop,
    inspirationPreloadTimeoutMs: 0,
    renderConnectionError: noop,
    renderStatus: noop,
    renderOverviewStatus: noop,
    localizedErrorMessage: String,
    renderExclusionList: noop,
    renderExcludeFolderOptions: noop,
    renderTodayMetaValue: noop,
    renderEfficiencyPanel: noop,
    renderDaily: noop,
    renderSummaries: noop,
    renderSectionFilters: noop,
    renderCategoryFilters: noop,
    renderCategories: noop,
    formatTodayMeta: () => ({ date: "", weekday: "", time: "", dateTime: "", label: "" }),
    getTodayKey: () => "2026-07-13",
    readNumber: (_key, fallback) => fallback,
    writeJson: noop,
    retainSeenArchiveEnabled: () => false,
    readSeenRecords: () => [],
    replaceSeenRecords: noop,
    refreshFeedbackMinMs: 0,
  });

  const first = controller.loadDashboard({ render: false });
  const second = controller.loadDashboard({ render: false });
  pending[1]({ marker: "newer" });
  await second;
  pending[0]({ marker: "stale" });
  await first;
  assert.equal(state.data.marker, "newer", "a stale dashboard response must not replace a newer generation");
}

async function testRefreshRequestShowsImmediateFeedback() {
  const noop = () => {};
  const refresh = feedbackButton();
  const settingsRefresh = feedbackButton();
  let resolveRefresh;
  const controller = createDashboardController({
    state: { data: {}, variants: {}, seen: new Set(), pollTimer: null },
    els: { refresh, settingsRefresh, dailyBoard: { removeAttribute: noop }, summaryGrid: { removeAttribute: noop } },
    t: (key) => key,
    apiGet: async () => ({}),
    apiPost: () => new Promise((resolve) => { resolveRefresh = resolve; }),
    preloadDailyInspiration: noop,
    inspirationPreloadTimeoutMs: 0,
    renderConnectionError: noop,
    renderStatus: noop,
    renderOverviewStatus: noop,
    localizedErrorMessage: String,
    renderExclusionList: noop,
    renderExcludeFolderOptions: noop,
    renderTodayMetaValue: noop,
    renderWebsiteShortcuts: noop,
    renderEfficiencyPanel: noop,
    renderDaily: noop,
    renderSummaries: noop,
    renderSectionFilters: noop,
    renderCategoryFilters: noop,
    renderCategories: noop,
    formatTodayMeta: () => ({}),
    getTodayKey: () => "2026-07-16",
    readNumber: (_key, fallback) => fallback,
    writeJson: noop,
    retainSeenArchiveEnabled: () => false,
    readSeenRecords: () => [],
    replaceSeenRecords: noop,
    refreshFeedbackMinMs: 0,
  });

  const request = controller.triggerRefresh(true);
  assert(refresh.classes.has("is-loading"), "refresh feedback must begin before the runtime responds");
  assert.equal(refresh.attributes.get("aria-busy"), "true");
  assert(settingsRefresh.classes.has("is-loading"), "both refresh entry points must share feedback");
  resolveRefresh({ started: false, status: { running: false } });
  await request;
  assert(!refresh.classes.has("is-loading"), "transient feedback must clear after the request settles");
  assert(!refresh.attributes.has("aria-busy"));
}

function feedbackButton() {
  const classes = new Set();
  const attributes = new Map();
  return {
    disabled: false,
    classes,
    attributes,
    classList: { toggle: (name, active) => active ? classes.add(name) : classes.delete(name) },
    setAttribute: (name, value) => attributes.set(name, value),
    removeAttribute: (name) => attributes.delete(name),
  };
}

function testRefreshAvailability() {
  assert.deepEqual(refreshAvailability(null), {
    available: false,
    reason: "loading",
    messageKey: "status.refreshUnavailable.loading",
  });
  assert.equal(refreshAvailability({
    status: { running: true },
    onboarding: { bookmarkConsentGranted: true },
    cache: { configuredSources: 2, refreshableSources: 2 },
  }).reason, "running");
  assert.equal(refreshAvailability({
    status: { running: false },
    onboarding: { bookmarkConsentGranted: false },
  }).reason, "consent");
  assert.equal(refreshAvailability({
    status: { running: false },
    onboarding: { bookmarkConsentGranted: true },
    cache: { configuredSources: 0, refreshableSources: 0 },
  }).reason, "no-sources");
  assert.equal(refreshAvailability({
    status: { running: false },
    onboarding: { bookmarkConsentGranted: true },
    cache: { configuredSources: 3, refreshableSources: 0 },
  }).reason, "permission");
  assert.equal(refreshAvailability({
    status: { running: false },
    onboarding: { bookmarkConsentGranted: true },
    cache: { configuredSources: 3, refreshableSources: 1 },
  }).available, true);
}

async function testRefreshStatusRendersDaily() {
  const noop = () => {};
  const state = { data: {}, variants: {}, seen: new Set(), pollTimer: null };
  let dailyRenderCount = 0;
  const controller = createDashboardController({
    state,
    els: {
      refresh: { disabled: false },
      settingsRefresh: { disabled: false },
      dailyBoard: { removeAttribute: noop },
      summaryGrid: { removeAttribute: noop },
    },
    t: (key) => key,
    apiGet: async () => ({ running: false }),
    apiPost: async () => ({ started: true, status: { running: true, progress: .25 } }),
    preloadDailyInspiration: noop,
    inspirationPreloadTimeoutMs: 0,
    renderConnectionError: noop,
    renderStatus: noop,
    renderOverviewStatus: noop,
    localizedErrorMessage: String,
    renderExclusionList: noop,
    renderExcludeFolderOptions: noop,
    renderTodayMetaValue: noop,
    renderWebsiteShortcuts: noop,
    renderEfficiencyPanel: noop,
    renderDaily: () => { dailyRenderCount += 1; },
    renderSummaries: noop,
    renderSectionFilters: noop,
    renderCategoryFilters: noop,
    renderCategories: noop,
    formatTodayMeta: () => ({ date: "", weekday: "", time: "", dateTime: "", label: "" }),
    getTodayKey: () => "2026-07-15",
    readNumber: (_key, fallback) => fallback,
    writeJson: noop,
    retainSeenArchiveEnabled: () => false,
    readSeenRecords: () => [],
    replaceSeenRecords: noop,
    refreshFeedbackMinMs: 0,
  });

  await controller.triggerRefresh(false);
  if (state.pollTimer) clearTimeout(state.pollTimer);
  assert.equal(state.data.status.progress, .25);
  assert.equal(dailyRenderCount, 1, "a running refresh response must reveal the daily news caching state immediately");
}

async function testUnavailableAutomaticRefreshIsSkipped() {
  const noop = () => {};
  let postCount = 0;
  const state = { data: {}, variants: {}, seen: new Set(), pollTimer: null };
  const controller = createDashboardController({
    state,
    els: {
      refresh: { disabled: false },
      settingsRefresh: { disabled: false },
      dailyBoard: { removeAttribute: noop },
      summaryGrid: { removeAttribute: noop },
    },
    t: (key) => key,
    apiGet: async () => state.data,
    apiPost: async () => {
      postCount += 1;
      return { started: false, status: { running: false } };
    },
    preloadDailyInspiration: noop,
    inspirationPreloadTimeoutMs: 0,
    renderConnectionError: noop,
    renderStatus: noop,
    renderOverviewStatus: noop,
    localizedErrorMessage: String,
    renderExclusionList: noop,
    renderExcludeFolderOptions: noop,
    renderTodayMetaValue: noop,
    renderWebsiteShortcuts: noop,
    renderEfficiencyPanel: noop,
    renderDaily: noop,
    renderSummaries: noop,
    renderSectionFilters: noop,
    renderCategoryFilters: noop,
    renderCategories: noop,
    formatTodayMeta: () => ({ date: "", weekday: "", time: "", dateTime: "", label: "" }),
    getTodayKey: () => "2026-07-15",
    readNumber: (_key, fallback) => fallback,
    writeJson: noop,
    retainSeenArchiveEnabled: () => false,
    readSeenRecords: () => [],
    replaceSeenRecords: noop,
    canRefresh: () => false,
    refreshFeedbackMinMs: 0,
  });

  await controller.triggerRefresh(false);
  assert.equal(postCount, 0, "an unavailable automatic refresh must not reach the runtime");
  await controller.triggerRefresh(true);
  assert.equal(postCount, 1, "forced refreshes after a source or permission change must remain available");
}

function testHiddenDocumentDisablesDeferredCardTransitions() {
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  globalThis.document = { hidden: true };
  globalThis.window = { matchMedia: () => ({ matches: false }) };
  try {
    const transition = createCardTransition({ exitMs: 110, enterMs: 240 });
    assert.equal(
      transition.prefersReducedMotion(),
      true,
      "a hidden dashboard must apply card diffs immediately instead of leaving transparent nodes behind",
    );
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
}
