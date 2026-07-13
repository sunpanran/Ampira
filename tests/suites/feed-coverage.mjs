import assert from "node:assert/strict";
import { fetchSourceArticles, parseFeedDocument } from "../../extension/core/feed.mjs";
import { decodeResponseBuffer } from "../../extension/core/network.mjs";
import { filterFeedItemsBySources } from "../../extension/core/permission-state.mjs";
import { sourceStatusForFetch } from "../../extension/runtime/refresh-service.mjs";
import { summarizeQuality, updateSourceQualityRecord } from "../../extension/runtime/runtime-utils.mjs";

const source = { key: "source-one", title: "Fixture", url: "https://source.example/" };
const atom = `<feed><entry xml:base="https://articles.example/base/"><title>Alternate article</title><link rel="self" href="https://source.example/feed.xml"/><link type="text/html" href="story" rel="alternate"/><summary>Readable Atom summary</summary><updated>2026-07-13T00:00:00Z</updated></entry></feed>`;
assert.equal(parseFeedDocument(atom, "https://source.example/feed.xml", source)[0].url, "https://articles.example/base/story", "Atom parsing must prefer the alternate HTML link and honor entry xml:base");

const rss = `<rss><channel><item><title>CDATA link</title><link><![CDATA[https://articles.example/story/one?id=1&amp;page=2]]></link><description>Readable RSS summary</description><pubDate>Mon, 13 Jul 2026 00:00:00 GMT</pubDate><enclosure url="https://images.example/cover.jpg" length="42" type="image/jpeg"/></item></channel></rss>`;
const rssItem = parseFeedDocument(rss, "https://source.example/rss.xml", source)[0];
assert.equal(rssItem.url, "https://articles.example/story/one?id=1&page=2", "RSS links wrapped in CDATA must remain usable");
assert.equal(rssItem.imageUrl, "https://images.example/cover.jpg", "image enclosures must be attribute-order independent");

const latin1 = Uint8Array.from([...Buffer.from('<?xml version="1.0" encoding="iso-8859-1"?><rss><title>Caf', "ascii"), 0xe9, ...Buffer.from("</title></rss>", "ascii")]);
assert(decodeResponseBuffer(latin1.buffer, "application/xml").includes("Café"), "XML declarations must supply a fallback charset when the HTTP header omits one");

