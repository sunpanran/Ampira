import assert from "node:assert/strict";
import { createCardSummaryPolicy, validateCardSummaryOutput } from "../../extension/runtime/card-summary-policy.mjs";
import { currentSummaryRetry, nextSummaryRetry } from "../../extension/core/card-summary-retry.mjs";
import { aiOutputMatchesLocale } from "../../extension/core/ai-output-language.mjs";
import { feedItemNeedsLocalization, filterPresentableFeedItems, localizedSummaryMatchesLocale } from "../../extension/core/feed-language-policy.mjs";
import { automaticSummaryCandidates } from "../../extension/runtime/automatic-ai-workflow.mjs";
import { createPriorityRanker, mergeRankedUnique, selectDailyEvents, selectTodayNewsItems } from "../../assets/client/dashboard-selectors.mjs";
import { buildDailyCandidates } from "../../extension/core/news-ranking.mjs";
import { createAutomaticAiHarness, syntheticArticle, GOOD_CARD, WRONG_CARD } from "../helpers/automatic-ai-harness.mjs";

const policy = createCardSummaryPolicy();
for (const title of ["Apple Vision Pro 推出更新", "OpenAI API 发布新版本", "NVIDIA RTX 更新", "使用 `some_code()` 处理数据"]) {
  assert(aiOutputMatchesLocale(title, "zh-CN"), `${title} is readable Chinese`);
  assert(localizedSummaryMatchesLocale(title, ["用户可以在现有设备上使用这些功能。"], "zh-CN"));
  assert(!feedItemNeedsLocalization({ title, excerpt: "这次更新面向现有用户。" }, "zh-CN"));
  assert.equal(filterPresentableFeedItems([{ title, excerpt: "这次更新面向现有用户。", contentLocale: "en", externalDiscovery: true }], "zh-CN").length, 1,
    "a readable native public article must not stay hidden after a coarse name-heavy language classification");
}
for (const title of ["English article title", "This is an English sentence 中文", "這個標題使用繁體中文"]) {
  assert(!localizedSummaryMatchesLocale(title, ["这是很长的中文正文，也不能掩盖错误语言的标题。"], "zh-CN"));
}
assert.equal(validateCardSummaryOutput("", "zh-CN").code, "AI_INVALID_OUTPUT");
assert.deepEqual(validateCardSummaryOutput("只有摘要而没有标题。", "zh-CN").fields, ["title"]);
assert.deepEqual(validateCardSummaryOutput("标题：产品更新", "zh-CN").fields, ["summary"]);
assert(validateCardSummaryOutput(GOOD_CARD, "zh-CN").valid);
assert(validateCardSummaryOutput("標題：Apple Vision Pro 推出更新\n現有用戶可以使用這些功能。", "zh-Hant").valid);
assert(validateCardSummaryOutput(WRONG_CARD, "en").valid);

const native = syntheticArticle("native", { title: "本地产品发布更新", excerpt: "更新改善显示效果，并向现有用户开放。", contentLocale: "zh-CN" });
const botOwned = createAutomaticAiHarness({ articles: [native], settings: { mcpEnabled: true, dashboardMode: "bot" } });
await botOwned.run();
assert.deepEqual(botOwned.requests.map(request => request.kind), ["card"], "Bot mode retains native card organization without generating a duplicate AI brief");
let manualRepair = false;
const harness = createAutomaticAiHarness({
  articles: [syntheticArticle("bad"), syntheticArticle("good"), native],
  providerResponse: (request) => request.articleId === "bad" && !manualRepair ? WRONG_CARD : undefined,
});
await harness.run();
assert.deepEqual(harness.requests.map((request) => request.articleId || request.kind), ["bad", "bad", "good", "digest", "native"]);
const repairedRequest = harness.requests[1];
assert(repairedRequest.system.includes("title, summary[1]"), "repair identifies the rejected fields");
assert(repairedRequest.input.includes("AMPIRA_REJECTED_DRAFT="), "repair has the bounded untrusted draft alongside the original input");
assert(!repairedRequest.system.includes("The update improves"), "draft prose must not enter the trusted system prompt");
let feed = harness.records.get("feed");
assert.equal(feed.items[0].summaryStatus, undefined);
assert.equal(feed.items[0].summaryRetry.failures, 1);
assert.equal(feed.items[1].summaryStatus, "ai");
assert.equal(feed.items[2].summaryStatus, "ai");
assert(!JSON.stringify(feed).includes(WRONG_CARD));
assert.equal((await harness.quota.read(20)).used, 4, "a language repair consumes one task quota, not two");
assert.deepEqual(
  Object.fromEntries(["phase", "processed", "attempted", "failed", "deferred"].map((key) => [key, harness.statuses.at(-1)[key]])),
  { phase: "partial", processed: 3, attempted: 4, failed: 1, deferred: 1 },
);
assert(harness.events.some((event) => event.type === "dashboard.ai-progress" && event.value.contentChanged && event.value.autoStatus.failed === 1));
const initialRequests = harness.requests.length;
await harness.run();
assert.equal(harness.requests.length, initialRequests, "a fresh Feed read must preserve the retry cooldown and valid summaries");
assert.equal(harness.records.get("feed").items[0].summaryRetry.failures, 1);
assert.equal(harness.statuses.at(-1).phase, "partial", "cooling work is pending, not quota exhaustion or no work");

