import assert from "node:assert/strict";
import { DEFAULT_SETTINGS } from "../../extension/core/constants.mjs";
import { fetchSourceArticles } from "../../extension/core/feed.mjs";
import { filterPresentableFeedItems } from "../../extension/core/feed-language-policy.mjs";
import { buildPermissionRows, filterFeedItemsBySources, originPattern } from "../../extension/core/permission-state.mjs";
import { publicFeedsForLocale } from "../../extension/core/public-feeds.mjs";
import { selectRefreshBatch } from "../../extension/core/refresh.mjs";
import { createDashboardContentService } from "../../extension/runtime/dashboard-content-service.mjs";
import { createPermissionGateway } from "../../extension/runtime/permission-gateway.mjs";
import { requiredUngrantedOrigins } from "../../assets/client/permission-ui-model.mjs";
import zhCN from "../../assets/client/locales/zh-CN.mjs";
import zhHant from "../../assets/client/locales/zh-Hant.mjs";
import en from "../../assets/client/locales/en.mjs";

const locales = { "zh-CN": zhCN, "zh-Hant": zhHant, en };
const nativeTitles = {
  "zh-CN": "科学家公布新的研究成果，更多实验将验证发现",
  "zh-Hant": "科學家公布新的研究成果，更多實驗將驗證發現",
  en: "Scientists publish new findings with further experiments planned",
};
const originalFetch = globalThis.fetch;
try {
  for (const [locale, messages] of Object.entries(locales)) {
    const settings = { ...DEFAULT_SETTINGS, bookmarkConsentGranted: true, uiLocale: locale };
    const model = { bookmarks: [] };
    let grantedOrigins = [];
    let aiReady = false;
    const chrome = { permissions: { getAll: async () => ({ origins: [...grantedOrigins] }) } };
    const gateway = createPermissionGateway({ chrome, getSettings: async () => settings, secretStatus: async () => ({}) });
    const content = createDashboardContentService({
      chrome, publicFeedsForLocale, settingsLocale: value => value.uiLocale,
      aiConfigured: async () => aiReady, originPattern, buildPermissionRows,
    });
    const native = publicFeedsForLocale(locale);
    const expanded = publicFeedsForLocale(locale, { includeAiOnly: true });
    const expectedOrigins = [...new Set(expanded.map(feed => originPattern(feed.url)))].sort();
    const rows = await gateway.selectedOrigins(model, settings);
    assert.deepEqual(rows.map(row => row.origin).sort(), expectedOrigins,
      "first-run authorization must include every actual fetch origin, deduplicated across feeds");
    assert.equal(rows.length, locale === "zh-Hant" ? 16 : 17,
      "feed counts must not be confused with origin counts when publishers share FeedBurner");
    assert(rows.every(row => !row.granted && /^https:\/\/[^/*]+\/\*$/.test(row.origin)));
    const denied = await content.currentFeedPermissionState(settings, model);
    assert.equal(denied.permitted.length, 0, "default sources must not fetch before the user grants website access");
    assert.equal(denied.denied.length, native.length);

    // An existing install keeps its grants; only the newly required origins are requested.
    grantedOrigins = [...new Set([...native.slice(0, 6), ...expanded.slice(native.length)].map(feed => originPattern(feed.url)))];
    const upgradeRows = await gateway.selectedOrigins(model, settings);
    const missing = requiredUngrantedOrigins(upgradeRows);
    assert.deepEqual([...missing].sort(), expectedOrigins.filter(origin => !grantedOrigins.includes(origin)));
    const beforeUpgradeGrant = await content.currentFeedPermissionState(settings, model);
    assert(beforeUpgradeGrant.denied.every(source => missing.includes(originPattern(source.url))));
    grantedOrigins.push(...missing);
    const active = await content.currentFeedPermissionState(settings, model);
    assert.deepEqual(active.permitted.map(source => source.key), native.map(source => source.key),
      "all native sources must be readable with empty bookmarks, no AI consent, and no key");
    assert.equal(active.denied.length, 0);
    assert.deepEqual(selectRefreshBatch(active.permitted).sources, active.permitted,
      "the entire native pack must fit in the initial refresh batch");
    assert(native.length * settings.hotNewsEntriesPerSource <= settings.hotNewsCacheSize,
      "default cache capacity must retain the initial native pack");

    const items = [];
    for (const source of active.permitted) {
      const calls = [];
      globalThis.fetch = async (url) => {
        calls.push(String(url));
        assert.equal(String(url), source.url, "built-in sources must use their canonical feed endpoint directly");
        return new Response(`<rss><channel><item><title>${nativeTitles[locale]}</title>
          <link>https://articles.example/story/${source.id}</link><description>${nativeTitles[locale]}</description>
          <pubDate>${new Date().toUTCString()}</pubDate></item></channel></rss>`, {
          headers: { "content-type": "application/rss+xml" },
        });
      };
      const result = await fetchSourceArticles(source, { validateUrl: async url => {
        assert(grantedOrigins.includes(originPattern(url)), "fetching must use only currently granted origins");
      } });
      assert.equal(calls.length, 1, "first use must not need homepage discovery or a second domain permission");
      assert.equal(result.length, 1);
      assert.equal(result[0].sourceKey, source.key);
      assert.equal(result[0].categoryKey, source.categoryKey);
      assert(messages[`category.${source.categoryKey}`], "every public category must have a native label");
      items.push({ ...result[0], externalDiscovery: true });
    }
    assert.equal(filterPresentableFeedItems(items, locale, { aiConfigured: false }).length, native.length,
      "native content must be presentable without translation or generated summaries");
    const revokedOrigin = originPattern(native.at(-1).url);
    grantedOrigins = grantedOrigins.filter(origin => origin !== revokedOrigin);
    const revoked = await content.currentFeedPermissionState(settings, model);
    assert.equal(filterFeedItemsBySources(items, revoked.permitted, grantedOrigins).length, native.length - 1,
      "revoking a newly added origin must immediately hide its cached content");
    aiReady = true;
    assert.equal((await content.configuredFeedSources(settings, model)).length, expanded.length,
      "cross-language expansion must remain gated on AI readiness");
    assert.deepEqual(await content.configuredFeedSources({ ...settings, bookmarkConsentGranted: false }, model), []);
    assert.deepEqual(await content.configuredFeedSources({ ...settings, publicFeedSupplementEnabled: false }, model), []);
  }
} finally {
  globalThis.fetch = originalFetch;
}

console.log("Public feed startup and permission tests passed.");
