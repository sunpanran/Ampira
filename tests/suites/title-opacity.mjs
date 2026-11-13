import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";
import { DEFAULT_SETTINGS } from "../../extension/core/constants.mjs";
import { normalizeSettings } from "../../extension/core/settings.mjs";
import { createSettingsStore } from "../../extension/core/settings-store.mjs";
import { createSettingsTransferDocument, parseSettingsTransferDocument } from "../../extension/core/settings-transfer.mjs";
import { createSettingsWorkflow } from "../../extension/runtime/settings-workflow.mjs";
import { normalizeSectionTitleOpacity } from "../../assets/client/appearance-model.mjs";
import { diffSettingsDraft, snapshotSettingsDraft } from "../../assets/client/settings-draft.mjs";

assert.equal(DEFAULT_SETTINGS.sectionTitleOpacity, 100, "existing dashboards must keep their title visibility");
for (const value of [undefined, null, "", " ", "invalid", NaN, Infinity, {}, [], false, true]) {
  assert.equal(normalizeSettings({ sectionTitleOpacity: value }).sectionTitleOpacity, 100);
  assert.equal(normalizeSectionTitleOpacity(value), 100, "invalid values must not hide page titles");
}
for (const [value, expected] of [[0, 0], [25, 25], [50, 50], [75, 75], [100, 100], ["45", 50], [47.6, 50], [12, 0], [12.5, 25], [62.5, 75], [87.5, 100], [-20, 0], [120, 100]]) {
  assert.equal(normalizeSettings({ sectionTitleOpacity: value }).sectionTitleOpacity, expected);
  assert.equal(normalizeSectionTitleOpacity(value), expected);
}

const records = {};
const storage = {
  get: async keys => keys === null ? { ...records } : Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, records[key]])),
  set: async values => Object.assign(records, structuredClone(values)),
  remove: async keys => { for (const key of keys) delete records[key]; },
  clear: async () => { for (const key of Object.keys(records)) delete records[key]; },
};
const store = createSettingsStore(storage);
const broadcasts = [];
const workflow = createSettingsWorkflow({
  getSettings: store.read,
  settingsLocale: settings => settings.uiLocale,
  defaultSettings: DEFAULT_SETTINGS,
  settingsService: store,
  contentSyncService: { applySettings: async () => {} },
  secretStatus: async () => ({}),
  emptyBookmarkModel: () => ({}),
  selectedOrigins: async () => [],
  currentFeedPermissionState: async () => ({}),
  filterSourceQuality: value => value,
  getRecord: async (key, fallback) => fallback,
  emptySourceQuality: () => ({}),
  broadcast: (...args) => broadcasts.push(args),
  startRefresh: () => assert.fail("title opacity must not start background work"),
});
await store.write({ ...DEFAULT_SETTINGS, colorMode: "light", uiLocale: "en" });
for (const opacity of [0, 25, 50, 75, 100]) {
  const saved = await workflow.saveSettings({ sectionTitleOpacity: opacity });
  assert.equal(saved.sectionTitleOpacity, opacity, "settings writes must include opacity in the public response");
  assert.equal(saved.colorMode, "light", "opacity must preserve unrelated appearance choices");
  assert.equal(saved.sourceRefreshScheduled, false);
  assert.equal(saved.automaticAiStarted, false);
  const reloaded = await createSettingsStore(storage).read();
  assert.equal(reloaded.sectionTitleOpacity, opacity, "opacity must survive a fresh settings store");
  const exported = createSettingsTransferDocument(reloaded);
  assert.equal(parseSettingsTransferDocument(exported).patch.sectionTitleOpacity, opacity);
}
assert.equal(broadcasts.length, 5);
assert(broadcasts.every(([type]) => type === "settings.changed"), "other dashboards must receive the saved opacity");

const baseline = snapshotSettingsDraft(await store.read());
assert.deepEqual(diffSettingsDraft({ sectionTitleOpacity: "100" }, baseline), {}, "opening the presets must not create a draft");
assert.deepEqual(diffSettingsDraft({ sectionTitleOpacity: 0 }, baseline), { sectionTitleOpacity: 0 });
const exported = createSettingsTransferDocument(baseline);
assert.equal(parseSettingsTransferDocument({ ...exported, settings: { ...exported.settings, sectionTitleOpacity: 45 } }).patch.sectionTitleOpacity, 50,
  "older slider exports must map to the nearest preset");
assert.equal(createSettingsTransferDocument({ sectionTitleOpacity: 71 }).settings.sectionTitleOpacity, 75);
for (const invalid of [-1, 101, 0.5, "50", null]) {
  assert.throws(() => parseSettingsTransferDocument({ ...exported, settings: { ...exported.settings, sectionTitleOpacity: invalid } }),
    { code: "SETTINGS_IMPORT_INVALID_VALUE" });
}
delete exported.settings.sectionTitleOpacity;
assert.equal(Object.hasOwn(parseSettingsTransferDocument(exported, { sectionTitleOpacity: 45 }).patch, "sectionTitleOpacity"), false,
  "older exports must preserve the existing opacity");
await store.reset();
assert.equal((await store.read()).sectionTitleOpacity, 100);

const bootstrap = await fs.readFile(new URL("../../assets/client/theme-bootstrap.mjs", import.meta.url), "utf8");
for (const [hint, expected] of [[null, "1"], ["", "1"], ["0", "0"], ["25", "0.25"], ["45", "0.5"], ["47.6", "0.5"], ["75", "0.75"], ["-10", "0"], ["120", "1"], ["invalid", "1"]]) {
  const styles = new Map();
  const context = {
    document: { hidden: true, documentElement: { dataset: {}, classList: { toggle() {} }, style: { setProperty: (name, value) => styles.set(name, value) } } },
    location: { protocol: "https:" },
    localStorage: { getItem: key => key === "ampira.sectionTitleOpacity" ? hint : key === "ampira.headerCover" ? '{"enabled":false}' : null },
  };
  vm.runInNewContext(bootstrap, context);
  assert.equal(styles.get("--section-title-opacity") || "1", expected, "the first frame must restore valid opacity hints, including zero");
}

console.log("title opacity tests passed");
