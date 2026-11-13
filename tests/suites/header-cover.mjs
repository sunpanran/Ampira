import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";
import {
  HEADER_COVER_MAX_DIMENSION,
  HEADER_COVER_STORED_MAX_BYTES,
  createHeaderCoverStore,
  normalizeHeaderCoverRecord,
  webpDataUrlByteLength,
} from "../../extension/core/header-cover.mjs";
import {
  DEFAULT_SETTINGS,
  HEADER_IMAGE_HEIGHT_MAX,
  HEADER_IMAGE_HEIGHT_MIN,
  LOCAL_HEADER_COVER_KEY,
} from "../../extension/core/constants.mjs";
import { normalizeSettings } from "../../extension/core/settings.mjs";
import { createSettingsTransferDocument, parseSettingsTransferDocument } from "../../extension/core/settings-transfer.mjs";
import { createSettingsWorkflow } from "../../extension/runtime/settings-workflow.mjs";
import {
  HEADER_COVER_ACCEPTED_TYPES, HEADER_COVER_MIN_LONG_EDGE, nextHeaderCoverDimensions,
} from "../../assets/client/header-cover-image.mjs";
import { createHeaderCoverController } from "../../assets/client/header-cover-controller.mjs";
import { createHeaderCoverRenderer } from "../../assets/client/header-cover-renderer.mjs";
import { DEFAULT_HEADER_IMAGE_URL, normalizeHeaderImageHeightScale } from "../../assets/client/header-cover-model.mjs";
import { createAppearanceController } from "../../assets/client/appearance-controller.mjs";
import { t } from "../../assets/client/i18n.mjs";
import { messageRequestForHttp } from "../../assets/client/message-contract.mjs";

const bytes = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBPfixture")]);
const dataUrl = `data:image/webp;base64,${bytes.toString("base64")}`;
const record = {
  schemaVersion: 1,
  dataUrl,
  name: "fixture.png",
  width: 1600,
  height: 900,
  byteLength: bytes.length,
};

assert.equal(webpDataUrlByteLength(dataUrl), bytes.length);
assert.equal(webpDataUrlByteLength("data:image/png;base64,AAAA"), 0);
assert.deepEqual(normalizeHeaderCoverRecord(record), {
  schemaVersion: 1,
  ...record,
  mimeType: "image/webp",
  updatedAt: new Date(0).toISOString(),
});
assert.equal(normalizeHeaderCoverRecord({ ...record, byteLength: bytes.length + 1 }), null);
assert.equal(normalizeHeaderCoverRecord({ ...record, width: HEADER_COVER_MAX_DIMENSION + 1 }), null);
assert.equal(normalizeHeaderCoverRecord({ ...record, schemaVersion: 2 }), null);
assert.equal(HEADER_COVER_STORED_MAX_BYTES, Math.floor(2.5 * 1024 * 1024));
assert.deepEqual(HEADER_COVER_ACCEPTED_TYPES, ["image/jpeg", "image/png", "image/webp", "image/avif"]);

assert.deepEqual(nextHeaderCoverDimensions(2560, 1440), { width: 2176, height: 1224 });
assert.deepEqual(nextHeaderCoverDimensions(HEADER_COVER_MIN_LONG_EDGE, 720), { width: 1280, height: 720 });

assert.equal(normalizeSettings({}).headerImageHeightScale, DEFAULT_SETTINGS.headerImageHeightScale);
assert.equal(normalizeSettings({ headerImageHeightScale: 62 }).headerImageHeightScale, HEADER_IMAGE_HEIGHT_MIN);
assert.equal(normalizeSettings({ headerImageHeightScale: 147 }).headerImageHeightScale, 145);
assert.equal(normalizeSettings({ headerImageHeightScale: 117 }).headerImageHeightScale, 115);
for (const [value, expected] of [[200, 200], [207, 205], [300, 300], [307, 300]]) {
  assert.equal(normalizeSettings({ headerImageHeightScale: value }).headerImageHeightScale, expected);
  assert.equal(normalizeHeaderImageHeightScale(value), expected, "preview and saved heights must use the same extended range");
}
assert.equal(normalizeSettings({ headerImageBlurAmount: 99 }).headerImageBlurAmount, 50);

