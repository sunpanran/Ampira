import assert from "node:assert/strict";
import { createAutomaticAiHarness, syntheticArticle } from "../helpers/automatic-ai-harness.mjs";
import { prepareTask, MAX_CONTEXT_CHARS, MAX_MESSAGE_CHARS } from "../../integrations/local-mcp/tasks.mjs";
import { compactQuestionContext, taskReference, boundedReferences, briefContext } from "../../extension/core/bot-task-context.mjs";
import { readMcpModule, MODULE_RESPONSE_LIMIT } from "../../integrations/local-mcp/module-reader.mjs";
import { createMcpHandler } from "../../integrations/local-mcp/mcp.mjs";
import { normalizeBotModule } from "../../extension/core/bot-board.mjs";

const settings = { mcpEnabled: true, dashboardMode: "bot" };
const nativeArticle = (id) => syntheticArticle(id, {
  title: `显示设备更新 ${id}`, excerpt: "这次更新改善显示效果，并支持现有设备。厂商公布了安装步骤和设备清单，本次更新不需要购买新的硬件。", contentLocale: "zh-CN",
});
for (const mode of [
  { mcpEnabled: false, dashboardMode: "bot" },
  { mcpEnabled: true, dashboardMode: "standard" },
  settings,
]) {
  const h = createAutomaticAiHarness({ articles: Array.from({ length: 13 }, (_, i) => nativeArticle(`native-${i}`)), settings: mode });
  await h.run();
  const digestCount = mode.mcpEnabled && mode.dashboardMode === "bot" ? 0 : 1;
  assert.equal(h.requests.filter(request => request.kind === "card").length, 13, "MCP and Bot mode must retain native summaries across the full feed pool");
  assert.equal(h.requests.filter(request => request.kind === "digest").length, digestCount, "Bot briefs must not cause a duplicate native AI brief");
  assert.equal(h.statuses.at(-1).phase, "completed", "native pending cards must not be reported as no candidates");
  assert.equal(h.statuses.at(-1).processed, 13 + digestCount);
  assert.equal((await h.quota.read(20)).used, 13 + digestCount);
  await h.run();
  assert.equal(h.requests.length, 13 + digestCount, "valid card summaries must be reused after refresh");
  assert.equal(h.statuses.at(-1).phase, "no-candidates", "no candidates is correct only once the enabled native work is finished");
}
{
  const h = createAutomaticAiHarness({ articles: Array.from({ length: 5 }, (_, i) => nativeArticle(`quota-${i}`)), dailyAiLimit: 3, settings });
  await h.run();
  assert.equal(h.requests.length, 3);
  assert.equal(h.statuses.at(-1).phase, "quota");
  assert.equal(h.statuses.at(-1).deferred, 2);
  const target = h.records.get("feed").items[3];
  const result = await h.service.refreshSingleSummary({ sourceKey: target.sourceKey, articleId: target.articleId, url: target.url });
  assert(result.ok, "manual native organization remains available in Bot mode after the automatic allowance is used");
  assert.equal(h.requests.at(-1).kind, "card");
  assert.equal(h.records.get("feed").items[3].summaryStatus, "ai");
  assert.equal((await h.quota.read(3)).used, 3, "explicit manual organization retains its existing separate allowance behavior");
}
for (const botOrganizeNews of [false, true]) {
  const h = createAutomaticAiHarness({ articles: [syntheticArticle("foreign"), nativeArticle("native")], settings: { ...settings, botOrganizeNews } });
  await h.run();
  assert.deepEqual(h.requests.map(request => request.kind), botOrganizeNews ? [] : ["translation-batch", "card"],
    "Bot organization owns both foreign and native card summaries");
  const disabled = createAutomaticAiHarness({ articles: [syntheticArticle("foreign"), nativeArticle("native")], settings: { ...settings, botOrganizeNews, cardSummaryEnabled: false } });
  await disabled.run();
  assert.deepEqual(disabled.requests.map(request => request.kind), botOrganizeNews ? [] : ["translation-batch"],
    "the user's summary setting stays effective without suppressing required native translation");
}
{
  const h = createAutomaticAiHarness({ articles: Array.from({ length: 13 }, (_, i) => syntheticArticle(`full-translation-${i}`)), settings });
  await h.run();
  assert.deepEqual(h.requests.map(request => JSON.parse(request.input).translations.length), [5, 5, 3], "native translation covers the full pool in bounded batches");
  assert.equal(h.statuses.at(-1).processed, 13);
}
{
  const h = createAutomaticAiHarness({ articles: Array.from({ length: 6 }, (_, i) => syntheticArticle(`item-${i}`, { externalDiscovery: true })), settings });
  await h.run();
  assert.deepEqual(h.requests.map(request => request.kind), ["translation-batch", "translation-batch"]);
  assert.deepEqual(h.requests.map(request => JSON.parse(request.input).translations.length), [5, 1]);
  assert.equal((await h.quota.read(20)).used, 6, "batching must reserve one allowance unit per translated entry");
  await h.run();
  assert.equal(h.requests.length, 2, "unchanged translated feed data causes no repeat model work");
}
{
  const h = createAutomaticAiHarness({ articles: Array.from({ length: 6 }, (_, i) => syntheticArticle(`budget-${i}`, { externalDiscovery: true })), dailyAiLimit: 3, settings });
  await h.run();
  assert.equal(h.requests.length, 1);
  assert.equal(JSON.parse(h.requests[0].input).translations.length, 3);
  assert.equal((await h.quota.read(3)).used, 3);
}
{
  let first = true;
  const h = createAutomaticAiHarness({ articles: Array.from({ length: 5 }, (_, i) => syntheticArticle(`partial-${i}`, { externalDiscovery: true })), settings,
    providerResponse: request => {
      if (request.kind !== "translation-batch" || !first) return;
      first = false;
      return JSON.stringify({ translations: JSON.parse(request.input).translations.map((item, index) => ({ id: item.id,
        title: index === 2 ? "Wrong language" : "产品更新", summary: [index === 2 ? "Still in English." : "这次更新改善显示效果，并支持现有设备。"] })) });
    } });
  await h.run();
  assert.deepEqual(h.requests.map(request => JSON.parse(request.input).translations.map(item => item.id)), [["1", "2", "3", "4", "5"], ["3"]], "only the rejected translation is sent for correction");
  assert.equal((await h.quota.read(20)).used, 5);
}

