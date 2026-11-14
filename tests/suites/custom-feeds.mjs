import assert from "node:assert/strict";
import { DEFAULT_SETTINGS, LOCAL_CUSTOM_FEEDS_KEY, SETTINGS_KEY } from "../../extension/core/constants.mjs";
import { customFeedSource, customFeedSources, normalizeCustomFeeds, normalizeCustomFeedUrl } from "../../extension/core/custom-feeds.mjs";
import { normalizeSettings } from "../../extension/core/settings.mjs";
import { createSettingsStore } from "../../extension/core/settings-store.mjs";
import { createSettingsTransferDocument } from "../../extension/core/settings-transfer.mjs";
import { fetchSourceArticles, fetchFeedSubscription } from "../../extension/core/feed.mjs";
import { buildPermissionRows, filterFeedItemsBySources, originPattern } from "../../extension/core/permission-state.mjs";
import { createPermissionGateway } from "../../extension/runtime/permission-gateway.mjs";
import { createDashboardContentService } from "../../extension/runtime/dashboard-content-service.mjs";
import { createCustomFeedService } from "../../extension/runtime/custom-feed-service.mjs";
import { createPermissionEpoch } from "../../extension/runtime/permission-epoch.mjs";
import { createAutomaticAiHarness } from "../helpers/automatic-ai-harness.mjs";

const feed = { url: "https://rss.example/science.xml", title: "Science", enabled: true };
const source = customFeedSource(feed);
const settings = normalizeSettings({ ...DEFAULT_SETTINGS, customFeeds: [feed], bookmarkConsentGranted: false });
assert.equal(normalizeCustomFeedUrl(" HTTPS://RSS.EXAMPLE:443/science.xml#latest "), feed.url);
for (const url of ["http://rss.example/feed", "https://name:pass@rss.example/feed", "javascript:alert(1)", "file:///feed.xml", "https://rss.example/" + "x".repeat(2048)]) {
  assert.equal(normalizeCustomFeedUrl(url), "");
}
assert.equal(normalizeCustomFeedUrl("http://localhost:9999/feed.xml"), "http://localhost:9999/feed.xml");
assert.equal(normalizeCustomFeeds([feed, { ...feed, url: `${feed.url}#duplicate` }]).length, 1);
assert.equal(normalizeCustomFeeds(Array.from({ length: 60 }, (_, i) => ({ ...feed, url: `${feed.url}?section=${i}` }))).length, 50);
assert.equal(customFeedSources(settings).length, 1, "custom subscriptions do not require bookmark consent");
assert.deepEqual(customFeedSources({ ...settings, customFeeds: [{ ...feed, enabled: false }] }), []);
assert.deepEqual(customFeedSources({ ...settings, excludedNewsSources: [{ value: "rss.example" }] }), []);
assert.equal(customFeedSource({ ...feed, title: "Renamed" }).key, source.key, "renaming retains source identity");
assert(!Object.hasOwn(createSettingsTransferDocument(settings).settings, "customFeeds"), "private subscription URLs are not exported");

const sync = storage(), local = storage();
const store = createSettingsStore(sync, local);
await store.write(settings);
assert.deepEqual((await store.read()).customFeeds, [feed]);
assert.deepEqual(local.values[LOCAL_CUSTOM_FEEDS_KEY], [feed]);
assert(!Object.hasOwn(sync.values[SETTINGS_KEY], "customFeeds"));
assert(!JSON.stringify(sync.values).includes("rss.example"), "subscription URLs never enter browser account sync");
sync.fail = true;
await assert.rejects(store.write({ ...settings, customFeeds: [] }), /synthetic write failure/);
assert.deepEqual((await store.read()).customFeeds, [feed], "failed settings writes restore local subscriptions");
sync.fail = false;
await store.reset();
assert.deepEqual((await store.read()).customFeeds, []);

let grants = ["https://rss.example/*"];
const chrome = { permissions: { getAll: async () => ({ origins: grants }) } };
const gateway = createPermissionGateway({ chrome, getSettings: async () => settings, secretStatus: async () => ({}) });
const content = createDashboardContentService({
  chrome, publicFeedsForLocale: () => [{ ...feed, key: "public-duplicate" }],
  settingsLocale: () => "en", aiConfigured: async () => false, originPattern, buildPermissionRows,
});
const model = { bookmarks: [{ ...source, key: "bookmark-duplicate" }] };
const configured = await content.configuredFeedSources({ ...settings, bookmarkConsentGranted: true }, model);
assert.deepEqual(configured.map(item => item.key), [source.key], "explicit subscriptions win when bookmark and public feeds use the same URL");
const independent = { ...settings, publicFeedSupplementEnabled: false };
assert.deepEqual(await gateway.selectedOrigins({ bookmarks: [] }, independent, { sourcesOnly: true }), [{ origin: grants[0], granted: true }]);
assert.equal((await content.currentFeedPermissionState(independent, model)).permitted.length, 1);
grants = [];
assert.equal((await content.currentFeedPermissionState(independent, model)).permitted.length, 0);
assert.equal((await content.currentFeedPermissionState(independent, model)).denied.length, 1);

