import assert from "node:assert/strict";
import { extractReaderDocument, fetchReaderHtml, loadReaderWithCache, readerTextFromBlocks } from "../extension/core/reader.mjs";

const richHtml = `<!doctype html>
<html>
  <head>
    <title>Fallback title</title>
    <meta property="og:title" content="A structured story">
    <meta property="og:site_name" content="Fixture News">
    <meta name="author" content="Ada Reporter">
    <meta property="article:published_time" content="2026-07-10T08:00:00Z">
    <meta property="og:image" content="/images/hero.jpg">
    <link rel="canonical" href="/stories/structured">
    <script>globalThis.readerScriptExecuted = true</script>
  </head>
  <body>
    <nav>Navigation item Navigation item Navigation item Navigation item</nav>
    <main>
      <article class="story-content">
        <h1>A structured story</h1>
        <p>Opening paragraph with a <a href="/stories/next">same-site link</a> and an <a href="javascript:alert(1)" onclick="alert(1)">unsafe link</a>.</p>
        <h2>Details</h2>
        <p>This is the second paragraph with enough meaningful public article text to select the article body instead of surrounding navigation.</p>
        <ul><li><p>First list item</p></li><li>Second list item</li></ul>
        <blockquote>A useful quotation.</blockquote>
        <pre>const safe = true;</pre>
        <figure>
          <picture><source srcset="/images/small.jpg 480w, /images/large.jpg 1280w"><img data-src="/images/lazy.jpg" alt="Article image"></picture>
          <figcaption>Article image caption</figcaption>
        </figure>
        <iframe src="https://www.youtube.com/embed/fixture" title="Fixture video"></iframe>
      </article>
    </main>
    <footer>Footer subscription and related links</footer>
  </body>
</html>`;

const article = extractReaderDocument(richHtml, "https://news.example.com/source?id=1", "https://news.example.com/feed-link");
assert.equal(article.schemaVersion, 2);
assert.equal(article.title, "A structured story");
assert.equal(article.siteName, "Fixture News");
assert.equal(article.byline, "Ada Reporter");
assert.equal(article.publishedAt, "2026-07-10T08:00:00.000Z");
assert.equal(article.canonicalUrl, "https://news.example.com/stories/structured");
const crossOriginCanonical = extractReaderDocument(
  richHtml.replace('href="/stories/structured"', 'href="https://attacker.example/poison"'),
  "https://news.example.com/source?id=1",
);
assert.equal(crossOriginCanonical.canonicalUrl, "https://news.example.com/source?id=1", "cross-origin canonical URLs must not become Reader cache identities");
assert(article.blocks.some((block) => block.type === "heading"));
assert(article.blocks.some((block) => block.type === "list" && block.items.length === 2));
assert(article.blocks.some((block) => block.type === "quote"));
assert(article.blocks.some((block) => block.type === "code"));
assert(article.blocks.some((block) => block.type === "image" && block.url === "https://news.example.com/images/hero.jpg"));
assert(article.blocks.some((block) => block.type === "image" && block.url === "https://news.example.com/images/large.jpg"));
assert(article.blocks.some((block) => block.type === "video" && block.externalUrl === "https://news.example.com/source?id=1"));
const articleText = readerTextFromBlocks(article.blocks);
assert(articleText.includes("Opening paragraph"));
assert(!articleText.includes("Navigation item"));
assert(!articleText.includes("Footer subscription"));
assert(!articleText.includes("readerScriptExecuted"));
const hrefs = article.blocks.flatMap((block) => block.runs || []).map((run) => run.href).filter(Boolean);
assert(hrefs.includes("https://news.example.com/stories/next"));
assert(!hrefs.some((href) => href.startsWith("javascript:")));

const malformed = extractReaderDocument(
  `<html><body><div class="content"><h1>Broken but readable</h1><p>Malformed public article content remains readable even when closing tags are missing and entities such as &amp; are present.<p>Another sufficiently long paragraph keeps extraction useful.</div>`,
  "https://example.com/broken",
);
assert(readerTextFromBlocks(malformed.blocks).includes("entities such as & are present"));

const oversizedText = "字".repeat(121000);
const truncated = extractReaderDocument(`<html><body><article><h1>Long article</h1><p>${oversizedText}</p></article></body></html>`, "https://example.com/long");
assert.equal(truncated.truncated, true);
assert(readerTextFromBlocks(truncated.blocks).length <= 120000);