const oldTransfer = createSettingsTransferDocument({ ...DEFAULT_SETTINGS, headerImageHeightScale: 200 });
assert.equal(parseSettingsTransferDocument(oldTransfer, DEFAULT_SETTINGS).patch.headerImageHeightScale, 200,
  "existing heights must retain their physical scale instead of being reinterpreted as UI percentages");
const transfer = createSettingsTransferDocument({ ...DEFAULT_SETTINGS, headerImageHeightScale: 300, headerCoverOperation: record });
assert.equal(transfer.settings.headerImageHeightScale, HEADER_IMAGE_HEIGHT_MAX);
assert.equal(Object.hasOwn(transfer.settings, "headerCoverOperation"), false);
assert.equal(parseSettingsTransferDocument(transfer, DEFAULT_SETTINGS).patch.headerImageHeightScale, HEADER_IMAGE_HEIGHT_MAX);
assert.throws(() => parseSettingsTransferDocument({
  ...transfer,
  settings: { ...transfer.settings, headerImageHeightScale: 305 },
}, DEFAULT_SETTINGS), (error) => error?.code === "SETTINGS_IMPORT_INVALID_VALUE");
assert.throws(() => parseSettingsTransferDocument({
  ...transfer,
  settings: { ...transfer.settings, headerImageHeightScale: 297 },
}, DEFAULT_SETTINGS), (error) => error?.code === "SETTINGS_IMPORT_INVALID_VALUE");
const blurTransfer = createSettingsTransferDocument({ ...DEFAULT_SETTINGS, headerImageBlurAmount: 50 });
assert.equal(parseSettingsTransferDocument(blurTransfer, DEFAULT_SETTINGS).patch.headerImageBlurAmount, 50);

const storage = memoryStorage({ [LOCAL_HEADER_COVER_KEY]: { corrupt: true } });
const store = createHeaderCoverStore(storage, { now: () => "2026-07-15T00:00:00.000Z" });
assert.deepEqual(await store.read(), { available: false, invalid: true, record: null });
const replacement = await store.apply({ action: "replace", record });
assert.equal((await store.read()).record.updatedAt, "2026-07-15T00:00:00.000Z");
await store.restore(replacement.previous);
assert.deepEqual(await store.read(), { available: false, invalid: true, record: null });
await store.apply({ action: "remove" });
assert.deepEqual(await store.read(), { available: false, invalid: false, record: null });
await assert.rejects(store.apply({ action: "replace", record: { ...record, dataUrl: "data:image/png;base64,AAAA" } }), {
  code: "HEADER_COVER_INVALID",
  messageKey: "background.error.headerCoverInvalid",
});
const failingStore = createHeaderCoverStore({
  async get() { return {}; },
  async set() { throw new Error("quota"); },
  async remove() {},
});
await assert.rejects(failingStore.apply({ action: "replace", record }), {
  code: "HEADER_COVER_STORAGE_FAILED",
  messageKey: "background.error.headerCoverStorage",
});

let workflowSettings = normalizeSettings(DEFAULT_SETTINGS);
const workflowStorage = memoryStorage();
const workflowStore = createHeaderCoverStore(workflowStorage, { now: () => "2026-07-15T00:00:00.000Z" });
const broadcasts = [];
const workflow = createSettingsWorkflow(workflowOptions({
  getSettings: async () => workflowSettings,
  headerCoverStore: workflowStore,
  broadcast: (type, payload) => broadcasts.push({ type, payload }),
  writeSettings: async (value) => { workflowSettings = normalizeSettings(value); },
}));
const saved = await workflow.saveSettings({
  headerImageHeightScale: 300,
  headerImageBlurEnabled: true,
  headerImageBlurAmount: 50,
  headerImageMediaType: "video",
  headerCoverOperation: { action: "replace", record },
});
assert.equal(saved.headerImageHeightScale, HEADER_IMAGE_HEIGHT_MAX);
assert.equal(saved.headerImageBlurEnabled, true);
assert.equal(saved.headerImageBlurAmount, 50);
assert.equal(saved.headerImageMediaType, "video", "media type must survive the settings workflow allowlist");
assert.equal(workflowSettings.headerImageHeightScale, HEADER_IMAGE_HEIGHT_MAX, "300% cover height must survive the settings write transaction");
assert.equal(workflowSettings.headerImageBlurAmount, 50, "50 px cover blur must survive the settings write transaction");
assert.equal(saved.headerCoverChanged, true);
assert.equal((await workflowStore.read()).record.name, record.name);
assert.equal(broadcasts.at(-1).type, "settings.changed");
assert.equal(broadcasts.at(-1).payload.headerCoverChanged, true);

