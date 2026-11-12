import assert from "node:assert/strict";
import { createAutomaticAiHarness, syntheticArticle } from "../helpers/automatic-ai-harness.mjs";
import { createSummarySessionOrder } from "../../assets/client/summary-session-order.mjs";
import { messageRequestForHttp } from "../../assets/client/message-contract.mjs";
import { isCorrectlySummarized } from "../../assets/client/item-presenter.mjs";

const articles = Array.from({ length: 13 }, (_, i) => syntheticArticle(`native-${i}`, {
  title: `产品功能更新 ${i}`, excerpt: "更新改善显示效果，已有设备可以获得支持。", contentLocale: "zh-CN",
}));
assert.equal(messageRequestForHttp("POST", "/api/news/organize").request.type, "news:organize");
assert(isCorrectlySummarized({ summary: { summaryStatus: "ai", summaryTitle: "更新已经整理", summary: ["摘要允许只包含一条有依据的信息。"] } }), "a validated single-line summary is complete");
{
  const h = createAutomaticAiHarness({ articles: articles.slice(0, 2) });
  await h.run(undefined, { organize: false }); h.control.refreshError = true;
  await h.run(undefined, { organize: false });
  assert.equal(h.requests.length, 0, "failed manual refresh must not fall back to AI");
  await h.run();
  assert.equal(h.requests.filter(request => request.kind === "card").length, 2, "failed background refresh still organizes the permitted cache");
}
{
  const h = createAutomaticAiHarness({ articles });
  await h.run(undefined, { organize: false });
  assert.equal(h.requests.length, 0, "explicit refresh only collects content");
  h.control.articles = [];
  const results = await Promise.all([h.service.organizeNews(), h.service.organizeNews()]);
  assert(h.service.isOrganizingNews(), "accepted native work is busy before its first provider result");
  await h.service.waitForOrganization();
  assert.equal(results.filter(result => result.started).length, 1);
  assert.equal(h.requests.length, 13, "organization reads the existing cache, not the live sources");
  assert(h.requests.every(request => request.kind === "card"), "organize-news must not generate a brief");
  assert.equal(h.statuses.at(-1).phase, "completed");
  await h.service.organizeNews(); await h.service.waitForOrganization();
  assert.equal(h.requests.length, 13, "valid summaries are reused");
}
{
  const h = createAutomaticAiHarness({ articles: [] });
  await h.service.organizeNews(); await h.service.waitForOrganization();
  assert.equal(h.statuses.at(-1).phase, "no-candidates");
}
{
  const h = createAutomaticAiHarness({ articles: articles.slice(0, 3), dailyAiLimit: 2 });
  await h.run(undefined, { organize: false });
  await h.service.organizeNews(); await h.service.waitForOrganization();
  assert.equal(h.requests.length, 2); assert.equal(h.statuses.at(-1).phase, "quota");
  const target = articles[2], body = { sourceKey: target.sourceKey, articleId: target.articleId, url: target.url };
  await Promise.all([h.service.refreshSingleSummary(body), h.service.refreshSingleSummary(body)]);
  assert.equal(h.requests.length, 3, "concurrent manual requests share one result");
  assert.equal((await h.quota.read(2)).used, 2, "single manual requests do not consume the automatic allowance");
}
{
  const h = createAutomaticAiHarness({ articles: articles.slice(0, 2) });
  await h.run();
  assert.equal(h.requests.filter(request => request.kind === "digest").length, 1, "background refresh retains automatic briefs");
  assert.equal(h.requests.filter(request => request.kind === "card").length, 2);
}
{
  const h = createAutomaticAiHarness({ articles: articles.slice(0, 2) });
  await h.run(undefined, { organize: false });
  const target = articles[0];
  await h.service.organizeNews();
  await h.service.refreshSingleSummary({ sourceKey: target.sourceKey, articleId: target.articleId, url: target.url });
  await h.service.waitForOrganization();
  assert.equal(h.requests.filter(request => request.articleId === target.articleId).length, 1, "manual work must reuse an overlapping automatic result");
}
{
  const order = createSummarySessionOrder(), keys = items => items.map(item => item.key);
  assert.deepEqual(keys(order.arrange([{ key: "a" }, { key: "b" }, { key: "c" }], "important")), ["a", "b", "c"]);
  assert.deepEqual(keys(order.arrange([{ key: "c" }, { key: "b" }, { key: "a" }], "important")), ["a", "b", "c"]);
  assert.deepEqual(keys(order.arrange([{ key: "new" }, { key: "c" }, { key: "a" }], "important")), ["a", "c", "new"]);
  assert.deepEqual(keys(order.arrange([{ key: "c" }, { key: "a" }, { key: "new" }], "time")), ["c", "a", "new"]);
  assert.deepEqual(keys(createSummarySessionOrder().arrange([{ key: "new" }, { key: "a" }], "important")), ["new", "a"]);
}
console.log("News organization and stable order tests passed");