const originalFetch = globalThis.fetch;
try {
  let calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (String(url) === "https://declared.example/") {
      return new Response('<html><head><link href="/?feed=rss2" rel="alternate"></head></html>', { headers: { "content-type": "text/html" } });
    }
    return new Response(rss, { headers: { "content-type": "application/rss+xml", etag: '"fixture"' } });
  };
  const declared = await fetchSourceArticles({ ...source, url: "https://declared.example/" });
  assert.equal(declared.method, "declared-feed");
  assert.equal(declared.length, 1);
  assert.deepEqual(calls, ["https://declared.example/", "https://declared.example/?feed=rss2"], "feed-looking alternate links without a MIME type must still be discovered");

  calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (String(url) === "https://anchor-feed.example/homepage.html") {
      return new Response(`
        <html><head><script type="application/ld+json">{
          "@context":"https://schema.org",
          "@type":"Article",
          "headline":"Example publication",
          "mainEntityOfPage":"https://anchor-feed.example/homepage.html",
          "datePublished":"2009-10-22T10:46:58Z",
          "description":"Publication homepage"
        }</script></head><body>
          <a href="/RSS-Feed-All-Articles.1206643.0.html">RSS</a>
          <main><article><h2>First story</h2></article><article><h2>Second story</h2></article><article><h2>Third story</h2></article></main>
        </body></html>
      `, { headers: { "content-type": "text/html" } });
    }
    if (String(url) === "https://anchor-feed.example/RSS-Feed-All-Articles.1206643.0.html") {
      return new Response(rss, { headers: { "content-type": "application/rss+xml" } });
    }
    return new Response("", { status: 404 });
  };
  const anchorFeed = await fetchSourceArticles({ ...source, url: "https://anchor-feed.example/homepage.html" });
  assert.equal(anchorFeed.method, "declared-feed", "feed-looking page links must win over a self-declared homepage Article");
  assert.equal(anchorFeed.at(0)?.title, "CDATA link");
  assert.deepEqual(calls, [
    "https://anchor-feed.example/homepage.html",
    "https://anchor-feed.example/RSS-Feed-All-Articles.1206643.0.html",
  ]);

  calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (String(url) === "https://collection.example/homepage.html") {
      return new Response(`
        <html><head>
          <meta property="og:type" content="article">
          <meta property="og:title" content="Example publication">
          <meta name="description" content="Publication homepage">
          <script type="application/ld+json">{
            "@context":"https://schema.org",
            "@type":"Article",
            "headline":"Example publication",
            "mainEntityOfPage":"https://collection.example/homepage.html",
            "datePublished":"2009-10-22T10:46:58Z",
            "description":"Publication homepage"
          }</script>
        </head><body><main>
          <article><h2>First story</h2></article>
          <article><h2>Second story</h2></article>
          <article><h2>Third story</h2></article>
        </main></body></html>
      `, { headers: { "content-type": "text/html" } });
    }
    return new Response("", { status: 404 });
  };
  const collection = await fetchSourceArticles({ ...source, url: "https://collection.example/homepage.html" });
  assert.equal(collection.length, 0, "a semantic article collection must reject self-referential Article metadata");
  assert.equal(collection.outcome, "empty");

  globalThis.fetch = async () => new Response(`
    <html><head><script type="application/ld+json">{
      "@context":"https://schema.org",
      "@type":"Article",
      "headline":"A direct article remains readable",
      "mainEntityOfPage":"https://direct-jsonld.example/story.html",
      "datePublished":"2026-07-13T00:00:00Z",
      "description":"A complete direct article summary"
    }</script></head><body><main><article><h1>A direct article remains readable</h1><p>Article body.</p></article></main></body></html>
  `, { headers: { "content-type": "text/html" } });
  const directJsonLd = await fetchSourceArticles({ ...source, url: "https://direct-jsonld.example/story.html" });
  assert.equal(directJsonLd.method, "json-ld");
  assert.equal(directJsonLd.at(0)?.title, "A direct article remains readable", "a directly saved article must not be mistaken for a collection page");

  calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (String(url) === "https://probe.example/") return new Response("<html><body>No declared feed</body></html>", { headers: { "content-type": "text/html" } });
    if (String(url) === "https://probe.example/feed/") return new Response(rss, { headers: { "content-type": "application/rss+xml" } });
    return new Response("", { status: 404 });
  };
  const probed = await fetchSourceArticles({ ...source, url: "https://probe.example/" });
  assert.equal(probed.method, "probed-feed");
  assert.deepEqual(calls, ["https://probe.example/", "https://probe.example/feed/"]);

  calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (String(url) === "https://semantic.example/") {
      return new Response('<main><a href="/news/meaningful-headline">Meaningful headline without a date or excerpt</a></main>', { headers: { "content-type": "text/html" } });
    }
    return new Response("", { status: 404 });
  };
  const semanticOnly = await fetchSourceArticles({ ...source, url: "https://semantic.example/" });
  assert.equal(semanticOnly.length, 1, "detail-style semantic links must remain discoverable for downstream handling");
  assert.equal(semanticOnly.displayableItemCount, 0, "title-only semantic links must not produce a false healthy source result");
  assert.equal(sourceStatusForFetch(semanticOnly, semanticOnly.displayableItemCount), "empty");

  calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (String(url) === "https://pending.example/") {
      return new Response('<html><head><link rel="alternate" type="application/rss+xml" href="https://feeds.example/rss.xml"></head></html>', { headers: { "content-type": "text/html" } });
    }
    return new Response('{"version":"https://jsonfeed.org/version/1.1","items":[]}', { headers: { "content-type": "application/feed+json" } });
  };
  const permissionError = (url) => Object.assign(new Error("permission"), {
    code: "ORIGIN_PERMISSION_REQUIRED",
    details: { url },
  });
  const pending = await fetchSourceArticles({ ...source, url: "https://pending.example/" }, {
    validateUrl: async (url) => {
      if (new URL(url).origin === "https://feeds.example") throw permissionError(url);
    },
  });