let contentSyncCalls = 0;
const localState = {
  provider: { openaiBaseUrl: DEFAULT_SETTINGS.openaiBaseUrl, openaiApiStyle: "responses", openaiSummaryModel: DEFAULT_SETTINGS.openaiSummaryModel, openaiApiKey: "old-key" },
  secrets: { braveSearchApiKey: "old-brave" },
  consent: { accepted: false, origin: "" },
};
const previousLocalState = structuredClone(localState);
const rollbackWorkflow = createSettingsWorkflow(workflowOptions({
  getSettings: async () => workflowSettings,
  headerCoverStore: workflowStore,
  writeSettings: async (value) => { workflowSettings = normalizeSettings(value); },
  localState,
  applyContentSync: async () => {
    contentSyncCalls += 1;
    if (contentSyncCalls === 1) throw new Error("content sync failed");
  },
}));
await assert.rejects(rollbackWorkflow.saveSettings({
  headerImageHeightScale: 125,
  headerCoverOperation: { action: "replace", record: { ...record, name: "replacement.webp" } },
  openaiApiKey: "new-key",
  braveSearchApiKey: "new-brave",
  aiDisclosureAccepted: true,
}), /content sync failed/);
assert.equal(workflowSettings.headerImageHeightScale, HEADER_IMAGE_HEIGHT_MAX);
assert.equal((await workflowStore.read()).record.name, record.name);
assert.deepEqual(localState, previousLocalState, "a failed settings transaction must restore credentials and device consent");

assert.deepEqual(messageRequestForHttp("GET", "/api/settings/header-cover").request, {
  type: "header-cover:get",
  payload: {},
});

