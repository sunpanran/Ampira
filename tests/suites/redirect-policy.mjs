import assert from "node:assert/strict";
import { fetchSourceArticles, parseFeedDocument } from "../../extension/core/feed.mjs";
import { fetchReaderHtml } from "../../extension/core/reader.mjs";

const rss = "<rss><channel><item><title>Policy fixture</title><link>https://article.example/item</link></item></channel></rss>";
const secureItem = parseFeedDocument(rss, "https://feed.example/rss.xml", {
  title: "Secure source",
  url: "https://User:Secret@Feed.Example:443/path",
})[0];
assert.equal(secureItem.sourceOrigin, "https://feed.example", "source origins must be normalized without credentials or default ports");

const localItem = parseFeedDocument(rss, "http://127.0.0.1:8787/rss.xml", {
  title: "Local source",
  url: "http://127.0.0.1:8787/path",
})[0];
assert.equal(localItem.sourceOrigin, "http://127.0.0.1:8787", "local HTTP source origins must retain their explicit port");

const insecureItem = parseFeedDocument(rss, "https://feed.example/rss.xml", {
  title: "Insecure source",
  url: "http://insecure.example/path",
})[0];
assert.equal(insecureItem.sourceOrigin, "", "non-local HTTP origins must not be persisted as approved source origins");

const invalidItem = parseFeedDocument(rss, "https://feed.example/rss.xml", {
  title: "Invalid source",
  url: "not a URL",
})[0];
assert.equal(invalidItem.sourceOrigin, "", "invalid source origins must be stored as an empty string");

const originalFetch = globalThis.fetch;
try {
  let feedRequest;
  globalThis.fetch = async (url, options) => {
    feedRequest = { url: String(url), options };
    return new Response(JSON.stringify({
      version: "https://jsonfeed.org/version/1.1",
      items: [{ id: "one", url: "https://article.example/one", title: "Feed item", date_published: "2026-07-13T00:00:00Z" }],
    }), { status: 200, headers: { "content-type": "application/feed+json" } });
  };
  const articles = await fetchSourceArticles({
    title: "Feed policy",
    url: "https://feed-policy.example/feed.json",
  });
  assert.equal(articles.length, 1);
  assert.equal(feedRequest.options.redirect, "error", "Feed requests must reject redirects");
  assert.equal(feedRequest.options.credentials, "omit", "Feed requests must omit browser credentials");
  assert.equal(feedRequest.options.referrerPolicy, "no-referrer", "Feed requests must not disclose a referrer");

  let readerRequest;
  globalThis.fetch = async (url, options) => {
    readerRequest = { url: String(url), options };
    return new Response("<html><body><main>Reader fixture</main></body></html>", {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  };
  await fetchReaderHtml("https://reader-policy.example/article");
  assert.equal(readerRequest.options.redirect, "error", "Reader requests must reject redirects");
  assert.equal(readerRequest.options.credentials, "omit", "Reader requests must omit browser credentials");
  assert.equal(readerRequest.options.referrerPolicy, "no-referrer", "Reader requests must not disclose a referrer");
} finally {
  globalThis.fetch = originalFetch;
}

console.log("Redirect and source-origin policy tests passed.");
