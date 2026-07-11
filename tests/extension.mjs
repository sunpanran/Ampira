import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { webcrypto } from "node:crypto";
import { buildBookmarkModel, originsFromUrls } from "../extension/core/bookmarks.mjs";
import { providerEndpoint, requestAiCompletion, searchImagePreview, testImageSearchConnection } from "../extension/core/ai.mjs";
import { createClientStateStore } from "../extension/core/client-state.mjs";
import { DEFAULT_SETTINGS, SETTINGS_KEY } from "../extension/core/constants.mjs";
import { recordsToPrune } from "../extension/core/db.mjs";
import { fetchSourceArticles, parseFeedDocument, rankAndDedupe } from "../extension/core/feed.mjs";
import { normalizeFeedback } from "../extension/core/feedback.mjs";
import { createQuotaManager } from "../extension/core/quota.mjs";
import { createPreviewService } from "../extension/core/preview.mjs";
import { retainActiveUnrefreshedItems, selectRefreshBatch, selectRefreshSources } from "../extension/core/refresh.mjs";
import { fetchBounded } from "../extension/core/network.mjs";
import { loadReaderWithCache, readerTextFromBlocks } from "../extension/core/reader.mjs";
import { normalizeSettings } from "../extension/core/settings.mjs";
import { decodeSettingsFromSync, encodeSettingsForSync, settingsChunkKeys } from "../extension/core/settings-storage.mjs";
import { createSettingsStore } from "../extension/core/settings-store.mjs";
import { isReaderUrl, normalizeUrl as normalizeClientUrl } from "../assets/client/urls.mjs";
import { findNewsItemByReference, pageForItems, seededShuffle } from "../assets/client/dashboard-model.mjs";
import { createPriorityRanker, groupItemsByKey, mergeRankedUnique, selectUnseenPool } from "../assets/client/dashboard-selectors.mjs";
import { readerErrorBodyKey, safeReaderOrigin, sameOrigin } from "../assets/client/reader-policy.mjs";
import { normalizeAccentTheme, normalizeColorMode, normalizeHexColor, paletteFromAccent } from "../assets/client/appearance-model.mjs";
import { cloneSettingsDraft, diffSettingsDraft, snapshotSettingsDraft } from "../assets/client/settings-draft.mjs";
import { createInspirationPreviewController, inspirationPreviewFingerprint } from "../assets/client/inspiration-preview-controller.mjs";
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

if (!globalThis.crypto) globalThis.crypto = webcrypto;
if (!globalThis.btoa) globalThis.btoa = (value) => Buffer.from(value, "binary").toString("base64");
if (!globalThis.atob) globalThis.atob = (value) => Buffer.from(value, "base64").toString("binary");

const root = path.dirname(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(?:[A-Za-z]:)/, (match) => match.slice(1))));
const manifest = JSON.parse(await fs.readFile(path.join(root, "manifest.json"), "utf8"));

assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.chrome_url_overrides.newtab, "dashboard.html");
assert.deepEqual(manifest.permissions.sort(), ["alarms", "bookmarks", "storage"]);
for (const forbidden of ["tabs", "history", "scripting", "webRequest", "management", "unlimitedStorage"]) {
  assert(!manifest.permissions.includes(forbidden), `manifest must not request ${forbidden}`);
}
assert.deepEqual([...manifest.optional_host_permissions].sort(), ["http://127.0.0.1/*", "http://localhost/*", "https://*/*"], "optional origins must stay on the reviewed allowlist");
assert(!manifest.host_permissions, "host permissions must remain optional");
const extensionCsp = manifest.content_security_policy?.extension_pages || "";
assert(extensionCsp.includes("script-src 'self'"), "extension CSP must only execute packaged scripts");
assert(extensionCsp.includes("object-src 'none'"), "extension CSP must disable plugin objects");
assert(extensionCsp.includes("base-uri 'none'"), "extension CSP must disable remote base URLs");
assert(!/unsafe-(?:eval|inline)/.test(extensionCsp), "extension CSP must not allow unsafe script execution");
const cspDirectives = new Map(extensionCsp.split(";").map((directive) => directive.trim().split(/\s+/)).filter((parts) => parts[0]).map(([name, ...values]) => [name, values]));
assert.deepEqual(cspDirectives.get("script-src"), ["'self'"], "extension scripts must only come from the package");