const retryItem = harness.records.get("feed").items[0];
const settings = harness.control.settings;
assert(currentSummaryRetry(retryItem, settings, "zh-CN"));
for (const changed of [
  { item: { ...retryItem, excerpt: "Changed source facts" } },
  { settings: { ...settings, openaiSummaryModel: "another-model" } },
  { settings: { ...settings, openaiApiStyle: "responses" } },
  { settings: { ...settings, credentialGeneration: 2 } },
  { locale: "zh-Hant" },
]) {
  assert.equal(currentSummaryRetry(changed.item || retryItem, changed.settings || settings, changed.locale || "zh-CN"), null);
}
let evolving = { ...retryItem, summaryRetry: undefined };
const now = Date.now();
for (const [index, minutes] of [15, 60, 360, 360].entries()) {
  const retry = nextSummaryRetry(evolving, settings, "zh-CN", { code: "AI_WRONG_LANGUAGE" }, now);
  assert.equal(retry.failures, index + 1);
  assert.equal(Date.parse(retry.nextEligibleAt) - now, minutes * 60_000);
  evolving = { ...evolving, summaryRetry: retry };
}
const due = { ...retryItem, summaryRetry: { ...retryItem.summaryRetry, nextEligibleAt: new Date(now - 1).toISOString() } };
const candidates = automaticSummaryCandidates([due, syntheticArticle("new")], settings, "zh-CN", policy.isCurrentCardSummary, "required");
assert.deepEqual(candidates.map((item) => item.articleId), ["new", "bad"], "fresh foreign items precede due retries");
assert.equal(automaticSummaryCandidates([syntheticArticle("new")], { ...settings, cardSummaryEnabled: false }, "zh-CN", policy.isCurrentCardSummary, "required").length, 1);

const poisoned = { ...syntheticArticle("poisoned"), summaryStatus: "ai", summaryLocale: "zh-CN", summaryTitle: "Wrong English title", summary: ["中文正文。"], summaryProviderOrigin: settings.openaiBaseUrl };
assert(!policy.isCurrentCardSummary(poisoned, "zh-CN"));
assert.equal(policy.sanitizeCardAiSummaries([poisoned], settings, true)[0].summaryStatus, "excerpt");
assert.equal(policy.preserveCardAiSummary(syntheticArticle("poisoned"), poisoned, settings).summaryStatus, undefined);

for (const mode of ["automatic", "manual"]) {
  const changedLocale = createAutomaticAiHarness({ articles: [syntheticArticle(`locale-${mode}`)],
    providerResponse: (request, control) => request.kind === "card" && control.settings.uiLocale === "en" ? WRONG_CARD : undefined });
  await changedLocale.run();
  const previous = changedLocale.records.get("feed").items[0];
  assert.equal(previous.localization.locale, "zh-CN");
  changedLocale.control.settings.uiLocale = "en";
  if (mode === "manual") {
    const result = await changedLocale.service.refreshSingleSummary({ sourceKey: previous.sourceKey, articleId: previous.articleId, url: previous.url });
    assert.equal(result.ok, true);
  } else {
    await changedLocale.service.organizeNews();
    await changedLocale.service.waitForOrganization();
  }
  const updated = changedLocale.records.get("feed").items[0];
  const [visible] = policy.sanitizeCardAiSummaries([updated], changedLocale.control.settings, true);
  assert.equal(visible.summaryStatus, "ai", `${mode} organization must replace a stale localization after a locale change`);
  assert.equal(visible.summaryLocale, "en");
  assert(policy.isCurrentCardSummary(visible, "en"));
  const requests = changedLocale.requests.length;
  await changedLocale.service.organizeNews();
  await changedLocale.service.waitForOrganization();
  assert.equal(changedLocale.requests.length, requests, "the replacement summary must be reused without spending quota again");
}

