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
import { buildDailyEventCandidates } from "../../extension/core/daily-events.mjs";

const HOUR_MS = 60 * 60 * 1000;

export async function runTodayEventTests() {
  const now = new Date(2026, 6, 14, 14, 0, 0).getTime();
  await testBoundedSourceOverscan(now);
  testRefreshSelectionAndRetention(now);
  testEventClusteringAndConfidence(now);
  testDailyEventSelectionAndDigest(now);
  testEventTimeValidation(now);
  testSharedSelectionLimits(now);
  testEventPriorityAndDeduplication(now);
  testVisibleFeedEventCandidates(now);
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

function testEventTimeValidation(now) {
  const event = digestItem("valid", new Date(now - HOUR_MS).toISOString(), 2, "corroborated", 80);
  const invalid = [
    { ...event, id: "stale", eventId: "stale", publishedAt: new Date(now - 25 * HOUR_MS).toISOString(), timeScope: "today" },
    { ...event, id: "future", eventId: "future", publishedAt: new Date(now + HOUR_MS).toISOString(), timeScope: "today" },
    { ...event, id: "missing", eventId: "missing", publishedAt: "", timeScope: "recent" },
    { ...event, id: "invalid", eventId: "invalid", publishedAt: "invalid", timeScope: "today" },
    { ...event, id: "unverified", eventId: "unverified", timeUnverified: true, timeScope: "today" },
    { ...event, id: "ineligible", eventId: "ineligible", rankingEligible: false },
    { ...event, id: "nonrepresentative", eventId: "nonrepresentative", eventRepresentative: false },
  ];
  assert.deepEqual(selectDailyEvents([...invalid, event], { now, limit: 10 }).map((item) => item.id), ["valid"],
    "cached time labels and ranking metadata must not restore expired, future or unverifiable events");
  const midnight = new Date(2026, 6, 15, 0, 10).getTime();
  const yesterday = { ...event, publishedAt: new Date(midnight - HOUR_MS).toISOString(), timeScope: "today" };
  assert.equal(selectDailyEvents([yesterday], { now: new Date(midnight) })[0].resolvedTimeScope, "recent");
  assert.equal(selectDailyEvents([yesterday], { now: midnight + 24 * HOUR_MS }).length, 0,
    "an event must expire even if a dashboard snapshot still calls it today's news");
  assert.equal(selectDailyEvents([event], { now: new Date(now).toISOString() }).length, 1);
  assert.deepEqual(selectDailyEvents([event], { now, limit: 0 }), []);
}

function testSharedSelectionLimits(now) {
  const today = new Date(now - HOUR_MS).toISOString();
  const recent = new Date(now - 18 * HOUR_MS).toISOString();
  const readableRecent = digestItem("readable-recent", recent, 2, "corroborated", 80);
  const pendingRecent = { ...digestItem("pending-recent", recent, 3, "corroborated", 90), localizationPending: true };
  const readableSingle = digestItem("readable-single", today, 1, "high-confidence-single", 90);
  const pendingSingle = { ...digestItem("pending-single", today, 1, "high-confidence-single", 99), localizationPending: true };
  const pendingToday = { ...digestItem("pending-today", today, 2, "corroborated", 85), localizationPending: true };
  const selected = selectDailyEvents([pendingSingle, pendingRecent, readableSingle, readableRecent, pendingToday], { now, limit: 8 });
  assert.deepEqual(selected.map((item) => item.id), ["readable-recent", "readable-single", "pending-today"],
    "readable and untranslated groups must share one recent slot and one single-source slot");
  assert.equal(selectDailyEvents([readableRecent, pendingRecent], { now, recentLimit: 0 }).length, 0);
  const duplicate = { ...pendingToday, id: "translated-copy", localizationPending: false, importanceScore: 40 };
  assert.deepEqual(selectDailyEvents([pendingToday, duplicate], { now }).map((item) => item.id), ["translated-copy"],
    "the same event must not be selected twice across language groups");
  const expiredSingle = { ...readableSingle, publishedAt: new Date(now - 13 * HOUR_MS).toISOString() };
  assert.equal(selectDailyEvents([expiredSingle], { now }).length, 0);
}

function testEventPriorityAndDeduplication(now) {
  const publishedAt = new Date(now - HOUR_MS).toISOString();
  const important = digestItem("important", publishedAt, 2, "corroborated", 95);
  const repeated = digestItem("repeated", publishedAt, 8, "corroborated", 50);
  const lowerDuplicate = { ...important, id: "weaker-copy", importanceScore: 30 };
  assert.deepEqual(selectDailyEvents([lowerDuplicate, repeated, important], { now }).map((item) => item.id), ["important", "repeated"],
    "importance must outrank raw coverage volume, and input order must not hide the strongest duplicate");
  const tied = [digestItem("b", publishedAt, 2, "corroborated", 80), digestItem("a", publishedAt, 2, "corroborated", 80)];
  assert.deepEqual(selectDailyEvents(tied, { now }), selectDailyEvents([...tied].reverse(), { now }), "ties must not flicker with Feed ordering");
  const recent = digestItem("recent", new Date(now - 18 * HOUR_MS).toISOString(), 9, "corroborated", 100);
  assert.equal(selectDailyEvents([recent, important], { now, limit: 1 })[0].id, "important");
}

function testVisibleFeedEventCandidates(now) {
  const ordinary = Array.from({ length: 12 }, (_, index) => article(now, {
    articleId: `ordinary-${index}`, title: `普通单源资讯 ${index}`, eventId: `ordinary-${index}`,
    eventConfidence: "single-source", rankingEligible: true, publicImportanceScore: 100,
  }));
  const reports = ["a", "b"].map((suffix, index) => article(now - HOUR_MS, {
    articleId: `report-${suffix}`, publisherHost: `${suffix}.example`, eventId: "important-event",
    eventRepresentative: index === 0, rankingEligible: true, eventSourceCount: 9,
    eventConfidence: "corroborated", publicImportanceScore: 80,
  }));
  const digestOnly = digestItem("digest-only", reports[0].publishedAt, 5, "corroborated", 100);
  const digest = [digestOnly, { ...digestItem("report-a", reports[0].publishedAt, 9, "corroborated", 92),
    url: reports[0].url, title: "整理后的精炼事件标题" }];
  const pool = buildDailyEventCandidates([...ordinary, ...reports], digest, now);
  const selected = selectDailyEvents(pool, { now });
  assert.deepEqual(selected.map((item) => item.id), ["report-a"], "events outside a twelve-item brief shortlist must remain discoverable");
  assert.equal(selected[0].title, "整理后的精炼事件标题", "matching native digest titles must remain available");
  assert.equal(selected[0].importanceScore, 92);
  assert.equal(selected[0].sourceCount, 2, "source counts must describe current distinct publishers, not old cluster totals");
  assert.deepEqual(buildDailyEventCandidates([], digest, now), [], "a retained digest cannot restore inaccessible Feed events");
  assert.equal(buildDailyEventCandidates(reports, [{ ...digest[1], publishedAt: new Date(now - 2 * HOUR_MS).toISOString() }], now)[0].title,
    reports[0].title, "stale per-article metadata must not replace the current title");

  const extra = [
    { ...reports[1], articleId: "duplicate-url", publisherHost: "fake.example" },
    { ...reports[0], articleId: "same-publisher", url: "https://www.a.example/another", publisherHost: "www.a.example" },
    { ...reports[0], articleId: "stale", url: "https://old.example/old", publisherHost: "old.example", publishedAt: new Date(now - 25 * HOUR_MS).toISOString() },
    { ...reports[0], articleId: "unverified", url: "https://unknown.example/news", publisherHost: "unknown.example", timeUnverified: true },
    { ...reports[0], articleId: "ineligible", url: "https://promo.example/news", publisherHost: "promo.example", rankingEligible: false },
  ];
  const counted = buildDailyEventCandidates([...reports, ...extra], [], now)[0];
  assert.equal(counted.sourceCount, 2, "duplicate URLs, publisher aliases and invalid evidence must not inflate corroboration");
  assert.equal(counted.articleCount, 3);
  assert.equal(selectDailyEvents(buildDailyEventCandidates(reports.slice(1), digest, now), { now }).length, 0,
    "a removed publisher must not leave a stale multi-source event behind");
  const withoutRepresentative = [reports[1], { ...reports[0], articleId: "replacement", eventRepresentative: false }];
  assert.equal(selectDailyEvents(buildDailyEventCandidates(withoutRepresentative, [], now), { now }).length, 1,
    "remaining independent evidence can supply a new representative after the old one disappears");
  const oldRepresentative = { ...reports[0], publishedAt: new Date(now - 18 * HOUR_MS).toISOString() };
  assert.equal(buildDailyEventCandidates([oldRepresentative, reports[1]], [], now)[0].id, "report-b",
    "today's report must represent an event with an older cached headline");
  assert.deepEqual(reports.map((item) => item.eventSourceCount), [9, 9], "candidate building must not mutate cached Feed records");
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