const workflowSource = await fs.readFile(new URL("../../extension/runtime/settings-workflow.mjs", import.meta.url), "utf8");
assert(workflowSource.includes("headerCoverStore.restore(headerCoverMutation.previous)"), "a failed settings transaction must restore the previous local cover");
assert(workflowSource.includes("headerCoverChanged"), "local cover changes must be broadcast to other tabs");
const settingsControllerSource = await fs.readFile(new URL("../../assets/client/settings-controller.mjs", import.meta.url), "utf8");
assert(settingsControllerSource.includes("else closeSettings();"), "discarding the unsaved settings prompt must restore the saved local cover draft");
const dashboardAppSource = await fs.readFile(new URL("../../assets/client/dashboard-app.mjs", import.meta.url), "utf8");
assert(dashboardAppSource.includes("headerCoverController.markExternalChange()"), "an external cover change must be retained while another tab has a local draft open");
assert(dashboardAppSource.includes("headerCoverController.load().then"), "an external cover change must refresh an idle open settings page");
assert(dashboardAppSource.includes("void Promise.resolve(globalThis.ampiraLayoutBootstrap?.headerCoverReady).catch(() => {});"), "header cover hydration must remain an explicitly non-blocking visual task");
assert(!dashboardAppSource.includes("globalThis.ampiraLayoutBootstrap?.headerCoverReady,"), "local cover storage and image decoding must not delay the initial dashboard render group");
await assert.rejects(fs.stat(new URL("../../assets/images/default-header.webp", import.meta.url)), { code: "ENOENT" });
const appearanceControllerSource = await fs.readFile(new URL("../../assets/client/appearance-controller.mjs", import.meta.url), "utf8") + "\n" + await fs.readFile(new URL("../../assets/client/header-cover-renderer.mjs", import.meta.url), "utf8") + "\n" + await fs.readFile(new URL("../../assets/client/header-cover-model.mjs", import.meta.url), "utf8");
const themeBootstrapSource = await fs.readFile(new URL("../../assets/client/theme-bootstrap.mjs", import.meta.url), "utf8");
for (const scale of [70, 100, 200, 250, 300, 305]) {
  const styles = new Map();
  vm.runInNewContext(themeBootstrapSource, {
    document: { hidden: true, documentElement: { dataset: {}, classList: { toggle() {} }, style: { setProperty: (name, value) => styles.set(name, value) } } },
    location: { protocol: "https:" },
    localStorage: { getItem: key => key === "ampira.headerCover" ? JSON.stringify({ enabled: false, heightScale: scale }) : null },
  });
  assert.equal(styles.get("--header-cover-height-scale"), String(Math.min(scale, 300) / 100), "first-frame restoration must retain extended and existing height scales");
  assert.equal(styles.get("--header-cover-fullscreen-height"), `${Math.min(scale, 300)}dvh`);
}
const shellControllerSource = await fs.readFile(new URL("../../assets/client/shell-controller.mjs", import.meta.url), "utf8");
const dashboardSectionsCssSource = await fs.readFile(new URL("../../assets/styles/dashboard-sections.css", import.meta.url), "utf8");
const coverImageRule = dashboardSectionsCssSource.match(/\.dashboard-cover img\s*\{([\s\S]*?)\n\}/)?.[1] || "";
const loadedCoverRule = dashboardSectionsCssSource.match(/\.dashboard-cover\.is-loaded img\s*\{([\s\S]*?)\n\}/)?.[1] || "";
const fixedCoverRule = dashboardSectionsCssSource.match(/\.has-fixed-header-cover \.dashboard-cover\s*\{([\s\S]*?)\n\}/)?.[1] || "";
assert(themeBootstrapSource.includes(`defaultHeaderImageUrl = "${DEFAULT_HEADER_IMAGE_URL}"`), "first-frame and normal rendering must share the default network image");
assert(themeBootstrapSource.includes('url: ""'), "a new profile must keep the cover URL field empty on its first frame");
assert(!appearanceControllerSource.includes("/assets/images/default-header.webp") && !themeBootstrapSource.includes("/assets/images/default-header.webp"), "default image loading must not retain the removed local asset");
assert(coverImageRule.includes("opacity 720ms var(--motion-ease-enter)"), "fast loading must retain the original cover fade duration");
assert(coverImageRule.includes("transform: scale(1.012);") && coverImageRule.includes("transform 900ms var(--motion-ease-standard)"), "fast loading must retain the original subtle cover settle motion");
assert(loadedCoverRule.includes("transform: scale(1);"), "the loaded cover state must finish the original settle motion");
assert(shellControllerSource.includes("window.innerWidth || document.documentElement.clientWidth"), "cover metrics must match CSS viewport units before falling back to client width");
assert(fixedCoverRule.includes("width: 100vw;"), "fixed and fullscreen covers must not be recropped when page scrollbar metrics settle");

await testLocalCoverSelection();
await testDefaultNetworkCover();
testHeaderHeightControl();

console.log("header cover tests passed");