assert.equal(pending.pendingFeed?.origin, "https://feeds.example");
assert(!calls.includes("https://feeds.example/rss.xml"), "cross-origin Feed discovery must not contact the origin before user authorization");
assert(calls.length <= 5, "balanced discovery must make at most four same-origin probes after the landing page");
assert.equal(sourceStatusForFetch(pending, 0), "permissionRequired", "pending cross-origin Feed discovery must surface as an authorization state");

  let requestHeaders;
  globalThis.fetch = async (url, options) => {
    requestHeaders = options.headers;
    return new Response(null, { status: 304, headers: { etag: '"fixture"' } });
  };
  const unchanged = await fetchSourceArticles(source, {
    profile: { resolvedUrl: "https://source.example/feed.xml", validators: { etag: '"fixture"' } },
  });
  assert.equal(unchanged.outcome, "notModified");
  assert.equal(requestHeaders["if-none-match"], '"fixture"');

  globalThis.fetch = async () => new Response(`<rss><channel><item><title>Solidot query article remains readable</title><link>https://www.solidot.org/story?sid=84815</link><description>Article paths identified by a query ID must not be mistaken for a section landing page.</description><pubDate>Mon, 13 Jul 2026 10:07:39 GMT</pubDate></item></channel></rss>`, {
    headers: { "content-type": "application/rss+xml" },
  });
  const solidot = await fetchSourceArticles({ key: "public-solidot", title: "Solidot", url: "https://www.solidot.org/index.rss" });
  assert.equal(solidot.length, 1, "single-segment story paths with an article ID query must remain displayable");
  assert.equal(solidot[0].url, "https://www.solidot.org/story?sid=84815");
} finally {
  globalThis.fetch = originalFetch;
}

const healthyRecord = updateSourceQualityRecord({}, {
  sourceKey: "source-one",
  sourceOrigin: "https://source.example",
  status: "healthy",
  itemCount: 3,
});
const sources = [source, { key: "source-two", title: "Denied", url: "https://denied.example/" }];
const summary = summarizeQuality({ "source-one": healthyRecord }, [sources[1]], sources);
assert.equal(summary.configured, 2);
assert.equal(summary.coveragePercent, 50);
assert.equal(summary.authorizedSuccessPercent, 100);
assert.equal(summary.permissionRequired, 1);

const pendingRecord = updateSourceQualityRecord({}, {
  sourceKey: source.key,
  sourceOrigin: "https://source.example",
  status: "empty",
  pendingFeed: { url: "https://feeds.example/rss.xml", origin: "https://feeds.example" },
});
const pendingSummary = summarizeQuality({ [source.key]: pendingRecord }, [], [source]);
assert.equal(pendingSummary.authorized, 0, "a discovered cross-origin Feed must remain outside fully authorized coverage");
assert.equal(pendingSummary.checked, 0, "authorization-gated Feed candidates must not lower the post-authorization success rate");
assert.equal(pendingSummary.authorizedSuccessPercent, null);
assert.equal(pendingSummary.permissionRequired, 1);

const crossOriginItem = {
  sourceKey: source.key,
  sourceOrigin: "https://source.example",
  fetchOrigin: "https://feeds.example",
};
assert.deepEqual(filterFeedItemsBySources([crossOriginItem], [source]), [], "cross-origin Feed items must fail closed without current fetch-origin permission");
assert.equal(filterFeedItemsBySources([crossOriginItem], [source], ["https://feeds.example/*"]).length, 1);

console.log("Feed coverage tests passed.");
