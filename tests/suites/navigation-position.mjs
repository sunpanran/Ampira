import assert from "node:assert/strict";
import { DEFAULT_SETTINGS } from "../../extension/core/constants.mjs";
import { normalizeSettings } from "../../extension/core/settings.mjs";
import { createSettingsStore } from "../../extension/core/settings-store.mjs";
import { createSettingsTransferDocument, parseSettingsTransferDocument } from "../../extension/core/settings-transfer.mjs";
import { createSettingsWorkflow } from "../../extension/runtime/settings-workflow.mjs";
import { normalizeNavPosition } from "../../assets/client/appearance-model.mjs";
import { diffSettingsDraft, snapshotSettingsDraft } from "../../assets/client/settings-draft.mjs";

export async function runNavigationPositionTests() {
  assert.equal(DEFAULT_SETTINGS.navPosition, "left");
  assert.equal(DEFAULT_SETTINGS.navAutoHideEnabled, false);
  assert.equal(normalizeSettings({}).navAutoHideEnabled, false);
  assert.equal(normalizeSettings({ navAutoHideEnabled: true }).navAutoHideEnabled, true);
  for (const value of [undefined, null, "", "auto", "TOP", {}, [], 0]) {
    assert.equal(normalizeSettings({ navPosition: value }).navPosition, "left");
    assert.equal(normalizeNavPosition(value), "left");
  }

  const records = {};
  const store = createSettingsStore({
    get: async (keys) => keys === null ? { ...records } : Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map((key) => [key, records[key]])),
    set: async (value) => Object.assign(records, structuredClone(value)),
    remove: async (keys) => { for (const key of keys) delete records[key]; },
    clear: async () => { for (const key of Object.keys(records)) delete records[key]; },
  });
  const broadcasts = [];
  const workflow = createSettingsWorkflow({
    getSettings: store.read,
    settingsLocale: (settings) => settings.uiLocale,
    defaultSettings: DEFAULT_SETTINGS,
    settingsService: store,
    contentSyncService: { applySettings: async () => {} },
    secretStatus: async () => ({}),
    emptyBookmarkModel: () => ({}),
    selectedOrigins: async () => [],
    currentFeedPermissionState: async () => ({}),
    filterSourceQuality: (value) => value,
    getRecord: async (key, fallback) => fallback,
    emptySourceQuality: () => ({}),
    broadcast: (...args) => broadcasts.push(args),
    startRefresh: () => assert.fail("navigation preferences must not fetch feeds or start AI"),
  });
  await store.write({ ...DEFAULT_SETTINGS, colorMode: "light", uiLocale: "en" });
  for (const position of ["top", "bottom", "right", "left"]) {
    assert.equal(normalizeNavPosition(position), position);
    const result = await workflow.saveSettings({ navPosition: position });
    assert.equal(result.navPosition, position, "the settings transaction must expose the saved position");
    assert.equal(result.colorMode, "light", "a position patch must preserve other appearance settings");
    assert.equal((await store.read()).navPosition, position, "the sync codec must retain every position");
    assert.equal(result.sourceRefreshScheduled, false);
    assert.equal(result.automaticAiStarted, false);
    const transferred = createSettingsTransferDocument(await store.read());
    assert.equal(parseSettingsTransferDocument(transferred).patch.navPosition, position);
    transferred.settings.navPosition = "floating";
    assert.throws(() => parseSettingsTransferDocument(transferred), { name: "SettingsTransferError" });
  }
  assert.equal(broadcasts.length, 4, "other open dashboards must receive saved settings changes");
  for (const enabled of [true, false]) {
    const result = await workflow.saveSettings({ navAutoHideEnabled: enabled });
    assert.equal(result.navAutoHideEnabled, enabled);
    assert.equal((await store.read()).navAutoHideEnabled, enabled);
    assert.equal(result.navPosition, "left");
    assert.equal(result.sourceRefreshScheduled, false);
    assert.equal(result.automaticAiStarted, false);
    const transferred = createSettingsTransferDocument(await store.read());
    assert.equal(parseSettingsTransferDocument(transferred).patch.navAutoHideEnabled, enabled);
    transferred.settings.navAutoHideEnabled = "true";
    assert.throws(() => parseSettingsTransferDocument(transferred), { name: "SettingsTransferError" });
  }
  assert.equal(broadcasts.length, 6);
  assert(broadcasts.every(([type]) => type === "settings.changed"));
  const baseline = snapshotSettingsDraft(await store.read());
  assert.deepEqual(diffSettingsDraft({ ...baseline, navPosition: "right" }, baseline), { navPosition: "right" });
  assert.deepEqual(diffSettingsDraft({ ...baseline, navAutoHideEnabled: true }, baseline), { navAutoHideEnabled: true });
  assert.deepEqual(diffSettingsDraft({ ...baseline }, baseline), {}, "opening or restoring appearance must not create a draft");
  const legacy = createSettingsTransferDocument({ colorMode: "dark" });
  delete legacy.settings.navPosition;
  delete legacy.settings.navAutoHideEnabled;
  assert.equal(Object.hasOwn(parseSettingsTransferDocument(legacy, { navAutoHideEnabled: true }).patch, "navAutoHideEnabled"), false);
  assert.equal(Object.hasOwn(parseSettingsTransferDocument(legacy, { navPosition: "right" }).patch, "navPosition"), false,
    "older exports must not reset the saved position");
  await store.reset();
  assert.equal((await store.read()).navPosition, "left");
  assert.equal((await store.read()).navAutoHideEnabled, false);
}