function testHeaderHeightControl() {
  const attributes = new Map(), styles = new Map(), fieldAttributes = new Map();
  const els = {
    saveSettings: { disabled: false },
    headerImageEnabledInput: { checked: true },
    headerImageHeightInput: { value: "100", setAttribute: (key, value) => attributes.set(key, value), style: { setProperty: (key, value) => styles.set(key, value) } },
    headerImageHeightOutput: {},
    headerImageHeightField: { setAttribute: (key, value) => fieldAttributes.set(key, value) },
  };
  const controller = createAppearanceController({ state: {}, els });
  for (const [scale, label] of [
    [70, "0%"], [100, t("settings.defaultValue", { value: "13%" })], [105, "15%"],
    [185, "50%"], [200, "57%"], [250, "78%"], [300, "100%"],
    [100, t("settings.defaultValue", { value: "13%" })],
  ]) {
    els.headerImageHeightInput.value = String(scale);
    controller.syncHeightControl();
    assert.equal(els.headerImageHeightInput.value, String(scale), "display normalization must not change the stored or previewed height");
    assert.equal(els.headerImageHeightOutput.value, label);
    assert.equal(attributes.get("aria-valuetext"), label, "assistive text must match the visible percentage");
    assert.equal(styles.get("--range-progress"), `${(scale - 70) / 230 * 100}%`);
  }
  assert.equal(els.headerImageHeightInput.min, "70");
  assert.equal(els.headerImageHeightInput.max, "300");
  assert.equal(els.headerImageHeightInput.step, "5");
  assert.equal(els.headerImageHeightInput.disabled, false);
  controller.syncHeightControl(true);
  assert.equal(els.headerImageHeightInput.disabled, true);
  assert.equal(fieldAttributes.get("aria-disabled"), "true");
  els.headerImageEnabledInput.checked = false;
  controller.syncHeightControl(false);
  assert.equal(els.headerImageHeightInput.disabled, true);
}

