import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { webcrypto } from "node:crypto";
import { buildBookmarkModel, inspirationPreviewSourceUrls, inspirationPreviewTargets, originsFromUrls } from "../extension/core/bookmarks.mjs";
import { providerEndpoint, requestAiCompletion, searchImagePreview, testImageSearchConnection } from "../extension/core/ai.mjs";
import { createClientStateStore } from "../extension/core/client-state.mjs";
import { DEFAULT_SETTINGS, SETTINGS_KEY } from "../extension/core/constants.mjs";
import { recordsToPrune } from "../extension/core/db.mjs";
import { feedCacheOrEmpty, fetchSourceArticles, parseFeedDocument, rankAndDedupe } from "../extension/core/feed.mjs";
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
assert.deepEqual([...(manifest.optional_permissions || [])].sort(), ["favicon"], "website icons must use an optional named permission so upgrades do not disable existing installs");
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
assert(cspDirectives.get("img-src")?.includes("'self'"), "the native favicon endpoint must remain available as a same-extension image");

assert.equal(DEFAULT_LOCALE, "zh-CN");
assert.deepEqual(SUPPORTED_LOCALES, ["en", "zh-CN", "zh-Hant"]);
assert.equal(normalizeLocale("en-US"), "en");
assert.equal(normalizeLocale("zh_TW"), "zh-Hant");
assert.equal(normalizeLocale("zh-HK"), "zh-Hant");
assert.equal(normalizeLocale("zh-Hans-SG"), "zh-CN");
assert.equal(detectSupportedLocale(["fr-FR", "en-GB"]), "en");
assert.equal(detectSupportedLocale(["fr-FR"]), "zh-CN");
assert.equal(translate("en", "context.openAll", { count: 3 }), "Open all in new tabs (3)");
assert(translate("en", "settings.service.consent").includes("article URLs used for context"), "the prominent AI disclosure must include context article URLs");
assert(translate("zh-CN", "settings.service.consent").includes("文章网址"), "the Chinese AI disclosure must include context article URLs");
assert.equal(translateCount("en", "unit.entries", 1), "1 entry");
assert.equal(translateCount("en", "unit.entries", 2), "2 entries");
assert.equal(formatListForLocale("en", ["News", "Design"]), "News and Design");
assert.deepEqual(defaultBookmarkFoldersForLocale("en"), { news: "News", inspiration: "Inspiration" });
assert.deepEqual(defaultBookmarkFoldersForLocale("zh-Hant"), { news: "資訊", inspiration: "審美" });
assert.equal(translate("en", "settings.bookmarks.folderOption", { name: "Design", count: 5 }), "Design (5)");
assert.equal(DEFAULT_SETTINGS.newsBookmarkFolder, "");
assert.equal(DEFAULT_SETTINGS.inspirationBookmarkFolder, "");

