import assert from "node:assert/strict";
import { buildFallbackDigest, fetchSourceArticles } from "../../extension/core/feed.mjs";
import {
  buildDailyCandidates, dailyCandidateFingerprint, rankNewsItems,
} from "../../extension/core/news-ranking.mjs";
import { selectRefreshBatch } from "../../extension/core/refresh.mjs";
import {
  selectDistinctEventEvidence, shouldRetainPreviousItemsAfterEmpty, sourceFetchProfile,
} from "../../extension/runtime/refresh-service.mjs";
import { selectDailyEvents } from "../../assets/client/dashboard-selectors.mjs";

const HOUR_MS = 60 * 60 * 1000;

export async function runTodayEventTests() {
  const now = new Date(2026, 6, 14, 14, 0, 0).getTime();
  await testBoundedSourceOverscan(now);
  testRefreshSelectionAndRetention(now);
  testEventClusteringAndConfidence(now);
  testDailyEventSelectionAndDigest(now);
  console.log("today event tests passed");
}

async function testBoundedSourceOverscan(now) {
  const originalFetch = globalThis.fetch;
  try {
    const items = Array.from({ length: 60 }, (_, index) => ({
      id: `item-${index}`,
      url: `https://overscan.example/news/${index}`,
      title: `Routine source update number ${index}`,
      summary: `A readable source summary with enough context for candidate ${index}.`,
      date_published: new Date(now - (index % 8) * HOUR_MS).toISOString(),
    }));
    items[0] = { ...items[0], url: "https://overscan.example/privacy", title: "Privacy Policy" };
    items[1] = { ...items[1], title: "Sponsored: limited partner offer" };
    items[47] = {
      ...items[47],
      title: "Earthquake triggers emergency response across several cities",
      summary: "Transit services stopped while emergency agencies issued evacuation and safety instructions.",
      date_published: new Date(now - HOUR_MS).toISOString(),
    };
    items[48] = {
      ...items[48],
      title: "War escalation forces a nationwide emergency response",
      summary: "The later unscanned fixture must stay outside the bounded source scan.",
      date_published: new Date(now).toISOString(),
    };
    globalThis.fetch = async () => new Response(JSON.stringify({
      version: "https://jsonfeed.org/version/1.1",
      items,
    }), { status: 200, headers: { "content-type": "application/feed+json" } });
    const result = await fetchSourceArticles({
      key: "overscan",
      title: "Overscan",
      url: "https://overscan.example/feed.json",
    }, { limit: 12, now });
    assert.equal(result.length, 12, "source selection must still honor the configured output limit");
    assert(result.some((item) => item.feedPosition === 47), "important candidates later in the bounded scan must remain eligible");
    assert(!result.some((item) => item.feedPosition === 48), "source scanning must stop at the 48-entry safety cap");
    assert(!result.some((item) => /privacy|sponsored/i.test(item.title)), "invalid leading entries must be filtered before applying the source limit");
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function testRefreshSelectionAndRetention(now) {
  const localSources = Array.from({ length: 81 }, (_, index) => ({ key: `local-${index + 1}` }));
  const publicSources = Array.from({ length: 4 }, (_, index) => ({ key: `public-${index + 1}`, externalDiscovery: true }));
  const firstBatch = selectRefreshBatch([...localSources, ...publicSources], 0, 80, {
    priority: (source) => source.externalDiscovery === true,
  });
  assert.deepEqual(firstBatch.sources.slice(0, 4).map((source) => source.key), publicSources.map((source) => source.key));
  assert.equal(firstBatch.sources.length, 80);
  assert.equal(firstBatch.nextCursor, 76, "bookmark rotation must advance only through non-priority sources");
  const secondBatch = selectRefreshBatch([...localSources, ...publicSources], firstBatch.nextCursor, 80, {
    priority: (source) => source.externalDiscovery === true,
  });
  assert.deepEqual(secondBatch.sources.slice(0, 4).map((source) => source.key), publicSources.map((source) => source.key));
  assert(secondBatch.sources.some((source) => source.key === "local-81"), "the next batch must reach sources beyond the first safety-capped group");

  const cachedItems = [{ publishedAt: new Date(now - HOUR_MS).toISOString(), timeUnverified: false }];
  const emptyResult = { outcome: "empty" };
  assert.equal(shouldRetainPreviousItemsAfterEmpty(emptyResult, cachedItems, { recentOutcomes: [] }, now), true);
  assert.equal(shouldRetainPreviousItemsAfterEmpty(emptyResult, cachedItems, { recentOutcomes: ["empty"] }, now), true);
  assert.equal(shouldRetainPreviousItemsAfterEmpty(emptyResult, cachedItems, { recentOutcomes: ["empty", "empty"] }, now), false, "the third consecutive empty response must clear the cache");
  assert.equal(shouldRetainPreviousItemsAfterEmpty(emptyResult, [{ ...cachedItems[0], publishedAt: new Date(now - 25 * HOUR_MS).toISOString() }], { recentOutcomes: [] }, now), false, "stale cached items must not receive the empty-response grace period");
  assert.deepEqual(sourceFetchProfile({ resolvedUrl: "https://source.example/feed", validators: { etag: "cached", lastModified: "date" } }, []), {
    resolvedUrl: "https://source.example/feed",
    validators: { etag: "", lastModified: "" },
  }, "conditional validators must be removed when there are no cached items to reuse");
}

function testEventClusteringAndConfidence(now) {
  const reordered = rankNewsItems([
    article(now, { articleId: "cn-a", publisherHost: "a.example", title: "监管机构 7 月 14 日宣布新的数据安全法规" }),
    article(now, { articleId: "cn-b", publisherHost: "b.example", title: "新的数据安全法规由监管机构正式公布" }),
  ], { now });
  assert.equal(new Set(reordered.map((item) => item.eventId)).size, 1, "calendar numbers must not split Chinese paraphrases");
  assert.equal(reordered.find((item) => item.eventRepresentative)?.eventConfidence, "corroborated");

  const english = rankNewsItems([
    article(now, { articleId: "en-a", publisherHost: "en-a.example", title: "Regulator approves data security law" }),
    article(now, { articleId: "en-b", publisherHost: "en-b.example", title: "The data security law is approved by the regulator" }),
  ], { now });
  assert.equal(new Set(english.map((item) => item.eventId)).size, 1, "English function words must not prevent equivalent titles from clustering");

  const quantityConflict = rankNewsItems([
    article(now, { articleId: "death-3", publisherHost: "death-a.example", title: "事故造成 3 人死亡并启动调查" }),
    article(now, { articleId: "death-4", publisherHost: "death-b.example", title: "事故造成 4 人死亡并启动调查" }),
  ], { now });
  assert.equal(new Set(quantityConflict.map((item) => item.eventId)).size, 2, "conflicting quantities in the same semantic context must stay separate");

  const modelConflict = rankNewsItems([
    article(now, { articleId: "phone-17", publisherHost: "phone-a.example", title: "Company launches iPhone 17 with a redesigned camera" }),
    article(now, { articleId: "phone-18", publisherHost: "phone-b.example", title: "Company launches iPhone 18 with a redesigned camera" }),
  ], { now });
  assert.equal(new Set(modelConflict.map((item) => item.eventId)).size, 2, "conflicting product models must stay separate");

  const outsideWindow = rankNewsItems([
    article(now, { articleId: "window-a", publisherHost: "window-a.example", title: "Regulator approves a major data security law" }),
    article(now - 37 * HOUR_MS, { articleId: "window-b", publisherHost: "window-b.example", title: "Regulator approves a major data security law" }),
  ], { now });
  assert.equal(new Set(outsideWindow.map((item) => item.eventId)).size, 2, "an event cluster must not span more than 36 hours");

  const highSingle = rankNewsItems([article(now, {
    articleId: "single-high",
    publisherHost: "trusted.example",
    title: "台风登陆，多地公共交通中断并启动应急响应",
    excerpt: "多个城市暂停公共交通，相关部门发布避险通知并开放应急安置点。",
  })], { now })[0];
  assert.equal(highSingle.eventConfidence, "high-confidence-single");
  const lowDetailSingle = rankNewsItems([article(now, {
    articleId: "single-low-detail",
    publisherHost: "trusted.example",
    title: "台风登陆，多地公共交通中断并启动应急响应",
    excerpt: "详情稍后公布。",
  })], { now })[0];
  assert.equal(lowDetailSingle.eventConfidence, "single-source", "short evidence must not qualify a single-source fallback");
  const staleSingle = rankNewsItems([article(now - 13 * HOUR_MS, {
    articleId: "single-stale",
    publisherHost: "trusted.example",
    title: "台风登陆，多地公共交通中断并启动应急响应",
    excerpt: "多个城市暂停公共交通，相关部门发布避险通知并开放应急安置点。",
  })], { now })[0];
  assert.equal(staleSingle.eventConfidence, "single-source", "single-source confidence must expire after twelve hours");
  const uncertainSingle = rankNewsItems([article(now, {
    articleId: "single-uncertain",
    publisherHost: "trusted.example",
    title: "传闻台风登陆，多地公共交通或将中断",
    excerpt: "多个城市正在评估公共交通调整，相关部门尚未发布正式避险通知。",
  })], { now })[0];
  assert.equal(uncertainSingle.eventConfidence, "single-source", "uncertain wording must block high-confidence single-source status");
  const unverifiedSingle = rankNewsItems([article(now, {
    articleId: "single-unverified",
    publisherHost: "trusted.example",
    title: "台风登陆，多地公共交通中断并启动应急响应",
    excerpt: "多个城市暂停公共交通，相关部门发布避险通知并开放应急安置点。",
    publishedAt: "",
    timeUnverified: true,
  })], { now })[0];
  assert.equal(unverifiedSingle.eventConfidence, "single-source", "unverified publication times must block high-confidence single-source status");
}

function testDailyEventSelectionAndDigest(now) {
  const today = new Date(now - HOUR_MS).toISOString();
  const recent = new Date(now - 18 * HOUR_MS).toISOString();
  const multiToday = digestItem("multi-today", today, 3, "corroborated", 82);
  const multiRecent = digestItem("multi-recent", recent, 4, "corroborated", 95);
  const highSingle = digestItem("single-high", today, 1, "high-confidence-single", 99);
  const secondSingle = digestItem("single-second", today, 1, "high-confidence-single", 98);
  assert.deepEqual(
    selectDailyEvents([highSingle, multiRecent, multiToday, secondSingle], { now, limit: 3, recentLimit: 1, minSourceCount: 2 }).map((item) => item.id),
    ["multi-today", "multi-recent", "single-high"],
    "all corroborated events must precede at most one high-confidence single-source fallback",
  );
  const fullMulti = [
    multiToday,
    digestItem("multi-today-2", today, 2, "corroborated", 80),
    multiRecent,
    highSingle,
  ];
  assert.equal(selectDailyEvents(fullMulti, { now, limit: 3, recentLimit: 1, minSourceCount: 2 }).some((item) => item.id === "single-high"), false, "single-source events must not displace corroborated events");

  const ranked = rankNewsItems([article(now, {
    articleId: "digest-single",
    publisherHost: "digest.example",
    title: "台风登陆，多地公共交通中断并启动应急响应",
    excerpt: "多个城市暂停公共交通，相关部门发布避险通知并开放应急安置点。",
  })], { now });
  const candidates = buildDailyCandidates(ranked, { now, limit: 12, recentLimit: 3 });
  const digest = buildFallbackDigest(candidates, "local", "zh-CN", { now, preselected: true });
  assert.equal(digest.schemaVersion, 6);
  assert.equal(digest.rankingPolicyVersion, 4);
  assert.equal(digest.items[0].eventConfidence, "high-confidence-single");
  assert.notEqual(
    dailyCandidateFingerprint(candidates),
    dailyCandidateFingerprint(candidates.map((item) => ({ ...item, eventConfidence: "single-source" }))),
    "event confidence changes must invalidate the daily digest fingerprint",
  );

  assert.deepEqual(selectDistinctEventEvidence([
    { articleId: "a", publisherHost: "same.example" },
    { articleId: "b", publisherHost: "same.example" },
    { articleId: "c", publisherHost: "other.example" },
    { articleId: "d", publisherHost: "third.example" },
  ]).map((item) => item.articleId), ["a", "c", "d"], "digest evidence must use distinct publishers");
}

function article(publishedAt, overrides = {}) {
  return {
    articleId: overrides.articleId || "article",
    entryKey: overrides.articleId || "article",
    title: overrides.title || "监管机构宣布新的数据安全法规",
    excerpt: overrides.excerpt ?? "监管机构公布执行时间、适用范围和具体合规要求，多家机构将按新规调整流程。",
    publishedAt: new Date(publishedAt).toISOString(),
    timeUnverified: false,
    publisher: overrides.publisher || overrides.publisherHost || "Publisher",
    publisherHost: overrides.publisherHost || "publisher.example",
    source: overrides.publisher || "Publisher",
    host: overrides.publisherHost || "publisher.example",
    url: `https://${overrides.publisherHost || "publisher.example"}/${overrides.articleId || "article"}`,
    feedPosition: 0,
    ...overrides,
  };
}

function digestItem(id, publishedAt, sourceCount, eventConfidence, importanceScore) {
  return {
    id,
    eventId: id,
    title: id,
    url: `https://digest.example/${id}`,
    publisher: `Publisher ${id}`,
    publishedAt,
    sourceCount,
    eventConfidence,
    importanceScore,
    localImportanceScore: importanceScore,
  };
}