async function testDefaultNetworkCover() {
  const keys = ["document", "location", "navigator", "localStorage", "chrome", "ampiraLayoutBootstrap"];
  const originals = Object.fromEntries(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const classes = new Set(), preloads = [], stored = new Map(), attributes = new Map();
  const classList = { add: value => classes.add(value), remove: (...values) => values.forEach(value => classes.delete(value)), toggle: (value, enabled) => enabled ? classes.add(value) : classes.delete(value), contains: value => classes.has(value) };
  const image = { complete: false, getAttribute: key => attributes.get(key), removeAttribute: key => attributes.delete(key), addEventListener() {} };
  Object.defineProperty(image, "src", { get: () => attributes.get("src"), set: value => attributes.set("src", value) });
  const hero = { hidden: true, dataset: {}, classList, querySelector: () => image };
  const origin = "https://extension.example";
  const document = {
    hidden: true, documentElement: { dataset: {}, classList, style: { setProperty() {} } },
    querySelector: selector => selector === "#headerImageHero" ? hero : selector === "#headerImage" ? image : null,
    createElement: () => ({ setAttribute() {} }), head: { append: element => preloads.push(element) },
  };
  try {
    for (const [key, value] of Object.entries({
      document, location: { origin, protocol: "chrome-extension:" }, navigator: { serviceWorker: { controller: {} } }, chrome: {},
      localStorage: { getItem: key => stored.get(key) || null, setItem: (key, value) => stored.set(key, value) },
    })) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    await import("../../assets/client/theme-bootstrap.mjs");
    await globalThis.ampiraLayoutBootstrap.headerCoverReady;
    const resolve = globalThis.ampiraLayoutBootstrap.resolveHeaderCoverSource;
    const networkSource = url => `${origin}/_header-cover?url=${encodeURIComponent(url)}`;
    const expected = networkSource(DEFAULT_HEADER_IMAGE_URL);
    assert.equal(image.src, expected, "first-frame defaults must use the ordinary network-image cache path");
    assert.equal(preloads[0].href, expected, "preload and visible default image must share the same network request");
    assert.equal(resolve(DEFAULT_HEADER_IMAGE_URL), expected, "an explicit default URL must follow ordinary image loading");
    const custom = "https://images.example/custom.webp";
    assert.equal(resolve(custom), networkSource(custom));
    const state = { settings: { headerImageEnabled: true, headerImageUrl: "" } };
    const renderer = createHeaderCoverRenderer({ state, els: { headerImage: image, headerImageHero: hero } });
    renderer.renderHeaderImage(state.settings);
    assert.equal(image.src, expected, "normal rendering must keep the first-frame network source");
    renderer.renderHeaderImage({ ...state.settings, headerImageUrl: custom });
    assert.equal(image.src, networkSource(custom), "custom image links must retain their normal cache behavior");
    state.localHeaderCover = { dataUrl };
    renderer.renderHeaderImage(state.settings);
    assert.equal(image.src, dataUrl, "user-selected local images must retain priority");
    renderer.handleHeaderImageError();
    assert.equal(image.src, expected, "failed local images must fall back to the default network image");
    renderer.renderHeaderImage({ ...state.settings, headerImageEnabled: false });
    assert.equal(image.src, undefined);
    assert.equal(hero.hidden, true);
    globalThis.location.protocol = "http:";
    assert.equal(resolve(""), DEFAULT_HEADER_IMAGE_URL, "web previews must load the direct URL");
  } finally {
    for (const [key, descriptor] of Object.entries(originals)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
}

async function testLocalCoverSelection() {
  const originals = Object.fromEntries(["document", "createImageBitmap", "FileReader"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const listeners = new Map(), status = [], busy = [], state = {};
  const replacementBytes = Buffer.concat([bytes, Buffer.from("replacement")]);
  const replacementDataUrl = `data:image/webp;base64,${replacementBytes.toString("base64")}`;
  const els = Object.fromEntries([
    "headerImageLocalChoose", "headerImageLocalInput", "headerImageLocalRemove", "headerImageLocalChooseLabel", "headerImageLocalStatus", "headerImageLocalMeta",
  ].map(id => [id, { removeAttribute() {}, addEventListener: (event, callback) => listeners.set(`${id}:${event}`, callback) }]));
  let previews = 0, decodes = 0, closed = 0, rejectDecode = false;
  const controller = createHeaderCoverController({
    state, els, t: key => key, apiGet: async () => ({ record, available: true }),
    updatePreview: () => { previews++; }, renderSettingsStatus: key => status.push(key),
    setSettingsBusy: value => { busy.push(value); controller.setBusy(value); },
  });
  const select = file => {
    els.headerImageLocalInput.files = file ? [file] : [];
    els.headerImageLocalInput.value = file ? file.name : "";
    return listeners.get("headerImageLocalInput:change")();
  };
  try {
    globalThis.createImageBitmap = async () => {
      decodes++;
      if (rejectDecode) throw new Error("Synthetic decode failure");
      return { width: 1920, height: 1080, close() { closed++; } };
    };
    globalThis.document = { createElement: () => ({
      getContext: () => ({ drawImage() {} }),
      toBlob: callback => callback(new Blob([replacementBytes], { type: "image/webp" })),
    }) };
    globalThis.FileReader = class {
      readAsDataURL() { this.result = replacementDataUrl; this.onload(); }
    };
    controller.bind();
    assert.equal(await controller.load(), true);
    await select(null);
    assert.deepEqual(busy, [], "cancelling selection must not start processing");
    const file = { name: "new-cover.webp", type: "image/webp", size: 1024 };
    controller.setBusy(true);
    await select(file);
    assert.equal(decodes, 0, "a busy settings form must ignore file selections");
    controller.setBusy(false);
    for (const [candidate, errorKey] of [
      [{ ...file, type: "text/plain" }, "settings.headerImage.localErrorType"],
      [{ ...file, size: 21 * 1024 * 1024 }, "settings.headerImage.localErrorSize"],
    ]) {
      await select(candidate);
      assert.equal(status.at(-1), errorKey);
      assert.deepEqual(controller.savePayload(), {}, "invalid selections must preserve the saved cover");
      assert.equal(els.headerImageLocalChoose.disabled, false);
    }
    assert.equal(decodes, 0, "unsupported and oversized files must not be decoded");
    rejectDecode = true;
    await select(file);
    assert.equal(status.at(-1), "settings.headerImage.localErrorDecode");
    assert.deepEqual(controller.savePayload(), {});
    assert.equal(els.headerImageLocalChoose.disabled, false);
    rejectDecode = false;
    const selecting = select(file);
    assert.equal(els.headerImageLocalChoose.disabled, true, "controls must be locked before the module load resolves");
    assert.equal(els.headerImageLocalInput.value, "", "the same file must be selectable again");
    await selecting;
    assert.equal(status.at(-1), "settings.headerImage.localReady");
    assert.equal(state.localHeaderCover.name, file.name);
    assert.equal(state.localHeaderCover.width, 1920);
    assert.equal(closed, 1);
    assert.equal(previews, 1);
    assert.equal(els.headerImageLocalChoose.disabled, false);
    assert.deepEqual(controller.savePayload(), { headerCoverOperation: { action: "replace", record: state.localHeaderCover } });
    assert.equal(state.localHeaderCover.dataUrl, replacementDataUrl);
    controller.restore();
    assert.equal(state.localHeaderCover.dataUrl, record.dataUrl, "discarding an upload must restore the saved cover");
    assert.deepEqual(controller.savePayload(), {});
    assert.deepEqual(busy, [true, false, true, false, true, false, true, false]);
  } finally {
    for (const [key, descriptor] of Object.entries(originals)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
}

function memoryStorage(initial = {}) {
  const values = structuredClone(initial);
  return {
    async get(keys) {
      const list = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(list.filter((key) => Object.hasOwn(values, key)).map((key) => [key, structuredClone(values[key])]))
    },
    async set(next) { Object.assign(values, structuredClone(next)); },
    async remove(keys) { for (const key of (Array.isArray(keys) ? keys : [keys])) delete values[key]; },
  };
}

function workflowOptions({ getSettings, headerCoverStore, writeSettings, broadcast = () => {}, applyContentSync = async () => {}, localState = null }) {
  const state = localState || {
    provider: { openaiBaseUrl: DEFAULT_SETTINGS.openaiBaseUrl, openaiApiStyle: "responses", openaiSummaryModel: DEFAULT_SETTINGS.openaiSummaryModel, openaiApiKey: "" },
    secrets: { braveSearchApiKey: "" },
    consent: { accepted: false, origin: "" },
  };
  return {
    getSettings,
    settingsLocale: (settings) => settings.uiLocale,
    secretStatus: async () => ({ hasOpenAIKey: false, hasImageSearchKey: false }),
    currentBookmarkModel: async () => ({ folderOptions: [], availableNewsFolders: [], missingFolders: [] }),
    emptyBookmarkModel: () => ({ folderOptions: [], availableNewsFolders: [], missingFolders: [] }),
    selectedOrigins: async () => [],
    currentFeedPermissionState: async () => ({}),
    filterSourceQuality: () => [],
    getRecord: async () => ({}),
    emptySourceQuality: () => ({}),
    defaultSettings: DEFAULT_SETTINGS,
    settingsService: { mutate: async (mutation) => mutation({ write: writeSettings }) },
    contentSyncService: { applySettings: applyContentSync },
    headerCoverStore,
    broadcast,
    readProviderProfile: async () => structuredClone(state.provider),
    bindProviderPatchToOrigin: (patch) => patch,
    isValidServiceUrl: () => true,
    typedError: (code) => Object.assign(new Error(code), { code }),
    providerTestConsentAllowed: () => true,
    providerRequiresApiKey: () => true,
    hasOriginPermission: async () => true,
    updateCredentials: async ({ providerPatch, secretsPatch }) => {
      Object.assign(state.secrets, secretsPatch);
      return Object.assign(state.provider, providerPatch);
    },
    setAiDisclosureConsent: async (accepted, origin) => { state.consent = { accepted, origin }; },
    captureCredentialState: async () => structuredClone({ provider: state.provider, secrets: state.secrets }),
    restoreCredentialState: async (snapshot) => {
      state.provider = structuredClone(snapshot.provider);
      state.secrets = structuredClone(snapshot.secrets);
    },
    captureDeviceConsentState: async () => structuredClone(state.consent),
    restoreDeviceConsentState: async (snapshot) => { state.consent = structuredClone(snapshot); },
  };
}
