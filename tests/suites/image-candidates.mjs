import assert from "node:assert/strict";
import {
  IMAGE_CANDIDATE_POLICY_VERSION,
  extractMarkupImageCandidates,
  extractPageImageCandidates,
  imageMeetsProfileDimensions,
  normalizeImageCandidates,
} from "../../extension/core/image-candidates.mjs";
import { parseFeedDocument } from "../../extension/core/feed.mjs";
import { extractReaderDocument } from "../../extension/core/reader.mjs";
import {
  articleImageSignature,
  fetchSourceImageCandidates,
  repeatedArticleImageSignatures,
} from "../../extension/core/preview.mjs";
import { createArticleImageReuseFilter } from "../../extension/core/article-image-reuse.mjs";
import { hashText } from "../../extension/core/bookmarks.mjs";
import { isPrivateAddressLiteral } from "../../extension/core/network-policy.mjs";
import { feedImageCacheFresh, selectFeedImageEnrichmentTargets } from "../../extension/runtime/refresh-service.mjs";
import { createFeedImageService } from "../../extension/runtime/feed-image-service.mjs";
import { browserImageMeetsProfileDimensions } from "../../assets/client/card-image-quality.mjs";
import { messageRequestForHttp } from "../../assets/client/message-contract.mjs";

const pageUrl = "https://news.example.com/story";
assert.equal(isPrivateAddressLiteral("127.0.0.1"), true);
assert.equal(isPrivateAddressLiteral("192.168.1.20"), true);
assert.equal(isPrivateAddressLiteral("news.example.com"), false);
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

const balancedArticleCandidates = extractPageImageCandidates(`
  <header><nav><img src="/arrow.png" width="9" height="6" alt="Next arrow"></nav></header>
  <aside class="app-download"><img src="/download-qr.png" width="160" height="160" alt="App QR code"></aside>
  <article><h1>Fixture article</h1><p>${"Substantial article copy. ".repeat(10)}</p>
    <picture><source srcset="/body-640.webp 640w, /body-1280.webp 1280w">
      <img src="/body.jpg" width="800" height="450" alt="The event described in the article">
    </picture>
  </article>
  <footer><img src="/publisher-logo.png" width="600" height="200"></footer>
`, pageUrl, { profile: "article" });
assert.equal(balancedArticleCandidates[0], "https://news.example.com/body-1280.webp",
  "article extraction must ignore early chrome and choose the responsive body image");
assert(!balancedArticleCandidates.some((url) => /arrow|qr|logo/.test(url)));

assert.deepEqual(extractPageImageCandidates(`
  <div class="article-shell">
    <div class="story-content">
      <p>${"Substantial article copy. ".repeat(24)}</p>
      <img src="/body-cover.jpg" width="900" height="500" alt="Article cover">
    </div>
    <div class="utility-panel">
      <div class="code-content"><img src="/opaque-static-asset.png" width="500" height="500"></div>
    </div>
  </div>
`, pageUrl, { profile: "article" }), ["https://news.example.com/body-cover.jpg"],
"a broad article shell must refine to the deeper text container and exclude sibling utility images with opaque URLs");
assert.deepEqual(extractPageImageCandidates(`
  <div class="article-shell">
    <div class="story-content"><p>${"Text-only article copy. ".repeat(24)}</p></div>
    <div class="utility-panel">
      <div class="code-content"><img src="/opaque-static-asset.png" width="500" height="500"></div>
    </div>
  </div>
`, pageUrl, { profile: "article" }), [],
"a text-only article must fall back to favicon instead of a sibling utility image");

assert.deepEqual(extractPageImageCandidates(`
  <article><h1>Text only</h1><p>${"Readable article copy without a picture. ".repeat(10)}</p></article>
`, pageUrl, { profile: "article" }), [], "text-only news must remain image-free");

assert.deepEqual(extractPageImageCandidates(`
  <main><h1>Main fallback</h1><p>${"Main content without an article element. ".repeat(8)}</p>
    <img src="/main-cover.jpg" width="900" height="500" alt="Main report cover">
  </main>
`, pageUrl, { profile: "article" }), ["https://news.example.com/main-cover.jpg"],
"article profile must allow a high-quality main fallback when no article element exists");

const visualLanding = `
  <link rel="preload" as="image" href="/landing-preload.webp">
  <div class="hero-masthead" style="background-image:url('/landing-hero.webp')">
    <h1>${"Design system launch ".repeat(10)}</h1>
  </div>
`;
assert.deepEqual(extractPageImageCandidates(visualLanding, pageUrl, { profile: "visual" }), [
  "https://news.example.com/landing-preload.webp",
  "https://news.example.com/landing-hero.webp",
], "visual profile must retain preload and semantic hero backgrounds on article-less pages");
assert.deepEqual(extractPageImageCandidates(visualLanding, pageUrl, { profile: "article" }), [],
  "article profile must not scan an unrelated landing-page hero");
