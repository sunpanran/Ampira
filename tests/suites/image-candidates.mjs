import assert from "node:assert/strict";
import {
  extractMarkupImageCandidates,
  extractPageImageCandidates,
  normalizeImageCandidates,
} from "../../extension/core/image-candidates.mjs";
import { parseFeedDocument } from "../../extension/core/feed.mjs";
import { extractReaderDocument } from "../../extension/core/reader.mjs";
import { fetchSourceImageCandidates } from "../../extension/core/preview.mjs";
import { feedImageCacheFresh, selectFeedImageEnrichmentTargets } from "../../extension/runtime/refresh-service.mjs";

const pageUrl = "https://news.example.com/story";
const pageCandidates = extractPageImageCandidates(`
  <meta name="twitter:image" content="/twitter.jpg">
  <meta content="/hero.jpg" property="og:image">
  <script type="application/ld+json">{
    "@type": "Article",
    "image": { "@type": "ImageObject", "contentUrl": "/structured.jpg" },
    "publisher": { "logo": "/publisher-logo.jpg" }
  }</script>
  <main><picture><source type="image/webp" srcset="/body-640.webp 640w, /body-1600.webp 1600w"><img src="/placeholder.gif" alt="Featured story visual"></picture></main>
`, pageUrl);
assert.deepEqual(pageCandidates, [
  "https://news.example.com/hero.jpg",
  "https://news.example.com/twitter.jpg",
  "https://news.example.com/structured.jpg",
], "page metadata must remain deterministic and must not select publisher logos");

assert.deepEqual(extractPageImageCandidates(`
  <meta property="og:image" content="https://127.0.0.1/private.jpg">
  <link href="/safe.jpg" rel="image_src">
`, pageUrl), ["https://news.example.com/safe.jpg"], "unsafe metadata must fall through to the next safe source");

assert.equal(extractMarkupImageCandidates(`
  &lt;picture&gt;&lt;source type=&quot;image/webp&quot; srcset=&quot;/small.webp 480w, /large.webp 1400w&quot;&gt;
  &lt;img data-src=&quot;/lazy.jpg&quot; src=&quot;/placeholder.gif&quot; alt=&quot;Story image&quot;&gt;&lt;/picture&gt;
`, pageUrl)[0], "https://news.example.com/large.webp", "escaped embedded markup must prefer the largest responsive source");
assert.deepEqual(extractMarkupImageCandidates('<div class="article-hero" style="background-image:url(\'/cover.avif\')"></div>', pageUrl), [
  "https://news.example.com/cover.avif",
], "semantic inline hero backgrounds must remain discoverable without external CSS");
assert.deepEqual(normalizeImageCandidates(["/logo.svg", "/cover.webp", "javascript:alert(1)"], pageUrl), [
  "https://news.example.com/cover.webp",
], "quality and protocol filters must reject logos and unsafe URLs");

const source = { key: "fixture", title: "Fixture", url: "https://news.example.com/feed.xml" };
const mediaFeed = `<rss><channel><item>
  <title>Media filtering</title><link>https://news.example.com/story/media</link><description>Readable story summary.</description>
  <media:content url="https://cdn.example.com/video.mp4" type="video/mp4"/>
  <media:thumbnail height="360" url="https://cdn.example.com/thumb.jpg" width="640"/>
  <enclosure type="image/jpeg" url="https://cdn.example.com/cover.jpg"/>
</item></channel></rss>`;
const mediaItem = parseFeedDocument(mediaFeed, source.url, source)[0];
assert.equal(mediaItem.imageUrl, "https://cdn.example.com/cover.jpg", "image enclosures must outrank thumbnails while video media is ignored");
assert.deepEqual(mediaItem.imageUrls, ["https://cdn.example.com/cover.jpg", "https://cdn.example.com/thumb.jpg"]);