for (const code of ["AI_EMPTY_RESPONSE", "AI_OUTPUT_LIMIT", "AI_INCOMPLETE_RESPONSE"]) {
  const h = createAutomaticAiHarness({ articles: Array.from({ length: 6 }, (_, i) => syntheticArticle(`batch-error-${i}`)), settings,
    providerResponse: request => {
      if (request.kind === "translation-batch" && JSON.parse(request.input).translations.some(item => item.title.includes("batch-error-0"))) {
        throw Object.assign(new Error("Synthetic content failure"), { code, messageKey: "background.error.aiInvalidOutput" });
      }
    } });
  await h.run();
  assert.equal(h.requests.length, 3, "a rejected batch gets one correction, then later entries must still run");
  assert.equal(h.records.get("feed").items[5].summaryStatus, "ai");
  assert(h.records.get("feed").items.slice(0, 5).every(item => item.summaryRetry.errorCode === code));
  assert.equal(h.statuses.at(-1).phase, "partial");
  assert.equal(h.statuses.at(-1).failed, 5);
  assert.equal(h.statuses.at(-1).processed, 1);
  assert.equal(h.statuses.at(-1).errorKey, "");
  assert.equal((await h.quota.read(20)).used, 6);
  await h.run();
  assert.equal(h.requests.length, 3, "content failures keep their cooldown during background refresh");
}
for (const code of ["AI_UNAUTHORIZED", "AI_NETWORK"]) {
  const h = createAutomaticAiHarness({ articles: Array.from({ length: 6 }, (_, i) => syntheticArticle(`service-error-${i}`)), settings,
    providerResponse: () => { throw Object.assign(new Error("Synthetic service failure"), { code, messageKey: "background.error.aiNetwork" }); } });
  await h.run();
  assert.equal(h.requests.length, 1, "service failures must still stop subsequent batches");
  assert.equal(h.statuses.at(-1).phase, "error");
  assert.equal((await h.quota.read(20)).used, 0, "a service failure releases the uncompleted batch reservation");
}

