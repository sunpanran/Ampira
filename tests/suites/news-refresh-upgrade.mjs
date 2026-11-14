import assert from "node:assert/strict";
import { parseFeedDocument } from "../../extension/core/feed.mjs";
import { articleContentFingerprint, articleContentText, CARD_CONTEXT_MAX_CHARS, FEED_CONTENT_MAX_CHARS, feedContentFingerprint } from "../../extension/core/feed-content.mjs";
import { buildDailyCandidates, dailyCandidateFingerprint, rankNewsItems } from "../../extension/core/news-ranking.mjs";
import { createLocalization, cachedLocalization } from "../../extension/core/feed-localization.mjs";
import { filterPresentableFeedItems } from "../../extension/core/feed-language-policy.mjs";
import { createCardSummaryPolicy } from "../../extension/runtime/card-summary-policy.mjs";
import { createFeedContentService, selectFeedContentTargets } from "../../extension/runtime/feed-content-service.mjs";
import { createFeedImageService } from "../../extension/runtime/feed-image-service.mjs";
import { createEpochMutationQueue } from "../../extension/core/mutation-queue.mjs";
import { createAutomaticAiHarness, syntheticArticle } from "../helpers/automatic-ai-harness.mjs";

const source = { key: "fixture", title: "Synthetic source", url: "https://news.example/feed" };
const body = `${"A factual account describes the public service rollout. ".repeat(35)}The final allocation covers twenty regions.`;
const article = (id, extra = {}) => syntheticArticle(id, { title: "Agency announces a public service update", contentLocale: "en", ...extra });
const policy = createCardSummaryPolicy();
const settings = { uiLocale: "en", openaiBaseUrl: "https://ai.example/v1" };
const summary = item => ({ ...item, summaryStatus: "ai", summaryLocale: "en", summaryTitle: "Public service rollout",
  summary: ["The agency is expanding its public service to twenty regions."], summaryProviderOrigin: "https://ai.example",
  summaryFingerprint: articleContentFingerprint(item) });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
async function until(check) {
  for (let i = 0; i < 300; i++) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 5)); }
  throw new Error("Synthetic refresh did not reach the expected state");
}

// Long feed bodies survive independently of the short UI excerpt, with distinct
// publication/update dates and a storage cap. No generated text becomes evidence.
for (const document of [
  `<rss><channel><item><title>Public service update</title><link>https://news.example/story</link><description>Short feed summary.</description><content:encoded><![CDATA[<p>${body}</p>]]></content:encoded><pubDate>2026-11-13T00:00:00Z</pubDate></item></channel></rss>`,
  `<feed><entry><title>Public service update</title><link href="https://news.example/story"/><summary>Short feed summary.</summary><content type="html">&lt;p&gt;${body}&lt;/p&gt;</content><published>2026-11-13T00:00:00Z</published><updated>2026-11-14T00:00:00Z</updated></entry></feed>`,
  JSON.stringify({ version: "https://jsonfeed.org/version/1.1", items: [{ id: "story", url: "https://news.example/story", title: "Public service update", summary: "Short feed summary.", content_html: `<p>${body}</p>`, date_published: "2026-11-13T00:00:00Z", date_modified: "2026-11-14T00:00:00Z" }] }),
]) {
  const [parsed] = parseFeedDocument(document, source.url, source);
  assert.equal(parsed.excerpt, "Short feed summary.");
  assert(parsed.contentText.endsWith("twenty regions."));
  assert(!parsed.contentText.includes("<p>"));
  assert.equal(parsed.publishedAt, "2026-11-13T00:00:00.000Z");
  if (!document.startsWith("<rss>")) assert.equal(parsed.modifiedAt, "2026-11-14T00:00:00.000Z");
  assert(policy.automaticCardSummaryContext(parsed).text.endsWith("twenty regions."));
}
const [bounded] = parseFeedDocument(JSON.stringify({ items: [{ url: "https://news.example/long", content_text: "A".repeat(20000) }] }), source.url, source);
assert.equal(bounded.contentText.length, FEED_CONTENT_MAX_CHARS);
assert.equal(bounded.excerpt.length, 420);
assert.equal(policy.automaticCardSummaryContext(bounded).text.length, CARD_CONTEXT_MAX_CHARS);

