import assert from "node:assert/strict";
import { annotateTodayNewsGroups, rankNewsItems, scoreNewsArticle } from "../../extension/core/news-ranking.mjs";
import { filterPresentableFeedItems } from "../../extension/core/feed-language-policy.mjs";
import { createLocalization } from "../../extension/core/feed-localization.mjs";
import { selectTodayNewsItems } from "../../assets/client/dashboard-selectors.mjs";
import { createDashboardContentService } from "../../extension/runtime/dashboard-content-service.mjs";
import { buildPermissionRows, filterFeedItemsBySources, originPattern } from "../../extension/core/permission-state.mjs";

const HOUR_MS = 60 * 60 * 1000;
const now = new Date(2026, 10, 13, 10, 0, 0).getTime();

export async function runTodayNewsTests() {
  testVisibleHeadlines();
  testLocalizedHeadlines();
  testDifferentFacts();
  testEventStateConflicts();
  testEnglishScoringBoundaries();
  testRepresentativeSelection();
  testUrlsAndConnectedIdentities();
  testPaginationAndTime();
  await testDashboardProjection();
  console.log("today news tests passed");
}

function article(id, title, overrides = {}) {
  return {
    articleId: id, eventId: `event-${id}`, title,
    url: `https://${id}.example/story`, publisherHost: `${id}.example`,
    publishedAt: new Date(now - HOUR_MS).toISOString(),
    rankingEligible: true, eventRepresentative: true, score: 50,
    ...overrides,
  };
}

function select(items, options = {}) {
  return selectTodayNewsItems(annotateTodayNewsGroups(items, { now }), {
    now, compare: (left, right) => right.score - left.score, ...options,
  });
}

function testVisibleHeadlines() {
  const reports = [
    article("first", "监管机构公布新的数据安全法规", { score: 50 }),
    article("second", "新的数据安全法规由监管机构正式公布", { score: 80 }),
    article("third", "监管机构公布新的数据安全法规！｜合成日报"),
    article("other", "轨道望远镜拍摄到遥远星系的清晰图像"),
  ];
  const before = structuredClone(reports);
  const annotated = annotateTodayNewsGroups(reports, { now });
  assert.deepEqual(reports, before, "deduplication must not mutate cached source records");
  assert.equal(annotated.length, reports.length, "other news surfaces and Reader retain every report");
  assert.deepEqual(annotated.map(item => item.eventId), reports.map(item => item.eventId), "existing event evidence must remain intact");
  assert.equal(new Set(annotated.slice(0, 3).map(item => item.todayNewsId)).size, 1);
  assert.deepEqual(select(reports).map(item => item.articleId), ["second", "other"], "choose the strongest report before filling the Today pool");
  const wrapped = annotated.map(feedItem => ({ key: feedItem.articleId, feedItem, score: feedItem.score }));
  const selected = selectTodayNewsItems(wrapped, { now, compare: (a, b) => b.score - a.score });
  assert.deepEqual(selected.map(item => item.key), ["second", "other"], "dashboard wrappers must use the same duplicate groups");
  assert.equal(selected[0], wrapped[1], "selection preserves the original card and its action identity");
  assert.equal(select([
    article("english-a", "Regulator approves a major data security law"),
    article("english-b", "The major data security law is approved by the regulator"),
  ]).length, 1);
  assert.equal(select([
    article("traditional-a", "監管機構公布新的資料安全法規"),
    article("traditional-b", "新的資料安全法規由監管機構正式公布"),
  ]).length, 1);
}

function testLocalizedHeadlines() {
  const english = article("english", "Regulator approves a major data security law");
  const localization = createLocalization(english, {
    title: "监管机构公布新的数据安全法规",
    summary: ["新法规明确数据处理范围和适用条件，相关机构将按规定公布后续执行安排。"],
  }, "zh-CN", "bot", new Date(now).toISOString());
  const visible = filterPresentableFeedItems([
    { ...english, localization },
    article("chinese", "新的数据安全法规由监管机构正式公布", { score: 90 }),
  ], "zh-CN");
  assert.equal(visible[0].localizedByAi, true);
  assert.equal(select(visible).length, 1, "native and translated reports must deduplicate after language projection");
  assert.equal(select(visible)[0].articleId, "chinese");
}

