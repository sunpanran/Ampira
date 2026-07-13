import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { webcrypto } from "node:crypto";
import { buildBookmarkModel, inspirationPreviewSourceUrls, inspirationPreviewTargets, originsFromUrls } from "../extension/core/bookmarks.mjs";
import { providerEndpoint, requestAiCompletion, searchImagePreview, testImageSearchConnection } from "../extension/core/ai.mjs";
import { createClientStateStore } from "../extension/core/client-state.mjs";
import { DEFAULT_SETTINGS, SETTINGS_KEY } from "../extension/core/constants.mjs";
import { recordsToPrune } from "../extension/core/db.mjs";
import { feedCacheOrEmpty, fetchSourceArticles, filterLikelyNewsItems, isDisplayableFeedItem, parseFeedDocument, rankAndDedupe } from "../extension/core/feed.mjs";
import { normalizeFeedback } from "../extension/core/feedback.mjs";
import { createQuotaManager } from "../extension/core/quota.mjs";
import { createPreviewService, fetchSourceImagePreview } from "../extension/core/preview.mjs";
import { bravePreviewCacheKeys, previewCacheKeysOutsideTargets } from "../extension/core/preview-cache.mjs";
import { retainActiveUnrefreshedItems, selectRefreshBatch, selectRefreshSources } from "../extension/core/refresh.mjs";
import { fetchBounded } from "../extension/core/network.mjs";
import { extractPageMetadata, loadReaderWithCache, readerTextFromBlocks } from "../extension/core/reader.mjs";
import { normalizeSettings } from "../extension/core/settings.mjs";
import { decodeSettingsFromSync, encodeSettingsForSync, settingsChunkKeys } from "../extension/core/settings-storage.mjs";
import { createSettingsStore } from "../extension/core/settings-store.mjs";
import { faviconUrl, isReaderUrl, normalizeUrl as normalizeClientUrl } from "../assets/client/urls.mjs";
import { findNewsItemByReference, pageForItems, seededShuffle } from "../assets/client/dashboard-model.mjs";
import { createPriorityRanker, groupItemsByKey, mergeRankedUnique, selectUnseenPool } from "../assets/client/dashboard-selectors.mjs";
import { readerErrorBodyKey, safeReaderOrigin, sameOrigin } from "../assets/client/reader-policy.mjs";
import { normalizeAccentTheme, normalizeColorMode, normalizeHexColor, paletteFromAccent } from "../assets/client/appearance-model.mjs";
import { cloneSettingsDraft, diffSettingsDraft, snapshotSettingsDraft } from "../assets/client/settings-draft.mjs";
import { createInspirationPreviewController, inspirationPreviewFingerprint } from "../assets/client/inspiration-preview-controller.mjs";
import { AI_SETUP_STAGE, aiProviderOrigin, aiProviderOriginPattern, deriveAiSetupControlState } from "../assets/client/ai-settings-policy.mjs";
import { permissionRowCounts, requiredUngrantedOrigins } from "../assets/client/permission-ui-model.mjs";
import { textLength, truncateText } from "../assets/client/text.mjs";
import { cleanGeneratedSummaryLine, extractGeneratedSummaryTitle, hasStructuralSummaryPrefix, normalizeSummaryMarkup, parseGeneratedDailyDigest } from "../extension/core/summary-text.mjs";
import { cleanAiAnswerMarkup, extractDirectAnswer, parseAiAnswer } from "../assets/client/ai-answer-format.mjs";
import { cleanSummaryLines as cleanPresentedSummaryLines, cleanSummaryTitle as cleanPresentedSummaryTitle } from "../assets/client/item-presenter.mjs";
import { searchQueryTerms } from "../extension/core/search.mjs";
import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  defaultBookmarkFoldersForLocale,
  detectSupportedLocale,
  formatListForLocale,
  localeMessages,
  normalizeLocale,
  translate,
  translateCount,
} from "../extension/core/i18n.mjs";
import { runArchitectureTests } from "./suites/architecture.mjs";
import { runManifestSecurityTests } from "./suites/manifest-security.mjs";
import { runActivityStoreTests } from "./suites/activity-store.mjs";
import { runDashboardControllerTests } from "./suites/dashboard-controller.mjs";
import { runBookmarkFeedPolicyTests } from "./suites/bookmark-feed-policy.mjs";