const original = article("same", { contentText: body });
const previous = summary(original);
assert.equal(policy.preserveCardAiSummary({ ...original }, previous, settings).summaryTitle, previous.summaryTitle);
const withImage = { ...previous, imageUrl: "https://news.example/resolved.jpg", imageUrls: ["https://news.example/resolved.jpg"], imageSource: "origin" };
assert.equal(policy.preserveCardAiSummary(original, withImage, settings).imageUrl, withImage.imageUrl, "unchanged feed text must not temporarily erase an enriched image");
assert.equal(policy.preserveCardAiSummary({ ...original, contentText: "Changed facts" }, withImage, settings).imageUrl, undefined);
{
  const h = createAutomaticAiHarness({ articles: [original], settings, runtime: { aiConfigured: async () => false, feedImageService: createFeedImageService({}) } });
  h.records.set("feed", { items: [withImage] });
  await h.run(undefined, { organize: false });
  assert.equal(h.records.get("feed").items[0].imageUrl, withImage.imageUrl);
  assert.equal(h.records.get("source-quality").records.fixture.imageCount, 1, "coverage counts must include reused images");
}
for (const patch of [{ title: "Corrected agency update" }, { excerpt: "A corrected description." },
  { contentText: body.replace("twenty regions", "thirty regions") }, { modifiedAt: "2026-11-14T01:00:00Z" }]) {
  const updated = { ...original, ...patch };
  assert.notEqual(policy.preserveCardAiSummary(updated, previous, settings).summaryStatus, "ai");
  assert.equal(policy.isCurrentCardSummary({ ...previous, ...patch }, "en"), false);
  assert.equal(policy.sanitizeCardAiSummaries([{ ...previous, ...patch }], settings, true)[0].summaryTitle, undefined);
}
const localized = { ...original, localization: createLocalization(original, { title: "公共服务扩展", summary: ["新计划覆盖二十个地区，后续将公布具体安排。"] }, "zh-CN", "native", new Date().toISOString()) };
assert(cachedLocalization(localized, "zh-CN"));
assert.equal(cachedLocalization({ ...localized, contentText: `${body} A correction follows.` }, "zh-CN"), null);
const [presented] = filterPresentableFeedItems([localized], "zh-CN", { aiConfigured: true });
assert.equal(articleContentFingerprint(presented), articleContentFingerprint(localized), "presentation must not change the original evidence identity");

// A correction in a corroborating report must invalidate the brief even when the
// representative, publication date, source count and event ID have not changed.
const reports = [article("lead", { excerpt: body.slice(0, 420), publisherHost: "lead.example" }),
  article("related", { publisherHost: "related.example", contentText: body })];
const fingerprint = values => dailyCandidateFingerprint(buildDailyCandidates(rankNewsItems(values)));
assert.equal(fingerprint(reports), fingerprint([...reports].reverse()));
assert.notEqual(fingerprint(reports), fingerprint([reports[0], { ...reports[1], contentText: `${body} Corrected allocation.` }]));

// Reader enrichment is capped, permission-bound, cancellable and isolated from
// providers. A long feed body needs no second network request.
{
  const requests = [], target = article("reader"), denied = article("denied");
  let allowed = true, active = true;
  const service = createFeedContentService({
    hasOriginPermission: async url => allowed && url !== denied.url,
    fetchReader: async (url, options) => {
      requests.push(url);
      await options.validateResponse({ url });
      return { url, blocks: [{ text: body }] };
    }, readerTextFromBlocks: blocks => blocks.map(block => block.text).join("\n"),
  });
  await service.enrichFeedContent([target, denied, article("long", { contentText: body }), article("cross", { url: "https://other.example/story" })], { isCurrent: () => active });
  assert.deepEqual(requests, [target.url]);
  assert.equal(articleContentText(target), body);
  assert.equal(selectFeedContentTargets([target]).length, 0);
  assert.equal(selectFeedContentTargets([{ ...target, modifiedAt: "2026-11-14T01:00:00Z" }]).length, 1);
  const refreshed = policy.preserveCardAiSummary(article("reader", { publishedAt: target.publishedAt }), summary(target), settings);
  assert.equal(refreshed.readerContent.text, body, "unchanged feeds retain usable supplemented evidence and summaries");
  assert.equal(refreshed.summaryStatus, "ai");
  const pool = Array.from({ length: 20 }, (_, i) => article(`cap-${i}`, { sourceKey: `source-${Math.floor(i / 3)}` }));
  const selected = selectFeedContentTargets(pool);
  assert.equal(selected.length, 8);
  assert([...new Set(selected.map(item => item.sourceKey))].every(key => selected.filter(item => item.sourceKey === key).length <= 2));
  const late = article("late"), gate = deferred();
  const racing = createFeedContentService({ hasOriginPermission: async () => allowed,
    fetchReader: async () => { await gate.promise; return { url: late.url, blocks: [{ text: body }] }; },
    readerTextFromBlocks: blocks => blocks[0].text });
  const pending = racing.enrichFeedContent([late], { isCurrent: () => active });
  await new Promise(resolve => setTimeout(resolve, 0));
  allowed = false; active = false; gate.resolve(); await pending;
  assert.equal(late.readerContent, undefined);
}