function testDifferentFacts() {
  const distinctPairs = [
    ["事故造成 3 人死亡并启动调查", "事故造成 4 人死亡并启动调查"],
    ["公司宣布投资 100 万元建设新工厂", "公司宣布投资 200 万元建设新工厂"],
    ["Company launches Aurora 2.1 with a redesigned rendering engine", "Company launches Aurora 2.2 with a redesigned rendering engine"],
    ["地震震级为 6.1 级，多地启动应急响应", "地震震级为 6.2 级，多地启动应急响应"],
    ["星海公司宣布收购远山科技公司", "星海公司终止收购远山科技公司"],
    ["轨道望远镜拍摄遥远星系", "轨道望远镜完成设备维修"],
    ["产品更新", "产品更新"],
  ];
  for (const [left, right] of distinctPairs) {
    assert.equal(select([article("left", left), article("right", right)]).length, 2,
      `material changes and generic headlines must stay separate: ${left} / ${right}`);
  }
  const versions = rankNewsItems([
    article("v1", "Company launches Aurora 2.1 with a redesigned rendering engine"),
    article("v2", "Company launches Aurora 2.2 with a redesigned rendering engine"),
  ], { now });
  assert.equal(new Set(versions.map(item => item.eventId)).size, 2, "ranking must not mistake decimal model versions for dates");
  const originals = [article("v1", distinctPairs[2][0]), article("v2", distinctPairs[2][1])];
  const shortened = annotateTodayNewsGroups(originals.map(item => ({ ...item, title: "Aurora 推出全新渲染引擎版本" })), { now, originalItems: originals });
  assert.equal(new Set(shortened.map(item => item.todayNewsId)).size, 2, "translated titles must not hide conflicting facts in the original reports");
}

function testEventStateConflicts() {
  for (const [left, right] of [
    ["星海公司宣布收购远山科技公司", "星海公司终止收购远山科技公司"],
    ["星海公司宣布收購遠山科技公司", "星海公司否認收購遠山科技公司"],
    ["星海公司宣布收购远山科技公司", "星海公司暂停收购远山科技公司"],
    ["Aurora will acquire Meridian technology company", "Aurora will not acquire Meridian technology company"],
    ["Aurora announces acquisition of Meridian technology company", "Aurora cancels acquisition of Meridian technology company"],
  ]) {
    const inputs = [article("left", left), article("right", right)].map(item => ({
      ...item, excerpt: "A detailed synthetic report describes the company's decision and its next steps for the proposed transaction.",
    }));
    for (const ordered of [inputs, [...inputs].reverse()]) {
      const ranked = rankNewsItems(ordered, { now });
      assert.equal(new Set(ranked.map(item => item.eventId)).size, 2, `${left} / ${right}: opposite states must remain separate events`);
      assert(ranked.every(item => item.eventSourceCount === 1 && item.eventConfidence !== "corroborated"));
      assert.equal(select(ranked).length, 2, "the complete ranking and visible-news pipeline must preserve both developments");
    }
    assert.equal(select(inputs.map(item => ({ ...item, eventId: "legacy-shared-id" }))).length, 2,
      "a previously cached event ID must not override conflicting states");
  }
  const sameState = rankNewsItems([
    article("cancel-a", "Aurora cancels acquisition of Meridian technology company"),
    article("cancel-b", "Aurora cancelled acquisition of Meridian technology company"),
  ], { now });
  assert.equal(new Set(sameState.map(item => item.eventId)).size, 1, "equivalent state inflections still corroborate one event");
}

