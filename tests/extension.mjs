import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { webcrypto } from "node:crypto";
import { buildBookmarkModel, inspirationPreviewSourceUrls, inspirationPreviewTargets, originsFromUrls } from "../extension/core/bookmarks.mjs";
import { providerEndpoint, requestAiCompletion, searchImagePreview, testImageSearchConnection } from "../extension/core/ai.mjs";
import { createClientStateStore } from "../extension/core/client-state.mjs";
import { DEFAULT_SETTINGS, SETTINGS_KEY } from "../extension/core/constants.mjs";
import { recordsToPrune } from "../extension/core/db.mjs";
import { buildFallbackDigest, feedCacheOrEmpty, fetchSourceArticles, filterLikelyNewsItems, isDisplayableFeedItem, parseFeedDocument, rankAndDedupe } from "../extension/core/feed.mjs";
import {
  buildDailyCandidates, dailyCandidateFingerprint, newsTimeScope, rankNewsItems, scoreNewsArticle,
} from "../extension/core/news-ranking.mjs";
import { normalizeFeedback } from "../extension/core/feedback.mjs";
import { createQuotaManager } from "../extension/core/quota.mjs";
import { createPreviewService, fetchSourceImagePreview } from "../extension/core/preview.mjs";
import { bravePreviewCacheKeys, newsPreviewTargets, previewCacheKeysOutsideTargets } from "../extension/core/preview-cache.mjs";
import { retainActiveUnrefreshedItems, selectRefreshBatch, selectRefreshSources } from "../extension/core/refresh.mjs";
import { fetchBounded } from "../extension/core/network.mjs";
import { PUBLIC_FEED_PACKS, publicFeedsForLocale } from "../extension/core/public-feeds.mjs";
import { extractPageMetadata, loadReaderWithCache, readerTextFromBlocks } from "../extension/core/reader.mjs";
import {
  MAX_HIDDEN_BOOKMARK_CATEGORIES, MAX_WEBSITE_SHORTCUTS, normalizeHiddenBookmarkCategories,
  normalizeSettings, normalizeWebsiteShortcutUrl,
} from "../extension/core/settings.mjs";
import { decodeSettingsFromSync, encodeSettingsForSync, settingsChunkKeys } from "../extension/core/settings-storage.mjs";
import { createSettingsStore } from "../extension/core/settings-store.mjs";
import { faviconUrl, isReaderUrl, normalizeUrl as normalizeClientUrl } from "../assets/client/urls.mjs";
import { findNewsItemByReference, pageForItems, seededShuffle } from "../assets/client/dashboard-model.mjs";
import {
  createPriorityRanker, groupItemsByKey, mergeRankedUnique,
  selectDailyEvents, selectTodayNewsItems, selectUnseenPool,
} from "../assets/client/dashboard-selectors.mjs";
import { readerErrorBodyKey, safeReaderOrigin, sameOrigin } from "../assets/client/reader-policy.mjs";
import { normalizeAccentTheme, normalizeColorMode, normalizeHexColor, paletteFromAccent } from "../assets/client/appearance-model.mjs";
import { cloneSettingsDraft, diffSettingsDraft, snapshotSettingsDraft } from "../assets/client/settings-draft.mjs";
import { createInspirationPreviewController, inspirationPreviewFingerprint } from "../assets/client/inspiration-preview-controller.mjs";
import {
  hideBookmarkCategory, isBookmarkCategoryHidden, restoreBookmarkCategory,
} from "../assets/client/bookmark-visibility.mjs";
import { AI_SETUP_STAGE, aiProviderOrigin, aiProviderOriginPattern, deriveAiSetupControlState } from "../assets/client/ai-settings-policy.mjs";
import {
  exactPermissionOrigins, newlyRequiredUngrantedOrigins, permissionRowCounts, requiredUngrantedOrigins,
} from "../assets/client/permission-ui-model.mjs";
import { personalSourcePermissionScope } from "../assets/client/saved-source-permission-controller.mjs";
import { textLength, truncateText } from "../assets/client/text.mjs";
import { formatTodayMeta } from "../assets/client/time.mjs";
import { cleanDailyDigestOverviewLine, cleanGeneratedSummaryLine, dailyDigestEvidence, extractGeneratedSummaryTitle, hasStructuralSummaryPrefix, normalizeSummaryMarkup, parseGeneratedDailyDigest } from "../extension/core/summary-text.mjs";
import { cleanAiAnswerMarkup, extractDirectAnswer, parseAiAnswer } from "../assets/client/ai-answer-format.mjs";
import { cleanSummaryLines as cleanPresentedSummaryLines, cleanSummaryTitle as cleanPresentedSummaryTitle, isCorrectlySummarized } from "../assets/client/item-presenter.mjs";
import { animatePanelEntrance } from "../assets/client/dom.mjs";
import {
  moveWebsiteShortcut, removeWebsiteShortcut, reorderWebsiteShortcuts, upsertWebsiteShortcut,
} from "../assets/client/website-shortcuts-controller.mjs";
import { normalizeUserUrl, searchQueryTerms } from "../extension/core/search.mjs";
import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  defaultBookmarkFoldersForLocale,
  detectSupportedLocale,
  formatListForLocale,
  localeMessages,
  normalizeLocale,
  translate,
  translateAiPrompt,
  translateCount,
} from "../extension/core/i18n.mjs";
import { runArchitectureTests } from "./suites/architecture.mjs";
import { runManifestSecurityTests } from "./suites/manifest-security.mjs";
import { runActivityStoreTests } from "./suites/activity-store.mjs";
import { runDashboardControllerTests } from "./suites/dashboard-controller.mjs";
import { runBookmarkFeedPolicyTests } from "./suites/bookmark-feed-policy.mjs";
import { runWeatherUtilityTests } from "./suites/weather-utility.mjs";
import { runSettingsTransferTests } from "./suites/settings-transfer.mjs";
import { runInspirationPresetTests } from "./suites/inspiration-preset.mjs";
import { runTodayEventTests } from "./suites/today-events.mjs";
import { createReaderPreviewService } from "../extension/runtime/reader-preview-service.mjs";
import { createRefreshService } from "../extension/runtime/refresh-service.mjs";

if (!globalThis.crypto) globalThis.crypto = webcrypto;
if (!globalThis.btoa) globalThis.btoa = (value) => Buffer.from(value, "binary").toString("base64");
if (!globalThis.atob) globalThis.atob = (value) => Buffer.from(value, "base64").toString("binary");

const todayMetaFixture = new Date(2026, 6, 14, 19, 51, 42);
const todayMetaValue = formatTodayMeta(todayMetaFixture);
assert.equal(todayMetaValue.date, "2026.07.14");
assert.equal(todayMetaValue.weekday, "周二");
assert.equal(todayMetaValue.time, "19:51", "the dashboard clock must omit seconds and retain a stable 24-hour minute display");
assert.equal(todayMetaValue.dateTime, todayMetaFixture.toISOString());
assert(!todayMetaValue.label.includes("42"), "the accessible date label must match the visible minute precision");

const expectedPublicFeedPacks = {
  "zh-CN": ["google-news", "bbc-world", "ithome", "solidot"],
  "zh-Hant": ["google-news", "bbc-world", "the-verge", "macrumors"],
  en: ["google-news", "bbc-world", "the-verge", "macrumors"],
};
const expectedResolvedPublicFeedIds = {
  "zh-CN": ["google-news-zh-cn", "bbc-world", "ithome", "solidot"],
  "zh-Hant": ["google-news-zh-hant", "bbc-world", "the-verge", "macrumors"],
  en: ["google-news-en", "bbc-world", "the-verge", "macrumors"],
};
assert.deepEqual(PUBLIC_FEED_PACKS, expectedPublicFeedPacks, "public Feed packs must stay explicit and reviewable");
for (const [locale, expectedIds] of Object.entries(expectedResolvedPublicFeedIds)) {
  const feeds = publicFeedsForLocale(locale);
  assert.deepEqual(feeds.map((feed) => feed.id), expectedIds, `${locale} must receive its intended public Feed pack`);
  assert.equal(new Set(feeds.map((feed) => feed.key)).size, feeds.length, "public Feed keys must be stable and unique");
  assert(feeds.every((feed) => feed.key === `public-${feed.id}` && feed.url.startsWith("https://")), "public Feeds must use stable IDs and HTTPS URLs");
  assert.equal(feeds.filter((feed) => feed.coverageGroup === "headlines").length, 2, "each locale must keep two headline sources");
  assert.equal(feeds.filter((feed) => feed.coverageGroup === "technology").length, 2, "each locale must keep two technology sources");
}
assert.equal(publicFeedsForLocale("zh-TW")[0].url, "https://news.google.com/rss?hl=zh-TW&gl=TW&ceid=TW:zh-Hant");
assert.equal(publicFeedsForLocale("en-US")[0].url, "https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en");
assert.equal(publicFeedsForLocale("zh-CN")[0].url, "https://news.google.com/rss?hl=zh-CN&gl=CN&ceid=CN:zh-Hans");
assert.equal(new Set(["zh-CN", "zh-Hant", "en"].map((locale) => publicFeedsForLocale(locale)[0].key)).size, 3, "Google News locale variants must not reuse cached resolved URLs across regions");
assert.equal(publicFeedsForLocale("en").find((feed) => feed.id === "macrumors")?.url, "https://feeds.macrumors.com/MacRumors-Front");

const originalMatchMedia = globalThis.matchMedia;
const panelAnimationCalls = [];
globalThis.matchMedia = () => ({ matches: false });
animatePanelEntrance(Array.from({ length: 3 }, (_, index) => ({
  animate(keyframes, timing) {
    panelAnimationCalls.push({ index, keyframes, timing });
    return { index };
  },
})), { delay: 60 });
assert.deepEqual(panelAnimationCalls.map(({ timing }) => timing.delay), [60, 108, 156], "dashboard panels must enter with a short stagger");
assert.equal(panelAnimationCalls[0].keyframes[0].transform, "translate3d(0, 8px, 0)", "dashboard panels must begin gently below their resting position");
assert.equal(panelAnimationCalls[0].keyframes[0].opacity, .2, "dashboard panel contents must remain partially visible at entrance start");
assert.equal(panelAnimationCalls[0].timing.duration, 520, "dashboard panel entrance must use the softer duration");
assert.equal(panelAnimationCalls[0].timing.easing, "cubic-bezier(.16, 1, .3, 1)", "dashboard panel entrance must settle with gentle deceleration");
let panelShellAnimated = false;
let panelContentAnimated = false;
animatePanelEntrance([{
  children: [{ animate() { panelContentAnimated = true; } }],
  animate() { panelShellAnimated = true; },
}]);
assert.equal(panelContentAnimated, true, "dashboard panel contents must receive the entrance motion");
assert.equal(panelShellAnimated, false, "dashboard panel shells must stay aligned with their loading placeholders");
globalThis.matchMedia = () => ({ matches: true });
assert.deepEqual(animatePanelEntrance([{ animate() { throw new Error("reduced motion must skip animation"); } }]), [], "dashboard panel entrance must respect reduced motion");
if (originalMatchMedia) globalThis.matchMedia = originalMatchMedia;
else delete globalThis.matchMedia;

const root = path.dirname(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(?:[A-Za-z]:)/, (match) => match.slice(1))));
await runArchitectureTests(root);
const { dashboardSource, localeKeys } = await runManifestSecurityTests(root);
const settingsWorkflowSource = await fs.readFile(path.join(root, "extension", "runtime", "settings-workflow.mjs"), "utf8");
assert.match(settingsWorkflowSource, /"websiteShortcutsEnabled", "websiteShortcuts"/, "settings saves must allow the shortcut switch and ordered list");
assert(settingsWorkflowSource.includes('"bookmarkOnlyFolders", "hiddenBookmarkCategories"'), "settings saves must allow bookmark category visibility changes");
const bookmarkSourceChangeSource = settingsWorkflowSource.slice(
  settingsWorkflowSource.indexOf("const bookmarkSourceChanged = ["),
  settingsWorkflowSource.indexOf("const rankingChanged ="),
);
assert(!bookmarkSourceChangeSource.includes("hiddenBookmarkCategories"), "bookmark-only visibility changes must not refresh news sources or caches");
const primarySourceChangeSource = settingsWorkflowSource.slice(
  settingsWorkflowSource.indexOf("const primarySourceChanged = ["),
  settingsWorkflowSource.indexOf("const bookmarkSourceChanged = ["),
);
assert(primarySourceChangeSource.includes('"newsBookmarkFolder", "newsSourceMode", "inspirationBookmarkFolder", "inspirationSourceMode"'), "both primary source selectors must be tracked independently of optional source settings");
assert(settingsWorkflowSource.indexOf("refreshCoordinator.invalidate()") < settingsWorkflowSource.indexOf("if (sourceRefreshScheduled) startRefresh(true)"), "a primary source switch must invalidate the stale generation before scheduling a forced refresh");
assert(settingsWorkflowSource.includes("const sourceRefreshScheduled = primarySourceChanged")
  && settingsWorkflowSource.includes("if (sourceRefreshScheduled) startRefresh(true).catch"), "every saved primary source switch must schedule a forced cache refresh in the background workflow");
assert(settingsWorkflowSource.includes("const saved = await saveSettings(transfer.patch)"), "imports must reuse the normal settings save and provider-origin safety path");
assert.match(
  settingsWorkflowSource,
  /localeChanged && \(previous\.publicFeedSupplementEnabled !== false \|\| normalized\.publicFeedSupplementEnabled !== false\)/,
  "changing locale while public coverage is active must invalidate and refresh the locale-specific source pack",
);
assert.match(dashboardSource, /id="websiteShortcuts"/);
assert.match(dashboardSource, /id="websiteShortcutSettingsList"/);
assert.match(
  dashboardSource,
  /<label class="switch-field" for="websiteShortcutsEnabledInput">/,
  "the shortcut toggle must reuse the sized settings switch component",
);
assert.match(dashboardSource, /id="exportSettings"/);
assert.match(dashboardSource, /id="importSettings"/);
assert.match(dashboardSource, /id="settingsImportFile"[^>]+accept="\.json,application\/json"/);
const transferApiSource = await fs.readFile(path.join(root, "assets", "client", "api.mjs"), "utf8");
const transferRuntimeSource = await fs.readFile(path.join(root, "extension", "runtime", "extension-runtime.mjs"), "utf8");
const transferControllerSource = await fs.readFile(path.join(root, "assets", "client", "settings-transfer-controller.mjs"), "utf8");
assert(transferApiSource.includes('"GET /api/settings/export": "settings:export"')
  && transferApiSource.includes('"POST /api/settings/import": "settings:import"'), "settings transfer must use explicit client routes");
assert(transferRuntimeSource.includes('"settings:export": () => exportSettings()')
  && transferRuntimeSource.includes('"settings:import": (payload) => importSettings(payload)'), "settings transfer must remain behind background message routes");
assert(transferControllerSource.includes("file.size > maxSettingsTransferBytes")
  && transferControllerSource.includes('input.value = ""')
  && transferControllerSource.includes("URL.revokeObjectURL(url)"), "settings transfer must bound file reads, allow retrying the same file, and release download URLs");
runActivityStoreTests();
await runDashboardControllerTests();
runBookmarkFeedPolicyTests();
await runWeatherUtilityTests();
runSettingsTransferTests();
await runInspirationPresetTests();
await runTodayEventTests();
const originalFetch = globalThis.fetch;
try {
  const manyItems = Array.from({ length: 15 }, (_, index) => ({ id: String(index), url: `https://example.com/${index}`, title: `Item ${index}`, content_text: `Summary ${index}` }));
  globalThis.fetch = async () => new Response(JSON.stringify({ version: "https://jsonfeed.org/version/1.1", items: manyItems }), {
    status: 200,
    headers: { "content-type": "application/feed+json" },
  });
  assert.equal((await fetchSourceArticles({ url: "https://fixture.example/feed", title: "Fixture" }, { limit: 0 })).length, 12, "zero source limit must use the safety cap");
  globalThis.fetch = async (url) => {
    if (String(url).endsWith("/bad.xml")) return new Response("failure", { status: 503 });
    if (String(url).endsWith("/good.json")) {
      return new Response(JSON.stringify({ version: "https://jsonfeed.org/version/1.1", items: [{ id: "ok", url: "https://fixture.example/ok", title: "Recovered", content_text: "Recovered summary" }] }), {
        status: 200,
        headers: { "content-type": "application/feed+json" },
      });
    }
    return new Response('<html><head><link rel="alternate" type="application/rss+xml" href="/bad.xml"><link rel="alternate" type="application/feed+json" href="/good.json"></head></html>', {
      status: 200,
      headers: { "content-type": "text/html" },
    });
  };
  assert.equal((await fetchSourceArticles({ url: "https://recover.example/", title: "Recover" })).at(0)?.title, "Recovered", "feed discovery must continue after one candidate fails");
  globalThis.fetch = async () => new Response('<html><head><meta property="og:type" content="website"><meta property="og:title" content="Example News"><meta name="description" content="A news website, not a news article."></head><body><a href="/news">Browse all current news coverage</a><a href="/login">Sign in to your account</a></body></html>', {
    status: 200,
    headers: { "content-type": "text/html" },
  });
  assert.deepEqual(
    await fetchSourceArticles({ url: "https://homepage.example/", title: "Example News" }),
    [],
    "an HTML homepage without a feed or article links must not become a news card",
  );
  globalThis.fetch = async () => new Response('<html><head><meta content="article" property="og:type"><meta property="og:title" content="Direct article"><meta property="article:published_time" content="2026-07-12T04:00:00Z"><meta name="description" content="Direct article summary"></head><body></body></html>', {
    status: 200,
    headers: { "content-type": "text/html" },
  });
  const directArticle = await fetchSourceArticles({ url: "https://direct.example/story", title: "Direct source" });
  assert.equal(directArticle.length, 1, "a directly bookmarked HTML article must remain readable");
  assert.equal(directArticle[0].title, "Direct article");
  assert.equal(directArticle[0].timeUnverified, false);
  globalThis.fetch = async () => new Response('<html><head><meta property="og:type" content="article"><meta property="og:title" content="Mislabelled homepage"></head><body></body></html>', {
    status: 200,
    headers: { "content-type": "text/html" },
  });
  assert.deepEqual(await fetchSourceArticles({ url: "https://mislabelled.example/", title: "Mislabelled" }), [], "an article-type marker without a verified publication time must not let a root homepage enter the feed");
  globalThis.fetch = async () => new Response('<html><head><meta property="og:title" content="80 Level"><meta property="datePublished" content="2019-07-11T11:57:45Z"></head><body></body></html>', {
    status: 200,
    headers: { "content-type": "text/html" },
  });
  assert.deepEqual(await fetchSourceArticles({ url: "https://dated-homepage.example/", title: "Dated Homepage" }), [], "a stale datePublished marker must never let a root homepage enter the feed");
  globalThis.fetch = async () => new Response('<html><body><a href="/detail/123456">A sufficiently descriptive detail article title</a></body></html>', {
    status: 200,
    headers: { "content-type": "text/html" },
  });
  const detailArticles = await fetchSourceArticles({ url: "https://details.example/", title: "Details" });
  assert.equal(detailArticles.at(0)?.url, "https://details.example/detail/123456", "detail-style news links must be discovered before considering an HTML fallback");
  globalThis.fetch = async () => new Response(JSON.stringify({
    version: "https://jsonfeed.org/version/1.1",
    items: [
      { id: "privacy", url: "https://filtered.example/privacy", title: "Privacy Policy" },
      { id: "sponsored", url: "https://filtered.example/news/sponsored", title: "Sponsored: partner offer" },
      { id: "real", url: "https://filtered.example/updates/real", title: "A real feed article", content_text: "A legitimate article remains visible." },
    ],
  }), {
    status: 200,
    headers: { "content-type": "application/feed+json" },
  });
  const filteredFeed = await fetchSourceArticles({ url: "https://filtered.example/feed", title: "Filtered" });
  assert.deepEqual(filteredFeed.map((item) => item.title), ["A real feed article"], "clear utility and sponsored feed entries must be removed before caching");
  globalThis.fetch = async () => new Response("failure", { status: 503 });
  await assert.rejects(
    fetchSourceArticles({ url: "https://fixture.example/feed", title: "Fixture" }),
    (error) => error.code === "SOURCE_HTTP_ERROR" && error.messageKey === "background.error.sourceHttp" && error.retryable === true,
  );
  globalThis.fetch = async () => new Response(JSON.stringify({ version: "https://jsonfeed.org/version/1.1", items: [] }), {
    status: 200,
    headers: { "content-type": "application/feed+json" },
  });
  assert.deepEqual(await fetchSourceArticles({ url: "https://empty.example/feed", title: "Empty" }), [], "a successful empty feed must not be reported as a network error");
  globalThis.fetch = async () => new Response(new Uint8Array(2 * 1024 * 1024 + 1), {
    status: 200,
    headers: { "content-type": "application/feed+json" },
  });
  await assert.rejects(fetchSourceArticles({ url: "https://large.example/feed", title: "Large" }), (error) => error.code === "SOURCE_RESPONSE_TOO_LARGE");
  globalThis.fetch = async (url, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true });
  });
  await assert.rejects(fetchSourceArticles({ url: "https://slow.example/feed", title: "Slow" }, { timeoutMs: 5 }), (error) => error.code === "SOURCE_TIMEOUT");
} finally {
  globalThis.fetch = originalFetch;
}