// End-to-end refresh with a held source and held image response. Pending and
// failing sources keep their cached text; fresh text appears before both gates.
{
  const slow = deferred(), second = deferred(), image = deferred();
  const fast = article("fast", { sourceKey: "fast" }), delayed = article("slow", { sourceKey: "slow" });
  const next = article("second", { sourceKey: "second" }), failed = article("failed", { sourceKey: "failed" });
  let imageStarted = false;
  const h = createAutomaticAiHarness({ articles: [fast, delayed, next, failed], settings, runtime: {
    cacheMutations: createEpochMutationQueue(),
    aiConfigured: async () => false,
    fetchSourceArticles: async source => {
      if (source.key === "failed") throw new Error("Synthetic source unavailable");
      if (source.key === "slow") await slow.promise;
      if (source.key === "second") await second.promise;
      return { outcome: "items", items: [{ ...[fast, delayed, next].find(item => item.sourceKey === source.key) }] };
    },
    feedImageService: { updateImageQualityMetrics() {}, enrichMissingFeedImages: async items => {
      imageStarted = true; await image.promise;
      for (const item of items) { item.imageUrl = "https://news.example/synthetic.jpg"; item.imageUrls = [item.imageUrl]; item.imageSource = "origin"; }
    } },
  } });
  h.records.set("feed", { items: [{ ...delayed, title: "Cached slow source" }, { ...failed, title: "Cached failed source" }] });
  const running = h.run(undefined, { organize: false });
  await until(() => h.records.get("feed")?.items.some(item => item.articleId === fast.articleId));
  assert(h.records.get("feed").items.some(item => item.title === "Cached slow source"));
  assert.equal(imageStarted, false);
  assert.equal(h.records.has("refresh-source-cursor"), false, "an unfinished refresh must not advance its rotating cursor");
  second.resolve();
  await until(() => h.records.get("feed").items.some(item => item.articleId === next.articleId));
  assert(h.records.get("feed").items.some(item => item.title === "Cached slow source"), "the partial batch flushes while the final source remains held");
  slow.resolve(); await until(() => imageStarted);
  assert(h.records.get("feed").items.some(item => item.articleId === delayed.articleId && item.title === delayed.title));
  assert(h.records.get("feed").items.some(item => item.title === "Cached failed source"));
  const latest = h.records.get("feed");
  latest.items = latest.items.map(item => item.articleId === fast.articleId ? summary(item) : item);
  h.records.set("feed", latest);
  image.resolve(); await running;
  const final = h.records.get("feed").items.find(item => item.articleId === fast.articleId);
  assert.equal(final.imageUrl, "https://news.example/synthetic.jpg");
  assert.equal(final.summaryTitle, "Public service rollout", "late images must preserve a newer summary");
  assert.equal(h.requests.length, 0);
  assert.equal(h.records.get("source-quality").records.failed.status, "error");
}