const permissionUiRows = [
  { origin: "https://allowed.example/*", required: true, granted: true },
  { origin: "https://pending.example/*", required: true, granted: false },
  { origin: "https://legacy.example/*", required: false, granted: true, legacy: true },
];
assert.deepEqual(permissionRowCounts(permissionUiRows), {
  required: 2,
  granted: 1,
  pending: 1,
  legacy: 1,
  broadRequired: 0,
});
assert.deepEqual(requiredUngrantedOrigins(permissionUiRows), ["https://pending.example/*"]);
assert.equal(permissionRowCounts(permissionUiRows.map((row) => ({ ...row, granted: true }))).pending, 0, "fully granted rows must not leave an active bulk action");
assert.equal(permissionRowCounts(permissionUiRows.filter((row) => row.legacy)).pending, 0, "legacy-only rows must not enable bulk authorization");

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
const dashboardI18nKeys = [...dashboardSource.matchAll(/(?:data-i18n(?:-[\w-]+)?|data-dynamic-i18n)="([^"]+)"/g)].map((match) => match[1]);
for (const key of dashboardI18nKeys) assert(localeKeys.includes(key), `dashboard translation key must exist: ${key}`);
const untranslatedDashboardLines = dashboardSource.split(/\r?\n/).filter((line) => (
  /[\u3400-\u9fff]/u.test(line)
  && !line.includes("data-i18n")
  && !line.includes("data-dynamic-i18n")
  && !/<option value="zh-(?:CN|Hant)">/.test(line)
  && !/id="currentUiLanguage"/.test(line)
));
assert.deepEqual(untranslatedDashboardLines, [], "dashboard-owned Chinese copy must be marked for translation");
assert(dashboardSource.includes('id="sourcePermissionSummary"'), "website access must expose a visible settings-page status");
assert(!dashboardSource.includes('id="refreshPermissionStatus"'), "website access must sync automatically without a no-op refresh button");
assert(dashboardSource.includes('id="toggleFaviconPermission"'), "existing users must be able to manage the optional favicon permission in settings");
assert(dashboardSource.includes('data-permission="favicon"'), "onboarding must request the optional favicon permission from an explicit user gesture");
assert.equal((dashboardSource.match(/data-onboarding-step="\d"/g) || []).length, 5, "onboarding must retain the five-step product, permission, folder, API key, and start flow");
assert(dashboardSource.includes('id="onboardingNewsFolder"') && dashboardSource.includes('id="onboardingInspirationFolder"'), "onboarding must let users choose bookmark folders in place");
assert(dashboardSource.includes('id="onboardingApiKey"') && dashboardSource.includes('id="onboardingSkipApiKey"'), "onboarding must offer an optional in-place API key step");
assert(dashboardSource.includes('data-i18n="onboarding.step3.skip"') && dashboardSource.includes('data-i18n="onboarding.step4.skip"'), "folder and API key onboarding steps must both remain skippable");
const permissionUiSource = await fs.readFile(path.join(root, "assets", "client", "extension-ui.mjs"), "utf8");
assert(permissionUiSource.includes('request("settings:save", { newsBookmarkFolder, inspirationBookmarkFolder })'), "onboarding folder choices must persist through the settings boundary");
assert(permissionUiSource.includes('request("settings:save", { openaiApiKey, aiDisclosureAccepted: true })'), "onboarding API keys must keep the existing consent and local-secret boundary");
assert(permissionUiSource.includes('event.detail?.type === "settings.changed"'), "website access must react to extension permission updates");
assert(permissionUiSource.includes('"visibilitychange"'), "website access must recheck when the page becomes visible");
const aiFieldsetStart = dashboardSource.indexOf('<fieldset class="ai-provider-fields"');
const aiFieldsetEnd = dashboardSource.indexOf("</fieldset>", aiFieldsetStart);
assert(aiFieldsetStart > 0 && aiFieldsetEnd > aiFieldsetStart, "AI provider controls must use a semantic fieldset");
assert(dashboardSource.slice(aiFieldsetStart, aiFieldsetEnd).includes(" disabled"), "AI provider fields must start locked before permission state hydrates");
assert(dashboardSource.slice(aiFieldsetStart, aiFieldsetEnd).includes('aria-describedby="aiFormAccessStatus"'), "locked AI fields must reference the live setup status");
assert(dashboardSource.indexOf('id="apiBaseUrlInput"') < aiFieldsetStart, "the provider URL must remain available before the gated AI fields");
assert(dashboardSource.indexOf('id="clearKey"') < aiFieldsetStart, "credential removal must remain available outside the gated AI fields");
assert(dashboardSource.indexOf('id="grantBraveOrigin"') > aiFieldsetEnd, "Brave authorization must remain independent of the AI provider gate");

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
assert.deepEqual(inspirationPreviewSourceUrls(model.bookmarks), ["https://design.example.com/"], "only inspiration bookmarks should require original-preview origins");
assert.deepEqual(previewCacheKeysOutsideTargets([
  { key: "preview-origin-v2-kept", value: { capability: "site-preview-origin", requestedUrl: "https://design.example.com/#work" } },
  { key: "preview-brave-v2-kept", value: { capability: "site-preview-brave", requestedUrl: "https://design.example.com/", title: "Design" } },
  { key: "preview-brave-v2-renamed", value: { capability: "site-preview-brave", requestedUrl: "https://design.example.com/", title: "Old name" } },
  { key: "preview-brave-v2-removed", value: { capability: "site-preview-brave", requestedUrl: "https://removed.example.com/" } },
  { key: "preview-origin-v2-insecure", value: { capability: "site-preview-origin", requestedUrl: "http://design.example.com/" } },
  { key: "preview-origin-v2-invalid", value: { capability: "site-preview-origin", requestedUrl: "" } },
  { key: "feed", value: { requestedUrl: "https://removed.example.com/" } },
], inspirationPreviewTargets(model.bookmarks)), [
  "preview-brave-v2-renamed",
  "preview-brave-v2-removed",
  "preview-origin-v2-insecure",
  "preview-origin-v2-invalid",
], "bookmark changes must identify stale v2 preview records without touching unrelated cache entries");
assert.deepEqual(bravePreviewCacheKeys([
  { key: "preview-origin-v2-kept", value: { capability: "site-preview-origin" } },
  { key: "preview-brave-v2-current", value: { capability: "site-preview-brave" } },
  { key: "preview-legacy", value: { capability: "image-preview" } },
  { key: "preview-brave-v2-unknown", value: {} },
]), ["preview-brave-v2-current", "preview-legacy", "preview-brave-v2-unknown"], "Brave setting or key changes must target only Brave preview cache records");
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

