import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createMessageRouter } from "../../extension/runtime/message-router.mjs";
import { createRuntimeSettingsService } from "../../extension/runtime/settings-service.mjs";
import { createRuntimeStatusStore } from "../../extension/runtime/status-store.mjs";
import { createPermissionGateway } from "../../extension/runtime/permission-gateway.mjs";
import { createExtensionRuntime } from "../../extension/runtime/extension-runtime.mjs";

export async function runArchitectureTests(root) {
  const appEntry = await fs.readFile(path.join(root, "assets/client/app.mjs"), "utf8");
  const workerEntry = await fs.readFile(path.join(root, "extension/service-worker.mjs"), "utf8");
  assert.deepEqual(importSpecifiers(appEntry), ["./dashboard-app.mjs"], "the dashboard entry may only assemble the dashboard app");
  assert.deepEqual(importSpecifiers(workerEntry), ["./runtime/extension-runtime.mjs"], "the worker entry may only assemble the extension runtime");
  const workerGraph = await localModuleGraph(path.join(root, "extension/service-worker.mjs"));
  const workerGraphRelative = new Set([...workerGraph].map((file) => path.relative(root, file).replaceAll("\\", "/")));
  const workerGraphBytes = (await Promise.all([...workerGraph].map(async (file) => (await fs.stat(file)).size)))
    .reduce((total, size) => total + size, 0);
  // Runtime catalogs share keys and exclude Reader controls used only by the page.
  // Personal cards add serialized local state transitions; MV3 workers cannot lazy-load them.
  // Topic sync adds rule normalization, merge revisions and runtime routing within 4 KiB.
  // Calendar adds bounded local event validation and serialized mutations within 4 KiB.
  // Calendar sync adds dataset routing, merge-limit feedback and the opt-in setting.
  // Notes and world clock add bounded state policies, sync routing and error messages (9 KiB).
  // News evidence/version tracking and incremental commits add at most 14 KiB;
  // Reader extraction is reused, and the three new modules stay within 6 KiB.
  assert(workerGraphBytes <= 864 * 1024, `the service worker static graph must stay within its 864 KiB startup budget (found ${workerGraphBytes} bytes)`);
  const newsModules = ["extension/core/feed-content.mjs", "extension/runtime/feed-content-service.mjs", "extension/runtime/feed-batch-writer.mjs"];
  const newsBytes = (await Promise.all(newsModules.map(file => fs.stat(path.join(root, file))))).reduce((sum, stat) => sum + stat.size, 0);
  assert(newsBytes <= 6 * 1024, "news content and batch policies must stay within 6 KiB");
  assert((await fs.stat(path.join(root, "extension/core/calendar.mjs"))).size <= 4 * 1024, "calendar domain policy must stay within 4 KiB");
  assert((await fs.stat(path.join(root, "extension/core/notes.mjs"))).size <= 4 * 1024, "notes policy must stay within 4 KiB");
  assert((await fs.stat(path.join(root, "extension/core/world-clock.mjs"))).size <= 3 * 1024, "city catalog and policy must stay within 3 KiB");
  const personalWorkerModules = ["extension/core/focus.mjs", "extension/core/tracked-topics.mjs", "extension/core/calendar.mjs", "extension/core/notes.mjs", "extension/core/world-clock.mjs", "extension/runtime/personal-cards-service.mjs"];
  const personalWorkerBytes = (await Promise.all(personalWorkerModules.map(file => fs.stat(path.join(root, file))))).reduce((sum, stat) => sum + stat.size, 0);
  assert(personalWorkerBytes <= 29 * 1024, "personal card state policies and orchestration must stay within 29 KiB");
  const workerGraphSources = await Promise.all([...workerGraph].map((file) => fs.readFile(file, "utf8")));
  assert(!workerGraphSources.some((source) => /\bimport\s*\(/.test(source)),
    "MV3 service workers must use static module imports because Chrome does not support import()");
  assert(!workerGraphRelative.has("extension/core/i18n.mjs"), "the service worker must not load the full client translation catalog");
  assert(![...workerGraphRelative].some((file) => file.startsWith("assets/client/locales/")), "the service worker graph must exclude client locale modules");
  assert(!workerGraphRelative.has("extension/core/china-location-data.mjs"), "the service worker graph must exclude the eager China location module");
  assert(!workerGraphRelative.has("assets/client/header-cover-image.mjs")
    && !workerGraphSources.some((source) => source.includes("nextHeaderCoverDimensions")),
  "local cover upload optimization must stay outside the service worker graph");
  assert(workerGraphRelative.has("extension/core/runtime-i18n.mjs")
    && workerGraphRelative.has("extension/core/runtime-locales/en.mjs")
    && workerGraphRelative.has("extension/core/runtime-locales/zh-CN.mjs")
    && workerGraphRelative.has("extension/core/runtime-locales/zh-Hant.mjs"),
  "the service worker must use the generated runtime locale catalogs");

  const dashboardGraph = new Set([
    ...await localModuleGraph(path.join(root, "assets/client/app.mjs")),
    ...await localModuleGraph(path.join(root, "assets/client/extension-ui.mjs")),
  ]);
  const dashboardGraphRelative = new Set([...dashboardGraph].map((file) => path.relative(root, file).replaceAll("\\", "/")));
  const dashboardGraphBytes = (await Promise.all([...dashboardGraph].map(async (file) => (await fs.stat(file)).size)))
    .reduce((total, size) => total + size, 0);
  // Shared display policies must not pull in extraction, ranking, or unopened tools.
  // Onboarding and optional-card dispatch add startup wiring; card implementations remain lazy.
  // Reading queue copy adds menu wiring and URL serialization within 1 KiB.
  assert(dashboardGraphBytes <= 769 * 1024, `the dashboard static graph must stay within its 769 KiB startup budget (found ${dashboardGraphBytes} bytes)`);
  for (const module of ["extension/core/image-candidates.mjs", "extension/core/reader-html-tree.mjs",
    "extension/core/news-ranking.mjs", "extension/core/settings-transfer.mjs", "assets/client/reader-ui.mjs"]) {
    assert(!dashboardGraphRelative.has(module), `${module} must stay outside the dashboard startup graph`);
  }
  assert(!dashboardGraphRelative.has("assets/client/header-cover-image.mjs")
    && !dashboardGraphRelative.has("extension/core/header-cover.mjs"),
  "local cover upload processing must stay outside the dashboard startup graph");
  assert(!dashboardGraphRelative.has("assets/client/header-cover-renderer.mjs")
    && !dashboardGraphRelative.has("assets/client/header-cover-video.mjs"),
  "cover rendering and video playback must load on demand");
  for (const module of ["assets/client/weather-card-state.mjs", "assets/client/stock-card-view.mjs", "assets/client/stock-card-state.mjs", "extension/core/stocks.mjs",
    "assets/client/countdown-card-view.mjs", "assets/client/countdown-card-state.mjs", "extension/core/countdown.mjs",
    "assets/client/calendar-card-view.mjs", "assets/client/calendar-card-state.mjs", "assets/client/calendar-month-view.mjs", "extension/core/calendar.mjs",
    "assets/client/notes-card-view.mjs", "assets/client/notes-card-state.mjs", "extension/core/notes.mjs",
    "assets/client/world-clock-card-view.mjs", "assets/client/world-clock-card-state.mjs", "assets/client/world-clock-time.mjs", "extension/core/world-clock.mjs",
    "assets/client/focus-card-view.mjs", "assets/client/focus-card-state.mjs", "extension/core/focus.mjs",
    "assets/client/topics-card-view.mjs", "assets/client/topics-card-state.mjs", "extension/core/tracked-topics.mjs",
    "assets/client/personal-card-state.mjs", "assets/client/personal-card-controls.mjs", "assets/client/topic-matching.mjs"]) {
    assert(!dashboardGraphRelative.has(module), "optional card models and views must load only when their type is selected");
  }
  assert(dashboardGraphRelative.has("assets/client/locales/all-translations.mjs"), "the dashboard graph must include the generated cross-locale subset");
  assert(!dashboardGraphRelative.has("extension/core/i18n.mjs"), "the dashboard must not eagerly load the full-catalog i18n adapter");
  for (const locale of ["en", "zh-CN", "zh-Hant"]) {
    assert(!dashboardGraphRelative.has(`assets/client/locales/${locale}.mjs`), `the dashboard must load ${locale} only on demand`);
  }
  const dashboardI18nSource = await fs.readFile(path.join(root, "assets/client/i18n.mjs"), "utf8");
  for (const locale of ["en", "zh-CN", "zh-Hant"]) {
    assert(dashboardI18nSource.includes(`() => import("./locales/${locale}.mjs")`), `the dashboard must use a literal dynamic import for ${locale}`);
  }

  const popupGraph = await localModuleGraph(path.join(root, "assets/client/action-popup.mjs"));
  const popupGraphRelative = new Set([...popupGraph].map((file) => path.relative(root, file).replaceAll("\\", "/")));
  const popupGraphBytes = (await Promise.all([...popupGraph].map(async (file) => (await fs.stat(file)).size)))
    .reduce((total, size) => total + size, 0);
  assert(popupGraphBytes <= 40 * 1024, `the action popup static graph must stay within its 40 KiB startup budget (found ${popupGraphBytes} bytes)`);
  assert(popupGraphRelative.has("assets/client/locales/popup.mjs"), "the action popup must include its generated micro-catalog");
  assert(!popupGraphRelative.has("assets/client/api.mjs")
    && !popupGraphRelative.has("assets/client/i18n.mjs")
    && !popupGraphRelative.has("extension/core/i18n.mjs"),
  "the action popup must exclude the dashboard API and full-catalog i18n graph");
  for (const locale of ["en", "zh-CN", "zh-Hant"]) {
    assert(!popupGraphRelative.has(`assets/client/locales/${locale}.mjs`), `the action popup must exclude the full ${locale} catalog`);
  }

  const coreFiles = await listFiles(path.join(root, "extension/core"), ".mjs");
  for (const file of coreFiles) {
    const source = await fs.readFile(file, "utf8");
    assert(!source.includes("../runtime/"), `${path.basename(file)} must not depend on runtime services`);
  }

  const clientFiles = await listFiles(path.join(root, "assets/client"), ".mjs");
  // Interaction contracts are exercised by the focused behavior suites.
  for (const file of clientFiles.filter((name) => /-view\.mjs$/.test(name))) {
    const source = await fs.readFile(file, "utf8");
    const imports = importSpecifiers(source);
    assert(!imports.some((specifier) => /(?:^|\/)(?:api|storage)\.mjs$/.test(specifier)), `${path.basename(file)} must receive API and storage dependencies from its controller`);
    assert(!/\bchrome\s*\./.test(source), `${path.basename(file)} must not call Chrome APIs`);
  }


  const runtimeFiles = await listFiles(path.join(root, "extension/runtime"), ".mjs");
  for (const file of runtimeFiles) {
    const source = await fs.readFile(file, "utf8");
    assert(!importSpecifiers(source).some((specifier) => specifier.includes("assets/client")), `${path.basename(file)} must not depend on dashboard modules`);
  }
  const cssEntry = await fs.readFile(path.join(root, "assets/dashboard.css"), "utf8");
  const imports = [...cssEntry.matchAll(/@import\s+url\(["'](.+?)["']\);/g)].map((match) => match[1]);
  assert(imports.length > 0, "dashboard.css must reference its local stylesheets");
  for (const reference of imports) {
    assert(reference.startsWith("./styles/") && !reference.includes(":") && !reference.includes(".."), "CSS imports must remain local");
    await fs.access(path.resolve(path.dirname(path.join(root, "assets/dashboard.css")), reference));
  }

  const route = createMessageRouter({ ping: (payload, sender) => payload.value + sender.offset }, (type) => {
    throw Object.assign(new Error(`unknown: ${type}`), { code: "UNKNOWN_REQUEST" });
  });
  assert.equal(route({ type: "ping", payload: { value: 7 } }, { offset: 2 }), 9, "message routing must preserve sender context for tab-scoped browser capabilities");
  assert.throws(() => route({ type: "missing" }), (error) => error.code === "UNKNOWN_REQUEST");

  const settingsService = createRuntimeSettingsService({
    store: {
      async read() { return { uiLocale: "en" }; },
      mutate(action) { return action({ write: async (value) => value }); },
    },
    async readProviderProfile() {
      return { openaiBaseUrl: "https://api.openai.com/v1", openaiApiStyle: "responses", openaiSummaryModel: "model", credentialGeneration: 2 };
    },
    async readDeviceConsent() { return { aiDisclosureAccepted: false }; },
  });
  const settings = await settingsService.getSettings();
  assert.equal(settings.newsBookmarkFolder, "");
  assert.equal(settings.newsSourceMode, "public");
  assert.equal(settings.inspirationBookmarkFolder, "");
  assert.equal(settings.inspirationSourceMode, "preset");
  assert.equal(settings.credentialGeneration, 2);

  const records = new Map();
  const statusStore = createRuntimeStatusStore({
    getRecord: async (key, fallback) => records.has(key) ? records.get(key) : fallback,
    setRecord: async (key, value) => records.set(key, value),
    broadcast: () => {},
    createStages: () => ({ complete: "running" }),
  });
  await statusStore.setRefreshStatus({ running: true });
  assert.deepEqual(await statusStore.getRefreshStatus(), { running: true });

  const permissionGateway = createPermissionGateway({
    chrome: {
      bookmarks: { async getTree() { return []; } },
      permissions: {
        async getAll() { return { origins: ["https://news.example/*"] }; },
        async contains({ origins }) { return origins.includes("https://news.example/*"); },
      },
    },
    async getSettings() { return {}; },
    async secretStatus() { return { hasOpenAIKey: false, hasImageSearchKey: false }; },
  });
  assert.equal(await permissionGateway.hasOriginPermission("https://news.example/story"), true);
  assert.equal(await permissionGateway.hasOriginPermission("http://remote.example/story"), false);
  const braveResearchGateway = createPermissionGateway({
    chrome: {
      bookmarks: { async getTree() { return []; } },
      permissions: { async getAll() { return { origins: [] }; } },
    },
    async getSettings() { return {}; },
    async secretStatus() { return { hasOpenAIKey: false, hasImageSearchKey: true }; },
  });
  const braveResearchOrigins = await braveResearchGateway.selectedOrigins({ bookmarks: [] }, {
    bookmarkConsentGranted: false,
    webImageSearchEnabled: false,
  });
  assert(braveResearchOrigins.some((row) => row.origin === "https://api.search.brave.com/*"),
    "a configured fallback-image key must expose its exact Brave origin even while image search is off so it can be removed");
  const zhCnPublicOrigins = await permissionGateway.selectedOrigins({ bookmarks: [] }, {
    bookmarkConsentGranted: true,
    publicFeedSupplementEnabled: true,
    uiLocale: "zh-CN",
  });
  assert(zhCnPublicOrigins.some((row) => row.origin === "https://www.ithome.com/*"));
  assert(!zhCnPublicOrigins.some((row) => row.origin === "https://www.theverge.com/*"));
  const enPublicOrigins = await permissionGateway.selectedOrigins({ bookmarks: [] }, {
    bookmarkConsentGranted: true,
    publicFeedSupplementEnabled: true,
    uiLocale: "en",
  });
  assert(enPublicOrigins.some((row) => row.origin === "https://www.theverge.com/*"));
  assert(enPublicOrigins.some((row) => row.origin === "https://feeds.macrumors.com/*"));
  assert(!enPublicOrigins.some((row) => row.origin === "https://www.solidot.org/*"));

  const storage = { async get() { return {}; }, async set() {}, async remove() {}, async clear() {} };
  const runtime = createExtensionRuntime({
    chrome: {
      storage: { local: storage, sync: storage },
      bookmarks: { async getTree() { return []; } },
      permissions: { async getAll() { return { origins: [] }; }, async contains() { return false; } },
      runtime: { sendMessage() { return Promise.resolve(); } },
    },
  });
  for (const method of [
    "ensureReady", "handleMessage", "refresh", "handleAlarm",
    "handleBookmarksChanged", "handlePermissionsAdded", "handlePermissionsRemoved",
    "handleActionClicked", "handleTabUpdated", "start",
  ]) assert.equal(typeof runtime[method], "function", `runtime must expose ${method}`);
  await assert.rejects(runtime.handleMessage({ type: "mcp:enabled", payload: { enabled: true } }),
    error => error?.code === "MCP_PERMISSION", "MCP enable must reach its permission gate rather than the unknown-request handler");
  const previousChrome = Object.getOwnPropertyDescriptor(globalThis, "chrome");
  Object.defineProperty(globalThis, "chrome", { configurable: true, value: { storage: { local: storage, sync: storage } } });
  try {
    for (const type of ["mcp:setup", "mcp:pair"]) await assert.rejects(runtime.handleMessage({ type, payload: {} }),
      error => error?.code === "mcpDisabled", `${type} must reach the disabled-feature gate rather than the unknown-request handler`);
  } finally {
    if (previousChrome) Object.defineProperty(globalThis, "chrome", previousChrome);
    else delete globalThis.chrome;
  }
  await assert.rejects(
    runtime.handleMessage({ type: "feed:refresh-source", payload: {} }),
    (error) => error?.code === "SOURCE_NOT_FOUND",
    "the scoped source-refresh message must reach the refresh service rather than an undefined factory export",
  );
}

function importSpecifiers(source) {
  return [...source.matchAll(/\bfrom\s+["']([^"']+)["']|\bimport\s+["']([^"']+)["']/g)]
    .map((match) => match[1] || match[2]);
}

async function listFiles(directory, extension) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return listFiles(absolute, extension);
    return entry.name.endsWith(extension) ? [absolute] : [];
  }));
  return files.flat();
}

async function localModuleGraph(entry) {
  const visited = new Set();
  const pending = [path.resolve(entry)];
  while (pending.length) {
    const file = pending.pop();
    if (visited.has(file)) continue;
    visited.add(file);
    const source = await fs.readFile(file, "utf8");
    for (const specifier of importSpecifiers(source)) {
      if (!specifier.startsWith(".")) continue;
      pending.push(path.resolve(path.dirname(file), specifier));
    }
  }
  return visited;
}