const embeddedFeed = `<rss><channel><item>
  <title>Encoded image</title><link>https://news.example.com/story/encoded</link>
  <content:encoded>&lt;img data-src=&quot;/encoded-cover.webp&quot; src=&quot;/placeholder.gif&quot; alt=&quot;Article cover&quot;&gt;</content:encoded>
</item></channel></rss>`;
assert.equal(parseFeedDocument(embeddedFeed, source.url, source)[0].imageUrl, "https://news.example.com/encoded-cover.webp");

const jsonItem = parseFeedDocument(JSON.stringify({
  version: "https://jsonfeed.org/version/1.1",
  items: [{
    id: "json",
    url: "https://news.example.com/story/json",
    title: "JSON image",
    content_html: '<picture><source srcset="/json-640.webp 640w, /json-1280.webp 1280w"></picture>',
  }],
}), "https://news.example.com/feed.json", source, 5, "application/feed+json")[0];
assert.equal(jsonItem.imageUrl, "https://news.example.com/json-1280.webp");

const reader = extractReaderDocument(`
  <html><head><meta property="og:title" content="Reader candidates"><meta property="og:image" content="/reader-hero.jpg"></head>
  <body><article><h1>Reader candidates</h1><p>${"Readable article paragraph. ".repeat(8)}</p>
  <picture><source data-srcset="/reader-small.webp 480w, /reader-large.webp 1400w"><img data-original-src="/reader-lazy.jpg" src="/placeholder.gif" alt="Reader body image"></picture>
  </article></body></html>
`, pageUrl);
assert.equal(reader.imageStrategyVersion, 2);
assert(reader.blocks.some((block) => block.type === "image" && block.imageUrls?.includes("https://news.example.com/reader-large.webp")));

const originalFetch = globalThis.fetch;
try {
  globalThis.fetch = async () => new Response(`
    <meta property="og:image" content="/first.jpg">
    <meta name="twitter:image" content="/second.jpg">
  `, { headers: { "content-type": "text/html" } });
  assert.deepEqual(await fetchSourceImageCandidates(pageUrl), [
    "https://news.example.com/first.jpg",
    "https://news.example.com/second.jpg",
  ]);
} finally {
  globalThis.fetch = originalFetch;
}

const targets = selectFeedImageEnrichmentTargets([
  { url: "https://a.example/one", sourceOrigin: "https://a.example", sourceKey: "a", score: 90 },
  { url: "https://a.example/two", sourceOrigin: "https://a.example", sourceKey: "a", score: 80 },
  { url: "https://a.example/three", sourceOrigin: "https://a.example", sourceKey: "a", score: 70 },
  { url: "https://external.example/four", sourceOrigin: "https://b.example", sourceKey: "b", score: 100 },
  { url: "https://c.example/five", sourceOrigin: "https://c.example", sourceKey: "c", score: 60, imageUrl: "https://cdn.example/existing.jpg" },
]);
assert.deepEqual(targets.map((item) => item.url), ["https://a.example/one", "https://a.example/two"], "enrichment must stay same-origin, missing-only, ranked, and capped per source");

const now = Date.parse("2026-07-13T12:00:00Z");
const cacheItem = { url: "https://a.example/one", sourceOrigin: "https://a.example", sourceKey: "a" };
const hitRecord = {
  strategyVersion: 1,
  capability: "feed-image",
  outcome: "hit",
  requestedUrl: cacheItem.url,
  sourceOrigin: cacheItem.sourceOrigin,
  sourceKey: cacheItem.sourceKey,
  checkedAt: new Date(now - 23 * 60 * 60 * 1000).toISOString(),
};
assert.equal(feedImageCacheFresh(hitRecord, cacheItem, now), true);
assert.equal(feedImageCacheFresh({ ...hitRecord, checkedAt: new Date(now - 25 * 60 * 60 * 1000).toISOString() }, cacheItem, now), false);
assert.equal(feedImageCacheFresh({ ...hitRecord, outcome: "miss", checkedAt: new Date(now - 3 * 60 * 60 * 1000).toISOString() }, cacheItem, now), false);

console.log("Image candidate tests passed.");
