import assert from "node:assert/strict";
import { createDashboardController } from "../../assets/client/dashboard-controller.mjs";

export async function runDashboardControllerTests() {
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
  });

  const first = controller.loadDashboard({ render: false });
  const second = controller.loadDashboard({ render: false });
  pending[1]({ marker: "newer" });
  await second;
  pending[0]({ marker: "stale" });
  await first;
  assert.equal(state.data.marker, "newer", "a stale dashboard response must not replace a newer generation");
}