if (!globalThis.crypto) globalThis.crypto = webcrypto;
if (!globalThis.btoa) globalThis.btoa = (value) => Buffer.from(value, "binary").toString("base64");
if (!globalThis.atob) globalThis.atob = (value) => Buffer.from(value, "base64").toString("binary");

const root = path.dirname(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(?:[A-Za-z]:)/, (match) => match.slice(1))));
await runArchitectureTests(root);
const { dashboardSource, localeKeys } = await runManifestSecurityTests(root);
runActivityStoreTests();
await runDashboardControllerTests();
runBookmarkFeedPolicyTests();
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
    choices: [{ message: { content: [{ type: "text", text: "Array chat answer" }] } }],
  }), { status: 200, headers: { "content-type": "application/json" } });
  assert.equal(await requestAiCompletion({ ...DEFAULT_SETTINGS, openaiApiStyle: "chat_completions" }, {
    apiKey: "test-key",
    system: "System",
    input: "Input",
    maxTokens: 20,
    hasOriginPermission: async () => true,
  }), "Array chat answer");
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
assert.equal(normalizedSettings.aiDisclosureAccepted, false);
assert.equal(normalizedSettings.headerImageUrl, DEFAULT_SETTINGS.headerImageUrl);
assert.equal(normalizeSettings({ headerImageUrl: "" }).headerImageUrl, "", "the default cover URL must remain removable");
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
assert([...originalPreviewRecords.keys()].some((key) => key.startsWith("preview-origin-v3-")), "the optimized extractor must bypass legacy v2 misses with a new cache identity");

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
assert.equal((await getDisallowedPreview({ url: "https://not-an-inspiration.example/", title: "Blocked" })).originalStatus, "unavailable");
assert.equal(disallowedTargetTouched, false, "preview:get must not become a general fetch endpoint for non-inspiration URLs");

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
assert.deepEqual(decodedSettings.excludedNewsSources, largeNormalizedSettings.excludedNewsSources);
const settingsSyncStorage = memoryStorage();
const settingsStore = createSettingsStore(settingsSyncStorage);
await settingsStore.write(largeNormalizedSettings);
assert.deepEqual((await settingsStore.read()).excludedNewsSources, largeNormalizedSettings.excludedNewsSources);
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
previewApi = async () => ({ imageUrl: "https://images.example/b.jpg", source: "origin" });
await previewController.request(currentPreviewItem);
assert.deepEqual(appliedPreviewImages, [["bookmark-1", "https://images.example/b.jpg"]]);
let fallbackRequestUrl = "";
previewApi = async (url) => {
  fallbackRequestUrl = url;
  return { imageUrl: "https://imgs.search.brave.com/b.jpg", source: "brave" };
};
await previewController.reject(currentPreviewItem, "https://images.example/b.jpg");
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
    : { imageUrl: "https://images.example/preload-failure.jpg", source: "origin" };
};
previewImageLoader = async (imageUrl) => {
  preloadedPreviewImages.push(imageUrl);
  return imageUrl.includes("imgs.search.brave.com");
};
await previewController.preload([currentPreviewItem], { timeoutMs: 50 });
assert.deepEqual(preloadedPreviewImages, [
  "https://images.example/preload-failure.jpg",
  "https://imgs.search.brave.com/preloaded-fallback.jpg",
], "a failed original preload must resolve and warm the Brave fallback before cards render");
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
const readerPolicySource = await fs.readFile(path.join(root, "assets/client/reader-policy.mjs"), "utf8");
const readerUiSource = await fs.readFile(path.join(root, "assets/client/reader-ui.mjs"), "utf8");
assert(readerPolicySource.includes('READER_HTTP_ERROR: "reader.error.httpTitle"'));
assert(readerUiSource.includes("markReadOnOpen(item);"), "opening a bookmark or news card must mark it as read");
assert(appSource.includes('t("settings.bookmarks.folderOption"'));
assert(appSource.includes('isEnabled: () => state.settings?.bookmarkConsentGranted === true'), "original previews must not depend on Brave configuration");
assert(appSource.includes('detail?.payload?.permissionsChanged || detail?.payload?.imageSearchChanged'), "permission and Brave configuration changes must invalidate previews in every open tab");
assert(appSource.includes('renderAll();\n  preloadDailyInspiration(UPDATE_INSPIRATION_PRELOAD_TIMEOUT_MS);'), "the initial dashboard must render before inspiration previews preload");
assert(appSource.includes('els.headerImage.addEventListener("error", handleHeaderImageError);\n  syncHeaderImageLoadState();'), "the header cover must reconcile an image that completed before its runtime listeners were bound");
assert(appSource.includes('if (els.headerImage.complete && els.headerImage.naturalWidth > 0)'), "a cached header cover must become visible without waiting for another load event");
assert(appSource.includes('if (board.dataset.loading === "true")'), "loading placeholders must be replaced through the dedicated initial render path");
assert(appSource.includes("animateCardsIn(dailyBoardCards(board));"), "initial daily cards must animate after replacing their loading placeholders");
assert(appSource.includes('dailyInspirationCount * dailyInspirationBatchLimit'), "daily preload must include all configured cards across reshuffle batches");
assert(appSource.includes('img.loading = "eager"'), "preloaded daily inspiration images must not be deferred again by lazy loading");
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
assert(appSource.includes("card.ampiraItem = item"), "preserved card roots must resolve interactions against their latest item data");
assert(appSource.includes("state.data?.ai?.enabled === true"), "manual summary actions must stay hidden until AI consent, credentials, and provider permission are configured");
assert(appSource.includes('options.t("context.explainArticle")') && appSource.includes("action: () => options.explain(url)"), "configured AI must expose article explanation through the context-menu controller");
assert(appSource.includes('feedItem.summaryStatus === "ai"'), "AI summary status must survive feed-to-card mapping");
assert(appSource.includes('feedItem.summaryStatus === "ai" && feedItem.summaryTitle ? feedItem.summaryTitle : feedItem.title'), "organized cards must prefer the separately cached AI title and retain the Feed title as fallback");
assert.deepEqual(cleanPresentedSummaryLines(["### 核心内容", "**核心内容**：有效摘要。"]), ["有效摘要。"], "cached card summaries must strip Markdown and structural AI headings before rendering");
assert.equal(cleanPresentedSummaryTitle("### 核心内容"), "", "structural AI headings must never render as card titles");
assert.equal([...cleanPresentedSummaryTitle("标题".repeat(80))].length, 64, "card titles must retain their explicit character cap");
assert(serviceWorkerSource.includes('const summaryText = await callProvider('), "manual card organization must invoke the configured AI provider");
assert(serviceWorkerSource.includes(".map(cleanGeneratedSummaryLine)"), "new AI card summaries must discard Markdown and structural headings before caching");
assert(serviceWorkerSource.includes('summaryStatus: "ai"'), "manual card organization must persist AI summary status in the feed cache");
assert(serviceWorkerSource.includes("summaryTitle: organized.title"), "automatic and manual card organization must persist the generated AI title separately");
assert(serviceWorkerSource.includes('translate(locale, "background.prompt.cardSummary")'), "card organization must request a structured AI title and summary");
assert(serviceWorkerSource.includes("parseGeneratedDailyDigest(result.value, digest.items.length)"), "daily digest generation must extract AI-organized event titles without a second provider call");
assert(serviceWorkerSource.includes("originalTitle: item.title, title: aiTitle, aiTitle"), "daily events must display the AI title while retaining the Feed title as fallback data");
assert(serviceWorkerSource.includes('const excerptText = String(target.excerpt || "").trim().slice(0, CARD_SUMMARY_EXCERPT_MAX_CHARS)'), "manual summaries must use only the bounded feed excerpt");
assert(serviceWorkerSource.includes("AI_CONNECTION_TEST_MAX_TOKENS = 900"), "AI connection tests must match the proven search budget so reasoning models can emit visible text");
assert(serviceWorkerSource.includes("AI_ARTICLE_SUMMARY_MAX_TOKENS = 1200"), "article organization must leave enough output budget after processing long source text");
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
assert(serviceWorkerSource.includes("AI_SEARCH_CACHE_VERSION = 3"), "AI search prompt and presentation changes must invalidate stale cached answers");
assert(serviceWorkerSource.includes("const context = await automaticCardSummaryContext(candidate)"), "automatic summaries must build a bounded excerpt-only context");
const automaticSummaryContextSource = serviceWorkerSource.slice(serviceWorkerSource.indexOf("function automaticCardSummaryContext"), serviceWorkerSource.indexOf("function preserveCardAiSummary"));
assert(!automaticSummaryContextSource.includes("readArticle") && !automaticSummaryContextSource.includes("hasOriginPermission"), "automatic card summaries must never fetch article bodies");
const manualSummarySource = serviceWorkerSource.slice(serviceWorkerSource.indexOf("async function refreshSingleSummary"), serviceWorkerSource.indexOf("function generatedCardSummary"));
assert(!manualSummarySource.includes("readArticle") && !manualSummarySource.includes("readerTextFromBlocks"), "manual card summaries must never fetch article bodies");
assert(searchQueryTerms("人工智能发布").includes("人工"), "dashboard AI search must segment CJK queries before selecting context");
assert(!serviceWorkerSource.includes("result = candidates.length\n      ? await answerWithOptionalAi"), "dashboard questions without a local keyword match must still invoke the configured AI provider");
assert(serviceWorkerSource.includes("content: candidates.length"), "dashboard AI search must explicitly tell the provider when no matching local context exists");
assert(appSource.includes('summary.className = "ai-digest-summary"'), "the daily brief must render provider-generated overview text instead of hiding it behind local lanes");
assert(dashboardSource.includes('id="settingsAutoAiStatus"') && dashboardSource.includes('id="settingsAutoAiDetail"'), "AI settings must expose automatic organization phase and progress");
assert(dashboardSource.includes('id="settingsQuotaDetail"') && dashboardSource.includes('id="settingsCacheOverviewDetail"'), "AI settings must expose quota meaning and cache timing details");
assert(dashboardSource.includes('id="settingsCacheLoadingIcon" data-icon="synchronize" alt="" aria-hidden="true" hidden'), "the cache loading icon must be local, decorative, and hidden while idle");
assert(serviceWorkerSource.includes('getRecord("ai-auto-status", null)'), "automatic AI status must persist across service-worker suspension");
assert(serviceWorkerSource.includes('"running-digest"') && serviceWorkerSource.includes('phase: "no-candidates"'), "automatic AI status must distinguish active work from an empty candidate queue");
assert(appSource.includes("function renderAutoAiStatus(ai)"), "the AI settings overview must render persisted automatic organization status");
assert(appSource.includes("function renderQuotaOverview(ai = {})") && appSource.includes('t("settings.overview.quotaDetail", { used, remaining })'), "the runtime overview must explain used and remaining automatic quota");
assert(appSource.includes("function renderCacheOverview(status = {})") && appSource.includes("status.finishedAt") && appSource.includes("status.progress"), "the runtime overview must show cache progress and the last completed refresh");
assert(appSource.includes('classList.toggle("is-loading", isLoading)') && appSource.includes("els.settingsCacheLoadingIcon.hidden = !isLoading"), "the cache spinner must only appear while background caching is active");
assert(appSource.includes('removeAttribute("data-i18n")'), "dynamic automatic AI status must survive whole-document translation passes");
assert(appSource.includes('"missing-key": "settings.auto.missingKey"'), "automatic AI status must explain when a tested API key has not been saved");
assert(appSource.includes("settings.test.successSaveHint"), "a successful draft connection test must tell the user to save settings before automation can run");
assert(serviceWorkerSource.includes("automaticAiStarted = true") && serviceWorkerSource.includes("startRefresh(true).catch"), "saving a ready AI configuration must start an automatic refresh immediately");
assert(serviceWorkerSource.includes("const aiAutoReady = aiOriginAdded"), "granting the saved provider origin must start automatic work when the remaining configuration is ready");
assert(!appSource.includes("createDigestLanes"), "the daily brief must not restore the important, follow, and skip card lanes");
assert(appSource.includes('createEfficiencyCard(t("events.cardTitle"), tc("unit.entries", items.length), "news")'), "the former topic card must render today's events");
assert(appSource.includes("Number(right.importanceScore || 0) - Number(left.importanceScore || 0)"), "today's events must rank digest stories by importance");
assert(appSource.includes('row.className = "efficiency-row topic-row"'), "today's event rows must preserve the former topic card styling hook");
assert(appSource.includes('meta.textContent = item.source || item.host || ""'), "today's event rows must show the source without the redundant high-priority reason");
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
  "mutation-queue.mjs",
  "permission-state.mjs",
  "provider-consent.mjs",
  "provider-policy.mjs",
  "reader.mjs",
  "redirect-policy.mjs",
  "refresh-coordinator.mjs",
  "settings-store.mjs",
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
