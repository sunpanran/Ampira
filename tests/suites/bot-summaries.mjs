import { createBotSummaryHarness } from "../helpers/bot-summary-harness.mjs";
import assert from "node:assert/strict";
import { createBotSummaryService } from "../../extension/runtime/bot-summary-service.mjs";
import { syncSummaries, completeSummaries, pendingSummary } from "../../integrations/local-mcp/summary-queue.mjs";
import { cachedLocalization, createLocalization, localizationFingerprint, withLocalization } from "../../extension/core/feed-localization.mjs";
import { filterPresentableFeedItems } from "../../extension/core/feed-language-policy.mjs";
import { createCardSummaryPolicy } from "../../extension/runtime/card-summary-policy.mjs";
import { createDashboardContentService } from "../../extension/runtime/dashboard-content-service.mjs";
import { normalizeSettings } from "../../extension/core/settings.mjs";
import { botOrganizesNews } from "../../extension/core/bot-mode.mjs";
import { createAutomaticAiHarness, syntheticArticle, GOOD_CARD } from "../helpers/automatic-ai-harness.mjs";

const text = { title: "产品显示功能更新", summary: ["这次更新改善显示效果，并支持现有设备。"] };
const settings = { mcpEnabled: true, dashboardMode: "bot", botOrganizeNews: true, uiLocale: "zh-CN", openaiBaseUrl: "https://ai.example/v1" };
assert.equal(normalizeSettings({}).botOrganizeNews, false);
assert.equal(normalizeSettings({ botTranslateForeign: true }).botOrganizeNews, false, "the old translation consent must not enable broader organization");
assert.equal(normalizeSettings({ botOrganizeNews: true }).botOrganizeNews, true);
assert.equal(botOrganizesNews(settings), true);
assert.equal(botOrganizesNews({ ...settings, mcpEnabled: false }), false);
assert.equal(botOrganizesNews({ ...settings, dashboardMode: "standard" }), false);
{
  const content = createDashboardContentService({ settingsLocale: () => "zh-CN", aiConfigured: async () => false,
    publicFeedsForLocale: (_locale, options) => options.includeAiOnly ? [{ key: "foreign", url: "https://news.example" }] : [] });
  assert.equal((await content.configuredFeedSources({ ...settings, bookmarkConsentGranted: true }, { bookmarks: [] })).length, 1,
    "Bot translation can use authorized foreign sources without an in-extension AI key");
  assert.equal((await content.configuredFeedSources({ ...settings, botOrganizeNews: false, bookmarkConsentGranted: true }, { bookmarks: [] })).length, 0);
}

const article = syntheticArticle("foreign", { externalDiscovery: true });
const localization = createLocalization(article, text, "zh-CN", "bot", new Date().toISOString());
const translated = withLocalization(article, localization);
assert(cachedLocalization(translated, "zh-CN"));
assert.equal(cachedLocalization({ ...translated, excerpt: "Changed source evidence" }, "zh-CN"), null);
const policy = createCardSummaryPolicy({ settingsLocale: () => "zh-CN" });
assert.equal(policy.sanitizeCardAiSummaries([translated], settings, false)[0].summaryTitle, text.title);
assert.equal(filterPresentableFeedItems([translated], "zh-CN", { aiConfigured: false }).length, 1);
assert.equal(filterPresentableFeedItems([{ ...translated, title: "Changed original" }], "zh-CN", { aiConfigured: false }).length, 0);
assert(policy.preserveCardAiSummary({ ...article }, translated, { ...settings, openaiBaseUrl: "https://different.example" }).localization);
assert(!policy.preserveCardAiSummary({ ...article, excerpt: "Changed" }, translated, settings).localization);

{
  const h = createAutomaticAiHarness({ articles: [article], settings });
  await h.run();
  assert.equal(h.requests.length, 0, "Bot-owned localization must not call the configured AI");
  h.control.settings.botOrganizeNews = false;
  await h.run();
  assert.equal(h.requests.filter(request => request.kind === "translation-batch").length, 1);
  assert(h.records.get("feed").items[0].localization, "native localization also populates the shared cache");
  h.control.settings.botOrganizeNews = true;
  await h.run();
  assert.equal(h.requests.filter(request => request.kind === "translation-batch").length, 1, "switching provider reuses a verified translation");
}
{
  const h = createAutomaticAiHarness({ articles: [article], settings: { ...settings, botOrganizeNews: false }, providerResponse: (request, control) => {
    if (request.kind === "translation-batch") { control.settings.botOrganizeNews = true; return GOOD_CARD; }
  } });
  await h.run();
  assert(!h.records.get("feed").items[0].localization, "late native output cannot win after switching to Bot");
}