const originalFetch = globalThis.fetch;
const date = new Date().toUTCString();
const rss = `<rss version="2.0"><channel><title>Science &amp; Research</title><item><title>Scientists publish a new experiment</title><link>https://rss.example/articles/new-experiment</link><description>The research team published results from its latest experiment.</description><pubDate>${date}</pubDate></item></channel></rss>`;
try {
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return new Response(rss, { headers: { "content-type": "application/rss+xml", etag: '"rss-fixture"' } });
  };
  const parsed = await fetchSourceArticles(source, { profile: { resolvedUrl: "https://rss.example/unrelated.xml" } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, feed.url, "custom feeds bypass cached discovery and preferred endpoints");
  assert.equal(calls[0].options.redirect, "error");
  assert.equal(calls[0].options.credentials, "omit");
  assert.equal(calls[0].options.referrerPolicy, "no-referrer");
  assert.equal(parsed[0].sourceKey, source.key);
  assert.equal(parsed.feedTitle, "Science & Research");
  assert.equal(parsed[0].externalDiscovery, false);
  assert.equal(filterFeedItemsBySources(parsed, [source], ["https://rss.example/*"]).length, 1);
  assert.deepEqual(filterFeedItemsBySources(parsed, customFeedSources({ ...settings, customFeeds: [] })), [], "deleted subscriptions lose cached content eligibility");
  assert.deepEqual(filterFeedItemsBySources(parsed, customFeedSources({ ...settings, customFeeds: [{ ...feed, enabled: false }] })), []);
  await assert.rejects(fetchSourceArticles(source, { validateUrl: async () => { throw Object.assign(new Error("denied"), { code: "ORIGIN_PERMISSION_REQUIRED" }); } }), { code: "ORIGIN_PERMISSION_REQUIRED" });
  assert.equal(calls.length, 1, "denied origins are rejected before any fetch");

  const epoch = createPermissionEpoch();
  const service = createCustomFeedService({ sourceFetchOptions: () => ({}), hasOriginPermission: async () => true, permissionEpoch: epoch });
  assert.equal((await service.preview({ url: feed.url })).items.length, 1);
  globalThis.fetch = async () => { epoch.next(); return new Response(rss); };
  await assert.rejects(service.preview({ url: feed.url }), { code: "SOURCE_PERMISSION_CHANGED" });
  for (const document of ["<html><title>Not a feed</title></html>", '{"items":[]}', "<rss><channel><title>Broken", "<rss><channel></rss>", "<feed><entry/>"]) {
    globalThis.fetch = async () => new Response(document);
    await assert.rejects(fetchFeedSubscription(source, { preview: true }), { code: "INVALID_FEED" });
  }
  for (const document of ['<feed xmlns="http://www.w3.org/2005/Atom"><title>Empty Atom</title></feed>', '<rss version="2.0"><channel><title>Empty RSS</title></channel></rss>', '{"version":"https://jsonfeed.org/version/1.1","title":"Empty JSON","items":[]}']) {
    globalThis.fetch = async () => new Response(document);
    assert.equal((await fetchFeedSubscription(source, { preview: true })).length, 0, "valid empty subscriptions can be saved");
  }
  globalThis.fetch = async () => new Response("", { status: 503 });
  await assert.rejects(fetchSourceArticles(source), { code: "SOURCE_HTTP_ERROR", messageParams: { status: 503 } });
  globalThis.fetch = async () => new Response(null, { status: 304 });
  await assert.rejects(fetchFeedSubscription(source, { preview: true }), { code: "INVALID_FEED" });
  assert.equal((await fetchSourceArticles(source, { profile: { resolvedUrl: feed.url, validators: { etag: '"fixture"' } } })).outcome, "notModified");
  globalThis.fetch = async () => new Response(JSON.stringify({ version: "https://jsonfeed.org/version/1.1", title: "JSON science", items: Array.from({ length: 14 }, (_, index) => ({ id: String(index), url: `https://rss.example/articles/experiment-${index}`, title: `Scientists publish experiment ${index}`, content_text: "Research details and results.", date_published: new Date().toISOString() })) }));
  assert.equal((await fetchSourceArticles(source, { limit: 0 })).length, 12, "zero keeps the existing per-source automatic limit");

  const harness = createAutomaticAiHarness({ articles: parsed, settings: { bookmarkConsentGranted: false } });
  await harness.run();
  assert(harness.requests.some(request => request.kind === "card"), "custom-feed articles enter the existing automatic summary workflow without bookmark consent");
  assert(harness.records.get("feed").items.some(item => item.sourceKey === source.key));
} finally {
  globalThis.fetch = originalFetch;
}

function storage() {
  const result = {
    values: {}, fail: false,
    async get(keys) {
      if (keys === null) return structuredClone(result.values);
      return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, structuredClone(result.values[key])]));
    },
    async set(records) { if (result.fail) throw new Error("synthetic write failure"); Object.assign(result.values, structuredClone(records)); },
    async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) delete result.values[key]; },
    async clear() { result.values = {}; },
  };
  return result;
}

console.log("Custom feed storage, permissions, parsing and summary integration tests passed.");