assert.equal(DEFAULT_LOCALE, "zh-CN");
assert.deepEqual(SUPPORTED_LOCALES, ["en", "zh-CN", "zh-Hant"]);
assert.equal(normalizeLocale("en-US"), "en");
assert.equal(normalizeLocale("zh_TW"), "zh-Hant");
assert.equal(normalizeLocale("zh-HK"), "zh-Hant");
assert.equal(normalizeLocale("zh-Hans-SG"), "zh-CN");
assert.equal(detectSupportedLocale(["fr-FR", "en-GB"]), "en");
assert.equal(detectSupportedLocale(["fr-FR"]), "zh-CN");
assert.equal(translate("en", "context.openAll", { count: 3 }), "Open all in new tabs (3)");
assert.equal(translateCount("en", "unit.entries", 1), "1 entry");
assert.equal(translateCount("en", "unit.entries", 2), "2 entries");
assert.equal(formatListForLocale("en", ["News", "Design"]), "News and Design");
assert.deepEqual(defaultBookmarkFoldersForLocale("en"), { news: "News", inspiration: "Inspiration" });
assert.deepEqual(defaultBookmarkFoldersForLocale("zh-Hant"), { news: "資訊", inspiration: "審美" });
assert.equal(translate("en", "settings.bookmarks.folderOption", { name: "Design", count: 5 }), "Design (5)");
assert.equal(DEFAULT_SETTINGS.newsBookmarkFolder, "");
assert.equal(DEFAULT_SETTINGS.inspirationBookmarkFolder, "");

