import assert from "node:assert/strict";
import { DEFAULT_SETTINGS } from "../../extension/core/constants.mjs";
import { markOnboardingComplete, grantBookmarkConsent, readDeviceConsent } from "../../extension/core/device-consent.mjs";
import { createPermissionGateway } from "../../extension/runtime/permission-gateway.mjs";
import { createDashboardContentService } from "../../extension/runtime/dashboard-content-service.mjs";
import { publicFeedsForLocale } from "../../extension/core/public-feeds.mjs";
import { buildPermissionRows, originPattern } from "../../extension/core/permission-state.mjs";
import { onboardingInitialStep, onboardingPermissionRequest, onboardingSourceMode, onboardingSourcePatch } from "../../assets/client/onboarding-model.mjs";
import { requestPermissionDetails } from "../../assets/client/permission-client.mjs";
import { newsBookmarkValue } from "../../assets/client/news-source-selection.mjs";
import { inspirationBookmarkValue } from "../../assets/client/inspiration-source-selection.mjs";
import { refreshAvailability } from "../../assets/client/status-view.mjs";
import { createAutomaticAiHarness, syntheticArticle } from "../helpers/automatic-ai-harness.mjs";
import { createMaintenanceService } from "../../extension/runtime/maintenance-service.mjs";

const originalChrome = globalThis.chrome;
try {
  const local = {};
  globalThis.chrome = { storage: { local: {
    get: async key => ({ [key]: local[key] }),
    set: async value => Object.assign(local, structuredClone(value)),
  } } };
  await markOnboardingComplete();
  const completed = await readDeviceConsent("");
  assert.equal(completed.onboardingCompleted, true, "authorized setup completion must persist across reloads");
  assert.equal(completed.bookmarkConsentGranted, false, "public-source authorization cannot imply bookmark consent");
  assert.equal(completed.aiDisclosureAccepted, false);
  await grantBookmarkConsent();
  const accepted = await readDeviceConsent("");
  assert.equal(accepted.bookmarkConsentGranted, true);
  assert.equal(accepted.onboardingCompleted, true);
} finally { globalThis.chrome = originalChrome; }

let completionWrites = 0, completionRefreshes = 0;
let completionSettings = { newsSourceMode: "public", inspirationSourceMode: "preset",
  bookmarkConsentGranted: false, onboardingSourcePermissions: [{ origin: "https://news.example/*", granted: false }] };
const maintenance = createMaintenanceService({
  publicSettings: async () => completionSettings,
  markOnboardingComplete: async () => { completionWrites++; },
  startRefresh: async () => { completionRefreshes++; },
  typedError: code => Object.assign(new Error(code), { code }),
});
await assert.rejects(maintenance.completeOnboarding(), { code: "ONBOARDING_PERMISSION_REQUIRED" });
assert.equal(completionWrites, 0, "a direct completion request cannot bypass website authorization");
assert.equal(completionRefreshes, 0);
completionSettings.onboardingSourcePermissions[0].granted = true;
await maintenance.completeOnboarding();
assert.equal(completionWrites, 1, "authorized public sources do not require bookmark consent");
completionSettings.newsSourceMode = "bookmarks";
await assert.rejects(maintenance.completeOnboarding(), { code: "ONBOARDING_PERMISSION_REQUIRED" });
assert.equal(completionWrites, 1, "personal sources still require explicit bookmark consent");
completionSettings.bookmarkConsentGranted = true;
await maintenance.completeOnboarding();
assert.equal(completionWrites, 2);
completionSettings.onboardingSourcePermissions[0].granted = false;
await assert.rejects(maintenance.completeOnboarding(), { code: "ONBOARDING_PERMISSION_REQUIRED" });
assert.equal(completionWrites, 2, "revocation before completion must be rechecked in the runtime");

for (const progress of [null, undefined, "", "welcome", "unknown"]) {
  assert.equal(onboardingInitialStep(progress), 0, "fresh or unrecognized progress starts with the welcome page");
}
for (const progress of ["sources", "folders"]) {
  assert.equal(onboardingInitialStep(progress), 1, "current and legacy source progress resume after the welcome page");
}
for (const progress of ["permissions", "ai"]) {
  assert.equal(onboardingInitialStep(progress), 2, "current and legacy access progress resume at the final authorization step");
}
assert.equal(onboardingSourceMode(DEFAULT_SETTINGS), "preset");
const permissionRows = [
  { origin: "https://news.example/*", granted: false },
  { origin: "https://design.example/*", granted: true },
];
const combinedPermissions = onboardingPermissionRequest(permissionRows, { faviconSupported: true });
assert.deepEqual(combinedPermissions, { origins: ["https://news.example/*"], permissions: ["favicon"] },
  "onboarding must combine only missing selected origins with browser icons, without history or search");
assert.deepEqual(onboardingPermissionRequest([], { faviconSupported: true }), { permissions: ["favicon"] },
  "icon authorization must still work when no website access is missing");