let storedReader = null;
const liveReader = { ...article, source: "live" };
const loadedLive = await loadReaderWithCache(article.requestedUrl, {
  readCache: async () => null,
  storeCache: async (value) => { storedReader = value; },
  fetchDocument: async () => liveReader,
});
assert.equal(loadedLive, liveReader);
assert.equal(storedReader, liveReader);
const notFound = Object.assign(new Error("not found"), { code: "READER_NOT_FOUND" });
const loadedCache = await loadReaderWithCache(article.requestedUrl, {
  readCache: async () => storedReader,
  storeCache: async () => assert.fail("cache fallback must not overwrite the last successful reader"),
  fetchDocument: async () => { throw notFound; },
});
assert.equal(loadedCache.source, "cache");
assert.equal(loadedCache.staleCode, "READER_NOT_FOUND");
assert.equal(loadedCache.fetchedAt, article.fetchedAt);
await assert.rejects(loadReaderWithCache("https://example.com/no-cache", {
  readCache: async () => null,
  fetchDocument: async () => { throw notFound; },
}), (error) => error === notFound);

const permissionRequired = Object.assign(new Error("permission required"), { code: "ORIGIN_PERMISSION_REQUIRED" });
await assert.rejects(loadReaderWithCache(article.requestedUrl, {
  readCache: async () => storedReader,
  fetchDocument: async () => { throw permissionRequired; },
}), (error) => error === permissionRequired, "a revoked redirect permission must never fall back to cached content");

await assert.rejects(loadReaderWithCache(article.requestedUrl, {
  readCache: async () => storedReader,
  validateCache: async () => false,
  fetchDocument: async () => { throw notFound; },
}), (error) => error === notFound, "a cache entry that fails current permission validation must be ignored");

const cacheWriteFailureReader = await loadReaderWithCache(article.requestedUrl, {
  readCache: async () => null,
  storeCache: async () => { throw new Error("cache unavailable"); },
  fetchDocument: async () => liveReader,
});
assert.equal(cacheWriteFailureReader, liveReader, "a cache write failure must not discard a live Reader result");

const originalFetch = globalThis.fetch;
try {
  globalThis.fetch = async () => new Response("missing", { status: 404, headers: { "content-type": "text/html" } });
  await assert.rejects(fetchReaderHtml("https://example.com/missing"), (error) => error.code === "READER_NOT_FOUND" && error.messageKey === "reader.error.notFoundBody" && error.details.status === 404);

  globalThis.fetch = async () => new Response("forbidden", { status: 403, headers: { "content-type": "text/html" } });
  await assert.rejects(fetchReaderHtml("https://example.com/private"), (error) => error.code === "READER_ACCESS_DENIED");

  globalThis.fetch = async () => new Response("%PDF", { status: 200, headers: { "content-type": "application/pdf" } });
  await assert.rejects(fetchReaderHtml("https://example.com/file.pdf"), (error) => error.code === "READER_UNSUPPORTED_CONTENT");

  globalThis.fetch = async () => new Response("<html></html>", { status: 200, headers: { "content-type": "text/html", "content-length": String(4 * 1024 * 1024 + 1) } });
  await assert.rejects(fetchReaderHtml("https://example.com/large"), (error) => error.code === "READER_RESPONSE_TOO_LARGE");

  globalThis.fetch = async () => new Response(new Uint8Array(4 * 1024 * 1024 + 1), { status: 200, headers: { "content-type": "text/html" } });
  await assert.rejects(fetchReaderHtml("https://example.com/streamed-large"), (error) => error.code === "READER_RESPONSE_TOO_LARGE" && error.messageKey === "reader.error.tooLargeBody");

  globalThis.fetch = async (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true });
  });
  await assert.rejects(fetchReaderHtml("https://example.com/slow", 5), (error) => error.code === "READER_TIMEOUT" && error.messageKey === "reader.error.timeoutBody" && error.retryable === true);

  globalThis.fetch = async () => { throw new TypeError("network down"); };
  await assert.rejects(fetchReaderHtml("https://example.com/offline"), (error) => error.code === "READER_NETWORK_ERROR" && error.retryable === true);
} finally {
  globalThis.fetch = originalFetch;
}

console.log("reader tests passed");
