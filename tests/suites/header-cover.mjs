import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {
  HEADER_COVER_MAX_DIMENSION,
  HEADER_COVER_MIN_LONG_EDGE,
  HEADER_COVER_STORED_MAX_BYTES,
  createHeaderCoverStore,
  nextHeaderCoverDimensions,
  normalizeHeaderCoverRecord,
  webpDataUrlByteLength,
} from "../../extension/core/header-cover.mjs";
import { DEFAULT_SETTINGS, LOCAL_HEADER_COVER_KEY } from "../../extension/core/constants.mjs";
import { normalizeSettings } from "../../extension/core/settings.mjs";
import { createSettingsTransferDocument, parseSettingsTransferDocument } from "../../extension/core/settings-transfer.mjs";
import { createSettingsWorkflow } from "../../extension/runtime/settings-workflow.mjs";
import { HEADER_COVER_ACCEPTED_TYPES } from "../../assets/client/header-cover-image.mjs";
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
assert.equal(normalizeSettings({ headerImageHeightScale: 62 }).headerImageHeightScale, 70);
assert.equal(normalizeSettings({ headerImageHeightScale: 147 }).headerImageHeightScale, 140);
assert.equal(normalizeSettings({ headerImageHeightScale: 117 }).headerImageHeightScale, 115);

const transfer = createSettingsTransferDocument({ ...DEFAULT_SETTINGS, headerImageHeightScale: 125, headerCoverOperation: record });
assert.equal(transfer.settings.headerImageHeightScale, 125);
assert.equal(Object.hasOwn(transfer.settings, "headerCoverOperation"), false);
assert.equal(parseSettingsTransferDocument(transfer, DEFAULT_SETTINGS).patch.headerImageHeightScale, 125);

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
  headerImageHeightScale: 120,
  headerCoverOperation: { action: "replace", record },
});
assert.equal(saved.headerImageHeightScale, 120);
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
assert.equal(workflowSettings.headerImageHeightScale, 120);
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
const packagedHeaderImage = await fs.readFile(new URL("../../assets/images/default-header.webp", import.meta.url));
assert(packagedHeaderImage.length > 0, "the default header image must be packaged locally");
assert.equal(packagedHeaderImage.subarray(0, 4).toString("ascii"), "RIFF", "the packaged default header image must have a WebP container");
assert.equal(packagedHeaderImage.subarray(8, 12).toString("ascii"), "WEBP", "the packaged default header image must be WebP");
assert(packagedHeaderImage.length < 750 * 1024, "the packaged default header image must stay below 750 KiB");
const appearanceControllerSource = await fs.readFile(new URL("../../assets/client/appearance-controller.mjs", import.meta.url), "utf8");
const themeBootstrapSource = await fs.readFile(new URL("../../assets/client/theme-bootstrap.mjs", import.meta.url), "utf8");
assert(appearanceControllerSource.includes('DEFAULT_HEADER_IMAGE_ASSET = "/assets/images/default-header.webp"'), "normal rendering must resolve the default cover to the packaged asset");
assert(themeBootstrapSource.includes('defaultHeaderImageAsset = "/assets/images/default-header.webp"'), "first-frame rendering must resolve the default cover to the packaged asset");
assert(themeBootstrapSource.includes("url: defaultHeaderImageUrl"), "a new profile must use the packaged default cover on its first frame");

console.log("header cover tests passed");

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
    updateProviderProfile: async (patch) => Object.assign(state.provider, patch),
    updateSecrets: async (patch) => Object.assign(state.secrets, patch),
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
