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
  assert(appEntry.split(/\r?\n/).length <= 40, "the dashboard entry must remain a composition root");
  assert(workerEntry.split(/\r?\n/).length <= 20, "the worker entry must remain a composition root");
  assert.deepEqual(importSpecifiers(appEntry), ["./dashboard-app.mjs"], "the dashboard entry may only assemble the dashboard app");
  assert.deepEqual(importSpecifiers(workerEntry), ["./runtime/extension-runtime.mjs"], "the worker entry may only assemble the extension runtime");

  const coreFiles = await listFiles(path.join(root, "extension/core"), ".mjs");
  for (const file of coreFiles) {
    const source = await fs.readFile(file, "utf8");
    assert(!source.includes("../runtime/"), `${path.basename(file)} must not depend on runtime services`);
  }

  const clientFiles = await listFiles(path.join(root, "assets/client"), ".mjs");
  const elementsSource = await fs.readFile(path.join(root, "assets/client/elements.mjs"), "utf8");
  const dashboardAppSource = await fs.readFile(path.join(root, "assets/client/dashboard-app.mjs"), "utf8");
  const sourceSettingsSource = await fs.readFile(path.join(root, "assets/client/source-settings-controller.mjs"), "utf8");
  for (const group of ["shell", "dashboard", "settings", "overlay"]) {
    assert(elementsSource.includes(`${group}: pick(elements,`), `elements must expose the ${group} group`);
  }
  assert(dashboardAppSource.includes("getElementGroups()") && !dashboardAppSource.includes("getElements()"), "dashboard assembly must use scoped element groups");
  for (const leakedBinding of ["NEWS_CARD_TYPE", "LEGACY_NEWS_SECTION", "LEGACY_INSPIRATION_SECTION"]) {
    assert(!sourceSettingsSource.includes(leakedBinding), `source settings must receive ${leakedBinding} through explicit dependencies`);
  }
  for (const dependency of ["allTranslations", "newsCardType", "newsSectionName", "legacyNewsSection", "legacyInspirationSection"]) {
    assert(sourceSettingsSource.slice(0, 600).includes(dependency), `source settings must declare the ${dependency} dependency`);
    assert(dashboardAppSource.includes(`${dependency}:`) || dashboardAppSource.includes(`  ${dependency},`), `dashboard composition must provide ${dependency}`);
  }
  for (const file of clientFiles.filter((name) => /-view\.mjs$/.test(name))) {
    const source = await fs.readFile(file, "utf8");
    const imports = importSpecifiers(source);
    assert(!imports.some((specifier) => /(?:^|\/)(?:api|storage)\.mjs$/.test(specifier)), `${path.basename(file)} must receive API and storage dependencies from its controller`);
    assert(!/\bchrome\s*\./.test(source), `${path.basename(file)} must not call Chrome APIs`);
  }

  for (const file of clientFiles.filter((name) => /(?:controller|view|service)\.mjs$/.test(name))) {
    const lines = (await fs.readFile(file, "utf8")).split(/\r?\n/).length;
    assert(lines <= 520, `${path.basename(file)} must remain a focused module (found ${lines} lines)`);
  }

  const runtimeFiles = await listFiles(path.join(root, "extension/runtime"), ".mjs");
  for (const file of runtimeFiles) {
    const source = await fs.readFile(file, "utf8");
    assert(!importSpecifiers(source).some((specifier) => specifier.includes("assets/client")), `${path.basename(file)} must not depend on dashboard modules`);
  }

  const cssEntry = await fs.readFile(path.join(root, "assets/dashboard.css"), "utf8");
  const imports = [...cssEntry.matchAll(/@import\s+url\(["'](.+?)["']\);/g)].map((match) => match[1]);
  assert.equal(imports.length, 7, "dashboard.css must remain an ordered local stylesheet manifest");
  for (const reference of imports) {
    assert(reference.startsWith("./styles/") && !reference.includes(":") && !reference.includes(".."), "CSS imports must remain local");
    await fs.access(path.resolve(path.dirname(path.join(root, "assets/dashboard.css")), reference));
  }

  const route = createMessageRouter({ ping: (payload) => payload.value }, (type) => {
    throw Object.assign(new Error(`unknown: ${type}`), { code: "UNKNOWN_REQUEST" });
  });
  assert.equal(route({ type: "ping", payload: { value: 7 } }), 7);
  assert.throws(() => route({ type: "missing" }), (error) => error.code === "UNKNOWN_REQUEST");

  const settingsService = createRuntimeSettingsService({
    store: {
      async read() { return { uiLocale: "en" }; },
      mutate(action) { return action({ write: async (value) => value }); },
      async sanitizeLocalOnlyFields() { return true; },
    },
    async readProviderProfile() {
      return { openaiBaseUrl: "https://api.openai.com/v1", openaiApiStyle: "responses", openaiSummaryModel: "model", credentialGeneration: 2 };
    },
    async readDeviceConsent() { return { aiDisclosureAccepted: false }; },
  });
  const settings = await settingsService.getSettings();
  assert.equal(settings.newsBookmarkFolder, "News");
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
    "handleBookmarksChanged", "handlePermissionsAdded", "handlePermissionsRemoved", "start",
  ]) assert.equal(typeof runtime[method], "function", `runtime must expose ${method}`);
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