function testEnglishScoringBoundaries() {
  const score = title => scoreNewsArticle(article("score", title, { excerpt: "A factual description of the change and the steps needed to use the updated feature." }), now);
  for (const title of [
    "Software update adds keyboard shortcuts", "Hardware update adds keyboard shortcuts",
    "Urban platform update adds keyboard shortcuts",
  ]) assert.equal(score(title).breakdown.impact, 2, "embedded war/ban substrings must not elevate ordinary updates");
  assert.equal(score("Interface preview adds keyboard shortcuts").breakdown.penalties, 0, "preview is not a review");
  assert.equal(score("Wholesale platform adds keyboard shortcuts").breakdown.penalties, 0, "wholesale is not a sale promotion");
  for (const title of ["War disrupts transport across the region", "Regulator bans unsafe equipment across the region",
    "Regulator banned unsafe equipment across the region", "Company recalled unsafe equipment across the region",
    "Security vulnerabilities affect regional services"]) {
    assert(score(title).breakdown.impact >= 24, "real impact terms and their inflections must retain their weight");
  }
  assert.equal(score("Interface review explains keyboard shortcuts").breakdown.penalties, 18);
  assert.equal(score("Discounts on selected equipment this week").breakdown.penalties, 35);
  assert.equal(score("Discounted equipment is available this week").breakdown.penalties, 35);
}

function testRepresentativeSelection() {
  const reports = [
    article("pending", "Original headline", { eventId: "same", score: 99, localizationPending: true }),
    article("readable", "已完成翻译的新闻", { eventId: "same", score: 40, eventRepresentative: false }),
  ];
  assert.equal(select(reports)[0].articleId, "readable", "an unreadable cached representative must not displace its translated report");
  assert.equal(select([reports[1]])[0].articleId, "readable", "visible coverage survives removal of its cached representative");
  const previousDay = article("yesterday", "监管机构公布新的数据安全法规", { score: 99, publishedAt: new Date(now - 12 * HOUR_MS).toISOString() });
  const today = article("today", "监管机构公布新的数据安全法规", { score: 40 });
  assert.equal(select([previousDay, today])[0].articleId, "today", "today's report wins over a higher-scoring cross-day copy");
}

function testUrlsAndConnectedIdentities() {
  const sameUrl = [
    article("url-a", "完全不同的旧标题", { url: "https://source.example/story?utm_source=feed#details" }),
    article("url-b", "后来整理后的新标题", { url: "https://source.example/story", score: 90 }),
  ];
  assert.equal(select(sameUrl).length, 1, "tracking and fragments do not make a second article");
  assert.equal(select(sameUrl)[0].articleId, "url-b");
  assert.equal(select([
    article("query-a", "监管机构公布新的数据安全法规", { url: "https://source.example/article?id=1" }),
    article("query-b", "轨道望远镜拍摄到遥远星系的清晰图像", { url: "https://source.example/article?id=2" }),
  ]).length, 2, "content query parameters must remain significant");
  const connected = [
    article("a", "Regulator approves the data security law", { eventId: "original-a" }),
    article("b", "监管机构公布新的数据安全法规", { eventId: "original-b" }),
    article("bridge", "同一文章的另一个标题", { eventId: "original-b", url: "https://a.example/story" }),
  ];
  assert.equal(select(connected).length, 1, "a shared URL must connect existing event identities regardless of translation");
}