manualRepair = true;
const usedBeforeManual = (await harness.quota.read(20)).used;
const manual = await harness.service.refreshSingleSummary({ sourceKey: "fixture", articleId: "bad", url: retryItem.url });
assert(manual.ok, "manual retry bypasses a live automatic cooldown");
assert.equal(harness.records.get("feed").items[0].summaryRetry, undefined);
assert.equal((await harness.quota.read(20)).used, usedBeforeManual);

for (const response of ["只有中文摘要，没有标题。", "标题：没有正文", ""]) {
  const invalid = createAutomaticAiHarness({
    articles: [syntheticArticle("bad"), syntheticArticle("next")],
    providerResponse: (request) => request.articleId === "bad" ? response : undefined,
  });
  await invalid.run();
  assert.equal(invalid.requests.filter((request) => request.articleId === "bad").length, 2);
  assert.equal(invalid.records.get("feed").items[1].summaryStatus, "ai", "malformed output must not stop later cards");
  assert.equal(invalid.records.get("feed").items[0].summaryRetry.errorCode, "AI_INVALID_OUTPUT");
}

const emptyProvider = createAutomaticAiHarness({ articles: [syntheticArticle("empty"), syntheticArticle("next")],
  providerResponse: (request) => {
    if (request.articleId === "empty") throw Object.assign(new Error("Empty synthetic completion"), { code: "AI_EMPTY_RESPONSE" });
  } });
await emptyProvider.run();
assert.equal(emptyProvider.requests.filter((request) => request.articleId === "empty").length, 2);
assert.equal(emptyProvider.records.get("feed").items[1].summaryStatus, "ai");
assert.equal((await emptyProvider.quota.read(20)).used, 3, "an empty completed card consumes one task even after repair");

for (const [locale, wrong, correct] of [
  ["zh-CN", WRONG_CARD, GOOD_CARD],
  ["zh-Hant", GOOD_CARD, "標題：產品推出更新\n這次更新改善顯示效果，現有用戶可以使用。"],
  ["en", GOOD_CARD, WRONG_CARD],
]) {
  let attempts = 0;
  const repaired = createAutomaticAiHarness({ articles: [syntheticArticle("repair")], settings: { uiLocale: locale },
    providerResponse: (request) => request.kind === "card" ? (++attempts === 1 ? wrong : correct) : undefined });
  await repaired.run();
  assert.equal(attempts, 2);
  assert.equal(repaired.records.get("feed").items[0].summaryLocale, locale);
  assert.equal(repaired.records.get("feed").items[0].summaryRetry, undefined);
}

const limited = createAutomaticAiHarness({ articles: [syntheticArticle("bad"), syntheticArticle("good"), native], dailyAiLimit: 2,
  providerResponse: (request) => request.articleId === "bad" ? WRONG_CARD : undefined });
await limited.run();
assert.equal(limited.requests.length, 3);
assert.equal((await limited.quota.read(2)).used, 2);
assert.equal(limited.statuses.at(-1).phase, "quota");
assert.equal(limited.statuses.at(-1).processed, 1);
assert.equal(limited.statuses.at(-1).attempted, 2);

for (const code of ["AI_HTTP_ERROR", "AI_NETWORK_ERROR", "AI_KEY_MISSING"]) {
  const fatal = createAutomaticAiHarness({ articles: [syntheticArticle("first"), syntheticArticle("next")],
    providerResponse: () => { throw Object.assign(new Error("Synthetic service failure"), { code, messageKey: "background.error.aiNetwork" }); } });
  await fatal.run();
  assert.equal(fatal.requests.length, 1, `${code} pauses the whole service`);
  assert.equal(fatal.statuses.at(-1).phase, "error");
  assert.equal((await fatal.quota.read(20)).used, 0);
}
for (const change of ["cancel", "permission", "locale", "model", "content"]) {
  const controller = new AbortController();
  const stale = createAutomaticAiHarness({ articles: [syntheticArticle("first"), syntheticArticle("next")],
    providerResponse: (_request, control) => {
      if (change === "cancel") { control.active = false; controller.abort(); }
      if (change === "permission") control.permitted = false;
      if (change === "locale") control.settings.uiLocale = "en";
      if (change === "model") control.settings.openaiSummaryModel = "changed-model";
      if (change === "content") stale.records.get("feed").items[0].excerpt = "New content arrived during generation.";
      return GOOD_CARD;
    } });
  await stale.run(controller.signal);
  assert.equal(stale.requests.length, 1, `${change} must stop old work`);
  assert(stale.records.get("feed").items.every((item) => !item.summaryRetry && item.summaryStatus !== "ai"), `${change} must prevent stale writes`);
}