const faviconPageUrl = "https://example.com/path?q=one&size=128#section";
const faviconRuntime = {
  id: "test-extension",
  getURL(pathname) {
    assert.equal(pathname, "/_favicon/");
    return `chrome-extension://test-extension${pathname}`;
  },
};
const nativeFavicon = new URL(faviconUrl({
  url: faviconPageUrl,
  faviconUrl: "https://tracker.example/icon.png",
}, { runtime: faviconRuntime, nativeEnabled: true }));
assert.equal(nativeFavicon.protocol, "chrome-extension:");
assert.equal(nativeFavicon.hostname, "test-extension");
assert.equal(nativeFavicon.pathname, "/_favicon/");
assert.equal(nativeFavicon.searchParams.get("pageUrl"), faviconPageUrl);
assert.deepEqual(nativeFavicon.searchParams.getAll("size"), ["32"]);
assert.equal(faviconUrl({ url: faviconPageUrl }, { runtime: faviconRuntime, nativeEnabled: false }), "favicon.svg", "ungranted optional favicon access must use the packaged fallback");
assert.equal(faviconUrl({ faviconUrl: "https://tracker.example/icon.png" }, { runtime: faviconRuntime, nativeEnabled: false }), "favicon.svg", "remote favicon candidates must never bypass Chrome's native icon service");
assert.equal(faviconUrl({ url: "javascript:alert(1)" }, { runtime: faviconRuntime, nativeEnabled: true }), "favicon.svg");
assert.equal(faviconUrl({ url: "not a url" }, { runtime: faviconRuntime, nativeEnabled: true }), "favicon.svg");
assert.equal(faviconUrl({ url: faviconPageUrl }, {
  nativeEnabled: true,
  runtime: { id: "test-extension", getURL() { throw new Error("unavailable"); } },
}), "favicon.svg");