assert.deepEqual(extractPageImageCandidates(`
  <section class="team">
    <img class="maintainer-photo" src="/maintainer.jpg" width="640" height="640">
  </section>
`, pageUrl, { profile: "visual" }), [],
"Hero semantics must match complete tokens instead of the main substring inside maintainer");
assert.deepEqual(extractPageImageCandidates(`
  <script type="application/ld+json">{
    "@type": "Article",
    "image": { "url": "/article-structured.jpg", "width": 1200, "height": 675 },
    "publisher": {
      "@type": "Organization",
      "image": { "url": "/publisher-brand.jpg", "width": 800, "height": 400 }
    },
    "author": {
      "image": { "url": "/author-portrait.jpg", "width": 800, "height": 800 }
    }
  }</script>
`, pageUrl, { profile: "article" }), ["https://news.example.com/article-structured.jpg"],
"publisher and author image fields must not inherit the enclosing Article image context");
assert.deepEqual(extractPageImageCandidates(`
  <article><p>${"Readable article copy. ".repeat(10)}</p>
    <img class="share-image" src="/share-panel.jpg" width="800" height="400">
  </article>
`, pageUrl, { profile: "article" }), [], "negative semantics on the image node itself must be rejected");
assert.deepEqual(extractPageImageCandidates(`
  <main><article><p>${"Readable article copy. ".repeat(10)}</p>
    <div hidden><img src="/hidden-cover.jpg" width="800" height="500"></div>
    <img aria-hidden="true" src="/decorative-cover.jpg" width="800" height="500">
  </article></main>
`, pageUrl, { profile: "article" }), [],
"hidden containers and aria-hidden image nodes must never become article candidates");

const squareMetadata = `
  <meta property="og:image" content="/fixed-square.jpg">
  <meta property="og:image:width" content="240">
  <meta property="og:image:height" content="240">
`;
assert.deepEqual(extractPageImageCandidates(squareMetadata, pageUrl, { profile: "article" }), [],
  "declared 240 by 240 metadata must fail the article threshold");
assert.deepEqual(extractPageImageCandidates(squareMetadata, pageUrl, { profile: "visual" }), [
  "https://news.example.com/fixed-square.jpg",
], "the same square may remain valid for a visual card");
assert.equal(imageMeetsProfileDimensions(319, 220, "article"), false);
assert.equal(imageMeetsProfileDimensions(640, 120, "article"), true);
assert.equal(browserImageMeetsProfileDimensions({ naturalWidth: 101, naturalHeight: 46 }, "article"), false);
assert.equal(browserImageMeetsProfileDimensions({ naturalWidth: 640, naturalHeight: 360 }, "article"), true);
assert.equal(messageRequestForHttp("GET", `/api/site-preview?url=${encodeURIComponent(pageUrl)}&profile=article`)
  .request.payload.profile, "article");
assert.equal(messageRequestForHttp("GET", `/api/site-preview?url=${encodeURIComponent(pageUrl)}&profile=unknown`)
  .request.payload.profile, "visual", "unknown preview profiles must fail closed to visual");

const repeatedUrl = "https://cdn.example.com/default-cover.jpg?w=1200&quality=80";
const repeatedSignature = articleImageSignature(repeatedUrl);
assert.equal(repeatedSignature, articleImageSignature("https://cdn.example.com/default-cover.jpg?w=640&quality=60"),
  "dimension and quality transforms must normalize to one reuse signature");
const repeatedObservations = Array.from({ length: 8 }, (_, index) => ({
  pageHash: String(index),
  signature: index < 4 ? repeatedSignature : `unique-${index}`,
  seenAt: Date.now(),
}));
assert(repeatedArticleImageSignatures(repeatedObservations).has(repeatedSignature),
  "four appearances across eight recent articles must mark a site default image");
assert(!repeatedArticleImageSignatures(repeatedObservations.slice(0, 7)
  .map((entry, index) => ({ ...entry, signature: index < 3 ? repeatedSignature : `other-${index}` }))).has(repeatedSignature),
"fewer than four appearances must not trigger suppression");
const reuseRegistry = new Map();
const filterArticleImageReuse = createArticleImageReuseFilter({
  hashText,
  getRecord: async (key, fallback) => reuseRegistry.get(key) || fallback,
  setRecord: async (key, value) => reuseRegistry.set(key, value),
  now: () => Date.parse("2026-07-19T00:00:00Z"),
});
for (let index = 0; index < 6; index += 1) {
  await filterArticleImageReuse(`https://ratio.example/story-${index}`, [{
    url: `https://ratio.example/article-${index}.jpg`,
    provenance: "article",
  }]);
}
let ratioCandidates = [];
for (let index = 6; index < 10; index += 1) {
  ratioCandidates = await filterArticleImageReuse(`https://ratio.example/story-${index}`, [{
    url: "https://ratio.example/default.jpg",
    provenance: "metadata",
  }]);
}
assert.equal(ratioCandidates[0]?.url, "https://ratio.example/default.jpg",
  "four repeats across ten distinct articles must remain below the fifty-percent threshold");