const localeKeys = Object.keys(localeMessages(DEFAULT_LOCALE)).sort();
const defaultMessages = localeMessages(DEFAULT_LOCALE);
for (const locale of SUPPORTED_LOCALES) {
  const messages = localeMessages(locale);
  assert.deepEqual(Object.keys(messages).sort(), localeKeys, `${locale} catalog keys must match ${DEFAULT_LOCALE}`);
  for (const key of localeKeys) {
    const expected = [...String(defaultMessages[key]).matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map((match) => match[1]).sort();
    const actual = [...String(messages[key]).matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map((match) => match[1]).sort();
    assert.deepEqual(actual, expected, `${locale} placeholders must match ${DEFAULT_LOCALE} for ${key}`);
  }
}
for (const file of ["en.mjs", "zh-CN.mjs", "zh-Hant.mjs"]) {
  const source = await fs.readFile(path.join(root, "assets", "client", "locales", file), "utf8");
  const declaredKeys = [...source.matchAll(/^\s*"([^"]+)"\s*:/gm)].map((match) => match[1]);
  assert.equal(new Set(declaredKeys).size, declaredKeys.length, `${file} must not declare duplicate translation keys`);
}

const manifestMessageKeys = [];
for (const locale of ["en", "zh_CN", "zh_TW"]) {
  const rawMessages = await fs.readFile(path.join(root, "_locales", locale, "messages.json"), "utf8");
  const declaredKeys = [...rawMessages.matchAll(/^\s{2}"([^"]+)"\s*:/gm)].map((match) => match[1]);
  assert.equal(new Set(declaredKeys).size, declaredKeys.length, `${locale} manifest messages must not declare duplicate keys`);
  const messages = JSON.parse(rawMessages);
  const keys = Object.keys(messages).sort();
  if (!manifestMessageKeys.length) manifestMessageKeys.push(...keys);
  assert.deepEqual(keys, manifestMessageKeys, `${locale} manifest messages must have matching keys`);
}

const dashboardSource = await fs.readFile(path.join(root, "dashboard.html"), "utf8");
const dashboardI18nKeys = [...dashboardSource.matchAll(/data-i18n(?:-[\w-]+)?="([^"]+)"/g)].map((match) => match[1]);
for (const key of dashboardI18nKeys) assert(localeKeys.includes(key), `dashboard translation key must exist: ${key}`);
const untranslatedDashboardLines = dashboardSource.split(/\r?\n/).filter((line) => (
  /[\u3400-\u9fff]/u.test(line)
  && !line.includes("data-i18n")
  && !/<option value="zh-(?:CN|Hant)">/.test(line)
  && !/id="currentUiLanguage"/.test(line)
));
assert.deepEqual(untranslatedDashboardLines, [], "dashboard-owned Chinese copy must be marked for translation");

for (const file of ["assets/client/api.mjs", "assets/client/extension-ui.mjs"]) {
  const text = await fs.readFile(path.join(root, file), "utf8");
  assert(!/[\u3400-\u9fff]/u.test(text), `${file} must not hardcode Chinese UI copy`);
}

for (const file of ["extension/service-worker.mjs", "extension/core/feed.mjs", "extension/core/secrets.mjs", "extension/core/db.mjs"]) {
  const text = await fs.readFile(path.join(root, file), "utf8");
  for (const match of text.matchAll(/["'](background\.[\w.]+)["']/g)) {
    assert(localeKeys.includes(match[1]), `${file} background translation key must exist: ${match[1]}`);
  }
}

for (const [file, expectedLang] of [
  ["docs/index.html", "zh-CN"],
  ["docs/en/index.html", "en"],
  ["docs/zh-TW/index.html", "zh-Hant"],
]) {
  const text = await fs.readFile(path.join(root, file), "utf8");
  assert(text.includes(`<html lang="${expectedLang}">`), `${file} must declare ${expectedLang}`);
  for (const hreflang of ["zh-CN", "zh-TW", "en"]) assert(text.includes(`hreflang="${hreflang}"`), `${file} must link ${hreflang}`);
}

const fixtureTree = [{
  id: "0",
  children: [{
    id: "1",
    title: "书签栏",
    children: [{
      id: "10",
      title: "资讯",
      children: [{ id: "11", title: "科技", children: [
        { id: "12", title: "Example News", url: "https://news.example.com/" },
        { id: "13", title: "Local Feed", url: "http://127.0.0.1:9000/feed.xml" },
      ] }],
    }, {
      id: "20",
      title: "审美",
      children: [{ id: "21", title: "设计", children: [
        { id: "22", title: "Design", url: "https://design.example.com/" },
      ] }],
    }],
  }],
}];

const model = buildBookmarkModel(fixtureTree, { newsBookmarkFolder: "资讯", inspirationBookmarkFolder: "审美", newsEntriesPerCategory: 12 });
assert.equal(model.sections.length, 2);
assert.equal(model.bookmarks.length, 3);
assert.equal(model.bookmarks.filter((item) => item.cardType === "news").length, 2);
assert.equal(model.availableNewsFolders[0].value, "资讯/科技");
const urlExcludedModel = buildBookmarkModel(fixtureTree, {
  newsBookmarkFolder: "资讯",
  inspirationBookmarkFolder: "审美",
  newsEntriesPerCategory: 12,
  excludedNewsSources: [{ url: "https://news.example.com/path" }],
});
assert.equal(urlExcludedModel.bookmarks.find((item) => item.host === "news.example.com")?.feedExcluded, true, "URL exclusions must be matched by host, not treated as folder paths");

const nestedLimitTree = [{ id: "0", children: [{ id: "1", children: [{
  id: "30", title: "资讯", children: [{ id: "31", title: "科技", children: [
    { id: "32", title: "First", url: "https://first.example/" },
    { id: "33", title: "Nested", children: [{ id: "34", title: "Second", url: "https://second.example/" }] },
  ] }],
}, { id: "40", title: "审美", children: [] }] }] }];
const limitedModel = buildBookmarkModel(nestedLimitTree, { newsBookmarkFolder: "资讯", inspirationBookmarkFolder: "审美", newsEntriesPerCategory: 1 });
assert.equal(limitedModel.bookmarks.filter((item) => item.cardType === "news" && item.category === "科技").length, 1, "nested folders must share the category limit");

const singleFolderTree = [{ id: "0", children: [{ id: "1", children: [{ id: "50", title: "资讯", children: [
  { id: "51", title: "Only", url: "https://only.example/" },
] }] }] }];
const singleFolderModel = buildBookmarkModel(singleFolderTree, { newsBookmarkFolder: "资讯", inspirationBookmarkFolder: "审美", newsEntriesPerCategory: 12 });
assert.deepEqual(singleFolderModel.sections.map((section) => [section.name, section.cardType, Boolean(section.missing)]), [
  ["资讯", "news", false],
  ["审美", "inspiration", true],
]);
assert.equal(singleFolderModel.bookmarks.length, 1, "one folder must not be reused for both primary roles");

assert.deepEqual(originsFromUrls([
  "https://news.example.com/path",
  "http://127.0.0.1:9000/feed.xml",
  "http://insecure.example.com/feed",
]), ["http://127.0.0.1:9000/*", "https://news.example.com/*"]);

const source = { key: "source", title: "Fixture", category: "科技" };
const rss = `<?xml version="1.0"?><rss><channel><item><title>第一条资讯</title><link>https://example.com/news/one</link><description><![CDATA[<script>alert(1)</script><p>安全摘要</p>]]></description><pubDate>Fri, 10 Jul 2026 10:00:00 GMT</pubDate></item></channel></rss>`;
const atom = `<feed><entry><title>Atom item</title><link href="https://example.com/article/two"/><summary>Atom summary</summary><updated>2026-07-10T11:00:00Z</updated></entry></feed>`;
const jsonFeed = JSON.stringify({ version: "https://jsonfeed.org/version/1.1", items: [{ id: "3", url: "https://example.com/story/three", title: "JSON item", content_text: "JSON summary", date_published: "2026-07-10T12:00:00Z" }] });
const rssItems = parseFeedDocument(rss, "https://example.com/feed.xml", source, 5, "application/rss+xml");
const atomItems = parseFeedDocument(atom, "https://example.com/atom.xml", source, 5, "application/atom+xml");
const jsonItems = parseFeedDocument(jsonFeed, "https://example.com/feed.json", source, 5, "application/feed+json");
assert.equal(rssItems.length, 1);
assert.equal(atomItems.length, 1);
assert.equal(jsonItems.length, 1);
assert(!rssItems[0].excerpt.includes("<script>"), "remote markup must never survive as executable HTML");
assert.equal(rankAndDedupe([...rssItems, ...rssItems, ...atomItems, ...jsonItems]).length, 3);
const entityUrlItems = parseFeedDocument(
  "<rss><channel><item><title>Entity URL</title><link>https://example.com/story?a=1&amp;b=2</link></item></channel></rss>",
  "https://example.com/feed.xml",
  source,
  5,
  "application/rss+xml",
);
assert.equal(entityUrlItems[0].url, "https://example.com/story?a=1&b=2");
assert.doesNotThrow(() => parseFeedDocument(
  "<rss><channel><item><title>Invalid &#99999999; entity</title><link>https://example.com/entity</link></item></channel></rss>",
  "https://example.com/feed.xml",
  source,
  5,
  "application/rss+xml",
), "invalid remote numeric entities must not abort feed parsing");
assert.notEqual(normalizeClientUrl("http://127.0.0.1:3000/a"), normalizeClientUrl("http://127.0.0.1:4000/a"));
assert.equal(isReaderUrl("http://news.example.com/article"), false);
assert.equal(isReaderUrl("http://127.0.0.1:3000/article"), true);

const originalFetch = globalThis.fetch;
try {
  const manyItems = Array.from({ length: 15 }, (_, index) => ({ id: String(index), url: `https://example.com/${index}`, title: `Item ${index}` }));
  globalThis.fetch = async () => new Response(JSON.stringify({ version: "https://jsonfeed.org/version/1.1", items: manyItems }), {
    status: 200,
    headers: { "content-type": "application/feed+json" },
  });
  assert.equal((await fetchSourceArticles({ url: "https://fixture.example/feed", title: "Fixture" }, { limit: 0 })).length, 12, "zero source limit must use the safety cap");
  globalThis.fetch = async (url) => {
    if (String(url).endsWith("/bad.xml")) return new Response("failure", { status: 503 });
    if (String(url).endsWith("/good.json")) {
      return new Response(JSON.stringify({ version: "https://jsonfeed.org/version/1.1", items: [{ id: "ok", url: "https://fixture.example/ok", title: "Recovered" }] }), {
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
let previewSearches = 0;
let previewCacheEpoch = -1;
const previewRecords = new Map();
const getPreview = createPreviewService({
  async getSettings() { return { webImageSearchEnabled: true }; },
  async readSecrets() { return { braveSearchApiKey: "preview-key" }; },
  async getRecord(key, fallback) { return previewRecords.get(key) || fallback; },
  async setRecord(key, value, _kind, cacheEpoch) { previewRecords.set(key, value); previewCacheEpoch = cacheEpoch; },
  async hasOriginPermission() { return true; },
  captureCacheEpoch() { return 17; },
  async searchImage(query) {
    previewSearches += 1;
    assert(query.includes("example.com"));
    return "https://imgs.search.brave.com/preview";
  },
  now: () => Date.parse("2026-07-11T00:00:00Z"),
});
assert.deepEqual(await getPreview({ url: "http://insecure.example.com/", title: "Unsafe" }), { ok: false, imageUrl: "", url: "http://insecure.example.com/" });
assert.equal((await getPreview({ url: "https://example.com/design", title: "Example Design" })).imageUrl, "https://imgs.search.brave.com/preview");
assert.equal((await getPreview({ url: "https://example.com/design", title: "Example Design" })).cached, true);
assert.equal(previewSearches, 1, "successful previews must be reused from cache");
assert.equal(previewCacheEpoch, 17, "preview writes must retain the permission/cache epoch captured before the request");

let revokedPreviewCacheRead = false;
const getRevokedPreview = createPreviewService({
  async getSettings() { return { webImageSearchEnabled: true }; },
  async readSecrets() { return { braveSearchApiKey: "preview-key" }; },
  async getRecord() { revokedPreviewCacheRead = true; return { imageUrl: "https://imgs.search.brave.com/stale" }; },
  async setRecord() { assert.fail("revoked preview access must not write cache"); },
  async hasOriginPermission() { return false; },
  async searchImage() { assert.fail("revoked Brave access must not issue a search"); },
});
assert.deepEqual(await getRevokedPreview({ url: "https://example.com/", title: "Example" }), {
  ok: false,
  imageUrl: "",
  url: "https://example.com/",
});
assert.equal(revokedPreviewCacheRead, false, "revoked Brave access must fail closed before reading cached previews");
let emptyPreviewSearches = 0;
const emptyPreviewRecords = new Map();
const getEmptyPreview = createPreviewService({
  async getSettings() { return { webImageSearchEnabled: true }; },
  async readSecrets() { return { braveSearchApiKey: "preview-key" }; },
  async getRecord(key, fallback) { return emptyPreviewRecords.get(key) || fallback; },
  async setRecord(key, value) { emptyPreviewRecords.set(key, value); },
  async hasOriginPermission() { return true; },
  async searchImage() { emptyPreviewSearches += 1; return ""; },
  now: () => Date.parse("2026-07-11T00:00:00Z"),
});
await getEmptyPreview({ url: "https://empty.example/", title: "Empty" });
assert.equal((await getEmptyPreview({ url: "https://empty.example/", title: "Empty" })).cached, true);
assert.equal(emptyPreviewSearches, 1, "empty previews must be negative-cached for the current day");

let concurrentPreviewSearches = 0;
let releaseConcurrentPreview;
const concurrentPreviewGate = new Promise((resolve) => { releaseConcurrentPreview = resolve; });
const getConcurrentPreview = createPreviewService({
  async getSettings() { return { webImageSearchEnabled: true }; },
  async readSecrets() { return { braveSearchApiKey: "preview-key" }; },
  async getRecord(_key, fallback) { return fallback; },
  async setRecord() {},
  async hasOriginPermission() { return true; },
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
assert.equal(concurrentPreviewSearches, 1, "concurrent preview requests for one cache key must share a search");
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
  async searchImage() { return "https://imgs.search.brave.com/uncached-preview"; },
});
const uncachedPreview = await getPreviewWithUnavailableCache({ url: "https://uncached.example/", title: "Uncached" });
assert.equal(uncachedPreview.ok, true, "cache write failures must not discard a valid preview result");
assert.equal(uncachedPreview.imageUrl, "https://imgs.search.brave.com/uncached-preview");
assert.equal(failedPreviewCacheWrites, 1);

let retryablePreviewSearches = 0;
const getRetryablePreview = createPreviewService({
  async getSettings() { return { webImageSearchEnabled: true }; },
  async readSecrets() { return { braveSearchApiKey: "preview-key" }; },
  async getRecord(_key, fallback) { return fallback; },
  async setRecord() {},
  async hasOriginPermission() { return true; },
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
assert.equal(retryablePreviewSearches, 2, "a failed in-flight preview request must be cleared so the next call can retry");
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
).map((item) => item.key), ["item-4", "item-5"], "seen items must be removed before the visible pool is capped");
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
let currentPreviewItem = { key: "bookmark-1", url: "https://a.example/", title: "A" };
let previewApiCalls = 0;
let resolvePreviewRequest;
const appliedPreviewImages = [];
let previewApi = () => new Promise((resolve) => { resolvePreviewRequest = resolve; });
const previewController = createInspirationPreviewController({
  apiGet: (...args) => { previewApiCalls += 1; return previewApi(...args); },
  normalizeUrl: (value) => String(value || ""),
  isHttpUrl: (value) => /^https?:\/\//.test(value),
  isEnabled: () => true,
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
previewApi = async () => ({ imageUrl: "https://images.example/b.jpg" });
await previewController.request(currentPreviewItem);
assert.deepEqual(appliedPreviewImages, [["bookmark-1", "https://images.example/b.jpg"]]);
previewController.invalidate();
assert.equal(previewController.get(currentPreviewItem), null);
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
assert.equal(normalizeColorMode("unknown"), "system");
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
const appSource = await fs.readFile(path.join(root, "assets/client/app.mjs"), "utf8");
const readerPolicySource = await fs.readFile(path.join(root, "assets/client/reader-policy.mjs"), "utf8");
assert(readerPolicySource.includes('READER_HTTP_ERROR: "reader.error.httpTitle"'));
assert(appSource.includes('t("settings.bookmarks.folderOption"'));

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
  ...(await listFilesRecursively(path.join(root, "extension", "core"))).filter((name) => name.endsWith(".mjs")).map((name) => path.relative(root, name).replaceAll("\\", "/")),
  "extension/service-worker.mjs",
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