assert.deepEqual(onboardingPermissionRequest(permissionRows, { faviconSupported: true, faviconGranted: true }),
  { origins: ["https://news.example/*"] }, "previous icon consent must not be requested again");
assert.deepEqual(onboardingPermissionRequest([], { faviconSupported: true, faviconGranted: true }), {});
assert.deepEqual(onboardingPermissionRequest(permissionRows, { faviconSupported: false }),
  { origins: ["https://news.example/*"] }, "browsers without native icons must keep their source-only flow");
assert.deepEqual(onboardingPermissionRequest([], { faviconSupported: false }), {});
try {
  const calls = [];
  let allowed = true;
  globalThis.chrome = { permissions: { request: details => { calls.push(details); return Promise.resolve(allowed); } } };
  const result = requestPermissionDetails(combinedPermissions);
  assert.deepEqual(calls, [combinedPermissions], "one combined browser request must begin synchronously in the user gesture");
  assert.equal(await result, true);
  allowed = false;
  assert.equal(await requestPermissionDetails(combinedPermissions), false, "rejection must propagate to the onboarding action");
} finally { globalThis.chrome = originalChrome; }
assert.deepEqual(onboardingSourcePatch("preset"), {
  newsSourceMode: "public", inspirationSourceMode: "preset", publicFeedSupplementEnabled: true,
  bookmarkSectionEnabled: false,
}, "choosing built-in sources must preserve saved personal folder names and consent");
const news = newsBookmarkValue("Reading");
assert.equal(onboardingSourcePatch("bookmarks", news, inspirationBookmarkValue("Reading")), null);
assert.deepEqual(onboardingSourcePatch("bookmarks", news, inspirationBookmarkValue("Design")), {
  newsSourceMode: "bookmarks", inspirationSourceMode: "bookmarks", publicFeedSupplementEnabled: false,
  bookmarkSectionEnabled: true,
  newsBookmarkFolder: "Reading", inspirationBookmarkFolder: "Design",
});
assert.equal(onboardingSourcePatch("bookmarks", "public", inspirationBookmarkValue("Design")).bookmarkSectionEnabled, false,
  "choosing public news must default the home bookmark section off even with a personal inspiration folder");

let bookmarkReads = 0, granted = [];
const settings = { ...DEFAULT_SETTINGS, uiLocale: "zh-CN", bookmarkConsentGranted: false };
const chrome = {
  bookmarks: { getTree: async () => { bookmarkReads++; throw new Error("Unexpected bookmark read"); } },
  permissions: { getAll: async () => ({ origins: granted }) },
};
const gateway = createPermissionGateway({ chrome, getSettings: async () => settings,
  secretStatus: async () => ({ hasImageSearchKey: true }),
  getRecord: async (_key, fallback) => fallback,
});
const model = await gateway.currentBookmarkModel(settings);
assert.equal(bookmarkReads, 0);
assert.equal(model.bookmarks.length, 48, "packaged inspiration must work without bookmark consent");
assert(model.bookmarks.every(item => item.sourceKind === "preset"));
const expected = publicFeedsForLocale("zh-CN").map(item => originPattern(item.url)).sort();
const before = await gateway.selectedOrigins(model, settings, { sourcesOnly: true });
assert.deepEqual(before.map(item => item.origin).sort(), expected,
  "onboarding requests only active content origins, excluding AI, image search, weather and unused cross-language feeds");
assert(before.every(item => !item.granted));
const content = createDashboardContentService({ chrome, publicFeedsForLocale, settingsLocale: value => value.uiLocale,
  aiConfigured: async () => false, originPattern, buildPermissionRows });
const injected = { bookmarks: [{ key: "private", cardType: "news", url: "https://private.example" }] };
assert((await content.configuredFeedSources(settings, injected)).every(item => item.externalDiscovery),
  "a stale model must not reintroduce private bookmarks before consent");
assert.equal((await content.currentFeedPermissionState(settings, model)).permitted.length, 0);
granted = expected.slice(0, 1);
assert.equal((await content.currentFeedPermissionState(settings, model)).permitted.length, 1);
granted = [];
assert.equal((await content.currentFeedPermissionState(settings, model)).permitted.length, 0, "revocation invalidates public content too");
assert.equal(refreshAvailability({ onboarding: { bookmarkConsentGranted: false },
  pipeline: { publicFeedSupplementEnabled: true }, cache: { configuredSources: 14, refreshableSources: 1 } }).available, true);
assert.equal(bookmarkReads, 0);

const harness = createAutomaticAiHarness({ articles: [syntheticArticle("public-onboarding", { externalDiscovery: true })],
  settings: { bookmarkConsentGranted: false, publicFeedSupplementEnabled: true, uiLocale: "en" } });
await harness.run(undefined, { organize: false });
assert.equal(harness.records.get("feed").items.length, 1, "public refresh cannot stop at the bookmark consent gate");
assert.equal(harness.requests.length, 0, "first refresh does not require an AI call");
console.log("Three-step onboarding, progress recovery, separate consent and public-source tests passed.");
