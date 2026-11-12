import assert from "node:assert/strict";
import { DASHBOARD_CARD_IDS, normalizeDashboardCardOrder, swapDashboardCards } from "../../extension/core/dashboard-layout.mjs";
import { DEFAULT_SETTINGS } from "../../extension/core/constants.mjs";
import { normalizeSettings } from "../../extension/core/settings.mjs";
import { createSettingsStore } from "../../extension/core/settings-store.mjs";
import { createSettingsTransferDocument, parseSettingsTransferDocument } from "../../extension/core/settings-transfer.mjs";
import { createSettingsWorkflow } from "../../extension/runtime/settings-workflow.mjs";
import { createDashboardLayoutState } from "../../assets/client/dashboard-layout-state.mjs";

export async function runDashboardLayoutTests() {
  for (const value of [null, undefined, "news", {}, 3]) assert.deepEqual(normalizeDashboardCardOrder(value), DASHBOARD_CARD_IDS);
  assert.deepEqual(DASHBOARD_CARD_IDS, ["utility", "digest", "archive", "news", "inspiration", "queue"], "the archive defaults to the compact left slot and the reading queue to the tall right slot");
  assert.deepEqual(normalizeDashboardCardOrder(["archive", "archive", "unknown", {}, "news"]), ["archive", "news", "utility", "digest", "inspiration", "queue"]);
  assert.deepEqual(normalizeSettings({}).dashboardCardOrder, DASHBOARD_CARD_IDS, "settings without a saved layout adopt the defaults");
  const previousOrder = ["utility", "digest", "queue", "news", "inspiration", "archive"];
  assert.deepEqual(normalizeSettings({ dashboardCardOrder: previousOrder }).dashboardCardOrder, previousOrder, "a complete saved layout must not be migrated or overwritten");
  for (let left = 0; left < 6; left += 1) {
    for (let right = left + 1; right < 6; right += 1) {
      const next = swapDashboardCards(DASHBOARD_CARD_IDS, DASHBOARD_CARD_IDS[left], DASHBOARD_CARD_IDS[right]);
      assert.equal(next[left], DASHBOARD_CARD_IDS[right]);
      assert.equal(next[right], DASHBOARD_CARD_IDS[left]);
      for (let index = 0; index < 6; index += 1) {
        if (index !== left && index !== right) assert.equal(next[index], DASHBOARD_CARD_IDS[index]);
      }
      assert.deepEqual(swapDashboardCards(next, DASHBOARD_CARD_IDS[left], DASHBOARD_CARD_IDS[right]), DASHBOARD_CARD_IDS);
    }
  }
  assert.deepEqual(swapDashboardCards(null, "unknown", "news"), DASHBOARD_CARD_IDS);

  const records = {};
  const store = createSettingsStore({
    get: async (keys) => keys === null ? { ...records } : Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map((key) => [key, records[key]])),
    set: async (value) => Object.assign(records, structuredClone(value)),
    remove: async (keys) => { for (const key of keys) delete records[key]; },
    clear: async () => { for (const key of Object.keys(records)) delete records[key]; },
  });
  const reordered = swapDashboardCards(DASHBOARD_CARD_IDS, "utility", "news");
  await store.write({ ...DEFAULT_SETTINGS, colorMode: "light", dashboardCardOrder: reordered });
  assert.deepEqual((await store.read()).dashboardCardOrder, reordered, "the real sync codec must round-trip the layout");
  const transferred = createSettingsTransferDocument(await store.read());
  assert.deepEqual(parseSettingsTransferDocument(transferred).patch.dashboardCardOrder, reordered);
  await store.reset();
  assert.deepEqual((await store.read()).dashboardCardOrder, DASHBOARD_CARD_IDS);

  let saved = normalizeSettings({ colorMode: "light" });
  const broadcasts = [];
  const workflow = createSettingsWorkflow({
    getSettings: async () => saved,
    defaultSettings: DEFAULT_SETTINGS,
    settingsService: { mutate: (action) => action({ write: async (value) => { saved = normalizeSettings(value); } }) },
    contentSyncService: { applySettings: async () => {} },
    secretStatus: async () => ({}),
    emptyBookmarkModel: () => ({}),
    selectedOrigins: async () => [],
    currentFeedPermissionState: async () => ({}),
    filterSourceQuality: (value) => value,
    getRecord: async (key, fallback) => fallback,
    emptySourceQuality: () => ({}),
    broadcast: (...args) => broadcasts.push(args),
    startRefresh: () => assert.fail("layout changes must not fetch feeds or start AI"),
  });
  const result = await workflow.saveSettings({ dashboardCardOrder: reordered });
  assert.deepEqual(result.dashboardCardOrder, reordered);
  assert.equal(result.colorMode, "light", "layout patches must preserve unrelated settings");
  assert.deepEqual(broadcasts, [["settings.changed", { dashboardLayoutOnly: true, dashboardCardOrder: reordered }]]);

  let resolveSave;
  let rejectSave;
  let visible;
  const painted = [];
  const feedback = [];
  const busy = [];
  let writes = 0;
  const state = createDashboardLayoutState({
    save: () => { writes += 1; return new Promise((resolve, reject) => { resolveSave = resolve; rejectSave = reject; }); },
    apply: (order) => { visible = [...order]; painted.push(visible); },
    feedback: (status) => feedback.push(status),
    setBusy: (value) => busy.push(value),
  });
  const first = state.swap("utility", "news");
  assert.deepEqual(visible, reordered, "the swap paints before the save resolves");
  assert.equal(await state.swap("queue", "archive"), false);
  state.sync(DASHBOARD_CARD_IDS);
  assert.deepEqual(state.getOrder(), reordered, "stale refresh data cannot reset an in-flight layout");
  resolveSave({ dashboardCardOrder: reordered });
  assert.equal(await first, true);
  assert.equal(painted.length, 1, "a fast successful save must not reapply the same order and cancel its animation");
  assert.equal(writes, 1);
  assert.deepEqual(busy, [true, false]);
  assert.deepEqual(feedback, ["saving", "saved"]);
  const reopened = createDashboardLayoutState({ initialOrder: reordered });
  assert.deepEqual(reopened.getOrder(), reordered);
  const failed = state.swap("queue", "archive");
  rejectSave(new Error("synthetic storage failure"));
  assert.equal(await failed, false);
  assert.equal(painted.length, 3, "a failed save must animate the optimistic move and then the rollback");
  assert.deepEqual(visible, reordered, "a failed save rolls back to the last confirmed order");
  assert.equal(feedback.at(-1), "failed");
  const external = swapDashboardCards(reordered, "digest", "inspiration");
  const concurrent = state.swap("queue", "archive");
  state.sync(external, { external: true });
  resolveSave({ dashboardCardOrder: reordered });
  await concurrent;
  assert.deepEqual(visible, external, "a newer committed settings event wins over an older response");
}