// Native AI receives the retained body and recomputes only changed articles.
{
  let reads = 0;
  const h = createAutomaticAiHarness({ articles: [article("supplemented")], settings,
    providerResponse: () => "Title: Public service rollout\nThe service reaches twenty regions, with implementation details supplied by the agency.",
    runtime: { cacheMutations: createEpochMutationQueue(), hasOriginPermission: async () => true,
      fetchReader: async (url, options) => { reads++; await options.validateResponse({ url }); return { url, blocks: [{ text: body }] }; },
      readerTextFromBlocks: blocks => blocks[0].text,
    } });
  await h.run(undefined, { organize: false });
  assert.equal(h.requests.length, 0, "supplementing cached evidence never invokes AI by itself");
  assert.equal(h.records.get("feed").items[0].readerContent.text, body);
  assert.equal(h.records.get("feed").items[0].excerpt, h.control.articles[0].excerpt);
  await h.service.organizeNews(); await h.service.waitForOrganization();
  assert(h.requests[0].input.includes("twenty regions."));
  await h.run(undefined, { organize: false });
  await h.service.organizeNews(); await h.service.waitForOrganization();
  assert.equal(reads, 1, "unchanged short feeds reuse their permission-bound body cache");
  assert.equal(h.requests.length, 1, "reused bodies do not invalidate a current summary");
}
{
  const h = createAutomaticAiHarness({ articles: [article("details", { contentText: body })], settings,
    providerResponse: request => request.kind === "card" ? "Title: Public service rollout\nThe service now reaches twenty regions, with implementation details supplied by the agency." : undefined });
  await h.run(undefined, { organize: false });
  await h.service.organizeNews(); await h.service.waitForOrganization();
  assert(h.requests.at(-1).input.includes("twenty regions."));
  await h.run(undefined, { organize: false });
  await h.service.organizeNews(); await h.service.waitForOrganization();
  assert.equal(h.requests.length, 1);
  h.control.articles[0].contentText = body.replace("twenty regions", "thirty regions");
  await h.run(undefined, { organize: false });
  assert.notEqual(h.records.get("feed").items[0].summaryStatus, "ai");
  await h.service.organizeNews(); await h.service.waitForOrganization();
  assert.equal(h.requests.length, 2);
  assert(h.requests.at(-1).input.includes("thirty regions."));
}

// Late results after generation invalidation or permission revocation cannot
// repopulate the feed. Conditional responses keep supplemental evidence intact.
for (const invalidation of ["generation", "permission"]) {
  const gate = deferred(), entry = article(`cancel-${invalidation}`);
  let requested = false;
  const h = createAutomaticAiHarness({ articles: [entry], settings, runtime: {
    aiConfigured: async () => false,
    fetchSourceArticles: async () => { requested = true; await gate.promise; return { outcome: "items", items: [entry] }; },
  } });
  const pending = h.run(undefined, { organize: false });
  await until(() => requested);
  if (invalidation === "generation") h.control.active = false;
  else h.control.permitted = false;
  gate.resolve(); await pending;
  assert.equal((h.records.get("feed")?.items || []).length, 0);
}
{
  const gate = deferred(), entry = article("late-image");
  let started = false;
  const h = createAutomaticAiHarness({ articles: [entry], settings, runtime: {
    aiConfigured: async () => false,
    feedImageService: { updateImageQualityMetrics() {}, enrichMissingFeedImages: async items => {
      started = true; await gate.promise; items[0].imageUrl = "https://news.example/stale.jpg";
    } },
  } });
  const pending = h.run(undefined, { organize: false });
  await until(() => started);
  h.control.active = false; gate.resolve(); await pending;
  assert.equal(h.records.get("feed").items[0].imageUrl, undefined);
}
{
  const entry = article("conditional");
  entry.readerContent = { fingerprint: feedContentFingerprint(entry), text: body, checkedAt: new Date().toISOString() };
  const h = createAutomaticAiHarness({ articles: [entry], settings, runtime: {
    aiConfigured: async () => false, fetchSourceArticles: async () => ({ outcome: "notModified", items: [] }),
  } });
  h.records.set("feed", { items: [summary(entry)] });
  await h.run(undefined, { organize: false });
  assert.equal(h.records.get("feed").items[0].readerContent.text, body);
  assert.equal(h.records.get("feed").items[0].summaryTitle, "Public service rollout");
}

console.log("News refresh content, invalidation and incremental delivery tests passed");