const digestFailure = createAutomaticAiHarness({ articles: [syntheticArticle("foreign"), native],
  providerResponse: (request) => request.kind === "digest" ? "OVERVIEW: This response is entirely in English." : undefined });
await digestFailure.run();
assert.equal(digestFailure.records.get("feed").items[1].summaryStatus, "ai", "a language failure in the brief must not block same-language cards");
assert.equal(digestFailure.statuses.at(-1).phase, "partial");

const hiddenFailure = createAutomaticAiHarness({ articles: [syntheticArticle("hidden", { externalDiscovery: true })],
  providerResponse: () => WRONG_CARD });
await hiddenFailure.run();
assert.equal(hiddenFailure.requests.length, 2, "an empty visible digest pool must not call the provider");
assert.equal(hiddenFailure.statuses.at(-1).total, 1, "an unnecessary empty digest must not remain in the planned task count");
assert.equal(hiddenFailure.statuses.at(-1).attempted, 1);

// Actual presentation projections feed both homepage sort orders and pagination.
const ready = { ...syntheticArticle("ready"), summaryStatus: "ai", summaryLocale: "zh-CN", summaryTitle: "产品更新", summary: ["具体信息以原始发布为准。"], summaryProviderOrigin: settings.openaiBaseUrl };
const presented = filterPresentableFeedItems([
  syntheticArticle("foreign", { score: 100 }), ready, native,
  syntheticArticle("hidden-public", { externalDiscovery: true }),
], "zh-CN", { aiConfigured: true, providerOrigin: settings.openaiBaseUrl });
assert.deepEqual(presented.map((item) => item.articleId), ["foreign", "ready", "native"]);
assert.equal(presented[0].localizationPending, true);
assert.equal(presented[1].localizationPending, false);
assert.equal(presented[1].title, "产品更新");
const ranker = createPriorityRanker({ hotScore: (item) => item.score, itemTime: (item) => item.score });
for (const order of ["importance", "time"]) {
  const sorted = mergeRankedUnique([presented.slice(0, 2), presented.slice(2)], { compare: ranker.compareByOrder(order), keyOf: (item) => item.articleId });
  assert.equal(sorted.at(-1).articleId, "foreign", `${order} applies language priority across source groups`);
}
// Keep yesterday's article inside the 24-hour window, including late-evening runs.
const nowDate = new Date(2026, 0, 15, 23, 30);
const todayTime = nowDate.toISOString();
const recentTime = new Date(2026, 0, 14, 23, 59).toISOString();
const many = Array.from({ length: 8 }, (_, index) => ({ ...native, articleId: `readable-${index}`, publisherHost: "same.example", publishedAt: index === 7 ? recentTime : todayTime }));
const visiblePool = [{ ...presented[0], publishedAt: todayTime }, ...many];
const selected = selectTodayNewsItems(visiblePool, { compare: ranker.compareImportant, pageSize: 3, pageCount: 4, publisherLimit: 1, now: nowDate });
assert.equal(selected.at(-1).articleId, "foreign", "publisher diversity and today's priority cannot promote unreadable cards over readable recent cards");
assert.equal(selected.length, 9, "deprioritizing must not remove visible cards");
assert.equal(buildDailyCandidates(visiblePool, { limit: 5, publisherLimit: 1, now: nowDate }).some((item) => item.localizationPending), false);
const eventPool = visiblePool.map((item, index) => ({ ...item, id: item.articleId, sourceCount: index ? 2 : 10, importanceScore: index ? 40 : 100 }));
assert.equal(selectDailyEvents(eventPool, { limit: 3, now: nowDate }).some((item) => item.localizationPending), false, "event cards must also prefer readable events over high-scoring untranslated events");
console.log("Automatic AI language recovery tests passed");