const queue = {};
const requests = Array.from({ length: 5 }, (_, index) => ({ id: `summary-${index}`, title: "Product news", excerpt: "A display update for existing devices.", locale: "zh-CN" }));
syncSummaries(queue, { requests, resultIds: requests.map(value => value.id) }, 1000);
const batch = pendingSummary(queue, 1001);
assert.equal(batch.items.length, 5);
assert.equal(batch.kind, "summary");
const first = completeSummaries(queue, { taskId: batch.id, summaries: [{ id: requests[0].id, ...text }, { id: requests[1].id, title: "Wrong language", summary: ["This remains in English."] }] }, 1002);
assert.deepEqual(first.completed, [requests[0].id]);
assert.equal(first.errors[0].code, "invalid-summary");
assert.equal(pendingSummary(queue, 1003).items.length, 4);
assert.equal(pendingSummary(queue, 1003).id, batch.id);
assert.deepEqual(completeSummaries(queue, { taskId: batch.id, summaries: [{ id: requests[0].id, ...text }] }, 1004).completed, [requests[0].id]);
completeSummaries(queue, { taskId: batch.id, summaries: [{ id: requests[1].id, title: "Wrong", summary: ["Still English."] }] }, 1005);
assert.equal(queue.summaries[1].status, "failed", "only one correction attempt is automatic");
syncSummaries(queue, { requests: [requests[1]] }, 1006);
assert.equal(queue.summaries[1].status, "failed", "polling cannot restart a failed model task");
syncSummaries(queue, { requests: [requests[1]], retry: true }, 1007);
assert.equal(queue.summaries[1].status, "pending");
syncSummaries(queue, { cancelIds: requests.map(value => value.id) }, 1008);
assert.equal(pendingSummary(queue, 1009), null);
assert.equal(queue.summaries[0].status, "completed", "cancellation preserves verified results for reuse");
assert.equal(completeSummaries(queue, { taskId: batch.id, summaries: [{ id: requests[2].id, ...text }] }, 1009).errors[0].code, "stale-task");

{
  const h = createBotSummaryHarness();
  await h.service.sync(); assert.equal(h.calls.length, 0, "polling cannot create work from new feed content");
  await Promise.all([h.service.organize(), h.service.organize()]);
  assert.equal((await h.quota.read(50)).used, 5, "repeated submissions reuse reservations");
  assert.equal(pendingSummary(h.jobs).items.length, 5);
  await h.drain();
  assert.equal(h.records.get("feed").items.filter(item => cachedLocalization(item, "zh-CN")).length, 20, "all native and foreign cached candidates are organized");
  assert.equal((await h.quota.read(50)).used, 20);
  assert.equal(h.briefCalls(), 0, "explicit organization does not generate a brief");
  const before = h.calls.length; await h.service.sync();
  assert.equal(h.calls.length, before, "completed work causes no new companion requests");
}
{
  const h = createBotSummaryHarness({ limit: 3 });
  await h.service.organize(); await h.drain();
  assert.equal((await h.service.status()).phase, "quota");
  const item = h.articles[19];
  assert(!(await h.service.status()).pendingIds.includes(item.articleId), "quota-deferred cards must keep their manual action enabled");
  assert((await h.service.status()).queuedIds.includes(item.articleId));
  await h.service.organize({ item: { articleId: item.articleId, sourceKey: item.sourceKey, url: item.url } });
  assert.equal(pendingSummary(h.jobs).items.length, 1);
  h.answer(); await h.service.sync();
  assert(h.records.get("feed").items[19].localization);
  assert.equal((await h.quota.read(3)).used, 3);
}
{
  const h = createBotSummaryHarness({ count: 2 }); h.offline(true);
  await h.service.organize(); assert((await h.service.status()).unavailable);
  const reserved = (await h.quota.read(50)).used;
  await h.service.sync(); assert.equal((await h.quota.read(50)).used, reserved);
  h.offline(false); await h.service.sync(); await h.drain();
  assert.equal(h.records.get("feed").items.filter(item => item.localization).length, 2);
}
for (const mutation of [h => { h.settings.botOrganizeNews = false; }, h => h.revoke(), h => { h.settings.uiLocale = "en"; }, h => { h.configuration.connectionId = "different"; }]) {
  const h = createBotSummaryHarness(); await h.service.organize(); h.answer();
  h.interrupt(() => mutation(h)); await h.service.sync();
  assert(!h.records.get("feed").items[0].localization, "late output must not cross mode, permission, language or pairing changes");
}
{
  const h = createBotSummaryHarness(); await h.service.organize(); h.answer();
  h.records.get("feed").items[0].excerpt = "The source evidence changed.";
  await h.service.sync(); assert(!h.records.get("feed").items[0].localization);
}
{
  const h = createBotSummaryHarness({ count: 2 }); await h.service.organize({ allowDigest: true }); await h.drain();
  assert.equal(h.briefCalls(), 1, "background organization can prepare the daily brief once");
  await h.service.sync(); assert.equal(h.briefCalls(), 1);
}
{
  const h = createBotSummaryHarness({ count: 1, limit: 3 }); await h.service.organize();
  const task = pendingSummary(h.jobs), invalid = { id: task.items[0].id, title: "Wrong", summary: ["Still English."] };
  completeSummaries(h.jobs, { taskId: task.id, summaries: [invalid] });
  completeSummaries(h.jobs, { taskId: task.id, summaries: [invalid] });
  await h.service.sync(); assert.equal((await h.service.status()).failed, 1);
  await h.service.organize({ allowDigest: true }); assert.equal(pendingSummary(h.jobs), null, "background cycles must not restart rejected output");
  await h.service.organize(); assert.equal((await h.quota.read(3)).used, 2, "an explicit new batch retry consumes a new allowance unit");
  await h.drain(); assert(h.records.get("feed").items[0].localization);
}
console.log("Bot news organization tests passed");
