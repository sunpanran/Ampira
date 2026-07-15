import assert from "node:assert/strict";
import { buildBookmarkModel, inspirationPreviewSourceUrls, inspirationPreviewTargets, originsFromUrls } from "../../extension/core/bookmarks.mjs";
import {
  NEWS_RANKING_POLICY_VERSION,
  feedCacheOrEmpty, filterLikelyNewsItems, isDisplayableFeedItem, parseFeedDocument, rankAndDedupe,
} from "../../extension/core/feed.mjs";
import { bravePreviewCacheKeys, previewCacheKeysOutsideTargets } from "../../extension/core/preview-cache.mjs";
import { faviconUrl, isReaderUrl, normalizeUrl as normalizeClientUrl } from "../../assets/client/urls.mjs";

export function runBookmarkFeedPolicyTests() {
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
assert.deepEqual(model.folderOptions, [
  { name: "资讯", count: 2 },
  { name: "审美", count: 1 },
], "folder options must include recursive bookmark counts");
const publicOnlyModel = buildBookmarkModel(fixtureTree, {
  newsBookmarkFolder: "资讯",
  newsSourceMode: "public",
  inspirationBookmarkFolder: "审美",
  newsEntriesPerCategory: 12,
});
assert.equal(publicOnlyModel.bookmarks.filter((item) => item.cardType === "news").length, 0, "public Feed mode must not read news bookmarks");
assert.equal(publicOnlyModel.bookmarks.filter((item) => item.cardType === "inspiration").length, 1, "public Feed mode must preserve the selected inspiration folder");
assert.deepEqual(publicOnlyModel.availableNewsFolders, [], "public Feed mode must not expose bookmark folders as active news sources");
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
assert.equal(limitedModel.folderOptions.find((item) => item.name === "资讯")?.count, 2, "folder counts must include nested bookmarks and ignore display limits");

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
const duplicatePublicItem = { ...rssItems[0], source: "Public duplicate", externalDiscovery: true };
const duplicateBookmarkItem = { ...rssItems[0], source: "Bookmark duplicate", externalDiscovery: false };
const locallyPreferred = rankAndDedupe([duplicatePublicItem, duplicateBookmarkItem]);
assert.equal(locallyPreferred.length, 1, "the same normalized article URL must only appear once");
assert.equal(locallyPreferred[0].source, "Bookmark duplicate", "bookmark sources must win URL collisions even when a public source finishes first");
assert.equal(locallyPreferred[0].externalDiscovery, false, "the retained duplicate must preserve bookmark-source identity");
const importanceFixture = parseFeedDocument(
  `<rss><channel>
    <item><title>限时优惠：桌面配件购买指南</title><link>https://example.com/deals/desk</link><description>热门配件推荐与优惠券汇总</description><pubDate>Sun, 12 Jul 2026 10:00:00 GMT</pubDate></item>
    <item><title>台风登陆，多地启动防汛应急响应</title><link>https://example.com/news/storm</link><description>公共交通中断，相关部门发布避险通知</description><pubDate>Sun, 12 Jul 2026 10:00:00 GMT</pubDate></item>
  </channel></rss>`,
  "https://example.com/feed.xml",
  source,
  5,
  "application/rss+xml",
);
const importanceRanked = rankAndDedupe(importanceFixture);
assert.equal(importanceRanked[0].url, "https://example.com/news/storm", "impact signals must outrank a source-leading promotional guide");
assert(importanceRanked[0].scoreBreakdown.impact > 0, "importance scores must expose their impact contribution");
assert(importanceRanked[1].scoreBreakdown.penalties > 0, "soft or commercial content must expose its ranking penalty");
const legacyImportanceRanked = rankAndDedupe([{ ...importanceFixture[0], score: 99, scorePolicyVersion: 1 }]);
assert.equal(legacyImportanceRanked[0].scorePolicyVersion, NEWS_RANKING_POLICY_VERSION, "legacy cached scores must be recalculated under the current policy");
assert.notEqual(legacyImportanceRanked[0].score, 99, "legacy feed-position scores must not survive policy migration");
const publisherFixture = parseFeedDocument(
  `<rss><channel><item><title>Publisher metadata remains inert</title><link>https://news.google.com/articles/one</link><source url="https://publisher.example/">Publisher Example</source><description>Readable reporting context for publisher identity.</description><pubDate>Sun, 12 Jul 2026 10:00:00 GMT</pubDate></item></channel></rss>`,
  "https://news.google.com/rss",
  { ...source, url: "https://news.google.com/rss" },
  5,
  "application/rss+xml",
);
assert.equal(publisherFixture[0].publisher, "Publisher Example");
assert.equal(publisherFixture[0].publisherHost, "publisher.example", "aggregated feeds must use the entry publisher for diversity without changing fetch permission identity");
assert.equal(publisherFixture[0].sourceOrigin, "https://news.google.com");
const locallyFilteredItems = filterLikelyNewsItems([
  { articleId: "privacy", title: "Privacy Policy", source: "Example", url: "https://example.com/privacy" },
  { articleId: "promotion", title: "【广告】限时推广", source: "Example", url: "https://example.com/news/promotion" },
  { articleId: "login", title: "Account access", source: "Example", url: "https://example.com/login" },
  { articleId: "root-home", title: "Latest reporting from around the world", source: "Example", url: "https://example.com/?utm_source=rss" },
  { articleId: "index-home", title: "Example front page", source: "Example", url: "https://example.com/index.html?ref=feed" },
  { articleId: "news-landing", title: "All current news", source: "Example", url: "https://example.com/news?from=rss" },
  { articleId: "blog-landing", title: "Company writing", source: "Example", url: "https://example.com/blog/" },
  { articleId: "sparse-news", title: "真实但没有摘要和日期的新闻", source: "Example", url: "https://example.com/updates/alpha", timeUnverified: true },
  { articleId: "nested-news", title: "A specific article remains eligible", source: "Example", url: "https://example.com/news/specific-story" },
]);
assert.deepEqual(locallyFilteredItems.map((item) => item.articleId), ["nested-news"], "local filtering must reject utility, promotional, root-homepage, section-landing, and unreadable undated entries without requiring AI");
assert.equal(isDisplayableFeedItem({ timeUnverified: true, excerpt: "", summary: [] }), false, "an undated item without readable content must stay hidden");
assert.equal(isDisplayableFeedItem({ timeUnverified: true, excerpt: "Readable excerpt", summary: [] }), true, "an undated item with a readable excerpt may remain visible");
assert.equal(isDisplayableFeedItem({ timeUnverified: false, excerpt: "", summary: [] }), true, "a dated article may remain visible even when its feed has no excerpt");
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
const legacyFeed = { schemaVersion: 2, items: [{ articleId: "legacy-article", title: "Legacy article" }] };
assert.deepEqual(feedCacheOrEmpty(legacyFeed).items, [], "schema 2 Feed caches must be discarded instead of migrating raw content");
const cachedEmptyFeed = { schemaVersion: 3, items: [] };
assert.equal(feedCacheOrEmpty(cachedEmptyFeed), cachedEmptyFeed, "an empty schema 3 Feed cache must remain authoritative");
const cachedFeed = { schemaVersion: 3, items: [{ articleId: "real-article", title: "Real article" }] };
assert.equal(feedCacheOrEmpty(cachedFeed), cachedFeed, "current cached news must remain available");
assert.equal(isReaderUrl("http://127.0.0.1:3000/article"), true);

}