const emptyFeedCache = feedCacheOrEmpty(null);
assert.deepEqual(emptyFeedCache.items, [], "a missing feed cache must remain empty instead of falling back to bookmark cards");
const cachedEmptyFeed = { schemaVersion: 2, items: [] };
assert.equal(feedCacheOrEmpty(cachedEmptyFeed), cachedEmptyFeed, "an empty feed cache must remain the authoritative empty result");
const cachedFeed = { schemaVersion: 2, items: [{ articleId: "real-article", title: "Real article" }] };
assert.equal(feedCacheOrEmpty(cachedFeed), cachedFeed, "real cached news must remain available");
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
  globalThis.fetch = async () => new Response('<html><head><meta property="og:type" content="website"><meta property="og:title" content="Example News"><meta name="description" content="A news website, not a news article."></head><body></body></html>', {
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
  globalThis.fetch = async () => new Response('<html><body><a href="/detail/123456">A sufficiently descriptive detail article title</a></body></html>', {
    status: 200,
    headers: { "content-type": "text/html" },
  });
  const detailArticles = await fetchSourceArticles({ url: "https://details.example/", title: "Details" });
  assert.equal(detailArticles.at(0)?.url, "https://details.example/detail/123456", "detail-style news links must be discovered before considering an HTML fallback");
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

const previewMetadata = extractPageMetadata(`
  <html><head>
    <meta name="twitter:image" content="https://cdn.example.com/twitter.jpg">
    <meta content="../images/hero.jpg?x=1&amp;y=2#crop" property="og:image">
  </head></html>
`, "https://design.example.com/work/item");
assert.equal(previewMetadata.heroImageUrl, "https://design.example.com/images/hero.jpg?x=1&y=2", "Open Graph images must outrank Twitter images and resolve relative URLs");
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
let previewApi = () => new Promise((resolve) => { resolvePreviewRequest = resolve; });
const previewController = createInspirationPreviewController({
  apiGet: (...args) => { previewApiCalls += 1; return previewApi(...args); },
  normalizeUrl: (value) => String(value || ""),
  isHttpUrl: (value) => /^https?:\/\//.test(value),
  isEnabled: () => true,
  canFallback: () => true,
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
const serviceWorkerSource = await fs.readFile(path.join(root, "extension/service-worker.mjs"), "utf8");
const readerPolicySource = await fs.readFile(path.join(root, "assets/client/reader-policy.mjs"), "utf8");
const readerUiSource = await fs.readFile(path.join(root, "assets/client/reader-ui.mjs"), "utf8");
assert(readerPolicySource.includes('READER_HTTP_ERROR: "reader.error.httpTitle"'));
assert(readerUiSource.includes("markReadOnOpen(item);"), "opening a bookmark or news card must mark it as read");
assert(appSource.includes('t("settings.bookmarks.folderOption"'));
assert(appSource.includes('isEnabled: () => state.settings?.bookmarkConsentGranted === true'), "original previews must not depend on Brave configuration");
assert(appSource.includes('event.detail?.payload?.permissionsChanged || event.detail?.payload?.imageSearchChanged'), "permission and Brave configuration changes must invalidate previews in every open tab");
assert(serviceWorkerSource.includes('urls.push(...inspirationPreviewSourceUrls(model.bookmarks))'), "inspiration origins must appear in the exact-origin permission list");
assert(serviceWorkerSource.includes("await pruneStalePreviewCaches(settings)"), "bookmark changes must prune preview caches for removed inspiration targets");
assert(serviceWorkerSource.includes("if (bookmarkSourceChanged) await pruneStalePreviewCaches(normalized)"), "changing the selected inspiration folder must prune stale preview caches");
assert(serviceWorkerSource.includes("if (imageSearchChanged) await pruneBravePreviewCaches()"), "Brave setting or key changes must prune Brave preview caches");
assert(appSource.includes('removeAttribute("data-i18n")'), "dynamic AI gate copy must not be overwritten by a later whole-document translation pass");
assert(appSource.includes('visibilitychange'), "the AI permission gate must refresh after the page becomes visible again");
assert(appSource.includes('settings.service.aiFormDeclined'), "AI permission denial must be reported in the adjacent live setup status");
assert(!serviceWorkerSource.includes("fallbackFeedFromBookmarks"), "missing or empty feed caches must remain empty");
assert(!serviceWorkerSource.includes("bookmark-article-"), "empty feeds must not synthesize news cards from bookmark names");

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
