import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";
import { DEFAULT_SETTINGS, HEADER_IMAGE_HEIGHT_MAX } from "../../extension/core/constants.mjs";
import { normalizeSettings } from "../../extension/core/settings.mjs";
import { createSettingsStore } from "../../extension/core/settings-store.mjs";
import { encodeSettingsForSync, decodeSettingsFromSync } from "../../extension/core/settings-storage.mjs";
import { createSettingsTransferDocument, parseSettingsTransferDocument } from "../../extension/core/settings-transfer.mjs";
import { createSettingsWorkflow } from "../../extension/runtime/settings-workflow.mjs";
import { normalizeHeaderImageFit } from "../../assets/client/header-cover-model.mjs";
import { createHeaderCoverRenderer } from "../../assets/client/header-cover-renderer.mjs";
import { diffSettingsDraft, snapshotSettingsDraft } from "../../assets/client/settings-draft.mjs";

const modes = ["cover", "contain", "fill", "height"];
assert.equal(DEFAULT_SETTINGS.headerImageFit, "cover");
for (const value of [undefined, null, "", "stretch", "COVER", true, [], {}, "url(https://invalid.example)"]) {
  assert.equal(normalizeSettings({ headerImageFit: value }).headerImageFit, "cover");
  assert.equal(normalizeHeaderImageFit(value), "cover");
}
const records = {};
const storage = {
  get: async keys => keys === null ? { ...records } : Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, records[key]])),
  set: async values => Object.assign(records, structuredClone(values)),
  remove: async keys => { for (const key of keys) delete records[key]; },
  clear: async () => { for (const key of Object.keys(records)) delete records[key]; },
};
const store = createSettingsStore(storage), broadcasts = [];
const workflow = createSettingsWorkflow({
  getSettings: store.read, settingsLocale: settings => settings.uiLocale, defaultSettings: DEFAULT_SETTINGS,
  settingsService: store, contentSyncService: { applySettings: async () => {} }, secretStatus: async () => ({}),
  emptyBookmarkModel: () => ({}), selectedOrigins: async () => [], currentFeedPermissionState: async () => ({}),
  filterSourceQuality: value => value, getRecord: async (key, fallback) => fallback, emptySourceQuality: () => ({}),
  broadcast: (...args) => broadcasts.push(args), startRefresh: () => assert.fail("media fit must not refresh sources"),
});
await store.write({ ...DEFAULT_SETTINGS, headerImageHeightScale: HEADER_IMAGE_HEIGHT_MAX, uiLocale: "en" });
for (const fit of modes) {
  const saved = await workflow.saveSettings({ headerImageFit: fit });
  assert.equal(saved.headerImageFit, fit, "the setting must survive the runtime workflow");
  assert.equal(saved.headerImageHeightScale, HEADER_IMAGE_HEIGHT_MAX, "fit must not change the height setting");
  assert.equal(saved.sourceRefreshScheduled, false);
  assert.equal(saved.automaticAiStarted, false);
  const reloaded = await createSettingsStore(storage).read();
  assert.equal(reloaded.headerImageFit, fit);
  assert.equal(decodeSettingsFromSync(encodeSettingsForSync(reloaded)).headerImageFit, fit);
  const exported = createSettingsTransferDocument(reloaded);
  assert.equal(parseSettingsTransferDocument(exported).patch.headerImageFit, fit);
  assert.deepEqual(diffSettingsDraft({ headerImageFit: fit }, snapshotSettingsDraft(reloaded)), {});
}
assert.equal(broadcasts.length, modes.length);
assert(broadcasts.every(([type]) => type === "settings.changed"));
const exported = createSettingsTransferDocument(await store.read());
for (const value of ["stretch", "Cover", "", null, 1, {}]) {
  assert.throws(() => parseSettingsTransferDocument({ ...exported, settings: { ...exported.settings, headerImageFit: value } }),
    { code: "SETTINGS_IMPORT_INVALID_VALUE" });
}
delete exported.settings.headerImageFit;
assert.equal(Object.hasOwn(parseSettingsTransferDocument(exported, { headerImageFit: "contain" }).patch, "headerImageFit"), false,
  "older imports must preserve the selected fit");
await store.reset();
assert.equal((await store.read()).headerImageFit, "cover");

const bootstrap = await fs.readFile(new URL("../../assets/client/theme-bootstrap.mjs", import.meta.url), "utf8");
for (const fit of [...modes, undefined, "invalid"]) {
  const styles = new Map(), dataset = {};
  vm.runInNewContext(bootstrap, {
    document: { hidden: true, documentElement: { dataset, classList: { toggle() {} }, style: { setProperty: (key, value) => styles.set(key, value) } } },
    location: { protocol: "https:" },
    localStorage: { getItem: key => key === "ampira.headerCover" ? JSON.stringify({ enabled: false, fit }) : null },
  });
  const normalized = normalizeHeaderImageFit(fit);
  assert.equal(dataset.headerImageFit, normalized, "the first frame must restore the saved sizing policy");
  assert.equal(styles.get("--header-cover-object-fit"), normalized === "height" ? "cover" : normalized);
}

const keys = ["document", "location", "localStorage", "ampiraLayoutBootstrap"];
const originals = Object.fromEntries(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
try {
  const values = new Map(), styles = new Map();
  const classList = { add() {}, remove() {}, toggle() {} };
  const root = { dataset: {}, classList, style: { setProperty: (key, value) => styles.set(key, value) } };
  const attributes = new Map();
  const image = { getAttribute: key => attributes.get(key), removeAttribute: key => attributes.delete(key) };
  Object.defineProperty(image, "src", { set: value => attributes.set("src", value) });
  for (const [key, value] of Object.entries({
    document: { documentElement: root }, location: { origin: "https://extension.example" },
    localStorage: { setItem: (key, value) => values.set(key, value) },
    ampiraLayoutBootstrap: { setHeaderCoverVideo() {} },
  })) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const state = {};
  const renderer = createHeaderCoverRenderer({ state, els: { headerImage: image, headerImageHero: { classList } } });
  for (const fit of modes) {
    for (const local of [null, { dataUrl: "data:image/webp;base64,synthetic" },
      { videoId: "11111111-1111-4111-8111-111111111111", objectUrl: "blob:https://extension.example/synthetic" }]) {
      state.localHeaderCover = local;
      for (const type of ["image", "video"]) {
        renderer.renderHeaderImage({ headerImageEnabled: true, headerImageFixed: true, headerImageFullscreen: true,
          headerImageUrl: "https://media.example/cover", headerImageMediaType: type, headerImageFit: fit });
        assert.equal(root.dataset.headerImageFit, fit, "local and remote images and videos must share the fit setting");
        assert.equal(styles.get("--header-cover-object-fit"), fit === "height" ? "cover" : fit);
        assert.equal(JSON.parse(values.get("ampira.headerCover")).fit, fit, "preview must persist the first-frame hint");
      }
    }
  }
} finally {
  for (const [key, descriptor] of Object.entries(originals)) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  }
}

console.log("shared header cover fit tests passed");