assert.equal(providerEndpoint("https://api.example.com/v1/", "responses"), "https://api.example.com/v1/responses");
assert.equal(
  providerEndpoint("https://api.example.com/v1?api-version=2026-01-01", "responses"),
  "https://api.example.com/v1/responses?api-version=2026-01-01",
  "provider paths must be inserted before query parameters",
);
assert.equal(
  providerEndpoint("https://api.example.com/v1/chat/completions?api-version=2026-01-01", "chat_completions"),
  "https://api.example.com/v1/chat/completions?api-version=2026-01-01",
  "complete provider endpoints must not be duplicated",
);
try {
  globalThis.fetch = async () => new Response(JSON.stringify({ output_text: "Provider answer" }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
  assert.equal(await requestAiCompletion(DEFAULT_SETTINGS, {
    apiKey: "test-key",
    system: "System",
    input: "Input",
    maxTokens: 20,
    hasOriginPermission: async () => true,
  }), "Provider answer");
  globalThis.fetch = async () => new Response(JSON.stringify({
    output: [{ type: "message", content: [{ type: "output_text", text: "Nested response answer" }] }],
  }), { status: 200, headers: { "content-type": "application/json" } });
  assert.equal(await requestAiCompletion(DEFAULT_SETTINGS, {
    apiKey: "test-key",
    system: "System",
    input: "Input",
    maxTokens: 20,
    hasOriginPermission: async () => true,
  }), "Nested response answer");
  globalThis.fetch = async () => new Response(JSON.stringify({
    status: "incomplete",
    incomplete_details: { reason: "max_output_tokens" },
    output: [],
  }), { status: 200, headers: { "content-type": "application/json" } });
  await assert.rejects(requestAiCompletion(DEFAULT_SETTINGS, {
    apiKey: "test-key",
    system: "System",
    input: "Input",
    maxTokens: 20,
    hasOriginPermission: async () => true,
  }), (error) => error.code === "AI_OUTPUT_LIMIT" && error.messageKey === "background.error.aiOutputLimit");
  globalThis.fetch = async () => new Response(JSON.stringify({
    choices: [{ message: { content: [{ type: "text", text: "Array chat answer" }] } }],
  }), { status: 200, headers: { "content-type": "application/json" } });
  assert.equal(await requestAiCompletion({ ...DEFAULT_SETTINGS, openaiApiStyle: "chat_completions" }, {
    apiKey: "test-key",
    system: "System",
    input: "Input",
    maxTokens: 20,
    hasOriginPermission: async () => true,
  }), "Array chat answer");
  let deepSeekRequestBody = null;
  globalThis.fetch = async (url, options) => {
    deepSeekRequestBody = JSON.parse(options.body);
    return new Response(JSON.stringify({ choices: [{ message: { content: "Visible brief" } }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  assert.equal(await requestAiCompletion({
    ...DEFAULT_SETTINGS,
    openaiBaseUrl: "https://api.deepseek.com",
    openaiApiStyle: "chat_completions",
    openaiSummaryModel: "deepseek-v4-flash",
  }, {
    apiKey: "test-key",
    system: "System",
    input: "Input",
    maxTokens: 2400,
    preferVisibleOutput: true,
    hasOriginPermission: async () => true,
  }), "Visible brief");
  assert.deepEqual(deepSeekRequestBody.thinking, { type: "disabled" }, "automatic briefs must reserve DeepSeek output for visible text");
  globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ text: "Legacy completion answer" }] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
  assert.equal(await requestAiCompletion({ ...DEFAULT_SETTINGS, openaiApiStyle: "chat_completions" }, {
    apiKey: "test-key",
    system: "System",
    input: "Input",
    maxTokens: 20,
    hasOriginPermission: async () => true,
  }), "Legacy completion answer");
  let guardedAiFetches = 0;
  globalThis.fetch = async () => { guardedAiFetches += 1; return new Response("{}"); };
  const staleContextError = Object.assign(new Error("stale context"), { code: "SOURCE_PERMISSION_CHANGED" });
  await assert.rejects(requestAiCompletion(DEFAULT_SETTINGS, {
    apiKey: "test-key",
    system: "System",
    input: "Sensitive input",
    maxTokens: 20,
    hasOriginPermission: async () => true,
    validateRequest: async () => { throw staleContextError; },
  }), (error) => error === staleContextError);
  assert.equal(guardedAiFetches, 0, "a stale source context must be rejected immediately before the provider fetch");
  let combinedOrigins = [];
  await assert.rejects(requestAiCompletion(DEFAULT_SETTINGS, {
    apiKey: "test-key",
    system: "System",
    input: "Sensitive input",
    maxTokens: 20,
    hasOriginPermission: async () => { assert.fail("combined permission checks must use one snapshot"); },
    hasOriginPermissions: async (origins) => { combinedOrigins = origins; return false; },
    validateRequest: async () => ({
      origins: ["https://source.example/feed"],
      code: "SOURCE_PERMISSION_CHANGED",
      messageKey: "background.error.sourcePermission",
    }),
  }), (error) => error.code === "SOURCE_PERMISSION_CHANGED" && error.messageKey === "background.error.sourcePermission");
  assert.deepEqual(combinedOrigins, [
    "https://api.openai.com/v1/responses",
    "https://source.example/feed",
  ], "provider and source origins must be checked together immediately before fetch");
  assert.equal(guardedAiFetches, 0);
  globalThis.fetch = async () => new Response(JSON.stringify({ results: [{}] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
  assert.equal((await testImageSearchConnection("test-key", async () => true)).count, 1);
  let imageRequest = null;
  globalThis.fetch = async (url, options) => {
    imageRequest = { url: String(url), options };
    return new Response(JSON.stringify({ results: [
      {
        title: "Site logo",
        thumbnail: { src: "https://imgs.search.brave.com/logo-proxy" },
        properties: { url: "https://example.com/logo.svg", width: 800, height: 450 },
      },
      {
        title: "Example product website",
        thumbnail: { src: "https://imgs.search.brave.com/hero-proxy" },
        properties: { url: "https://example.com/hero.jpg", width: 1200, height: 675 },
      },
    ] }), { status: 200, headers: { "content-type": "application/json" } });
  };
  assert.equal(await searchImagePreview("Example website", "test-key", async () => true), "https://imgs.search.brave.com/hero-proxy");
  assert(new URL(imageRequest.url).searchParams.get("safesearch") === "strict");
  assert.equal(imageRequest.options.redirect, "error", "Brave requests must not follow redirects");
  globalThis.fetch = async () => new Response(new Uint8Array(1024 * 1024 + 1), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
  await assert.rejects(requestAiCompletion(DEFAULT_SETTINGS, {
    apiKey: "test-key",
    system: "System",
    input: "Input",
    maxTokens: 20,
    hasOriginPermission: async () => true,
  }), (error) => error.code === "AI_RESPONSE_TOO_LARGE" && error.messageKey === "background.error.aiTooLarge");
  await assert.rejects(searchImagePreview("Example website", "test-key", async () => true), (error) => (
    error.code === "IMAGE_RESPONSE_TOO_LARGE" && error.messageKey === "background.error.imageTooLarge"
  ));
  globalThis.fetch = async () => new Response("busy", { status: 429 });
  await assert.rejects(requestAiCompletion(DEFAULT_SETTINGS, {
    apiKey: "test-key",
    system: "System",
    input: "Input",
    maxTokens: 20,
    hasOriginPermission: async () => true,
  }), (error) => error.code === "AI_HTTP_ERROR" && error.messageKey === "background.error.aiHttp" && error.retryable === true);
  globalThis.fetch = async (url, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true });
  });
  await assert.rejects(fetchBounded("https://timeout.example/", {}, { timeoutMs: 5, maxBytes: 100 }), (error) => error.code === "NETWORK_TIMEOUT");
  let responseBodyRead = false;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    url: "https://redirected.example/private",
    headers: new Headers(),
    body: {
      getReader() {
        responseBodyRead = true;
        return { read: async () => ({ done: true }), releaseLock() {} };
      },
    },
  });
  const rejectedResponse = Object.assign(new Error("origin rejected"), { code: "ORIGIN_PERMISSION_REQUIRED" });
  await assert.rejects(fetchBounded("https://allowed.example/", {}, {
    timeoutMs: 100,
    maxBytes: 100,
    validateResponse: async () => { throw rejectedResponse; },
  }), (error) => error === rejectedResponse);
  assert.equal(responseBodyRead, false, "redirect validation must run before response body reads");
} finally {
  globalThis.fetch = originalFetch;
}

const previewMetadata = extractPageMetadata(`
  <html><head>
    <meta name="twitter:image" content="https://cdn.example.com/twitter.jpg">
    <meta content="../images/hero.jpg?x=1&amp;y=2#crop" property="og:image">
  </head></html>
`, "https://design.example.com/work/item");
assert.equal(previewMetadata.heroImageUrl, "https://design.example.com/images/hero.jpg?x=1&y=2", "Open Graph images must outrank Twitter images and resolve relative URLs");
assert.equal(extractPageMetadata('<meta name="description" content="A concise website description">', "https://example.com/").description, "A concise website description", "website overview metadata must expose the page description");
assert.equal(extractPageMetadata('<meta content="/twitter.jpg" name="twitter:image">', "https://design.example.com/").heroImageUrl, "https://design.example.com/twitter.jpg", "metadata attribute order must not matter");
assert.equal(extractPageMetadata('<meta property="og:image" content="javascript:alert(1)"><link rel="image_src" href="/safe.jpg">', "https://design.example.com/").heroImageUrl, "https://design.example.com/safe.jpg", "unsafe image candidates must fall through to the next source");
assert.equal(extractPageMetadata('<meta property="og:image" content="https://127.0.0.1/private.jpg">', "https://design.example.com/").heroImageUrl, "", "remote pages must not trigger image requests to private address literals");
assert.equal(extractPageMetadata(`
  <script type="application/ld+json">{
    "@context": "https://schema.org",
    "@type": "Article",
    "image": { "@type": "ImageObject", "contentUrl": "/structured-cover.jpg" },
    "publisher": { "@type": "Organization", "logo": "/publisher-logo.jpg" }
  }</script>
`, "https://design.example.com/work").heroImageUrl, "https://design.example.com/structured-cover.jpg", "JSON-LD article images must be used without selecting publisher logos");
assert.equal(extractPageMetadata('<link rel="preload" as="image" imagesrcset="/cover-640.jpg 640w, /cover-1280.jpg 1280w">', "https://design.example.com/").heroImageUrl, "https://design.example.com/cover-1280.jpg", "preloaded responsive hero images must prefer the largest candidate");
assert.equal(extractPageMetadata(`
  <header><img src="/brand-logo.png" width="120" height="40" alt="Brand logo"></header>
  <main><article><img src="/placeholder.gif" data-src="/article-cover.jpg" width="1200" height="675" alt="Article cover image"></article></main>
`, "https://design.example.com/").heroImageUrl, "https://design.example.com/article-cover.jpg", "semantic article images must outrank decorative logos and lazy placeholders");
assert.equal(extractPageMetadata(`
  <main><picture><source srcset="/visual-640.webp 640w, /visual-1600.webp 1600w"><img src="/placeholder.gif" alt="Featured visual"></picture></main>
`, "https://design.example.com/").heroImageUrl, "https://design.example.com/visual-1600.webp", "picture source sets must remain available when the img source is only a placeholder");

let sourcePreviewRequest = null;
try {
  globalThis.fetch = async (url, options) => {
    sourcePreviewRequest = { url: String(url), options };
    return new Response('<html><head><meta content="/cover.jpg" property="og:image"></head><body>Large page</body></html>', {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8", "content-length": String(8 * 1024 * 1024) },
    });
  };
  assert.equal(await fetchSourceImagePreview("https://design.example.com/work"), "https://design.example.com/cover.jpg");
  assert.equal(sourcePreviewRequest.options.redirect, "error");
  assert.equal(sourcePreviewRequest.options.credentials, "omit");
  assert.equal(sourcePreviewRequest.options.referrerPolicy, "no-referrer");

  globalThis.fetch = async () => new Response(`<html><head>${" ".repeat(600 * 1024)}<meta property="og:image" content="/late-cover.jpg"></head></html>`, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
  assert.equal(await fetchSourceImagePreview("https://design.example.com/late"), "https://design.example.com/late-cover.jpg", "preview metadata beyond the old 512 KiB prefix must remain discoverable within the bounded 1 MiB scan");

  let unsupportedBodyRead = false;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    url: "https://design.example.com/data",
    headers: new Headers({ "content-type": "application/json" }),
    body: {
      getReader() {
        unsupportedBodyRead = true;
        return { read: async () => ({ done: true }), releaseLock() {} };
      },
    },
  });
  await assert.rejects(fetchSourceImagePreview("https://design.example.com/data"), (error) => error.code === "SOURCE_UNSUPPORTED_CONTENT");
  assert.equal(unsupportedBodyRead, false, "unsupported source bodies must be rejected before reading");
} finally {
  globalThis.fetch = originalFetch;
}

const normalizedSettings = normalizeSettings({
  unknownSetting: "must disappear",
  openaiApiStyle: "invalid",
  accentTheme: "invalid",
  customAccentColor: "not-a-color",
  dailyAiLimit: 9999,
  hotNewsEntriesPerSource: 0,
});
assert.equal(Object.hasOwn(normalizedSettings, "unknownSetting"), false);
assert.equal(normalizedSettings.openaiApiStyle, "responses");
assert.equal(normalizedSettings.accentTheme, "violet");
assert.equal(normalizedSettings.customAccentColor, "#9152FF");
assert.equal(normalizedSettings.dailyAiLimit, 500);
assert.equal(normalizedSettings.hotNewsEntriesPerSource, 0);
assert.equal(DEFAULT_SETTINGS.newsSourceMode, "public", "new installs must default to the Ampira public Feed");
assert.equal(DEFAULT_SETTINGS.inspirationSourceMode, "preset", "new installs must default to the Ampira inspiration preset");
assert.equal(normalizeSettings({}).newsSourceMode, "public", "fresh settings must select the Ampira public Feed");
assert.equal(normalizeSettings({}).inspirationSourceMode, "preset", "fresh settings must select the Ampira inspiration preset");
assert.equal(normalizeSettings({ schemaVersion: 1 }).newsSourceMode, "bookmarks", "legacy settings must retain their news bookmark folder");
assert.equal(normalizeSettings({ schemaVersion: 1 }).inspirationSourceMode, "bookmarks", "legacy settings must retain their inspiration bookmark folder");
const publicOnlySettings = normalizeSettings({
  schemaVersion: 1,
  newsSourceMode: "public",
  publicFeedSupplementEnabled: false,
  newsBookmarkFolder: "资讯",
  bookmarkOnlyFolders: ["资讯"],
});
assert.equal(publicOnlySettings.publicFeedSupplementEnabled, true, "public Feed mode must keep the public supplement enabled");
assert.deepEqual(publicOnlySettings.bookmarkOnlyFolders, ["资讯"], "the inactive news folder may remain available as an extra bookmark folder");
const presetOnlySettings = normalizeSettings({
  schemaVersion: 1,
  newsSourceMode: "public",
  inspirationSourceMode: "preset",
  inspirationBookmarkFolder: "审美",
  bookmarkOnlyFolders: ["审美"],
});
assert.deepEqual(presetOnlySettings.bookmarkOnlyFolders, ["审美"], "the inactive inspiration folder may remain available as an extra bookmark folder");
assert.deepEqual(newlyRequiredUngrantedOrigins([
  { origin: "https://personal-news.example/*", required: true, granted: false },
  { origin: "https://personal-inspiration.example/*", required: true, granted: false },
  { origin: "https://existing.example/*", required: true, granted: false },
], [
  { origin: "https://existing.example/*", required: true, granted: false },
]), [
  "https://personal-news.example/*",
  "https://personal-inspiration.example/*",
], "personal source saves must prompt only for newly required ungranted origins");
assert.deepEqual(exactPermissionOrigins([
  "https://personal-news.example/path",
  "https://personal-news.example/*",
  "http://localhost:8770/path",
  "http://insecure.example/path",
  "https://*/*",
]), [
  "https://personal-news.example/*",
  "http://localhost:8770/*",
], "saved-source prompts must request deduplicated exact secure origins only");
assert.equal(personalSourcePermissionScope({ newsSourceMode: "bookmarks" }, { newsBookmarkFolder: "资讯" }), "news");
assert.equal(personalSourcePermissionScope({ inspirationSourceMode: "bookmarks" }, { inspirationSourceMode: "bookmarks" }), "inspiration");
assert.equal(personalSourcePermissionScope({ newsSourceMode: "bookmarks", inspirationSourceMode: "bookmarks" }, {
  newsSourceMode: "bookmarks",
  inspirationBookmarkFolder: "审美",
}), "both");
assert.equal(personalSourcePermissionScope({ newsSourceMode: "public" }, { publicFeedSupplementEnabled: true }), "", "public-only changes must not open the personal-source permission prompt");
assert.equal(DEFAULT_SETTINGS.todayNewsPerPublisherLimit, 0);
assert.equal(normalizeSettings({ todayNewsPerPublisherLimit: 0 }).todayNewsPerPublisherLimit, 0);
assert.equal(normalizeSettings({ todayNewsPerPublisherLimit: 1 }).todayNewsPerPublisherLimit, 1);
assert.equal(normalizeSettings({ todayNewsPerPublisherLimit: 2 }).todayNewsPerPublisherLimit, 2);
assert.equal(normalizeSettings({ todayNewsPerPublisherLimit: 10 }).todayNewsPerPublisherLimit, 10);
assert.equal(normalizeSettings({ todayNewsPerPublisherLimit: 11 }).todayNewsPerPublisherLimit, 10);
assert.equal(normalizeSettings({ todayNewsPerPublisherLimit: -1 }).todayNewsPerPublisherLimit, 0);
assert.equal(normalizedSettings.aiDisclosureAccepted, false);
assert.equal(normalizedSettings.headerImageUrl, DEFAULT_SETTINGS.headerImageUrl);
assert.equal(normalizeSettings({ headerImageUrl: "" }).headerImageUrl, "", "the default cover URL must remain removable");
assert.equal(DEFAULT_SETTINGS.headerImageBlurEnabled, false, "cover blur must remain opt-in");
assert.equal(DEFAULT_SETTINGS.headerImageBlurAmount, 12, "cover blur must retain a useful remembered default");
assert.equal(normalizeSettings({ headerImageBlurEnabled: true, headerImageBlurAmount: -1 }).headerImageBlurAmount, 0);
assert.equal(normalizeSettings({ headerImageBlurEnabled: true, headerImageBlurAmount: 18.7 }).headerImageBlurAmount, 19);
assert.equal(normalizeSettings({ headerImageBlurEnabled: true, headerImageBlurAmount: 99 }).headerImageBlurAmount, 24);
assert.equal(DEFAULT_SETTINGS.websiteShortcutsEnabled, false, "website shortcuts must remain opt-in");
assert.deepEqual(DEFAULT_SETTINGS.websiteShortcuts, []);
const normalizedHiddenCategories = normalizeHiddenBookmarkCategories([
  { section: "  资讯 ", category: " 产品   动态 " },
  { section: "资讯", category: "产品 动态" },
  { section: "审美", category: "灵感" },
  { section: "", category: "无效" },
  null,
]);
assert.deepEqual(normalizedHiddenCategories, [
  { section: "资讯", category: "产品 动态" },
  { section: "审美", category: "灵感" },
]);
assert.equal(normalizeHiddenBookmarkCategories(Array.from({ length: 120 }, (_, index) => ({
  section: "资讯",
  category: `分类 ${index}`,
}))).length, MAX_HIDDEN_BOOKMARK_CATEGORIES, "hidden bookmark categories must stay within the sync-safe item cap");
const visibilitySettings = { hiddenBookmarkCategories: normalizedHiddenCategories };
assert.equal(isBookmarkCategoryHidden(visibilitySettings, "资讯", "产品 动态"), true);
assert.equal(isBookmarkCategoryHidden(visibilitySettings, "资讯", "灵感"), false, "category identity must include its parent section");
const withHiddenCategory = hideBookmarkCategory(visibilitySettings, "资讯", "行业");
assert.equal(withHiddenCategory.length, 3);
assert.deepEqual(restoreBookmarkCategory({ hiddenBookmarkCategories: withHiddenCategory }, "资讯", "产品 动态"), [
  { section: "审美", category: "灵感" },
  { section: "资讯", category: "行业" },
]);
assert.equal(normalizeWebsiteShortcutUrl("openai.com"), "https://openai.com/");
assert.equal(normalizeWebsiteShortcutUrl("http://localhost:4173/start"), "http://localhost:4173/start");
assert.equal(normalizeWebsiteShortcutUrl("http://127.0.0.1:4173/start"), "http://127.0.0.1:4173/start");
assert.equal(normalizeWebsiteShortcutUrl("http://example.com"), "", "insecure remote shortcuts must be rejected");
assert.equal(normalizeWebsiteShortcutUrl("https://user:secret@example.com"), "", "shortcut URLs must reject embedded credentials");
assert.equal(normalizeWebsiteShortcutUrl("javascript:alert(1)"), "", "shortcut URLs must reject active protocols");
assert.equal(normalizeWebsiteShortcutUrl(`https://example.com/${"x".repeat(2048)}`), "", "shortcut URLs must enforce the storage length limit");
const normalizedShortcuts = normalizeSettings({
  websiteShortcutsEnabled: true,
  websiteShortcuts: [
    { title: "  OpenAI   Docs  ", url: "openai.com/docs" },
    { title: "Duplicate", url: "https://openai.com/docs" },
    { title: "Unsafe", url: "http://example.com" },
    ...Array.from({ length: 20 }, (_, index) => ({ title: `Site ${index}`, url: `https://site-${index}.example/` })),
  ],
});
assert.equal(normalizedShortcuts.websiteShortcutsEnabled, true);
assert.equal(normalizedShortcuts.websiteShortcuts.length, MAX_WEBSITE_SHORTCUTS);
assert.deepEqual(normalizedShortcuts.websiteShortcuts[0], { title: "OpenAI Docs", url: "https://openai.com/docs" });
const disabledShortcuts = normalizeSettings({
  websiteShortcutsEnabled: false,
  websiteShortcuts: [{ title: "x".repeat(80), url: "retained.example" }],
});
assert.equal(disabledShortcuts.websiteShortcuts[0].title.length, 60, "shortcut titles must be capped at 60 characters");
assert.deepEqual(disabledShortcuts.websiteShortcuts.map((item) => item.url), ["https://retained.example/"], "disabling shortcuts must retain their normalized list");
const shortcutDraft = [{ title: "A", url: "https://a.example/" }];
assert.deepEqual(upsertWebsiteShortcut(shortcutDraft, { title: "B", url: "https://b.example/" }), [
  ...shortcutDraft,
  { title: "B", url: "https://b.example/" },
]);
assert.deepEqual(upsertWebsiteShortcut(shortcutDraft, { title: "A2", url: "https://a.example/2" }, 0), [
  { title: "A2", url: "https://a.example/2" },
]);
assert.deepEqual(removeWebsiteShortcut([...shortcutDraft, { title: "B", url: "https://b.example/" }], 0), [
  { title: "B", url: "https://b.example/" },
]);
assert.deepEqual(moveWebsiteShortcut([
  ...shortcutDraft,
  { title: "B", url: "https://b.example/" },
], 1, -1).map((item) => item.title), ["B", "A"]);
const orderedShortcutDraft = [
  { title: "A", url: "https://a.example/" },
  { title: "B", url: "https://b.example/" },
  { title: "C", url: "https://c.example/" },
  { title: "D", url: "https://d.example/" },
];
assert.deepEqual(reorderWebsiteShortcuts(orderedShortcutDraft, 0, 3).map((item) => item.title), ["B", "C", "D", "A"], "shortcut dragging must move the first entry to the end");
assert.deepEqual(reorderWebsiteShortcuts(orderedShortcutDraft, 3, 0).map((item) => item.title), ["D", "A", "B", "C"], "shortcut dragging must move the last entry to the start");
assert.deepEqual(reorderWebsiteShortcuts(orderedShortcutDraft, 2, 1).map((item) => item.title), ["A", "C", "B", "D"], "shortcut dragging must support non-adjacent insertion in either direction");
assert.deepEqual(orderedShortcutDraft.map((item) => item.title), ["A", "B", "C", "D"], "shortcut reordering must not mutate the settings draft passed by the caller");
assert.deepEqual(reorderWebsiteShortcuts(orderedShortcutDraft, -1, 2), orderedShortcutDraft, "invalid shortcut drag indices must leave the order unchanged");
const newsPreviewFixture = {
  sourceKey: "news-source",
  url: "https://news.example/story",
  title: "Original headline",
  summaryTitle: "Organized headline",
};
assert.deepEqual(newsPreviewTargets([newsPreviewFixture]), [
  { url: "https://news.example/story", title: "Organized headline" },
  { url: "https://news.example/story", title: "Original headline" },
], "news preview targets must retain both visible title variants for Brave cache reuse");
assert.deepEqual(newsPreviewTargets([{
  ...newsPreviewFixture,
  url: "https://news.example/unreadable",
  timeUnverified: true,
  title: "Undated landing page",
}]), [], "feed entries hidden by the dashboard must not become preview targets");
const previewTargetService = createReaderPreviewService({
  normalizeUserUrl,
  async getSettings() { return { bookmarkConsentGranted: true, webImageSearchEnabled: true }; },
  async currentBookmarkModel() {
    return {
      bookmarks: [{ cardType: "inspiration", url: "https://inspiration.example/work", title: "Work" }],
    };
  },
  async getRecord(key, fallback) {
    return key === "feed" ? { schemaVersion: 2, items: [newsPreviewFixture] } : fallback;
  },
  async currentFeedPermissionState() {
    return { permitted: [], grantedOrigins: [] };
  },
  filterFeedItemsBySources(items) { return items; },
  inspirationPreviewTargets,
  newsPreviewTargets,
  async secretStatus() { return { hasImageSearchKey: true }; },
  async hasOriginPermission(value) { return String(value).startsWith("https://api.search.brave.com/"); },
});
assert.equal(await previewTargetService.isSitePreviewTarget(newsPreviewFixture.url), true, "visible news cards must be exact preview targets");
assert.equal(await previewTargetService.isSitePreviewTarget("https://inspiration.example/work"), true, "news fallback must preserve inspiration targets");
assert.equal(await previewTargetService.isSitePreviewTarget("https://unrelated.example/"), false, "preview access must remain closed to unrelated URLs");
assert.equal(await previewTargetService.previewCachePermitted({
  strategyVersion: 2,
  capability: "site-preview-brave",
  requestedUrl: newsPreviewFixture.url,
  providerOrigin: "https://api.search.brave.com",
}), true, "Brave preview caches must be allowed for current news cards");
let originalPreviewFetches = 0;
let originalPreviewSearches = 0;
let previewCacheEpoch = -1;
const originalPreviewRecords = new Map();
const getOriginalPreview = createPreviewService({
  async getSettings() { assert.fail("an original hit must not read Brave settings"); },
  async readSecrets() { assert.fail("an original hit must not read the Brave key"); },
  async getRecord(key, fallback) { return originalPreviewRecords.get(key) || fallback; },
  async setRecord(key, value, _kind, cacheEpoch) { originalPreviewRecords.set(key, value); previewCacheEpoch = cacheEpoch; },
  async hasOriginPermission(value) { return String(value).startsWith("https://origin.example/"); },
  captureCacheEpoch() { return 17; },
  async fetchSourceImage() {
    originalPreviewFetches += 1;
    return "https://origin.example/hero.jpg";
  },
  async searchImage() { originalPreviewSearches += 1; return ""; },
  now: () => Date.parse("2026-07-11T00:00:00Z"),
});
const originalPreview = await getOriginalPreview({ url: "https://origin.example/design", title: "Original" });
assert.equal(originalPreview.imageUrl, "https://origin.example/hero.jpg");
assert.equal(originalPreview.source, "origin");
assert.equal(originalPreview.originalStatus, "found");
assert.equal((await getOriginalPreview({ url: "https://origin.example/design", title: "Renamed" })).cached, true, "original caches must depend on URL, not title");
assert.equal(originalPreviewFetches, 1);
assert.equal(originalPreviewSearches, 0, "Brave must not run when the original page supplies an image");
assert.equal(previewCacheEpoch, 17, "preview writes must retain the permission/cache epoch captured before the request");
assert([...originalPreviewRecords.keys()].some((key) => key.startsWith("preview-origin-v4-")), "the optimized extractor must bypass legacy preview misses with the current cache identity");

let previewSearches = 0;
const previewRecords = new Map();
const getPreview = createPreviewService({
  async getSettings() { return { webImageSearchEnabled: true }; },
  async readSecrets() { return { braveSearchApiKey: "preview-key" }; },
  async getRecord(key, fallback) { return previewRecords.get(key) || fallback; },
  async setRecord(key, value, _kind, cacheEpoch) { previewRecords.set(key, value); previewCacheEpoch = cacheEpoch; },
  async hasOriginPermission() { return true; },
  captureCacheEpoch() { return 17; },
  async fetchSourceImage() { return ""; },
  async searchImage(query) {
    previewSearches += 1;
    assert(query.includes("example.com"));
    return "https://imgs.search.brave.com/preview";
  },
  now: () => Date.parse("2026-07-11T00:00:00Z"),
});
assert.equal((await getPreview({ url: "http://insecure.example.com/", title: "Unsafe" })).originalStatus, "invalid");
const braveFallbackPreview = await getPreview({ url: "https://example.com/design", title: "Example Design" });
assert.equal(braveFallbackPreview.imageUrl, "https://imgs.search.brave.com/preview");
assert.equal(braveFallbackPreview.source, "brave");
assert.equal(braveFallbackPreview.originalStatus, "missing");
assert.equal((await getPreview({ url: "https://example.com/design", title: "Example Design" })).cached, true);
assert.equal(previewSearches, 1, "successful Brave fallbacks must be reused from their own cache");

let disallowedTargetTouched = false;
const getDisallowedPreview = createPreviewService({
  async isAllowedTarget() { return false; },
  async getSettings() { disallowedTargetTouched = true; return {}; },
  async readSecrets() { disallowedTargetTouched = true; return {}; },
  async getRecord() { disallowedTargetTouched = true; return null; },
  async setRecord() { disallowedTargetTouched = true; },
  async hasOriginPermission() { disallowedTargetTouched = true; return true; },
  async fetchSourceImage() { disallowedTargetTouched = true; return ""; },
  async searchImage() { disallowedTargetTouched = true; return ""; },
});
assert.equal((await getDisallowedPreview({ url: "https://not-a-card.example/", title: "Blocked" })).originalStatus, "unavailable");
assert.equal(disallowedTargetTouched, false, "preview:get must not become a general fetch endpoint for URLs outside current cards");

let skippedSourceFetches = 0;
const getPermissionFallback = createPreviewService({
  async getSettings() { return { webImageSearchEnabled: true }; },
  async readSecrets() { return { braveSearchApiKey: "preview-key" }; },
  async getRecord(_key, fallback) { return fallback; },
  async setRecord() {},
  async hasOriginPermission(value) { return String(value).startsWith("https://api.search.brave.com/"); },
  async fetchSourceImage() { skippedSourceFetches += 1; return "https://denied.example/hero.jpg"; },
  async searchImage() { return "https://imgs.search.brave.com/permission-fallback"; },
});
const permissionFallback = await getPermissionFallback({ url: "https://denied.example/", title: "Denied" });
assert.equal(permissionFallback.imageUrl, "https://imgs.search.brave.com/permission-fallback");
assert.equal(permissionFallback.originalStatus, "unavailable");
assert.equal(skippedSourceFetches, 0, "an ungranted source origin must never be fetched");

let revokedPreviewCacheRead = false;
const getRevokedPreview = createPreviewService({
  async getSettings() { return { webImageSearchEnabled: true }; },
  async readSecrets() { return { braveSearchApiKey: "preview-key" }; },
  async getRecord() { revokedPreviewCacheRead = true; return { imageUrl: "https://imgs.search.brave.com/stale" }; },
  async setRecord() { assert.fail("revoked preview access must not write cache"); },
  async hasOriginPermission() { return false; },
  async fetchSourceImage() { assert.fail("revoked source access must not fetch HTML"); },
  async searchImage() { assert.fail("revoked Brave access must not issue a search"); },
});
const revokedPreview = await getRevokedPreview({ url: "https://example.com/", title: "Example" });
assert.equal(revokedPreview.ok, false);
assert.equal(revokedPreview.imageUrl, "");
assert.equal(revokedPreview.originalStatus, "unavailable");
assert.equal(revokedPreviewCacheRead, false, "revoked capabilities must fail closed before reading either cache");

let emptyPreviewSearches = 0;
let emptySourceFetches = 0;
let emptyPreviewNow = Date.parse("2026-07-11T00:00:00Z");
const emptyPreviewRecords = new Map();
const getEmptyPreview = createPreviewService({
  async getSettings() { return { webImageSearchEnabled: true }; },
  async readSecrets() { return { braveSearchApiKey: "preview-key" }; },
  async getRecord(key, fallback) { return emptyPreviewRecords.get(key) || fallback; },
  async setRecord(key, value) { emptyPreviewRecords.set(key, value); },
  async hasOriginPermission() { return true; },
  async fetchSourceImage() { emptySourceFetches += 1; return ""; },
  async searchImage() { emptyPreviewSearches += 1; return ""; },
  now: () => emptyPreviewNow,
});
await getEmptyPreview({ url: "https://empty.example/", title: "Empty" });
assert.equal((await getEmptyPreview({ url: "https://empty.example/", title: "Empty" })).cached, true);
assert.equal(emptySourceFetches, 1);
assert.equal(emptyPreviewSearches, 1, "confirmed empty previews must be negative-cached for the current day");
emptyPreviewNow += 2 * 60 * 60 * 1000 + 1;
await getEmptyPreview({ url: "https://empty.example/", title: "Empty" });
assert.equal(emptySourceFetches, 2, "original misses must retry after two hours so transient consent or bot pages do not hide images all day");
assert.equal(emptyPreviewSearches, 1, "a refreshed original miss must continue reusing the 24-hour Brave negative cache");
emptyPreviewNow += 22 * 60 * 60 * 1000 + 1;
await getEmptyPreview({ url: "https://empty.example/", title: "Empty" });
assert.equal(emptySourceFetches, 3, "original misses must continue their shorter retry cadence");
assert.equal(emptyPreviewSearches, 2, "expired Brave misses must be retried");

let sourceErrorFetches = 0;
const getSourceErrorPreview = createPreviewService({
  async getSettings() { return { webImageSearchEnabled: false }; },
  async readSecrets() { return { braveSearchApiKey: "" }; },
  async getRecord(_key, fallback) { return fallback; },
  async setRecord() { assert.fail("source network errors must not be negative-cached"); },
  async hasOriginPermission(value) { return !String(value).startsWith("https://api.search.brave.com/"); },
  async fetchSourceImage() { sourceErrorFetches += 1; throw new Error("offline"); },
  async searchImage() { assert.fail("disabled Brave fallback must not run"); },
});
await getSourceErrorPreview({ url: "https://source-error.example/", title: "Error" });
await getSourceErrorPreview({ url: "https://source-error.example/", title: "Error" });
assert.equal(sourceErrorFetches, 2, "source failures must remain retryable across service calls");

let concurrentPreviewSearches = 0;
let releaseConcurrentPreview;
const concurrentPreviewGate = new Promise((resolve) => { releaseConcurrentPreview = resolve; });
const getConcurrentPreview = createPreviewService({
  async getSettings() { return { webImageSearchEnabled: true }; },
  async readSecrets() { return { braveSearchApiKey: "preview-key" }; },
  async getRecord(_key, fallback) { return fallback; },
  async setRecord() {},
  async hasOriginPermission() { return true; },
  async fetchSourceImage() { return ""; },
  async searchImage() {
    concurrentPreviewSearches += 1;
    await concurrentPreviewGate;
    return "https://imgs.search.brave.com/shared-preview";
  },
});
const concurrentPreviewA = getConcurrentPreview({ url: "https://concurrent.example/", title: "Concurrent" });
const concurrentPreviewB = getConcurrentPreview({ url: "https://concurrent.example/", title: "Concurrent" });
releaseConcurrentPreview();
const concurrentPreviewResults = await Promise.all([concurrentPreviewA, concurrentPreviewB]);
assert.equal(concurrentPreviewSearches, 1, "concurrent preview requests must share the complete origin-to-Brave pipeline");
assert.deepEqual(concurrentPreviewResults[0], concurrentPreviewResults[1]);

let failedPreviewCacheWrites = 0;
const getPreviewWithUnavailableCache = createPreviewService({
  async getSettings() { return { webImageSearchEnabled: true }; },
  async readSecrets() { return { braveSearchApiKey: "preview-key" }; },
  async getRecord(_key, fallback) { return fallback; },
  async setRecord() {
    failedPreviewCacheWrites += 1;
    throw new Error("cache unavailable");
  },
  async hasOriginPermission() { return true; },
  async fetchSourceImage() { return ""; },
  async searchImage() { return "https://imgs.search.brave.com/uncached-preview"; },
});
const uncachedPreview = await getPreviewWithUnavailableCache({ url: "https://uncached.example/", title: "Uncached" });
assert.equal(uncachedPreview.ok, true, "cache write failures must not discard a valid preview result");
assert.equal(uncachedPreview.imageUrl, "https://imgs.search.brave.com/uncached-preview");
assert.equal(failedPreviewCacheWrites, 2, "origin and Brave cache failures must both remain isolated");

let retryablePreviewSearches = 0;
const retryablePreviewRecords = new Map();
const getRetryablePreview = createPreviewService({
  async getSettings() { return { webImageSearchEnabled: true }; },
  async readSecrets() { return { braveSearchApiKey: "preview-key" }; },
  async getRecord(key, fallback) { return retryablePreviewRecords.get(key) || fallback; },
  async setRecord(key, value) { retryablePreviewRecords.set(key, value); },
  async hasOriginPermission() { return true; },
  async fetchSourceImage() { return ""; },
  async searchImage() {
    retryablePreviewSearches += 1;
    if (retryablePreviewSearches === 1) throw Object.assign(new Error("temporary failure"), { retryable: true });
    return "https://imgs.search.brave.com/retried-preview";
  },
});
const failedPreviewRequests = await Promise.all([
  getRetryablePreview({ url: "https://retry.example/", title: "Retry" }),
  getRetryablePreview({ url: "https://retry.example/", title: "Retry" }),
]);
assert.equal(retryablePreviewSearches, 1, "concurrent failed preview requests must still share the in-flight search");
assert.equal(failedPreviewRequests[0].retryable, true);
assert.deepEqual(failedPreviewRequests[0], failedPreviewRequests[1]);
const retriedPreview = await getRetryablePreview({ url: "https://retry.example/", title: "Retry" });
assert.equal(retryablePreviewSearches, 2, "a failed Brave request must be cleared so the next call can retry");
assert.equal(retriedPreview.imageUrl, "https://imgs.search.brave.com/retried-preview");
assert.throws(() => normalizeFeedback({ action: "unknown", articleId: "article" }), (error) => error.code === "INVALID_FEEDBACK" && error.retryable === false);
assert.throws(() => normalizeFeedback({ action: "read", articleId: "" }), (error) => error.code === "INVALID_FEEDBACK");
const normalizedFeedback = normalizeFeedback({
  action: "more_like_this",
  articleId: "a".repeat(300),
  source: "s".repeat(300),
  category: "c".repeat(300),
  topics: [...Array.from({ length: 25 }, (_, index) => `topic-${index}`), "topic-1"],
});
assert.equal(normalizedFeedback.articleId.length, 200);
assert.equal(normalizedFeedback.source.length, 200);
assert.equal(normalizedFeedback.category.length, 200);
assert.equal(normalizedFeedback.topics.length, 20);
const largeNormalizedSettings = normalizeSettings({
  bookmarkOnlyFolders: Array.from({ length: 100 }, (_, index) => `Folder ${index} ${"x".repeat(150)}`),
  hiddenBookmarkCategories: Array.from({ length: 20 }, (_, index) => ({ section: "Bookmarks", category: `Category ${index}` })),
  websiteShortcutsEnabled: true,
  websiteShortcuts: Array.from({ length: MAX_WEBSITE_SHORTCUTS }, (_, index) => ({
    title: `Shortcut ${index}`,
    url: `https://shortcut-${index}.example/`,
  })),
  excludedNewsSources: Array.from({ length: 250 }, (_, index) => ({
    id: `exclude-${index}`,
    type: "source",
    value: `https://source-${index}.example.com/${"path/".repeat(80)}`,
    url: `https://source-${index}.example.com/${"article/".repeat(80)}`,
    title: `Source ${index} ${"title ".repeat(30)}`,
    reasonDetail: "failure ".repeat(60),
  })),
});
const encodedSettings = encodeSettingsForSync(largeNormalizedSettings);
assert(settingsChunkKeys(encodedSettings[SETTINGS_KEY]).length > 0, "large valid settings must be split across sync items");
for (const [key, value] of Object.entries(encodedSettings)) {
  assert(new TextEncoder().encode(JSON.stringify(value)).byteLength <= 7000, `${key} must stay below the sync per-item safety budget`);
}
assert(Object.entries(encodedSettings).reduce((total, [key, value]) => (
  total + new TextEncoder().encode(JSON.stringify(key)).byteLength + new TextEncoder().encode(JSON.stringify(value)).byteLength
), 0) <= 90 * 1024, "chunked settings must stay below the sync total safety budget");
const decodedSettings = decodeSettingsFromSync(encodedSettings);
assert.deepEqual(decodedSettings.bookmarkOnlyFolders, largeNormalizedSettings.bookmarkOnlyFolders);
assert.deepEqual(decodedSettings.hiddenBookmarkCategories, largeNormalizedSettings.hiddenBookmarkCategories);
assert.deepEqual(decodedSettings.websiteShortcuts, largeNormalizedSettings.websiteShortcuts);
assert.deepEqual(decodedSettings.excludedNewsSources, largeNormalizedSettings.excludedNewsSources);
const maximumShortcutSettings = normalizeSettings({
  websiteShortcutsEnabled: true,
  websiteShortcuts: Array.from({ length: MAX_WEBSITE_SHORTCUTS }, (_, index) => ({
    title: `Long shortcut ${index}`,
    url: `https://long-shortcut-${index}.example/${"x".repeat(1800)}`,
  })),
});
const encodedMaximumShortcuts = encodeSettingsForSync(maximumShortcutSettings);
assert(encodedMaximumShortcuts[SETTINGS_KEY].settingsChunks.fields.websiteShortcuts.length > 1, "the full 16-shortcut allowance must be chunked below Chrome Sync's per-item limit");
assert.deepEqual(decodeSettingsFromSync(encodedMaximumShortcuts).websiteShortcuts, maximumShortcutSettings.websiteShortcuts);
for (const value of Object.values(encodedMaximumShortcuts)) {
  assert(new TextEncoder().encode(JSON.stringify(value)).byteLength <= 7000, "every maximum-shortcut sync record must stay below the per-item safety budget");
}
const settingsSyncStorage = memoryStorage();
const settingsStore = createSettingsStore(settingsSyncStorage);
await settingsStore.write(largeNormalizedSettings);
assert.deepEqual((await settingsStore.read()).excludedNewsSources, largeNormalizedSettings.excludedNewsSources);
assert.deepEqual((await settingsStore.read()).hiddenBookmarkCategories, largeNormalizedSettings.hiddenBookmarkCategories);
const oldSettingChunkKeys = settingsChunkKeys((await settingsSyncStorage.get(SETTINGS_KEY))[SETTINGS_KEY]);
assert(oldSettingChunkKeys.length > 0);
await settingsStore.write(DEFAULT_SETTINGS);
const afterCompactWrite = await settingsSyncStorage.get(null);
assert(oldSettingChunkKeys.every((key) => !Object.hasOwn(afterCompactWrite, key)), "obsolete settings chunks must be removed after a compact write");
await settingsSyncStorage.set({ [SETTINGS_KEY]: { ...DEFAULT_SETTINGS, openaiApiKey: "legacy-synced-secret" } });
assert.equal(await settingsStore.sanitizeLegacyCredentials(), true);
assert.equal(Object.hasOwn((await settingsSyncStorage.get(SETTINGS_KEY))[SETTINGS_KEY], "openaiApiKey"), false, "legacy synced credentials must be scrubbed");
assert.deepEqual(pageForItems([1, 2, 3, 4, 5], 2, -1), {
  items: [5], page: 3, pageCount: 3, variant: 2, total: 5,
});
assert.deepEqual(seededShuffle([1, 2, 3, 4], "same-seed"), seededShuffle([1, 2, 3, 4], "same-seed"));
const selectorItems = [
  { key: "a", url: "https://example.com/a", title: "A", hotScore: 10, time: 10 },
  { key: "b", url: "https://example.com/b", title: "B", hotScore: 90, time: 20 },
];
const selectorRanker = createPriorityRanker({
  digestItems: [{ url: "https://example.com/a", title: "A", importanceScore: 100 }],
  digestKeys: (item) => [item.url, item.title],
  itemKeys: (item) => [item.url, item.title],
  hotScore: (item) => item.hotScore,
  itemTime: (item) => item.time,
});
assert.deepEqual([...selectorItems].sort(selectorRanker.compareImportant).map((item) => item.key), ["a", "b"], "digest priority must outrank fallback hot score");
assert.deepEqual([...selectorItems].sort(selectorRanker.compareByOrder("time")).map((item) => item.key), ["b", "a"]);
const qualityRanker = createPriorityRanker({
  digestItems: [{ title: "empty", importanceScore: 100 }],
  digestKeys: (item) => [item.title],
  itemKeys: (item) => [item.title],
  hotScore: (item) => item.hotScore,
  itemTime: (item) => item.time,
  itemQuality: (item) => item.quality,
});
const qualityItems = [
  { title: "empty", hotScore: 100, time: 30, quality: 0 },
  { title: "complete", hotScore: 10, time: 10, quality: 1 },
];
assert.deepEqual([...qualityItems].sort(qualityRanker.compareImportant).map((item) => item.title), ["complete", "empty"], "bare unverified items must follow items with readable content even when their fallback score is higher");
assert.deepEqual([...qualityItems].sort(qualityRanker.compareByOrder("time")).map((item) => item.title), ["complete", "empty"], "bare unverified items must not treat fetch time as a newest-story signal");
const zeroPriorityRanker = createPriorityRanker({
  digestItems: [{ title: "zero", importanceScore: 0 }, { title: "ranked", importanceScore: 10 }],
  digestKeys: (item) => [item.title],
  itemKeys: (item) => [item.title],
});
assert.deepEqual([{ title: "zero" }, { title: "ranked" }].sort(zeroPriorityRanker.compareImportant).map((item) => item.title), ["ranked", "zero"], "an explicit zero priority must not receive the positional default score");
const rankingNow = new Date(2026, 6, 13, 12, 0, 0).getTime();
let rankingArticleSequence = 0;
const rankingArticle = (overrides = {}) => ({
  articleId: overrides.articleId || `article-${rankingArticleSequence += 1}`,
  title: "监管机构公布新的数据安全法规",
  url: overrides.url || `https://${overrides.publisherHost || "publisher.example"}/story-${rankingArticleSequence}`,
  source: overrides.publisher || "Publisher",
  host: overrides.publisherHost || "publisher.example",
  publisher: overrides.publisher || "Publisher",
  publisherHost: overrides.publisherHost || "publisher.example",
  category: overrides.category || "科技",
  publishedAt: new Date(rankingNow - 60 * 60 * 1000).toISOString(),
  timeUnverified: false,
  excerpt: "监管变化将影响大量用户和企业，报道提供了具体生效时间、适用范围与后续安排。",
  feedPosition: 0,
  ...overrides,
});
const freshRankingScore = scoreNewsArticle(rankingArticle(), rankingNow).score;
const agedRankingScore = scoreNewsArticle(rankingArticle(), rankingNow + 5 * 24 * 60 * 60 * 1000).score;
assert(freshRankingScore > agedRankingScore, "cached stories must lose freshness whenever ranking is recomputed");
const localMidnight = new Date(2026, 6, 13, 0, 5, 0).getTime();
assert.equal(newsTimeScope(rankingArticle({ publishedAt: new Date(2026, 6, 13, 0, 1, 0).toISOString() }), localMidnight), "today");
assert.equal(newsTimeScope(rankingArticle({ publishedAt: new Date(2026, 6, 12, 23, 59, 0).toISOString() }), localMidnight), "recent", "Today must follow the device-local calendar boundary");
assert.equal(scoreNewsArticle(rankingArticle({ publishedAt: new Date(rankingNow + 60 * 60 * 1000).toISOString() }), rankingNow).rankingEligible, false, "timestamps beyond the future-skew allowance must not enter Today");
assert.equal(scoreNewsArticle(rankingArticle({ publishedAt: "", timeUnverified: true }), rankingNow).rankingEligible, false, "unverified timestamps must not enter Today");
const genericRelease = scoreNewsArticle(rankingArticle({ title: "公司宣布发布常规产品更新", excerpt: "本次更新提供若干常规功能。" }), rankingNow);
const publicEmergency = scoreNewsArticle(rankingArticle({ title: "台风登陆，多地公共交通中断", excerpt: "多地启动应急响应并发布避险通知。" }), rankingNow);
assert(publicEmergency.score > genericRelease.score, "generic release wording must not outrank concrete public consequences");
const clusteredEvents = rankNewsItems([
  rankingArticle({ articleId: "event-a", publisher: "Publisher A", publisherHost: "a.example", title: "监管机构宣布新的数据安全法规" }),
  rankingArticle({ articleId: "event-b", publisher: "Publisher B", publisherHost: "b.example", title: "新的数据安全法规由监管机构正式公布", publishedAt: new Date(rankingNow - 2 * 60 * 60 * 1000).toISOString() }),
], { now: rankingNow });
assert.equal(new Set(clusteredEvents.map((item) => item.eventId)).size, 1, "reordered Chinese event wording must cluster within the time window");
assert.equal(clusteredEvents.find((item) => item.eventRepresentative)?.eventSourceCount, 2, "independent publishers must raise corroboration count");
assert(clusteredEvents.find((item) => item.eventRepresentative)?.scoreBreakdown.corroboration > 0);
const numericConflictEvents = rankNewsItems([
  rankingArticle({ articleId: "layoff-1000", publisherHost: "one.example", title: "公司宣布裁员 1000 人" }),
  rankingArticle({ articleId: "layoff-2000", publisherHost: "two.example", title: "公司宣布裁员 2000 人" }),
], { now: rankingNow });
assert.equal(new Set(numericConflictEvents.map((item) => item.eventId)).size, 2, "conflicting numeric facts must not be merged into one event");
const sharedDateNumericConflict = rankNewsItems([
  rankingArticle({ articleId: "year-layoff-1000", publisherHost: "year-one.example", title: "公司 2026 年裁员 - 1000 人" }),
  rankingArticle({ articleId: "year-layoff-2000", publisherHost: "year-two.example", title: "公司 2026 年裁员 - 2000 人" }),
], { now: rankingNow });
assert.equal(new Set(sharedDateNumericConflict.map((item) => item.eventId)).size, 2, "a shared date must not hide a conflicting event quantity");
const samePublisherDuplicates = rankNewsItems([
  rankingArticle({ articleId: "same-a", publisher: "Same", publisherHost: "same.example", title: "监管机构宣布新的数据安全法规" }),
  rankingArticle({ articleId: "same-b", publisher: "Same", publisherHost: "same.example", title: "新的数据安全法规由监管机构正式公布" }),
], { now: rankingNow });
assert.equal(samePublisherDuplicates.find((item) => item.eventRepresentative)?.eventSourceCount, 1, "same-publisher duplicates must not increase corroboration");
const singleSourceEmergency = rankNewsItems([
  rankingArticle({ articleId: "single-emergency", title: "台风登陆，多地启动防汛应急响应", excerpt: "" }),
], { now: rankingNow })[0];
assert.equal(singleSourceEmergency.rankingEligible, true, "a concrete high-impact single-source event must remain eligible without corroboration");
assert.equal(singleSourceEmergency.scoreBreakdown.corroboration, 0);
const personalizedItem = rankNewsItems([rankingArticle({ publisher: "Preferred", publisherHost: "preferred.example" })], {
  now: rankingNow,
  feedback: [{ action: "more_like_this", source: "Preferred", category: "科技", recordedAt: new Date(rankingNow).toISOString() }],
})[0];
assert(personalizedItem.scoreBreakdown.personalization > 0 && personalizedItem.scoreBreakdown.personalization <= 4, "recent local feedback must remain a bounded adjustment");
const aiPersonalizedItem = rankNewsItems([rankingArticle({ publisher: "Preferred", publisherHost: "preferred.example" })], {
  now: rankingNow,
  aiRankingEnabled: true,
  feedback: [{ action: "more_like_this", source: "Preferred", category: "科技", recordedAt: new Date(rankingNow).toISOString() }],
})[0];
assert.equal(aiPersonalizedItem.score, aiPersonalizedItem.neutralImportanceScore, "when AI ranking is enabled, personalization must only break equal local scores");
assert(aiPersonalizedItem.scoreBreakdown.personalization > 0, "AI mode may retain local personalization only as a tie-break signal");
const publicPriorityCandidate = {
  ...rankingArticle({ articleId: "public-priority", url: "https://public.example/story" }),
  eventId: "public-priority-event", eventRepresentative: true, rankingEligible: true,
  publicImportanceScore: 51, localImportanceScore: 51, scoreBreakdown: { personalization: 0 },
};
const personalizedPriorityCandidate = {
  ...rankingArticle({ articleId: "personal-priority", url: "https://personal.example/story" }),
  eventId: "personal-priority-event", eventRepresentative: true, rankingEligible: true,
  publicImportanceScore: 50, localImportanceScore: 54, scoreBreakdown: { personalization: 4 },
};
assert.equal(buildDailyCandidates([personalizedPriorityCandidate, publicPriorityCandidate], { now: rankingNow, aiRankingEnabled: true })[0].articleId, "public-priority", "AI candidate order must not let personalization override public importance");
assert.equal(buildDailyCandidates([personalizedPriorityCandidate, publicPriorityCandidate], { now: rankingNow, aiRankingEnabled: false })[0].articleId, "personal-priority", "local fallback order may apply the bounded personalization adjustment");
const expiredPersonalization = rankNewsItems([rankingArticle({ publisher: "Preferred", publisherHost: "preferred.example" })], {
  now: rankingNow,
  feedback: [{ action: "more_like_this", source: "Preferred", category: "科技", recordedAt: new Date(rankingNow - 31 * 24 * 60 * 60 * 1000).toISOString() }],
})[0];
assert.equal(expiredPersonalization.scoreBreakdown.personalization, 0, "feedback older than 30 days must not affect ranking");
const todayRankedFeed = rankNewsItems([
  ...Array.from({ length: 5 }, (_, index) => rankingArticle({
    articleId: `dominant-${index}`,
    title: `主要发布方政策事件 ${index + 1}`,
    publisher: "Dominant",
    publisherHost: "dominant.example",
    url: `https://dominant.example/${index}`,
  })),
  ...Array.from({ length: 9 }, (_, index) => rankingArticle({
    articleId: `diverse-${index}`,
    title: `独立发布方监管事件 ${index + 20}`,
    publisher: `Publisher ${index}`,
    publisherHost: `publisher-${index}.example`,
    url: `https://publisher-${index}.example/story`,
  })),
  ...Array.from({ length: 5 }, (_, index) => rankingArticle({
    articleId: `recent-${index}`,
    title: `跨日公共政策事件 ${index + 40}`,
    publisher: `Recent ${index}`,
    publisherHost: `recent-${index}.example`,
    url: `https://recent-${index}.example/story`,
    publishedAt: new Date(rankingNow - 18 * 60 * 60 * 1000).toISOString(),
  })),
], { now: rankingNow });
const todayCandidates = buildDailyCandidates(todayRankedFeed, { now: rankingNow, limit: 20, recentLimit: 3, publisherLimit: 0 });
assert.equal(todayCandidates.filter((item) => item.timeScope === "recent").length, 3, "daily candidate selection must cap cross-day news at three");
assert(todayCandidates.every((item) => ["today", "recent"].includes(newsTimeScope(item, rankingNow))));
const fallbackDigestV4 = buildFallbackDigest(todayCandidates, "local", "zh-CN", { now: rankingNow, preselected: true, publisherLimit: 2 });
assert.equal(fallbackDigestV4.schemaVersion, 4);
assert.equal(fallbackDigestV4.rankingPolicyVersion, 4);
assert(fallbackDigestV4.candidateFingerprint);
assert(fallbackDigestV4.items.every((item) => item.eventId && item.eventConfidence && item.sourceCount >= 1 && item.articleCount >= 1 && item.timeScope && Number.isFinite(item.localImportanceScore) && Number.isFinite(item.importanceScore)));
assert.notEqual(
  dailyCandidateFingerprint(todayCandidates, { publisherLimit: 2 }),
  dailyCandidateFingerprint(todayCandidates, { publisherLimit: 0 }),
  "publisher policy changes must invalidate the daily candidate fingerprint",
);
assert.notEqual(
  dailyCandidateFingerprint(todayCandidates, { publisherLimit: 2 }),
  dailyCandidateFingerprint(todayCandidates.slice(1), { publisherLimit: 2 }),
  "source permission or candidate-set changes must invalidate the daily candidate fingerprint",
);
const unifiedToday = todayRankedFeed.map((feedItem, index) => ({
  key: feedItem.articleId,
  feedItem,
  score: (feedItem.publisherHost === "dominant.example" ? 200 : 100) - index,
}));
const compareToday = (left, right) => right.score - left.score;
const limitedToday = selectTodayNewsItems(unifiedToday, { now: rankingNow, compare: compareToday, recentLimit: 3, pageSize: 10, pageCount: 1, publisherLimit: 2 });
assert.equal(limitedToday.filter((item) => item.feedItem.publisherHost === "dominant.example").length, 2, "the default Today batch must prefer at most two stories per publisher when alternatives exist");
const onePerPublisherToday = selectTodayNewsItems(unifiedToday, { now: rankingNow, compare: compareToday, recentLimit: 3, pageSize: 10, pageCount: 1, publisherLimit: 1 });
assert.equal(onePerPublisherToday.filter((item) => item.feedItem.publisherHost === "dominant.example").length, 1);
const unlimitedToday = selectTodayNewsItems(unifiedToday, { now: rankingNow, compare: compareToday, recentLimit: 3, pageSize: 10, pageCount: 1, publisherLimit: 0 });
assert(unlimitedToday.filter((item) => item.feedItem.publisherHost === "dominant.example").length > 2, "a zero publisher limit must leave the ranking unrestricted");
const tenPerPublisherToday = selectTodayNewsItems(unifiedToday, { now: rankingNow, compare: compareToday, recentLimit: 3, pageSize: 10, pageCount: 1, publisherLimit: 10 });
assert.deepEqual(tenPerPublisherToday.map((item) => item.key), unlimitedToday.map((item) => item.key));
const twoPublisherBatches = selectTodayNewsItems(unifiedToday, { now: rankingNow, compare: compareToday, recentLimit: 3, pageSize: 5, pageCount: 2, publisherLimit: 2 });
assert(twoPublisherBatches.every((_, index, list) => index % 5 || list.slice(index, index + 5).filter((item) => item.feedItem.publisherHost === "dominant.example").length <= 2), "the publisher limit must reset for each Today batch");
const relaxedPublisherLimit = selectTodayNewsItems(unifiedToday.filter((item) => item.feedItem.publisherHost === "dominant.example"), { now: rankingNow, compare: compareToday, pageSize: 5, pageCount: 1, publisherLimit: 1 });
assert.equal(relaxedPublisherLimit.length, 5, "publisher diversity must relax instead of leaving a batch empty when candidates are insufficient");
assert(limitedToday.filter((item) => newsTimeScope(item.feedItem, rankingNow) === "recent").length <= 3);
const selectedEvents = selectDailyEvents([
  ...todayCandidates.filter((item) => item.timeScope === "today").slice(0, 1).map((item) => ({ ...item, eventId: "single-source", sourceCount: 1, importanceScore: 100 })),
  ...todayCandidates.filter((item) => item.timeScope === "today").slice(1, 3).map((item, index) => ({ ...item, eventId: `today-${index}`, sourceCount: 2 + index, importanceScore: 90 - index })),
  ...todayCandidates.filter((item) => item.timeScope === "recent").map((item, index) => ({ ...item, eventId: `recent-${index}`, sourceCount: 4, importanceScore: 99 - index })),
], { now: rankingNow, limit: 3, recentLimit: 1 });
assert(selectedEvents.every((item) => Number(item.sourceCount || 1) >= 2), "Today events must not duplicate single-source news merely to fill three rows");
assert.equal(selectedEvents[0].sourceCount, 3, "Today events must prioritize independent corroboration before importance within today's scope");
assert.equal(selectedEvents.filter((item) => newsTimeScope(item, rankingNow) === "recent").length, 1, "Today events must admit at most one cross-day fallback even when AI scores it highest");
const validAiRanking = parseGeneratedDailyDigest("OVERVIEW: 第一段。\nOVERVIEW: 第二段。\nRANK 1: 92\nTITLE 1: 事件一\nRANK 2: 71\nTITLE 2: 事件二", 2);
assert.equal(validAiRanking.rankingValid, true);
assert.deepEqual(validAiRanking.aiScores, [92, 71]);
const partialAiRanking = parseGeneratedDailyDigest("RANK 1: 90\nTITLE 1: 事件一\nTITLE 2: 事件二", 2);
assert.equal(partialAiRanking.rankingValid, false, "partial AI scores must fall back as one complete ranking");
assert.deepEqual(partialAiRanking.eventTitles, ["事件一", "事件二"], "valid AI titles may survive a ranking fallback");
assert.equal(parseGeneratedDailyDigest("RANK 1: 80\nRANK 2: 80", 2).rankingValid, false, "an undifferentiated AI score set must not replace local order");
assert.equal(parseGeneratedDailyDigest("RANK 1: 101\nRANK 2: 70", 2).rankingValid, false, "out-of-range AI scores must invalidate the complete ranking");
assert.equal(parseGeneratedDailyDigest("RANK 1: 90\nRANK 1: 70\nRANK 2: 60", 2).rankingValid, false, "duplicate AI score rows must invalidate the complete ranking");
assert.equal(dailyDigestEvidence("曼谷酒吧火灾致27人死亡", "曼谷酒吧火灾致27人死亡。"), "", "headline-only excerpts must not be presented to the brief as extra evidence");
assert.equal(dailyDigestEvidence("曼谷酒吧火灾致27人死亡", "曼谷酒吧火灾致27人死亡：警方正在调查起火原因，伤者已送医救治。"), "警方正在调查起火原因，伤者已送医救治。", "headline prefixes should be removed while preserving substantive feed detail");
assert.equal(cleanDailyDigestOverviewLine("整体态势：多地公共安全事件集中出现。"), "多地公共安全事件集中出现。", "daily brief strategy labels must not leak into visible prose");
assert.deepEqual(parseGeneratedDailyDigest("OVERVIEW: 影响判断：交通和公共服务承压。\nOVERVIEW: 后续关注：仍需等待调查结论。", 0).overview, ["交通和公共服务承压。", "仍需等待调查结论。"]);
const englishDigestPrompt = translate("en", "background.prompt.dailyDigest");
assert(englishDigestPrompt.includes("genuine editorial synthesis")
  && englishDigestPrompt.includes("Every overview line must add information beyond the headlines")
  && englishDigestPrompt.includes("Do not expose labels or prefixes"), "English daily briefs must request native editorial synthesis without visible strategy labels");
const localizedAiPrompts = [
  ["en", "English", "never mention, quote, summarize, explain, or otherwise reveal"],
  ["zh-CN", "简体中文", "不得提及、引用、概括、解释或以其他方式暴露"],
  ["zh-Hant", "繁體中文", "不得提及、引用、概括、解釋或以其他方式暴露"],
];
for (const [locale, languageName, silentRule] of localizedAiPrompts) {
  const prompt = translateAiPrompt(locale, "background.prompt.dashboardAnswer");
  assert(prompt.startsWith(translate(locale, "background.prompt.dashboardAnswer")), `${locale} AI prompts must retain their task instructions`);
  assert(prompt.includes(languageName), `${locale} AI prompts must explicitly require the selected UI language`);
  assert(prompt.includes(silentRule), `${locale} AI prompts must forbid exposing prompt constraints in visible prose`);
}
const localizedSummaryService = createRefreshService({
  settingsLocale: (settings) => settings.uiLocale,
  originPattern: (value) => value,
  cardSummaryPolicyVersion: 4,
});
const cachedEnglishSummary = {
  summaryStatus: "ai",
  summaryPolicyVersion: 4,
  summaryLocale: "en",
  summaryTitle: "English title",
  summary: ["English facts.", "English impact."],
  summaryProviderOrigin: "https://api.example.com",
};
assert.equal(localizedSummaryService.preserveCardAiSummary(
  { title: "原始标题" },
  cachedEnglishSummary,
  { uiLocale: "zh-CN", openaiBaseUrl: "https://api.example.com" },
).summaryStatus, undefined, "card summaries from another UI locale must not be preserved");
assert.equal(localizedSummaryService.preserveCardAiSummary(
  { title: "Original title" },
  cachedEnglishSummary,
  { uiLocale: "en", openaiBaseUrl: "https://api.example.com" },
).summaryTitle, "English title", "card summaries may be preserved when locale, policy, and provider still match");
const [sanitizedWrongLocaleSummary] = localizedSummaryService.sanitizeCardAiSummaries([
  { ...cachedEnglishSummary, excerpt: "本地 Feed 摘录。" },
], { uiLocale: "zh-CN", openaiBaseUrl: "https://api.example.com" }, true);
assert.equal(sanitizedWrongLocaleSummary.summaryStatus, "excerpt", "cached card summaries in another language must fall back to inert Feed text");
assert.equal(sanitizedWrongLocaleSummary.summaryLocale, undefined, "locale metadata from a rejected AI summary must be removed");
assert.deepEqual(mergeRankedUnique([
  [selectorItems[1], selectorItems[0]],
  [selectorItems[0]],
], { compare: selectorRanker.compareImportant, keyOf: (item) => item.key }).map((item) => item.key), ["a", "b"], "ranked pools must deduplicate without calling an unbound comparator");
assert.deepEqual(mergeRankedUnique([selectorItems], { compare: selectorRanker.compareImportant, keyOf: (item) => item.key, limit: 0 }), []);
assert.deepEqual([...groupItemsByKey([
  { section: "one", category: "x", key: "1" },
  { section: "one", category: "x", key: "2" },
  { section: "two", category: "y", key: "3" },
], (item) => `${item.section}/${item.category}`).entries()].map(([key, items]) => [key, items.length]), [["one/x", 2], ["two/y", 1]]);
assert.deepEqual(selectUnseenPool(
    Array.from({ length: 5 }, (_, index) => ({ key: `item-${index + 1}` })),
    new Set(["item-1", "item-2", "item-3"]),
    2,
  ).map((item) => item.key), [], "seen items must leave vacancies in the capped daily pool");
const settingsDraftBaseline = snapshotSettingsDraft({ uiLocale: "", dailyAiLimit: 50, accentTheme: "violet", excludedNewsSources: [] }, "zh-CN");
const settingsDraftClone = cloneSettingsDraft(settingsDraftBaseline);
settingsDraftClone.excludedNewsSources.push({ id: "local-only" });
assert.equal(settingsDraftBaseline.excludedNewsSources.length, 0, "settings cancellation snapshots must be restored from an independent clone");
const websiteShortcutSnapshot = snapshotSettingsDraft({
  websiteShortcutsEnabled: false,
  websiteShortcuts: shortcutDraft,
}, "zh-CN");
const websiteShortcutClone = cloneSettingsDraft(websiteShortcutSnapshot);
websiteShortcutClone.websiteShortcuts.push({ title: "B", url: "https://b.example/" });
assert.equal(websiteShortcutSnapshot.websiteShortcuts.length, 1, "shortcut cancellation snapshots must remain independent");
assert.deepEqual(diffSettingsDraft({
  websiteShortcutsEnabled: true,
  websiteShortcuts: websiteShortcutClone.websiteShortcuts,
}, websiteShortcutSnapshot), {
  websiteShortcutsEnabled: true,
  websiteShortcuts: websiteShortcutClone.websiteShortcuts,
}, "shortcut drafts must save only their changed switch and ordered list");
assert.deepEqual(diffSettingsDraft({
  uiLocale: "zh-CN",
  dailyAiLimit: "50",
  accentTheme: "rose",
  excludedNewsSources: [],
  openaiApiKey: "",
  braveSearchApiKey: "new-secret",
}, settingsDraftBaseline), {
  accentTheme: "rose",
  braveSearchApiKey: "new-secret",
}, "saving a stale tab must submit only fields explicitly changed from its baseline");
assert.deepEqual(diffSettingsDraft({
  openaiBaseUrl: "https://new-provider.example/v1",
  aiDisclosureAccepted: true,
}, {
  savedBaseUrl: "https://old-provider.example/v1",
  openaiBaseUrl: "https://old-provider.example/v1",
  aiDisclosureAccepted: true,
}), {
  openaiBaseUrl: "https://new-provider.example/v1",
  aiDisclosureAccepted: true,
}, "renewed consent must be submitted even when its boolean matches the old provider baseline");
assert.equal(aiProviderOrigin("https://api.example.com/v1"), "https://api.example.com");
assert.equal(aiProviderOrigin("https://api.example.com/v1?api-version=1"), "", "provider query strings must stay locked because saved provider URLs reject them");
assert.equal(aiProviderOriginPattern("http://localhost:8787/v1"), "http://localhost:8787/*");
assert.equal(aiProviderOrigin("http://api.example.com/v1"), "", "insecure remote AI origins must stay locked");
assert.equal(aiProviderOrigin("https://user:pass@api.example.com/v1"), "", "credentialed AI URLs must stay locked");
assert.deepEqual(deriveAiSetupControlState({
  providerUrl: "https://api.example.com/v1",
  consentAccepted: false,
  permissionGranted: true,
}), {
  stage: AI_SETUP_STAGE.NEEDS_CONSENT,
  origin: "https://api.example.com",
  originPattern: "https://api.example.com/*",
  formUnlocked: false,
  providerUrlDisabled: false,
  consentDisabled: false,
  grantDisabled: true,
  protectedFieldsDisabled: true,
}, "website permission alone must never unlock the AI form without consent");
assert.equal(deriveAiSetupControlState({
  providerUrl: "https://api.example.com/v1",
  consentAccepted: true,
  permissionGranted: false,
}).grantDisabled, false, "consent plus a valid origin must enable the exact-origin grant action");
assert.deepEqual(deriveAiSetupControlState({
  providerUrl: "https://api.example.com/v1",
  consentAccepted: true,
  permissionGranted: true,
}), {
  stage: AI_SETUP_STAGE.READY,
  origin: "https://api.example.com",
  originPattern: "https://api.example.com/*",
  formUnlocked: true,
  providerUrlDisabled: false,
  consentDisabled: false,
  grantDisabled: true,
  protectedFieldsDisabled: false,
}, "consent and current-origin access must unlock the AI form while leaving the completed grant action disabled");
assert.deepEqual(deriveAiSetupControlState({
  providerUrl: "https://api.example.com/v1",
  consentAccepted: true,
  permissionGranted: false,
  grantPending: true,
}), {
  stage: AI_SETUP_STAGE.NEEDS_PERMISSION,
  origin: "https://api.example.com",
  originPattern: "https://api.example.com/*",
  formUnlocked: false,
  providerUrlDisabled: true,
  consentDisabled: true,
  grantDisabled: true,
  protectedFieldsDisabled: true,
}, "an in-flight permission prompt must freeze the provider identity and keep protected fields locked");
assert.deepEqual(deriveAiSetupControlState({
  providerUrl: "https://api.example.com/v1",
  consentAccepted: true,
  permissionGranted: true,
  busy: true,
}), {
  stage: AI_SETUP_STAGE.READY,
  origin: "https://api.example.com",
  originPattern: "https://api.example.com/*",
  formUnlocked: true,
  providerUrlDisabled: true,
  consentDisabled: true,
  grantDisabled: true,
  protectedFieldsDisabled: true,
}, "busy state must temporarily lock a logically authorized AI form without losing its ready state");
let currentPreviewItem = { key: "bookmark-1", url: "https://a.example/", title: "A" };
let previewApiCalls = 0;
let resolvePreviewRequest;
const appliedPreviewImages = [];
const preloadedPreviewImages = [];
let previewApi = () => new Promise((resolve) => { resolvePreviewRequest = resolve; });
let previewImageLoader = async (imageUrl) => { preloadedPreviewImages.push(imageUrl); return true; };
const previewController = createInspirationPreviewController({
  apiGet: (...args) => { previewApiCalls += 1; return previewApi(...args); },
  normalizeUrl: (value) => String(value || ""),
  isHttpUrl: (value) => /^https?:\/\//.test(value),
  isEnabled: () => true,
  canFallback: () => true,
  preloadImage: (imageUrl) => previewImageLoader(imageUrl),
  isCurrent: (item, fingerprint) => inspirationPreviewFingerprint(currentPreviewItem, String) === fingerprint,
  onImage: (item, imageUrl) => appliedPreviewImages.push([item.key, imageUrl]),
});
const oldPreviewRequest = previewController.request(currentPreviewItem);
assert.equal(previewController.request(currentPreviewItem), oldPreviewRequest, "duplicate preview requests must share one in-flight promise");
await Promise.resolve();
assert.equal(previewApiCalls, 1);
currentPreviewItem = { key: "bookmark-1", url: "https://b.example/", title: "B" };
resolvePreviewRequest({ imageUrl: "https://images.example/a.jpg" });
await oldPreviewRequest;
assert.deepEqual(appliedPreviewImages, [], "a preview response must not update a bookmark whose URL changed in flight");
previewApi = async () => ({
  imageUrl: "https://images.example/b.jpg",
  imageUrls: ["https://images.example/b.jpg", "https://images.example/b-alternate.jpg"],
  source: "origin",
});
await previewController.request(currentPreviewItem);
assert.deepEqual(appliedPreviewImages, [["bookmark-1", "https://images.example/b.jpg"]]);
let fallbackRequestUrl = "";
previewApi = async (url) => {
  fallbackRequestUrl = url;
  return { imageUrl: "https://imgs.search.brave.com/b.jpg", source: "brave" };
};
await previewController.reject(currentPreviewItem, "https://images.example/b.jpg");
assert.equal(fallbackRequestUrl, "", "a failed original image must try the next original candidate before Brave");
assert.deepEqual(appliedPreviewImages.at(-1), ["bookmark-1", "https://images.example/b-alternate.jpg"]);
await previewController.reject(currentPreviewItem, "https://images.example/b-alternate.jpg");
assert(new URL(fallbackRequestUrl, "https://ampira.invalid").searchParams.get("mode") === "brave-only", "a failed original image must request Brave-only fallback");
assert.deepEqual(appliedPreviewImages.at(-1), ["bookmark-1", "https://imgs.search.brave.com/b.jpg"]);
const previewCallsAfterBrave = previewApiCalls;
await previewController.reject(currentPreviewItem, "https://imgs.search.brave.com/b.jpg");
assert.equal(previewApiCalls, previewCallsAfterBrave, "a failed Brave image must fall back to the favicon without looping");
previewController.invalidate();
assert.equal(previewController.get(currentPreviewItem), null);
currentPreviewItem = { key: "bookmark-2", url: "https://preload.example/", title: "Preload" };
previewApi = async () => ({ imageUrl: "https://images.example/preloaded.jpg", source: "origin" });
await previewController.preload([currentPreviewItem, currentPreviewItem], { timeoutMs: 50 });
assert.deepEqual(preloadedPreviewImages, ["https://images.example/preloaded.jpg"], "daily preload must deduplicate items and warm the resolved image URL before rendering");
assert.equal(previewController.get(currentPreviewItem)?.imageUrl, "https://images.example/preloaded.jpg");
previewController.invalidate();
currentPreviewItem = { key: "bookmark-3", url: "https://fallback-preload.example/", title: "Fallback preload" };
preloadedPreviewImages.length = 0;
previewApi = async (url) => {
  const mode = new URL(url, "https://ampira.invalid").searchParams.get("mode");
  return mode === "brave-only"
    ? { imageUrl: "https://imgs.search.brave.com/preloaded-fallback.jpg", source: "brave" }
    : {
        imageUrl: "https://images.example/preload-failure.jpg",
        imageUrls: ["https://images.example/preload-failure.jpg", "https://images.example/preload-alternate-failure.jpg"],
        source: "origin",
      };
};
previewImageLoader = async (imageUrl) => {
  preloadedPreviewImages.push(imageUrl);
  return imageUrl.includes("imgs.search.brave.com");
};
await previewController.preload([currentPreviewItem], { timeoutMs: 50 });
assert.deepEqual(preloadedPreviewImages, [
  "https://images.example/preload-failure.jpg",
  "https://images.example/preload-alternate-failure.jpg",
  "https://imgs.search.brave.com/preloaded-fallback.jpg",
], "failed original preload candidates must be exhausted before resolving and warming the Brave fallback");
assert.equal(previewController.get(currentPreviewItem)?.source, "brave");
previewController.invalidate();
currentPreviewItem = { key: "bookmark-4", url: "https://slow-preload.example/", title: "Slow preload" };
previewApi = async () => ({ imageUrl: "https://images.example/slow-preload.jpg", source: "origin" });
previewImageLoader = () => new Promise(() => {});
const preloadTimeoutStartedAt = Date.now();
await previewController.preload([currentPreviewItem], { timeoutMs: 5 });
assert(Date.now() - preloadTimeoutStartedAt < 500, "a slow image preload must respect the render timeout instead of blocking the dashboard");
previewController.invalidate();
const dailyPoolItems = Array.from({ length: 15 }, (_, index) => ({
  key: `daily-${index}`,
  url: `https://daily-${index}.example/`,
  title: `Daily ${index}`,
}));
const dailyPoolRequests = [];
const dailyPoolController = createInspirationPreviewController({
  apiGet: async (url) => {
    dailyPoolRequests.push(new URL(url, "https://ampira.invalid").searchParams.get("url"));
    return { imageUrl: `https://images.example/${dailyPoolRequests.length}.jpg`, source: "origin" };
  },
  normalizeUrl: String,
  isHttpUrl: (value) => /^https?:\/\//.test(value),
  isEnabled: () => true,
  isCurrent: () => true,
  preloadImage: async () => true,
  onImage() {},
});
await dailyPoolController.preload(dailyPoolItems, { timeoutMs: 100 });
assert.equal(dailyPoolRequests.length, 15, "the complete three-batch daily inspiration pool must be requested in one preload pass");
const referenceItems = [
  { key: "article-a", sourceKey: "source-shared", url: "https://example.com/a", summary: { title: "Article A" } },
  { key: "article-b", sourceKey: "source-shared", url: "https://example.com/b", summary: { title: "Article B" } },
];
assert.equal(findNewsItemByReference(referenceItems, { sourceKey: "source-shared", url: "https://example.com/b" })?.key, "article-b");
assert.equal(findNewsItemByReference(referenceItems, { sourceKey: "source-shared" }), null, "ambiguous source keys must not select an unrelated article");
assert.equal(readerErrorBodyKey("READER_HTTP_ERROR"), "reader.error.httpBody");
assert.equal(safeReaderOrigin("http://example.com/article"), "");
assert.equal(safeReaderOrigin("http://localhost:3000/article"), "http://localhost:3000");
assert.equal(sameOrigin("https://example.com/a", "https://example.com/b"), true);
assert.equal(normalizeAccentTheme("unknown"), "violet");
assert.equal(normalizeColorMode("unknown"), "dark");
assert.equal(normalizeColorMode("system"), "system", "system mode must remain explicitly selectable");
assert.equal(normalizeHexColor("9152ff"), "#9152FF");
assert.deepEqual(paletteFromAccent("#06B6D4"), { accent: "#06B6D4", accentRgb: [6, 182, 212] });

assert.equal(readerTextFromBlocks([{ type: "video", title: "" }]), "", "untitled video blocks must defer to localized UI copy");
const cachedReader = { schemaVersion: 2, url: "https://example.com/article", blocks: [{ type: "paragraph", text: "Cached article" }] };
const upstreamError = new Error("upstream failure");
upstreamError.code = "READER_HTTP_ERROR";
upstreamError.details = { status: 503 };
const staleReader = await loadReaderWithCache(cachedReader.url, {
  readCache: async () => cachedReader,
  fetchDocument: async () => { throw upstreamError; },
});
assert.equal(staleReader.staleCode, "READER_HTTP_ERROR");
assert.deepEqual(staleReader.staleDetails, { status: 503 });

const readerSource = await fs.readFile(path.join(root, "extension/core/reader.mjs"), "utf8");
for (const leakedCopy of ["视频内容", "网站返回 HTTP", "在线正文暂时不可用"]) {
  assert(!readerSource.includes(leakedCopy), `reader core must not hardcode localized UI copy: ${leakedCopy}`);
}
const appSource = (await Promise.all(
  (await listFilesRecursively(path.join(root, "assets", "client")))
    .filter((file) => file.endsWith(".mjs"))
    .map((file) => fs.readFile(file, "utf8")),
)).join("\n");
const serviceWorkerSource = (await Promise.all(
  (await listFilesRecursively(path.join(root, "extension", "runtime")))
    .filter((file) => file.endsWith(".mjs"))
    .map((file) => fs.readFile(file, "utf8")),
)).join("\n");
const aiCoreSource = await fs.readFile(path.join(root, "extension/core/ai.mjs"), "utf8");
const weatherCoreSource = await fs.readFile(path.join(root, "extension/core/weather.mjs"), "utf8");
const readerPolicySource = await fs.readFile(path.join(root, "assets/client/reader-policy.mjs"), "utf8");
const readerUiSource = await fs.readFile(path.join(root, "assets/client/reader-ui.mjs"), "utf8");
assert(readerUiSource.includes('className = "reader-header-actions"') && readerUiSource.includes('"ghost reader-translate"'), "the in-app reader must place translation with article-level actions");
assert(readerUiSource.includes('state.data?.ai?.enabled === true') && !dashboardSource.includes('id="translateWebFrame"'), "reader translation must stay absent until AI is fully configured");
assert(readerUiSource.includes('apiPost("/api/reader/translate"') && readerUiSource.includes('reader.showOriginal'), "reader translation must use the extension AI route and preserve an original-text toggle");
const aiSearchUiSource = await fs.readFile(path.join(root, "assets/client/ai-search-ui.mjs"), "utf8");
const settingsControllerSource = await fs.readFile(path.join(root, "assets/client/settings-controller.mjs"), "utf8");
const savedSourcePermissionControllerSource = await fs.readFile(path.join(root, "assets/client/saved-source-permission-controller.mjs"), "utf8");
const settingsTransferControllerSource = await fs.readFile(path.join(root, "assets/client/settings-transfer-controller.mjs"), "utf8");
const appearanceControllerSource = await fs.readFile(path.join(root, "assets/client/appearance-controller.mjs"), "utf8");
const coverBlurPreviewSource = await fs.readFile(path.join(root, "assets/client/cover-blur-preview-controller.mjs"), "utf8");
const contextMenuSource = await fs.readFile(path.join(root, "assets/client/context-menu-controller.mjs"), "utf8");
const efficiencyViewSource = await fs.readFile(path.join(root, "assets/client/efficiency-view.mjs"), "utf8");
const bookmarksViewSource = await fs.readFile(path.join(root, "assets/client/bookmarks-view.mjs"), "utf8");
const bookmarkSettingsControllerSource = await fs.readFile(path.join(root, "assets/client/bookmark-settings-controller.mjs"), "utf8");
const themeBootstrapSource = await fs.readFile(path.join(root, "assets/client/theme-bootstrap.mjs"), "utf8");
const overlaysCssSource = await fs.readFile(path.join(root, "assets/styles/overlays.css"), "utf8");
const settingsCssSource = await fs.readFile(path.join(root, "assets/styles/settings.css"), "utf8");
const motionCssSource = await fs.readFile(path.join(root, "assets/styles/motion-responsive.css"), "utf8");
const baseLayoutCssSource = await fs.readFile(path.join(root, "assets/styles/base-layout.css"), "utf8");
const primitivesCssSource = await fs.readFile(path.join(root, "assets/styles/primitives.css"), "utf8");
const dashboardSectionsCssSource = await fs.readFile(path.join(root, "assets/styles/dashboard-sections.css"), "utf8");
assert(dashboardSectionsCssSource.includes("grid-template-rows: 22px minmax(0, 1fr) auto;")
  && dashboardSectionsCssSource.includes("align-content: stretch;"), "fixed-height inspiration cards must reserve explicit rows so platform font metrics cannot clip their title and host");
assert(serviceWorkerSource.includes("digest?.schemaVersion !== digestSchemaVersion")
  && serviceWorkerSource.includes("digest?.rankingPolicyVersion !== rankingPolicyVersion")
  && serviceWorkerSource.includes("digest?.date !== localDateKey()")
  && serviceWorkerSource.includes("digest?.candidateFingerprint !== expectedFingerprint"), "daily digest cache reuse must require the current schema, policy, local date, and candidate fingerprint");
assert(serviceWorkerSource.includes('originPattern(digest.providerOrigin || "") === originPattern(settings.openaiBaseUrl)'), "AI digest cache reuse must remain bound to the configured Provider origin");
assert(readerPolicySource.includes('READER_HTTP_ERROR: "reader.error.httpTitle"'));
assert(readerUiSource.includes("markReadOnOpen(item);"), "opening a bookmark or news card must mark it as read");
assert(serviceWorkerSource.includes('record.value?.capability === "feed-image"')
  && serviceWorkerSource.includes('expectedOrigin === originPattern(record.value?.sourceOrigin || "")'), "Feed image caches must be removed when their exact source permission no longer matches");
assert(readerUiSource.includes("Array.isArray(block.imageUrls)") && readerUiSource.includes("imageIndex += 1"), "Reader images must exhaust safe original candidates before showing the source fallback");
assert(aiSearchUiSource.includes('classList.add("closing")') && aiSearchUiSource.includes("AI_SEARCH_CLOSE_MOTION_MS = 180"), "AI search must retain the overlay while its close motion completes");
assert(aiSearchUiSource.includes('classList.remove("open", "closing")') && aiSearchUiSource.includes("prefers-reduced-motion: reduce"), "AI search close cleanup must complete immediately for reduced motion");
assert(overlaysCssSource.includes(".search-overlay.open.closing") && motionCssSource.includes("@keyframes aiSearchPanelClose"), "AI search must define a visible closing state");
const aiSearchMotionSource = motionCssSource.slice(motionCssSource.indexOf("@keyframes aiSearchPanelOpen"), motionCssSource.indexOf("@keyframes aiSearchControlIn"));
assert(!aiSearchMotionSource.includes("clip-path") && aiSearchMotionSource.includes("scale(.985)"), "AI search must enter as one continuous surface without clipping its controls");
assert(readerUiSource.includes('classList.add("closing")') && readerUiSource.includes("READER_CLOSE_MOTION_MS = 180"), "the floating reader must retain its overlay while closing");
assert(readerUiSource.includes("finalizeFloatingWebClose();") && readerUiSource.includes("clearTimeout(readerCloseTimer)"), "the floating reader must clean up after close and cancel stale close timers on reopen");
assert(overlaysCssSource.includes(".web-frame-overlay.open.closing") && motionCssSource.includes("@keyframes webFrameDialogIn") && motionCssSource.includes("@keyframes webFrameDialogOut"), "the floating reader must animate both entrance and exit");
assert(settingsControllerSource.includes('classList.add("is-entering")') && settingsControllerSource.includes('event.animationName !== "settingsPanelIn"'), "settings panels must use a guarded entrance animation cleanup");
assert(settingsCssSource.includes(".settings-panel.active.is-entering") && motionCssSource.includes("@keyframes settingsPanelIn"), "settings tab changes must define a restrained incoming transition");
assert(settingsCssSource.includes(".source-health-list.settings-compact-list:not(:empty)")
  && settingsCssSource.includes("overflow-y: auto;")
  && settingsCssSource.includes("overscroll-behavior: contain;")
  && dashboardSource.includes('id="sourceCoverageList" tabindex="0" aria-labelledby="sourceCoverageTitle"'), "source coverage diagnostics must override compact-list clipping with a keyboard-accessible isolated vertical scroller");
assert(appSource.includes("const CARD_EXIT_MS = 110") && appSource.includes("const CARD_ENTER_MS = 240"), "card replacement must use a short exit and settle duration");
assert(appSource.includes("Math.min(index * 12, 84)"), "card replacement stagger must stay within the shortened motion budget");
const navLabelSource = baseLayoutCssSource.slice(baseLayoutCssSource.indexOf(".nav-label {"), baseLayoutCssSource.indexOf(".main {"));
assert(navLabelSource.includes("visibility: hidden") && navLabelSource.includes("visibility: visible") && navLabelSource.includes("opacity: 1"), "desktop navigation labels must fade and slide instead of popping between display states");
assert(contextMenuSource.includes('setProperty("--context-menu-origin-x"') && contextMenuSource.includes('setProperty("--context-menu-origin-y"'), "context menus must derive their entrance origin from the pointer");
assert(contextMenuSource.includes("interactiveTarget !== element"), "context menus must support rows whose root element is a button");
assert(contextMenuSource.includes("function attachActions") && contextMenuSource.includes("attachActions, hide"), "context menus must support action-only targets");
assert(contextMenuSource.includes("link?.canExplain || item?.feedItem?.articleId"), "context menus must allow explicitly explainable links");
assert(efficiencyViewSource.includes("attachLinkContextMenu(row") && efficiencyViewSource.includes("canExplain: true"), "reading queue rows must expose link context-menu actions");
assert(appSource.includes('contextAttachActions: (...args) => contextMenu.attachActions(...args)') && appSource.includes('selectSettingsTab("bookmarks")'), "section filters must expose bookmark settings from their context menu");
assert(bookmarksViewSource.includes('t("context.hideBookmarkCategory")')
  && bookmarksViewSource.includes("isBookmarkCategoryHidden(state.settings")
  && bookmarksViewSource.includes('"empty.hiddenCategories.title"'), "bookmark subcategories must support hiding, filtering, and a recoverable all-hidden state");
assert(bookmarkSettingsControllerSource.includes("renderHiddenBookmarkCategoryList")
  && bookmarkSettingsControllerSource.includes("restoreHiddenBookmarkCategory")
  && dashboardSource.includes('id="hiddenBookmarkCategoryList"'), "Bookmark settings must list and restore hidden categories");
assert(bookmarkSettingsControllerSource.includes('const optionNodes = [createFolderOption(PUBLIC_FEED_VALUE')
  && bookmarkSettingsControllerSource.includes('els.publicFeedSupplementEnabledInput.disabled = disabled')
  && bookmarkSettingsControllerSource.includes('?.setAttribute("aria-disabled", String(disabled))')
  && settingsCssSource.includes('.switch-field[aria-disabled="true"]'), "news settings must place Public Feed first and reuse the shared unavailable switch state in public-only mode");
const savedSourcePermissionGrant = savedSourcePermissionControllerSource.slice(
  savedSourcePermissionControllerSource.indexOf("async function grant"),
  savedSourcePermissionControllerSource.indexOf("function dismiss"),
);
assert(dashboardSource.includes('id="savedSourcePermissionPrompt"')
  && dashboardSource.includes('id="grantSavedSourcePermissions"')
  && settingsControllerSource.includes("savedSourcePermission.show(pendingOrigins, sourcePermissionScope)"), "saving a personal source with new origin gaps must reveal an in-context permission confirmation");
assert(savedSourcePermissionGrant.indexOf("requestSourcePermissions(origins)") >= 0
  && savedSourcePermissionGrant.indexOf("requestSourcePermissions(origins)") < savedSourcePermissionGrant.indexOf("await"), "the exact-origin permission request must begin synchronously from the confirmation click");
assert(appSource.includes("exactPermissionOrigins(origins)")
  && appSource.includes("chrome.permissions.request({ origins: requested })"), "saved-source permission confirmation must reject broad or insecure origins before invoking Chrome");
assert(savedSourcePermissionControllerSource.includes("await triggerRefresh(true)")
  && savedSourcePermissionControllerSource.includes('t("settings.status.sourcePermissionDeclined")'), "grant success must refresh automatically while refusal keeps a clear unavailable state");
assert(settingsCssSource.includes(".hidden-bookmark-category-list.settings-compact-list:not(:empty)")
  && settingsCssSource.includes("max-height: min(320px, 36vh)"), "long hidden-category lists must scroll inside the settings panel");
assert(dashboardSource.includes('id="libraryFeedback" role="status" aria-live="polite"')
  && appSource.includes('apiPost("/api/settings", { hiddenBookmarkCategories })'), "immediate visibility saves must report accessible success or failure feedback");
assert(contextMenuSource.includes("getLeadingActions") && contextMenuSource.includes("actions.push("), "link context menus must accept shortcut-specific leading actions without replacing standard link actions");
assert(overlaysCssSource.includes("animation: contextMenuIn 110ms") && motionCssSource.includes("@keyframes contextMenuIn"), "context menus must use a lightweight entrance animation");
assert(motionCssSource.includes("@media (prefers-reduced-motion: reduce)") && motionCssSource.includes("animation-duration: .01ms !important"), "new motion must remain covered by the global reduced-motion override");
assert(themeBootstrapSource.includes('shortcutLayoutStorageKey = "ampira.websiteShortcutsLayout"')
  && themeBootstrapSource.includes("chrome.storage.sync.get(settingsStorageKey)")
  && themeBootstrapSource.includes("const maxWebsiteShortcuts = 16"), "the first frame must restore and cap the non-sensitive shortcut layout hint at the current allowance");
assert(themeBootstrapSource.includes("websiteShortcutsReady") && appSource.includes("await globalThis.ampiraLayoutBootstrap?.websiteShortcutsReady"), "dashboard loading placeholders must wait for the shortcut layout hint before mounting");
assert(appSource.includes("function renderWebsiteShortcutLoadingState()") && appSource.includes("dataset.websiteShortcutCount"), "shortcut loading placeholders must preserve the saved shortcut row count");
assert(appSource.includes("cacheWebsiteShortcutLayout(settings)") && appSource.includes('delete els.websiteShortcuts.dataset.loading'), "resolved settings must cache the next first-frame layout and clear the shortcut loading state");
assert(dashboardSectionsCssSource.includes(".website-shortcut-skeleton") && dashboardSectionsCssSource.includes(".website-shortcuts-empty-skeleton") && motionCssSource.includes(".website-shortcuts-empty-skeleton"), "shortcut loading placeholders must reuse the final rail geometry for populated, empty, and narrow states");
assert(dashboardSectionsCssSource.includes(".website-shortcuts.is-empty .website-shortcut-list")
  && dashboardSectionsCssSource.includes("justify-content: flex-start;")
  && dashboardSectionsCssSource.includes("white-space: nowrap;")
  && appSource.includes('classList.toggle("is-empty", count === 0)')
  && motionCssSource.includes("flex-direction: row;"), "the empty shortcut prompt must span the rail and remain a compact single row across breakpoints");
assert(dashboardSectionsCssSource.includes("padding: 7px 6px 7px 10px;"), "website shortcut cards must retain a comfortable left content inset");
assert.equal(MAX_WEBSITE_SHORTCUTS, 16, "website shortcuts must allow the approved wide-screen capacity");
assert(dashboardSectionsCssSource.includes("grid-auto-columns: minmax(88px, 104px)")
  && dashboardSectionsCssSource.includes("overflow-x: auto")
  && dashboardSectionsCssSource.includes("scrollbar-width: none"), "website shortcuts must stay on one horizontally scrollable row without increasing dashboard height");
assert(dashboardSectionsCssSource.includes(".website-shortcuts.has-scroll-overflow:not(.is-scroll-end)::after")
  && appSource.includes("createWebsiteShortcutOverflow")
  && appSource.includes("autoScrollDragContainer")
  && appSource.includes('ArrowRight: list.scrollLeft + distance')
  && appSource.includes('End: list.scrollWidth - list.clientWidth'), "overflowing shortcut rails must expose an edge cue and support drag and keyboard scrolling");
assert(settingsCssSource.includes(".website-shortcut-settings-list.settings-compact-list:not(:empty)")
  && settingsCssSource.includes("max-height: min(420px, 42vh)"), "the expanded settings list must scroll internally instead of stretching the modal");
assert(dashboardSource.includes('id="websiteShortcutList" tabindex="0"')
  && dashboardSource.includes('data-i18n-aria-label="shortcuts.scrollLabel"'), "the horizontal shortcut rail must remain keyboard-focusable and explicitly labeled");
assert(appSource.includes('bindShortcutDragEvents(els.websiteShortcutList, "dashboard"')
  && appSource.includes('bindShortcutDragEvents(els.websiteShortcutSettingsList, "settings"')
  && appSource.includes('apiPost("/api/settings", { websiteShortcuts })'), "dashboard and settings shortcut lists must share drag sorting while only dashboard drops persist immediately");
assert(appSource.includes('label: t("shortcuts.edit")')
  && appSource.includes("openWebsiteShortcutEditor(shortcut.url)")
  && contextMenuSource.includes("getLeadingActions"), "shortcut context menus must open the matching URL in settings before the standard open and copy actions");
assert(dashboardSource.includes('id="websiteShortcutFeedback" role="status" aria-live="polite"')
  && dashboardSectionsCssSource.includes(".website-shortcut.is-drop-before::after")
  && settingsCssSource.includes(".website-shortcut-settings-row.is-drop-before::after"), "shortcut drag state and immediate-save failures must remain visible and accessible in both list layouts");
assert(primitivesCssSource.includes(".empty-state.is-compact .empty-state-copy") && primitivesCssSource.includes(".empty-state.is-compact .empty-state-body") && primitivesCssSource.includes("max-width: none;"), "every compact empty state must use its available surface width instead of orphaning Chinese characters");
assert(dashboardSectionsCssSource.includes("overflow-wrap: anywhere;") && motionCssSource.includes(".digest-card .ai-digest-overview") && motionCssSource.includes("overflow-y: auto;"), "daily brief text must wrap long tokens and remain contained inside fixed-height desktop cards");
assert(appSource.includes('t("settings.bookmarks.folderOption"'));
assert(appSource.includes('isEnabled: () => state.settings?.bookmarkConsentGranted === true'), "original previews must not depend on Brave configuration");
assert(appSource.includes('detail?.payload?.permissionsChanged || detail?.payload?.bookmarkSourceChanged || detail?.payload?.imageSearchChanged'), "permission, bookmark-source, and Brave configuration changes must invalidate previews in every open tab");
assert(settingsControllerSource.includes("if (bookmarkSourceChanged || imageSearchChanged)"), "saving a different inspiration source must invalidate the current tab preview cache before reloading the dashboard");
assert(settingsTransferControllerSource.includes("if (bookmarkSourceChanged || savedSettings.imageSearchChanged === true)"), "importing a different inspiration source must invalidate the current tab preview cache before reloading the dashboard");
assert(settingsControllerSource.includes("!automaticAiStarted && !sourceRefreshScheduled")
  && settingsTransferControllerSource.includes("!automaticAiStarted && !sourceRefreshScheduled"), "clients must not duplicate a primary-source refresh already scheduled by the settings workflow");
assert(appSource.includes('renderAll();\n  preloadDailyInspiration(UPDATE_INSPIRATION_PRELOAD_TIMEOUT_MS);'), "the initial dashboard must render before inspiration previews preload");
assert(appSource.includes('els.headerImage.addEventListener("error", handleHeaderImageError);\n  syncHeaderImageLoadState();'), "the header cover must reconcile an image that completed before its runtime listeners were bound");
assert(appSource.includes('if (els.headerImage.complete && els.headerImage.naturalWidth > 0)'), "a cached header cover must become visible without waiting for another load event");
assert(dashboardSource.includes('id="headerImageBlurEnabledInput"')
  && dashboardSource.includes('id="headerImageBlurAmountInput" type="range" min="0" max="24" step="1"')
  && dashboardSource.includes('id="headerImageBlurField" aria-disabled="true" aria-hidden="true"')
  && dashboardSource.includes('class="cover-blur-meter"')
  && !dashboardSource.includes('class="cover-blur-scale"')
  && !settingsCssSource.includes(".cover-blur-scale"), "appearance settings must expose an uncluttered bounded instrument slider without tick labels");
assert(appearanceControllerSource.includes("headerImageBlurAmount: syncBlurAmountLabel()")
  && appearanceControllerSource.includes('setProperty("--header-cover-blur"')
  && appSource.includes('els.headerImageBlurAmountInput.addEventListener("input", () => updateAppearancePreview())'), "cover blur changes must persist and preview live");
assert(appSource.includes("createCoverBlurPreviewController")
  && dashboardSource.includes('class="settings-section header-image-settings"')
  && coverBlurPreviewSource.includes('classList.add("is-cover-previewing")')
  && coverBlurPreviewSource.includes('addEventListener("lostpointercapture"')
  && coverBlurPreviewSource.includes("KEYBOARD_PREVIEW_IDLE_MS = 600")
  && settingsCssSource.includes("#settingsModal.is-cover-previewing .cover-blur-range")
  && settingsCssSource.includes(".header-image-settings > :not(.settings-row-list)")
  && settingsCssSource.includes("width: min(560px, calc(100% - 24px));")
  && settingsCssSource.includes("grid-template-columns: max-content minmax(0, 1fr) max-content;")
  && settingsCssSource.includes("pointer-events: auto;"), "cover blur adjustment must reveal the dashboard temporarily without losing pointer or keyboard control");
assert(appearanceControllerSource.includes('setAttribute("aria-hidden", String(!enabled))')
  && settingsCssSource.includes('.cover-blur-range[aria-hidden="false"]')
  && settingsCssSource.includes("height 220ms cubic-bezier(.22, 1, .36, 1)")
  && settingsCssSource.includes("height: 46px;")
  && settingsCssSource.includes('.cover-blur-range input[type="range"] {\n  width: 100%;\n  height: 18px;\n  display: block;')
  && settingsCssSource.includes("visibility 0s linear 220ms"), "the blur slider must expand only while enabled and collapse without leaving an interactive hidden control");
assert(themeBootstrapSource.includes("applyHeaderCoverBlur(cover?.enabled === true && cover?.blurEnabled === true")
  && dashboardSectionsCssSource.includes("filter: blur(var(--header-cover-blur, 0px))")
  && dashboardSectionsCssSource.includes("--header-cover-size-adjustment"), "cover blur must restore on the first frame and overscan the image to protect its edges");
assert(appSource.includes('if (board.dataset.loading === "true")'), "loading placeholders must be replaced through the dedicated initial render path");
assert(appSource.includes("animateCardsIn(dailyBoardCards(board));"), "initial daily cards must animate after replacing their loading placeholders");
assert(appSource.includes('els.efficiencyPanel.dataset.loading = "true"'), "efficiency cards must retain the initial-loading entrance boundary");
assert(appSource.includes("animatePanelEntrance(renderedCards);"), "efficiency cards must animate when initial loading completes");
assert(appSource.includes("function syncEfficiencyCards(panel, nextCards)"), "unchanged efficiency cards must retain their animated DOM roots during the first refresh");
assert(appSource.includes("animatePanelEntrance(nodes, { delay: 60 });"), "daily columns must join the staggered dashboard entrance");
assert(appSource.includes("currentHead && nextHead && !currentHead.isEqualNode(nextHead)"), "unchanged daily column headers must keep their entrance animation targets");
assert(appSource.includes('dailyInspirationCount * dailyInspirationBatchLimit'), "daily preload must include all configured cards across reshuffle batches");
assert(appSource.includes('img.loading = "eager"'), "preloaded daily inspiration images must not be deferred again by lazy loading");
assert(appSource.includes("newsPreviews.request(item)")
  && appSource.includes("newsPreviews.reject(item, imageUrl)")
  && appSource.includes("updateVisibleNewsThumbs")
  && appSource.includes("applyResolvedSummaryPreview(thumb, item, fallbackUrl, newsPreviews.request(item))"), "news cards must enter the shared image fallback and retain it across refresh races");
assert(serviceWorkerSource.includes("...newsPreviewTargets(visibleFeedItems)")
  && serviceWorkerSource.includes("isAllowedTarget: isSitePreviewTarget"), "preview requests must admit current news URLs without becoming a general fetch endpoint");
assert(serviceWorkerSource.includes("...newsPreviewTargets(items)"), "permission cleanup must retain only preview caches for currently permitted news cards");
assert(serviceWorkerSource.includes('urls.push(...inspirationPreviewSourceUrls(model.bookmarks))'), "inspiration origins must appear in the exact-origin permission list");
assert(serviceWorkerSource.includes("await pruneStalePreviewCaches(settings)"), "bookmark changes must prune preview caches for removed inspiration targets");
assert(serviceWorkerSource.includes("if (bookmarkSourceChanged) await pruneStalePreviewCaches(normalized)"), "changing the selected inspiration folder must prune stale preview caches");
assert(serviceWorkerSource.includes("if (imageSearchChanged) await pruneBravePreviewCaches()"), "Brave setting or key changes must prune Brave preview caches");
assert(appSource.includes('removeAttribute("data-i18n")'), "dynamic AI gate copy must not be overwritten by a later whole-document translation pass");
assert(appSource.includes('visibilitychange'), "the AI permission gate must refresh after the page becomes visible again");
assert(appSource.includes('settings.service.aiFormDeclined'), "AI permission denial must be reported in the adjacent live setup status");
assert(!serviceWorkerSource.includes("fallbackFeedFromBookmarks"), "missing or empty feed caches must remain empty");
assert(!serviceWorkerSource.includes("bookmark-article-"), "empty feeds must not synthesize news cards from bookmark names");
assert(appSource.includes('articleId: item.feedItem?.articleId || item.key'), "manual summaries must identify the clicked article, not only its feed source");
const manualSummaryHandlerSource = appSource.slice(appSource.indexOf("async function refreshSummaryItem"), appSource.indexOf("function updateSummaryCard"));
assert(!manualSummaryHandlerSource.includes("requestWebsitePermission"), "manual summaries must not require or request article-origin permission");
assert(appSource.includes(".filter(isDisplayableFeedItem)"), "the dashboard must hide unreadable undated items already present in an older cache");
assert(appSource.includes("syncSummaryCard(current, createSummaryCard(item))"), "organizing one card must update it in place instead of replacing the whole card");
assert(appSource.includes("syncSummaryCard(currentCard, node)"), "cache updates must preserve existing summary card roots when their content changes");
const summaryGridDiffSource = appSource.slice(appSource.indexOf("function applySummaryGridDiff"), appSource.indexOf("function directSummaryCards"));
assert(summaryGridDiffSource.includes("if (grid.children[index] !== node) grid.insertBefore(node, grid.children[index] || null)"), "summary cache updates must leave unchanged cards attached to the document");
assert(!summaryGridDiffSource.includes("grid.replaceChildren"), "summary cache updates must not detach and reattach the complete card grid");
assert(appSource.includes("card.ampiraItem = item"), "preserved card roots must resolve interactions against their latest item data");
assert(appSource.includes("state.data?.ai?.enabled === true"), "manual summary actions must stay hidden until AI consent, credentials, and provider permission are configured");
assert(appSource.includes('options.t("context.explainArticle")') && appSource.includes("action: () => options.explain(url)"), "configured AI must expose article explanation through the context-menu controller");
assert(appSource.includes('feedItem.summaryStatus === "ai"'), "AI summary status must survive feed-to-card mapping");
assert(appSource.includes('feedItem.summaryStatus === "ai" && feedItem.summaryTitle ? feedItem.summaryTitle : feedItem.title'), "organized cards must prefer the separately cached AI title and retain the Feed title as fallback");
assert.deepEqual(cleanPresentedSummaryLines(["### 核心内容", "**核心内容**：有效摘要。"]), ["有效摘要。"], "cached card summaries must strip Markdown and structural AI headings before rendering");
assert.equal(cleanPresentedSummaryTitle("### 核心内容"), "", "structural AI headings must never render as card titles");
assert.equal([...cleanPresentedSummaryTitle("标题".repeat(80))].length, 64, "card titles must retain their explicit character cap");
assert.equal(isCorrectlySummarized({ summary: { summaryStatus: "ai", summaryTitle: "旧摘要", summary: ["第一段。", "第二段。"] } }), false, "legacy short card summaries must be eligible for reorganization");
assert.equal(isCorrectlySummarized({ summary: { summaryStatus: "ai", summaryPolicyVersion: 4, summaryTitle: "新版摘要", summary: ["第一段。", "第二段。", "第三段。"] } }), true, "current compact card summaries must not be reorganized again");
assert(serviceWorkerSource.includes('const summaryText = await callProvider('), "manual card organization must invoke the configured AI provider");
assert(serviceWorkerSource.includes(".map(cleanGeneratedSummaryLine)"), "new AI card summaries must discard Markdown and structural headings before caching");
assert(serviceWorkerSource.includes('summaryStatus: "ai"'), "manual card organization must persist AI summary status in the feed cache");
assert(serviceWorkerSource.includes("summaryTitle: organized.title"), "automatic and manual card organization must persist the generated AI title separately");
assert(serviceWorkerSource.includes('translateAiPrompt(locale, "background.prompt.cardSummary")'), "card organization must request a localized structured AI title and summary");
for (const locale of ["zh-CN", "zh-Hant", "en"]) {
  const prompt = translateAiPrompt(locale, "background.prompt.cardSummary");
  assert(prompt.includes("130–180") && prompt.includes("110") && prompt.includes("120"), `${locale} card summaries must share the compact generation and front-loaded detail policy`);
}
assert(serviceWorkerSource.includes("summaryLocale: locale"), "generated card summaries must record the UI locale used for their visible prose");
assert(serviceWorkerSource.includes("isCurrentCardSummary(item, locale)"), "card summary reuse must require the current UI locale");
assert(serviceWorkerSource.includes("parseGeneratedDailyDigest(result.value, digest.items.length)"), "daily digest generation must extract AI-organized event titles without a second provider call");
assert(serviceWorkerSource.includes("originalTitle: item.title, title: aiTitle, aiTitle"), "daily events must display the AI title while retaining the Feed title as fallback data");
assert(serviceWorkerSource.includes('const excerptText = String(target.excerpt || "").trim().slice(0, CARD_SUMMARY_EXCERPT_MAX_CHARS)'), "manual summaries must use only the bounded feed excerpt");
assert(serviceWorkerSource.includes("AI_CONNECTION_TEST_MAX_TOKENS = 900"), "AI connection tests must match the proven search budget so reasoning models can emit visible text");
assert(serviceWorkerSource.includes("AI_DIGEST_MAX_TOKENS = 2400"), "automatic daily briefs must leave enough output budget for ranking and visible text");
assert(serviceWorkerSource.includes("{ preferVisibleOutput: true }") && aiCoreSource.includes("isOfficialDeepSeekEndpoint(endpoint)"), "automatic DeepSeek briefs must disable thinking without changing manual AI calls");
assert(serviceWorkerSource.includes("AI_ARTICLE_SUMMARY_MAX_TOKENS = 1200"), "article organization must leave enough output budget after processing long source text");
assert(serviceWorkerSource.includes("CARD_SUMMARY_MAX_CHARS = 200") && serviceWorkerSource.includes("limitGeneratedSummaryLines(summaryLines, CARD_SUMMARY_MAX_CHARS, 3)"), "organized card summaries must enforce the compact 200-character cache boundary");
assert(appSource.includes("SUMMARY_DETAIL_MAX_LENGTH = 200"), "summary cards must enforce the compact detail budget");
const summarySectionCssSource = (await fs.readFile(path.join(root, "assets/styles/dashboard-sections.css"), "utf8")).replace(/\r\n/g, "\n");
assert(summarySectionCssSource.includes(".summary-line {\n  display: -webkit-box;\n  overflow: hidden;\n  -webkit-box-orient: vertical;\n  -webkit-line-clamp: 6;"), "favicon summary cards must retain their six-line detail allowance");
assert(summarySectionCssSource.includes(".summary-card:not(.has-favicon-thumb) .summary-line {\n  -webkit-line-clamp: 5;\n}"), "image summary cards must expose five lines without changing card geometry");
assert(serviceWorkerSource.includes("const remainingQuota = Math.max(0, settings.dailyAiLimit - quota.used)"), "automatic card summaries must use the remaining shared daily quota");
assert(serviceWorkerSource.includes("Math.min(availableCards, Math.max(0, remainingQuota - Number(digestEligible)))"), "automatic card summaries must process every eligible card that fits in the remaining daily quota");
assert(serviceWorkerSource.includes("const automatic = await automaticallySummarizeCards(settings, items, cacheEpoch, generation,"), "the refresh pipeline must run automatic card summaries after committing fresh feed items");
assert(serviceWorkerSource.includes("result = await runAiWithinQuota(settings"), "automatic card summaries must reserve the shared daily AI quota");
assert(serviceWorkerSource.includes("preserveCardAiSummary(item"), "fresh feed reads must preserve compatible AI card summaries");
assert(serviceWorkerSource.includes("sanitizeCardAiSummaries(feed.items, settings, configuredForAi)"), "card AI summaries must be hidden after provider consent, key, or permission becomes invalid");
assert(serviceWorkerSource.includes("await refreshDailyDigest({ automatic: true })"), "a missing daily AI brief must be generated automatically after feed refresh");
assert(serviceWorkerSource.includes("? await runAiWithinQuota(settings, operation)"), "only automatic daily briefs may consume the automatic AI quota");
assert(serviceWorkerSource.includes("AI_SEARCH_MAX_TOKENS = 1400"), "AI search must leave enough output budget for substantial article briefs");
assert(serviceWorkerSource.includes("const value = await callProvider(settings, options.system, options.input, AI_SEARCH_MAX_TOKENS"), "manual AI search must not consume the automatic organization quota");
assert(serviceWorkerSource.includes("AI_SEARCH_CACHE_VERSION = 4"), "AI search language prompt changes must invalidate stale cached answers");
assert(serviceWorkerSource.includes("const context = await automaticCardSummaryContext(candidate)"), "automatic summaries must build a bounded excerpt-only context");
const automaticSummaryContextSource = serviceWorkerSource.slice(serviceWorkerSource.indexOf("function automaticCardSummaryContext"), serviceWorkerSource.indexOf("function preserveCardAiSummary"));
assert(!automaticSummaryContextSource.includes("readArticle") && !automaticSummaryContextSource.includes("hasOriginPermission"), "automatic card summaries must never fetch article bodies");
const manualSummarySource = serviceWorkerSource.slice(serviceWorkerSource.indexOf("async function refreshSingleSummary"), serviceWorkerSource.indexOf("function generatedCardSummary"));
assert(!manualSummarySource.includes("readArticle") && !manualSummarySource.includes("readerTextFromBlocks"), "manual card summaries must never fetch article bodies");
assert(searchQueryTerms("人工智能发布").includes("人工"), "dashboard AI search must segment CJK queries before selecting context");
assert(!serviceWorkerSource.includes("result = candidates.length\n      ? await answerWithOptionalAi"), "dashboard questions without a local keyword match must still invoke the configured AI provider");
assert(serviceWorkerSource.includes("content: candidates.length"), "dashboard AI search must explicitly tell the provider when no matching local context exists");
assert(appSource.includes('summary.className = "ai-digest-summary"'), "the daily brief must render provider-generated overview text instead of hiding it behind local lanes");
assert(appSource.includes('summary.type = "button"') && appSource.includes('summary.addEventListener("click", refreshDailyDigest)'), "organized daily brief text must be the refresh trigger");
assert(!appSource.includes('retry.className = "ai-digest-refresh-mini"'), "the organized daily brief must not keep a separate refresh button visible");
assert(appSource.includes("function dailyDigestParagraphs(lines)"), "single-line daily briefs must be split into balanced text paragraphs when punctuation allows");
assert(appSource.includes("digest.errorKey") && appSource.includes("messageKey: digest.errorKey"), "failed daily brief cards must show the localized provider reason");
assert(appSource.includes("state.data?.ai?.enabled !== true")
  && appSource.includes('actionLabel: t("action.configureAi")')
  && appSource.includes("onAction: openAiSettings"), "an unavailable AI service must replace the ineffective daily brief action with a direct setup entry");
assert(appSource.includes("async function openAiSettings()")
  && appSource.includes('settingsController.selectSettingsTab("service")')
  && appSource.includes("settingsController.focusSettingsStart({ reveal: true })"), "the daily brief setup entry must reveal the AI panel and focus its first unmet requirement");
assert(appSource.includes('allTranslations("action.configureAi")'), "the localized AI setup action must retain the settings icon");
assert(dashboardSource.includes('id="settingsAutoAiStatus"') && dashboardSource.includes('id="settingsAutoAiDetail"'), "AI settings must expose automatic organization phase and progress");
assert(dashboardSource.includes('id="settingsQuotaDetail"') && dashboardSource.includes('id="settingsCacheOverviewDetail"'), "AI settings must expose quota meaning and cache timing details");
assert(dashboardSource.includes('id="settingsCacheLoadingIcon" data-icon="synchronize" alt="" aria-hidden="true" hidden'), "the cache loading icon must be local, decorative, and hidden while idle");
assert(dashboardSource.indexOf('id="settingsRefresh"') < dashboardSource.indexOf('id="settingsOverviewAction"'), "AI settings must place the shared cache retry action before provider configuration");
assert(appSource.includes('els.settingsRefresh.addEventListener("click", () => triggerRefresh(true))'), "the settings cache action must use the same forced refresh path as the dashboard action");
assert(appSource.includes("renderRefreshButton(els.refresh, isRunning)") && appSource.includes("renderRefreshButton(els.settingsRefresh, isRunning)"), "both cache actions must share loading and disabled state");
assert(serviceWorkerSource.includes('getRecord("ai-auto-status", null)'), "automatic AI status must persist across service-worker suspension");
assert(serviceWorkerSource.includes('"running-digest"') && serviceWorkerSource.includes('phase: "no-candidates"'), "automatic AI status must distinguish active work from an empty candidate queue");
assert(appSource.includes("function renderAutoAiStatus(ai)"), "the AI settings overview must render persisted automatic organization status");
assert(appSource.includes('localizedErrorMessage({ messageKey: auto.errorKey, messageParams: auto.errorParams || {} })'), "automatic organization errors must render their localized persisted reason");
assert(serviceWorkerSource.includes('errorParams: error?.messageParams || {}'), "automatic organization status must retain safe error translation parameters such as HTTP status");
assert(appSource.includes('digest: "settings.auto.stageDigest"') && serviceWorkerSource.includes('errorStage = "digest"'), "automatic organization errors must identify the failed stage");
assert(serviceWorkerSource.includes('if (phase !== "quota" && cardEligible') && !serviceWorkerSource.includes('if (!errorKey && phase !== "quota" && cardEligible'), "daily brief failures must not block automatic card organization");
assert(appSource.includes("function renderQuotaOverview(ai = {})") && appSource.includes('t("settings.overview.quotaDetail", { used, remaining })'), "the runtime overview must explain used and remaining automatic quota");
assert(appSource.includes("function renderCacheOverview(status = {})") && appSource.includes("status.finishedAt") && appSource.includes("status.progress"), "the runtime overview must show cache progress and the last completed refresh");
assert(appSource.includes('classList.toggle("is-loading", isLoading)') && appSource.includes("els.settingsCacheLoadingIcon.hidden = !isLoading"), "the cache spinner must only appear while background caching is active");
assert(appSource.includes('removeAttribute("data-i18n")'), "dynamic automatic AI status must survive whole-document translation passes");
assert(appSource.includes('"missing-key": "settings.auto.missingKey"'), "automatic AI status must explain when a tested API key has not been saved");
assert(appSource.includes("settings.test.successSaveHint"), "a successful draft connection test must tell the user to save settings before automation can run");
assert(serviceWorkerSource.includes("automaticAiStarted = true") && serviceWorkerSource.includes("startRefresh(true).catch"), "saving a ready AI configuration must start an automatic refresh immediately");
assert(serviceWorkerSource.includes("const aiAutoReady = aiOriginAdded"), "granting the saved provider origin must start automatic work when the remaining configuration is ready");
assert(!serviceWorkerSource.includes("prioritizeAutomaticAi") && !serviceWorkerSource.includes("runAutomaticAiFromCache"), "a user-forced refresh must fetch and commit the background cache before automatic AI organization runs");
assert(serviceWorkerSource.includes("await runAutomaticAiAfterFailedRefresh(generation)")
  && serviceWorkerSource.includes('broadcast("dashboard.updated", { reason: "refresh-failed-ai-fallback" })')
  && serviceWorkerSource.includes("const items = filterFeedItemsBySources(feed.items, feedPermissions.permitted, feedPermissions.grantedOrigins)"), "a failed source refresh must retry automatic AI from the still-permitted background cache");
assert(!appSource.includes("createDigestLanes"), "the daily brief must not restore the important, follow, and skip card lanes");
assert(appSource.includes("createUtilityCardView") && appSource.includes("utilityCardView.render(dailyEvents)"), "the first efficiency card must retain one stable root while its utility mode changes");
assert(appSource.includes('UTILITY_MODES = Object.freeze(["events", "weather", "todo"])')
  && appSource.includes('UTILITY_MODE_KEY = "dash.utility.mode"')
  && appSource.includes('TODO_ITEMS_KEY = "dash.utility.todos.v1"'), "utility mode and to-do data must use bounded extension-local client-state keys");
assert(appSource.includes('WEATHER_LOCATION_KEY = "dash.utility.weather.location.v1"')
  && appSource.includes('WEATHER_OPTED_IN_KEY = "dash.utility.weather.optedIn"')
  && appSource.includes('WEATHER_ORIGINS.map((origin) => `${origin}/*`)'), "weather opt-in must request only the two fixed provider patterns from a user action");
assert(serviceWorkerSource.includes('"weather:search"') && serviceWorkerSource.includes('"weather:get"')
  && serviceWorkerSource.includes("normalizeWeatherForecastResponse")
  && serviceWorkerSource.includes("WEATHER_CACHE_STALE_MS"), "weather search and forecast must be normalized and cache-bounded by the background runtime");
assert(weatherCoreSource.includes('"https://geocoding-api.open-meteo.com"')
  && weatherCoreSource.includes('"https://api.open-meteo.com"')
  && !weatherCoreSource.includes("http://"), "weather traffic must stay pinned to the two HTTPS Open-Meteo origins");
assert(dashboardSectionsCssSource.includes(".efficiency-card.utility-card")
  && dashboardSectionsCssSource.includes("height: 168px;")
  && dashboardSectionsCssSource.includes("overflow-y: auto;"), "utility modes must remain inside the existing fixed card boundary with internal scrolling");
assert(dashboardSectionsCssSource.includes(".efficiency-card:has(:focus-visible)::before")
  && !dashboardSectionsCssSource.includes(".efficiency-card:focus-within::before"), "pointer clicks inside the utility card must not leave its glow active after the pointer exits");
assert(appSource.includes("let composerOpen = false;")
  && appSource.includes('addButton.setAttribute("aria-expanded", String(composerOpen))')
  && appSource.includes('if (event.key !== "Escape") return;')
  && appSource.includes('getContentRoot().querySelector(".todo-entry-form input")?.focus')
  && appSource.includes('addButton.disabled ? getFocusFallback() : addButton'), "the to-do composer must stay collapsed by default, support focused disclosure and Escape, and restore keyboard focus after closing");
assert(appSource.includes("tools.append(meta, locationButton, todoView.addButton, switchButton)")
  && dashboardSectionsCssSource.includes(".utility-switch {")
  && dashboardSectionsCssSource.includes("flex: 0 0 auto;"), "the utility switch must remain the fixed right-edge action while mode-specific tools change to its left");
assert(appSource.includes("MODE_SWITCH_OUT_MS = 80")
  && appSource.includes("MODE_SWITCH_IN_MS = 140")
  && motionCssSource.includes("@keyframes utilityModeOut")
  && motionCssSource.includes("translateX(-8px)")
  && motionCssSource.includes("translateX(10px)")
  && appSource.includes("prefersReducedMotion()"), "utility modes must use a bounded directional transition with a reduced-motion fallback");
assert(appSource.includes('toggle.setAttribute("role", "checkbox")')
  && appSource.includes('toggle.setAttribute("aria-checked", String(item.completed))'), "to-do completion controls must expose checkbox semantics and state");
assert(dashboardSectionsCssSource.includes(".todo-content.is-composing")
  && dashboardSectionsCssSource.includes("min-height: 28px;")
  && dashboardSectionsCssSource.includes(".todo-row:focus-within .todo-remove")
  && dashboardSectionsCssSource.includes("@media (hover: none), (pointer: coarse)"), "to-do rows must be compact while retaining keyboard and touch access to delete controls");
assert(motionCssSource.includes(".utility-card .weather-forecast-list")
  && motionCssSource.includes("grid-template-rows: repeat(3, minmax(0, 1fr));")
  && motionCssSource.includes(".utility-card .weather-row:not(.is-current) .efficiency-row-main"), "wide desktop weather rows must expand into three readable two-line forecasts");
assert(dashboardSectionsCssSource.includes("grid-template-columns: minmax(0, 1fr) 66px;")
  && appSource.includes("weatherConditionIconName(weatherConditionKey(weatherForecast.current.weatherCode))")
  && appSource.includes('drizzle: "cloud-drizzle"')
  && appSource.includes('thunderstorm: "cloud-lightning"'), "weather rows must share a fixed temperature column and the header icon must reflect the current condition");
assert(appSource.includes('attributionGroup.className = "weather-attribution-group"')
  && appSource.includes('attributionGroup.append(separator, createLocationAttribution({ compact: true }))')
  && appSource.includes('t("weather.attributionShort")')
  && dashboardSectionsCssSource.includes(".weather-attribution-group"), "weather and conditional GeoNames credits must share one compact source line");
assert(serviceWorkerSource.includes('record.value?.capability === "weather"')
  && serviceWorkerSource.includes("weatherCachePermitted(record.value)"), "revoking a weather origin must remove the dedicated forecast cache during permission reconciliation");
assert(appSource.includes("selectDailyEvents(state.data?.dailyDigest?.items") && appSource.includes("minSourceCount: 2"), "today's events must prioritize independent corroboration instead of mirroring the first three stories");
assert(appSource.includes('row.className = "efficiency-row topic-row"'), "today's event rows must preserve the former topic card styling hook");
assert(appSource.includes('item.publisher || item.source || item.host || ""')
  && appSource.includes('item.eventConfidence === "high-confidence-single"')
  && appSource.includes('t("events.singlePending")'), "today's event rows must distinguish corroborated source counts from pending single-source fallbacks");
assert(!serviceWorkerSource.includes("buildTopics("), "the dashboard payload must not run the removed cross-source topic aggregation");

const now = Date.now();
const tooLarge = [
  { key: "old", updatedAt: now - 31 * 86400000, size: 100 },
  { key: "large-a", updatedAt: now - 1000, size: 20 * 1024 * 1024 },
  { key: "large-b", updatedAt: now, size: 10 * 1024 * 1024 },
];
const pruning = recordsToPrune(tooLarge, now);
assert(pruning.remove.some((record) => record.key === "old"));
assert(pruning.remainingSize <= 25 * 1024 * 1024);

globalThis.chrome = { storage: { local: memoryStorage(), session: memoryStorage(), sync: memoryStorage() } };
const { clearLegacyCredentialData, readSecrets, secretStatus, updateSecrets } = await import("../extension/core/secrets.mjs");
await updateSecrets({ openaiApiKey: "secret-test-key" });
assert.equal((await readSecrets()).openaiApiKey, "secret-test-key");
assert.equal((await secretStatus()).hasOpenAIKey, true);
assert(!JSON.stringify(await chrome.storage.sync.get(null)).includes("secret-test-key"), "API keys must never enter Chrome Sync");
await updateSecrets({ openaiApiKey: "" });
assert.equal((await secretStatus()).hasOpenAIKey, false);
await Promise.all([
  updateSecrets({ openaiApiKey: "concurrent-openai-key" }),
  updateSecrets({ braveSearchApiKey: "concurrent-brave-key" }),
]);
assert.deepEqual(await readSecrets(), {
  openaiApiKey: "concurrent-openai-key",
  braveSearchApiKey: "concurrent-brave-key",
}, "concurrent secret updates must merge instead of overwriting each other");
await updateSecrets({ openaiApiKey: "", braveSearchApiKey: "" });
await chrome.storage.local.set({ "ampira.vault.v1": { legacy: true } });
await chrome.storage.session.set({ "ampira.secrets.session.v1": { openaiApiKey: "legacy" } });
await clearLegacyCredentialData();
assert.equal((await chrome.storage.local.get("ampira.vault.v1"))["ampira.vault.v1"], undefined);
assert.equal((await chrome.storage.session.get("ampira.secrets.session.v1"))["ampira.secrets.session.v1"], undefined);

let clientState = {};
const clientStateStore = createClientStateStore({
  async getRecord() { return { ...clientState }; },
  async setRecord(key, value) {
    assert.equal(key, "client-state");
    await Promise.resolve();
    clientState = value;
  },
});
await Promise.all([
  clientStateStore.save({ values: { "dash.one": "1" } }),
  clientStateStore.save({ values: { "dash.two": "2" } }),
]);
assert.deepEqual(clientState, { "dash.one": "1", "dash.two": "2" });
await assert.rejects(clientStateStore.save({ values: { invalid: "value" } }), (error) => error.code === "INVALID_CLIENT_STATE");
await assert.rejects(clientStateStore.save({ values: { [`dash.${"x".repeat(92)}`]: "value" } }), (error) => error.code === "INVALID_CLIENT_STATE");
await assert.rejects(clientStateStore.save({ values: Object.fromEntries(Array.from({ length: 101 }, (_, index) => [`dash.limit.${index}`, "x"])) }), (error) => error.code === "INVALID_CLIENT_STATE");
await assert.rejects(clientStateStore.save({ values: { "dash.multibyte": "界".repeat(180000) } }), (error) => error.code === "INVALID_CLIENT_STATE");
const oversizedStateStore = createClientStateStore({
  async getRecord() { return {}; },
  async setRecord() { assert.fail("oversized aggregate state must not be persisted"); },
});
await assert.rejects(oversizedStateStore.save({ values: Object.fromEntries(Array.from({ length: 5 }, (_, index) => [
  `dash.large.${index}`,
  "x".repeat(450000),
])) }), (error) => error.code === "CLIENT_STATE_TOO_LARGE");
let stateWriteAttempts = 0;
const recoveringStateStore = createClientStateStore({
  async getRecord() { return {}; },
  async setRecord() {
    stateWriteAttempts += 1;
    if (stateWriteAttempts === 1) throw new Error("temporary write failure");
  },
});
await assert.rejects(recoveringStateStore.save({ values: { "dash.first": "1" } }));
await recoveringStateStore.save({ values: { "dash.second": "2" } });
assert.equal(stateWriteAttempts, 2, "a failed state write must not poison the serialized mutation queue");

const quotaStorage = memoryStorage();
const quotaManager = createQuotaManager(quotaStorage, () => "2026-07-11");
const reservations = await Promise.all([quotaManager.reserve(2), quotaManager.reserve(2), quotaManager.reserve(2)]);
assert.equal(reservations.filter(Boolean).length, 2, "concurrent quota reservations must not exceed the limit");
await quotaManager.release(reservations.find(Boolean));
assert.equal((await quotaManager.read(2)).used, 1);
const preResetReservation = await quotaManager.reserve(3);
await quotaManager.reset();
await quotaManager.reserve(3);
await quotaManager.release(preResetReservation);
assert.equal((await quotaManager.read(3)).used, 1, "releasing an old reservation must not decrement post-reset usage");

const refreshSources = Array.from({ length: 81 }, (_, index) => ({ key: `source-${index + 1}` }));
const selectedRefreshSources = selectRefreshSources(refreshSources);
assert.equal(selectedRefreshSources.length, 80, "refresh work must stay within the source safety cap");
assert.deepEqual(selectRefreshBatch(refreshSources, 80), {
  sources: [{ key: "source-81" }],
  nextCursor: 0,
}, "refresh batches must rotate to sources beyond the first safety-capped batch");
assert.deepEqual(
  retainActiveUnrefreshedItems([
    { sourceKey: "source-1", title: "refreshed" },
    { sourceKey: "source-81", title: "not selected" },
    { sourceKey: "deleted-source", title: "stale" },
  ], refreshSources, selectedRefreshSources),
  [{ sourceKey: "source-81", title: "not selected" }],
  "unselected active sources must be retained while removed sources are dropped",
);

const stateMessages = [];
globalThis.location = { protocol: "chrome-extension:" };
chrome.runtime = {
  id: "test-extension",
  async sendMessage(message) {
    if (message.type === "client-state:get") return { ok: true, data: {} };
    stateMessages.push(message);
    return { ok: true, data: { ok: true } };
  },
};
const { flushStorage, hydrateStorage, writeValue } = await import("../assets/client/storage.mjs");
await hydrateStorage();
writeValue("dash.batch.one", "1");
writeValue("dash.batch.two", "2");
await flushStorage();
assert.equal(stateMessages.length, 1, "client-state writes must be batched");
assert.deepEqual(stateMessages[0].payload.values, { "dash.batch.one": "1", "dash.batch.two": "2" });

let resolveHydration;
chrome.runtime.sendMessage = async (message) => {
  if (message.type === "client-state:get") return new Promise((resolve) => { resolveHydration = resolve; });
  return { ok: true, data: { ok: true } };
};
const raceStorage = await import(`../assets/client/storage.mjs?hydrate-race=${Date.now()}`);
const hydration = raceStorage.hydrateStorage();
raceStorage.writeValue("dash.race", "local-newer");
resolveHydration({ ok: true, data: { "dash.race": "remote-older" } });
await hydration;
assert.equal(raceStorage.readValue("dash.race"), "local-newer", "hydration must not overwrite a local write made while it was in flight");
await raceStorage.flushStorage();
raceStorage.writeValue("dash.race", "local-latest");
raceStorage.applyExternalStoragePatch({ "dash.race": "remote-stale" });
assert.equal(raceStorage.readValue("dash.race"), "local-latest", "an older runtime echo must not overwrite a newer pending local write");
raceStorage.applyExternalStoragePatch({ "dash.race": "local-latest" });
await raceStorage.flushStorage();

let writeAttempt = 0;
const persistedBatches = [];
chrome.runtime.sendMessage = async (message) => {
  if (message.type === "client-state:get") return { ok: true, data: {} };
  writeAttempt += 1;
  persistedBatches.push(message.payload.values);
  if (writeAttempt === 1) return { ok: false, error: { message: "invalid batch", retryable: false } };
  return { ok: true, data: { ok: true } };
};
const resilientStorage = await import(`../assets/client/storage.mjs?retry=${Date.now()}`);
await resilientStorage.hydrateStorage();
resilientStorage.writeValue("dash.rejected", "bad");
await resilientStorage.flushStorage();
resilientStorage.writeValue("dash.accepted", "good");
await resilientStorage.flushStorage();
assert.equal(writeAttempt, 2, "a non-retryable batch must not block later writes");
assert.deepEqual(persistedBatches[1], { "dash.accepted": "good" });
resilientStorage.writeValue("dash.too-large", "x".repeat(512 * 1024 + 1));
await resilientStorage.flushStorage();
assert.equal(writeAttempt, 2, "oversized client state must be isolated before transport");
delete globalThis.location;
delete chrome.runtime;

const sourceFiles = [
  "dashboard.html",
  ...(await listFilesRecursively(path.join(root, "assets", "client"))).filter((name) => name.endsWith(".mjs")).map((name) => path.relative(root, name).replaceAll("\\", "/")),
  ...(await listFilesRecursively(path.join(root, "extension"))).filter((name) => name.endsWith(".mjs")).map((name) => path.relative(root, name).replaceAll("\\", "/")),
];
for (const file of sourceFiles) {
  const absoluteFile = path.join(root, file);
  const text = await fs.readFile(absoluteFile, "utf8");
  assert(!/\beval\s*\(|new\s+Function\s*\(|\bimportScripts\s*\(|\bWebAssembly\s*\.|new\s+(?:Shared)?Worker\s*\(/.test(text), `${file} must not execute or load unreviewed code`);
  assert(!/\.(?:innerHTML|outerHTML)\s*=|\.insertAdjacentHTML\s*\(/.test(text), `${file} must not inject markup strings`);
  for (const match of text.matchAll(/["']((?:background|reader)\.[\w.]+)["']/g)) {
    assert(localeKeys.includes(match[1]), `${file} translation key must exist: ${match[1]}`);
  }
  if (file === "dashboard.html") {
    assert(!/<script[^>]+src=["']https?:/i.test(text), "dashboard must not load remote scripts");
    assert(!/\son[a-z]+\s*=/i.test(text), "dashboard must not use inline event handlers");
  }
  if (file.endsWith(".mjs")) {
    assert(!/\bimport\s*\(\s*["']https?:/i.test(text), `${file} must not dynamically import remote code`);
    for (const match of text.matchAll(/(?:\bfrom\s*|\bimport\s*\()\s*["'](\.[^"']+)["']/g)) {
      const target = path.resolve(path.dirname(absoluteFile), match[1]);
      await fs.access(target).catch(() => assert.fail(`${file} import must exist: ${match[1]}`));
    }
  }
}
const bookmarkRuntimeSource = await Promise.all(sourceFiles.filter((file) => file.startsWith("extension/")).map((file) => fs.readFile(path.join(root, file), "utf8")));
assert(!/chrome\.bookmarks\.(?:create|update|move|remove|removeTree)\s*\(/.test(bookmarkRuntimeSource.join("\n")), "bookmark access must remain read-only");

for (const suite of [
  "reading-queue.mjs",
  "mutation-queue.mjs",
  "permission-state.mjs",
  "provider-consent.mjs",
  "provider-policy.mjs",
  "reader.mjs",
  "feed-coverage.mjs",
  "image-candidates.mjs",
  "redirect-policy.mjs",
  "refresh-coordinator.mjs",
  "settings-store.mjs",
  "content-sync.mjs",
]) {
  await import(`./suites/${suite}`);
}

console.log("extension tests passed");

function memoryStorage() {
  const values = {};
  return {
    async get(keys) {
      if (keys == null) return { ...values };
      const list = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(list.filter((key) => Object.hasOwn(values, key)).map((key) => [key, values[key]]));
    },
    async set(input) { Object.assign(values, input); },
    async remove(keys) { for (const key of (Array.isArray(keys) ? keys : [keys])) delete values[key]; },
    async clear() { for (const key of Object.keys(values)) delete values[key]; },
  };
}

async function listFilesRecursively(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? listFilesRecursively(absolute) : [absolute];
  }));
  return nested.flat();
}