const trackingRegistry = new Map();
const filterTrackedArticleReuse = createArticleImageReuseFilter({
  hashText,
  getRecord: async (key, fallback) => trackingRegistry.get(key) || fallback,
  setRecord: async (key, value) => trackingRegistry.set(key, value),
  now: () => Date.parse("2026-07-19T00:00:00Z"),
});
for (const campaign of ["alpha", "beta", "gamma", "delta"]) {
  const candidates = await filterTrackedArticleReuse(
    `https://tracking.example/story?utm_source=${campaign}&fbclid=${campaign}`,
    [{ url: "https://tracking.example/default.jpg", provenance: "metadata" }],
  );
  assert.equal(candidates.length, 1,
    "tracking variants of one article must not accumulate toward the repeated-image threshold");
}

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

const repeatedRssItems = parseFeedDocument(`<rss><channel>${Array.from({ length: 4 }, (_, index) => `
  <item><title>Repeated enclosure ${index}</title><link>https://news.example.com/story/${index}</link>
  <enclosure type="image/jpeg" url="https://cdn.example.com/shared-feed-cover.jpg"/></item>`).join("")}
</channel></rss>`, source.url, source);
assert.equal(repeatedRssItems.filter((item) => item.imageUrl === "https://cdn.example.com/shared-feed-cover.jpg").length, 4,
  "trusted RSS image extraction must not apply page-level default-image suppression");

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
  capability: "feed-image",
  policyVersion: IMAGE_CANDIDATE_POLICY_VERSION,
  profile: "article",
  outcome: "hit",
  requestedUrl: cacheItem.url,
  sourceOrigin: cacheItem.sourceOrigin,
  sourceKey: cacheItem.sourceKey,
  rawImageCandidates: [],
  checkedAt: new Date(now - 23 * 60 * 60 * 1000).toISOString(),
};
assert.equal(feedImageCacheFresh(hitRecord, cacheItem, now), true);
assert.equal(feedImageCacheFresh({ ...hitRecord, rawImageCandidates: undefined }, cacheItem, now), false,
  "article feed-image caches without original candidates must be refreshed");
assert.equal(feedImageCacheFresh({ ...hitRecord, policyVersion: 1 }, cacheItem, now), false,
  "legacy feed-image cache records must not hit the current image policy");
assert.equal(feedImageCacheFresh({ ...hitRecord, checkedAt: new Date(now - 25 * 60 * 60 * 1000).toISOString() }, cacheItem, now), false);
assert.equal(feedImageCacheFresh({ ...hitRecord, outcome: "miss", checkedAt: new Date(now - 3 * 60 * 60 * 1000).toISOString() }, cacheItem, now), false);

const feedReuseRecords = new Map();
const feedImageService = createFeedImageService({
  fetchSourceImageCandidates: async () => [{
    url: "https://feed-reuse.example/default.jpg",
    provenance: "metadata",
    width: 1200,
    height: 630,
  }],
  hasOriginPermission: async () => true,
  mapWithConcurrency: async (values, _limit, operation) => Promise.all(values.map(operation)),
  cacheMutations: {
    isCurrent: () => true,
    run: async (operation) => operation(() => true),
  },
  getRecord: async (key, fallback) => feedReuseRecords.get(key) || fallback,
  setRecord: async (key, value) => feedReuseRecords.set(key, value),
  hashText,
  refreshCoordinator: { isCurrent: () => true },
});
const enrichedItems = [];
for (let index = 0; index < 4; index += 1) {
  const item = {
    url: `https://feed-reuse.example/story-${index}`,
    sourceOrigin: "https://feed-reuse.example",
    sourceKey: "feed-reuse",
    score: 100 - index,
  };
  await feedImageService.enrichMissingFeedImages([item], { cacheEpoch: 1, generation: 1 });
  enrichedItems.push(item);
}
assert.deepEqual(enrichedItems.map((item) => Boolean(item.imageUrl)), [true, true, true, false],
  "Feed page enrichment must apply the same fourth-repeat suppression as site previews");
for (const index of [3, 0]) {
  const cachedItem = {
    url: `https://feed-reuse.example/story-${index}`,
    sourceOrigin: "https://feed-reuse.example",
    sourceKey: "feed-reuse",
    score: 100 - index,
  };
  await feedImageService.enrichMissingFeedImages([cachedItem], { cacheEpoch: 1, generation: 1 });
  assert.equal(cachedItem.imageUrl, undefined,
    "cached Feed candidates must retain the original default-image observation and remain suppressed");
}

console.log("Image candidate tests passed.");