function testPaginationAndTime() {
  const originals = [
    "监管机构公布新的数据安全法规", "轨道望远镜拍摄到遥远星系的清晰图像",
    "城市地铁全线恢复正常运营", "考古团队发现完整古代石刻遗址",
    "国家公园新设候鸟保护区域", "研究人员公布新型电池材料的实验结果",
  ].map((title, index) => article(`original-${index}`, title, { score: 90 - index, publisherHost: index < 3 ? "same.example" : `${index}.example` }));
  const copies = originals.map((item, index) => ({ ...item, articleId: `copy-${index}`, eventId: `copy-${index}`, url: `https://copy.example/${index}`, score: 100 + index }));
  const selected = select([...originals, ...copies], { pageSize: 2, pageCount: 3, publisherLimit: 1 });
  assert.equal(selected.length, 6, "copies must not consume page slots");
  assert.equal(new Set(selected.map(item => item.title)).size, 6, "all batches share one deduplicated pool");
  const invalid = [
    article("stale", originals[0].title, { publishedAt: new Date(now - 30 * HOUR_MS).toISOString() }),
    article("future", originals[0].title, { publishedAt: new Date(now + HOUR_MS).toISOString() }),
    article("unverified", originals[0].title, { timeUnverified: true }),
    article("ineligible", originals[0].title, { rankingEligible: false }),
  ];
  assert.deepEqual(select([...invalid, originals[0]]).map(item => item.articleId), [originals[0].articleId]);
  assert.deepEqual(selectTodayNewsItems(null, { now }), []);
}

async function testDashboardProjection() {
  const sources = ["one", "two"].map(id => ({ key: id, url: `https://${id}.example/feed`, cardType: "news" }));
  let origins = sources.map(source => originPattern(source.url));
  const items = sources.map((source, index) => article(source.key, index ? "监管机构公布新的数据安全法规" : "Regulator approves a major data security law", {
    sourceKey: source.key, sourceOrigin: new URL(source.url).origin, publishedAt: new Date().toISOString(),
    eventRepresentative: index === 0,
  }));
  items[0].localization = createLocalization(items[0], {
    title: "监管机构公布新的数据安全法规",
    summary: ["新法规明确数据处理范围和适用条件，相关机构将按规定公布后续执行安排。"],
  }, "zh-CN", "bot", new Date().toISOString());
  const service = createDashboardContentService({
    cacheMutations: { capture: () => 0, isCurrent: () => true },
    capturePermissionEpoch: () => 0, isPermissionEpochCurrent: () => true,
    getSettings: async () => ({ bookmarkConsentGranted: true, publicFeedSupplementEnabled: false }),
    settingsLocale: () => "zh-CN", secretStatus: async () => ({}),
    currentBookmarkModel: async () => ({ bookmarks: sources, sections: [] }),
    feedCacheOrEmpty: value => value,
    getRecord: async (key, fallback) => key === "feed" ? { items } : fallback,
    getRefreshStatus: async () => ({}), readQuota: async () => ({ used: 0 }),
    emptySourceQuality: () => ({ records: {} }), getAiAutoStatus: async () => ({}),
    filterFeedItemsBySources, originsFromUrls: urls => urls.map(url => new URL(url).origin), buildPermissionRows, originPattern,
    withFeedCacheMetadata: value => value, sanitizeCardAiSummaries: values => values,
    presentableFeedItems: values => filterPresentableFeedItems(values, "zh-CN"),
    buildFallbackDigest: () => ({ status: "local" }), summarizeQuality: records => ({ records }),
    buildDailyCandidates: values => values, pipelineStages: () => ({}), providerCredentialAvailable: () => false,
    chrome: { permissions: { getAll: async () => ({ origins }) } },
  });
  for (const scope of ["all", "news"]) {
    const payload = await service.buildDashboardPayload(0, scope);
    assert.equal(payload.feed.items.length, 2, "full and incremental responses must retain all source articles");
    assert.equal(selectTodayNewsItems(payload.feed.items).length, 1, "both response paths must group the actual localized headlines");
  }
  origins = [originPattern(sources[1].url)];
  const permitted = await service.buildDashboardPayload(0, "news");
  assert.deepEqual(selectTodayNewsItems(permitted.feed.items).map(item => item.articleId), ["two"], "permission revocation must retain the remaining report even when it was not the cached representative");
  assert(items.every(item => !Object.hasOwn(item, "todayNewsId")), "display grouping must not write back into the feed cache");
}