const source = { title: "产品显示更新", excerpt: "显示效果得到改善，已有设备可使用更新。".repeat(50), url: "https://example.com/article", source: "Synthetic", publishedAt: "2026-11-08T00:00:00Z" };
const refs = boundedReferences(Array.from({ length: 3 }, (_, i) => taskReference({ ...source, url: source.url + i })));
const context = compactQuestionContext(refs, [{ question: "旧问题", answer: "已有回答".repeat(80) }, { question: "相关追问", answer: "近期回答".repeat(80) }]);
assert(JSON.stringify(context).length <= MAX_CONTEXT_CHARS);
const messages = Array.from({ length: 5 }, (_, i) => ({ id: `question-${i}`, text: "问".repeat(1500), conversationId: "thread-a", locale: "zh-CN", references: refs }));
const history = [{ answered: true, action: { id: "unrelated", conversationId: "thread-b", text: "UNRELATED_PRIVATE_QUESTION" } }];
const task = prepareTask(messages, { replies: { data: { items: [{ replyTo: "unrelated", text: "UNRELATED_PRIVATE_REPLY" }] } } }, null, new Date().toISOString(), history);
assert.equal(task.messages.length, 4);
assert.equal(task.messages.reduce((sum, item) => sum + Array.from(item.text).length, 0), MAX_MESSAGE_CHARS);
assert(!JSON.stringify(task).includes("UNRELATED_PRIVATE"));
assert(JSON.stringify(task.context).length <= 1200);
assert(!Object.hasOwn(task, "instructions"), "static task instructions are not repeated in each question payload");
const emoji = prepareTask([{ id: "unicode", text: "🙂".repeat(6000), conversationId: "unicode" }], {}, null, new Date().toISOString());
assert.equal(Array.from(emoji.messages[0].text).length, 6000, "long Unicode questions are not silently dropped to meet a byte budget");
const material = briefContext(Array.from({ length: 24 }, (_, i) => ({ ...source, title: source.title + i, url: source.url + i })));
assert(material.context.length <= 12 && JSON.stringify(material.context).length <= 4500);

const replies = normalizeBotModule("replies", { schemaVersion: 1, bot: "Synthetic", updatedAt: new Date().toISOString(), data: {
  items: Array.from({ length: 200 }, (_, i) => ({ id: `reply-${i}`, replyTo: `question-${i}`, text: "Known facts and supporting context. ".repeat(40), createdAt: new Date().toISOString() })) } });
const store = { module: () => replies, taskReferences: () => refs, getPending: () => task };
const firstPage = readMcpModule(store, { module: "replies" });
assert.equal(firstPage.items.length, 10);
assert(firstPage.nextCursor && JSON.stringify(firstPage).length <= MODULE_RESPONSE_LIMIT);
const nextPage = readMcpModule(store, { module: "replies", cursor: firstPage.nextCursor, limit: 20 });
assert(nextPage.items.length <= 20 && nextPage.items[0].id === "reply-10");
const detail = readMcpModule(store, { module: "replies", ids: ["reply-5"] });
assert.equal(detail.items[0].id, "reply-5"); assert(detail.items[0].text.length > firstPage.items[0].text.length);
assert(JSON.stringify(detail).length <= MODULE_RESPONSE_LIMIT);
const selected = readMcpModule(store, { module: "context", taskId: task.id, ids: [refs[0].id] });
assert.equal(selected.items.length, 1); assert.equal(selected.items[0].url, refs[0].url);
assert.throws(() => readMcpModule(store, { module: "replies", limit: 200 }));
replies.data.items[0].text = "Changed";
assert.throws(() => readMcpModule(store, { module: "replies", cursor: firstPage.nextCursor }), { code: "stale-cursor" });
const mcp = createMcpHandler(store);
await mcp({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "budget-test", version: "1" } } });
const call = args => mcp({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "ampira_get_pending", arguments: args } });
const read = JSON.parse((await call({})).result.content[0].text);
const unchanged = JSON.parse((await call({ knownRevision: read.revision })).result.content[0].text);
assert.equal(unchanged.unchanged, true);
assert(!Object.hasOwn(unchanged, "pending"));
console.log("Bot token policy tests passed");
