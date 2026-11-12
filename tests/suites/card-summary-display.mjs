import assert from "node:assert/strict";
import { CARD_SUMMARY_WRITING_RULES, normalizeCardSummary } from "../../extension/core/card-summary-format.mjs";
import { cachedLocalization, createLocalization, localizationFingerprint } from "../../extension/core/feed-localization.mjs";
import { createCardSummaryPolicy } from "../../extension/runtime/card-summary-policy.mjs";
import { translateFeedBatch } from "../../extension/runtime/feed-translation-batch.mjs";
import { syncSummaries, pendingSummary, completeSummaries } from "../../integrations/local-mcp/summary-queue.mjs";
import { createAutomaticAiHarness, syntheticArticle } from "../helpers/automatic-ai-harness.mjs";
import { createBotSummaryHarness } from "../helpers/bot-summary-harness.mjs";
import { translate } from "../../extension/core/runtime-i18n.mjs";
import { summaryDetailLines } from "../../assets/client/item-presenter.mjs";

const policy = createCardSummaryPolicy();
const examples = {
  "zh-CN": { title: "显示设备更新面向现有用户开放", summary: [
    "厂商发布显示设备软件更新，新增屏幕色彩校准与亮度调节功能，并将支持范围扩大到两款现有设备，无需额外购买硬件。",
    "用户安装更新后可以在设置中分别调整两块屏幕，原有配置仍会保留，试用期间收集的显示问题也已纳入修复范围。",
    "更新分批推出，具体设备名单和地区安排以公布内容为准，尚未提供完整的推送时间表。",
  ] },
  "zh-Hant": { title: "顯示設備更新向現有用戶開放", summary: [
    "廠商發布顯示設備軟體更新，新增螢幕色彩校準功能，現有設備也可以安裝。",
    "用戶可分別調整兩塊螢幕，原有設定仍會保留，不必購買新硬體。",
    "更新分批推出，詳細地區安排與完整時程尚待公布。",
  ] },
  en: { title: "Display update reaches existing devices", summary: [
    "The update adds color controls to two existing displays.",
    "Users can adjust each screen without replacing hardware.",
    "Rollout dates remain unannounced.",
  ] },
};
const plain = value => `Title: ${value.title}\n${value.summary.join("\n")}`;
assert.deepEqual(summaryDetailLines({ title: "Synthetic News", summary: { title: examples.en.title, summary: examples.en.summary } }), examples.en.summary,
  "English facts must not be mistaken for the headline just because they share letters");
assert.deepEqual(summaryDetailLines({ title: "Synthetic News", summary: { title: "Displays update existing devices", summary: [
  "Displays update the existing devices.", "Users can adjust each screen without replacing hardware.",
] } }), ["Users can adjust each screen without replacing hardware."], "near-duplicate English headlines still yield to useful detail");
for (const [locale, value] of Object.entries(examples)) {
  const native = policy.generatedCardSummary(plain(value));
  assert.deepEqual(native, value, `${locale}: already compact native summaries must stay unchanged`);
  const queue = {};
  syncSummaries(queue, { requests: [{ id: "article", locale, title: value.title, excerpt: value.summary.join(" ") }] });
  const task = pendingSummary(queue);
  assert(task.instructions.includes(CARD_SUMMARY_WRITING_RULES));
  for (const number of ["130–180", "110", "120", "64"]) {
    assert(task.instructions.includes(number) && translate(locale, "background.prompt.cardSummary").includes(number),
      `${locale}: MCP and released native writing instructions must agree on text density`);
  }
  const submitted = { taskId: task.id, summaries: [{ id: "article", ...value }] };
  assert.deepEqual(completeSummaries(queue, submitted).completed, ["article"]);
  assert.deepEqual(queue.summaries[0].result, { ...native, locale });
  assert.deepEqual(completeSummaries(queue, submitted).completed, ["article"], "retries remain idempotent after formatting");
  const article = syntheticArticle("article", { excerpt: "Source detail. ".repeat(180) });
  const batch = await translateFeedBatch([article], locale, async inputs => {
    assert.equal(inputs[0].excerpt.length, 2000, "batch organization retains the same excerpt budget as native and MCP cards");
    return JSON.stringify({ translations: [{ id: "1", ...value }] });
  });
  assert.deepEqual(batch.results.get("article"), native);
}

const verbose = { title: "显示设备更新".repeat(20), summary: ["新增色彩校准功能，现有设备无需更换硬件。".repeat(20)] };
const bounded = normalizeCardSummary(verbose);
assert.equal(Array.from(bounded.title).length, 64);
assert(bounded.summary.length <= 3 && Array.from(bounded.summary.join("")).length <= 200);
const longLines = normalizeCardSummary({ title: "更新", summary: ["甲".repeat(120), "乙".repeat(120), "丙".repeat(120)] });
assert.equal(Array.from(longLines.summary.join("")).length, 200);
assert(longLines.summary.at(-1).endsWith("…"));
const article = syntheticArticle("cached");
const saved = { ...verbose, fingerprint: localizationFingerprint(article), locale: "zh-CN", producer: "native", updatedAt: "2026-11-09T00:00:00Z" };
const cached = cachedLocalization({ ...article, localization: saved }, "zh-CN");
assert.deepEqual({ title: cached.title, summary: cached.summary }, bounded, "existing shared cache also follows the card budget without another AI call");
assert.deepEqual(saved.summary, verbose.summary, "reading old cache must not mutate its source record");
const batch = await translateFeedBatch([article], "zh-CN", async () => JSON.stringify({ translations: [{ id: "1", ...verbose }] }));
assert.deepEqual(batch.results.get("cached"), bounded, "verbose batch output is bounded before caching");

const marked = { title: "**显示设备更新**", summary: ["- 核心事实：新增色彩校准功能。", "实际影响：现有设备无需更换硬件。", "后续关注：推送时间待公布。"] };
const clean = { title: "显示设备更新", summary: ["新增色彩校准功能。", "现有设备无需更换硬件。", "推送时间待公布。"] };
assert.deepEqual(normalizeCardSummary(marked), clean);
assert.deepEqual(policy.generatedCardSummary(plain(marked)), clean);
const markedQueue = {};
syncSummaries(markedQueue, { requests: [{ id: "marked", locale: "zh-CN", title: clean.title, excerpt: clean.summary.join(" ") }] });
const markedTask = pendingSummary(markedQueue), submission = { taskId: markedTask.id, summaries: [{ id: "marked", ...marked }] };
assert.deepEqual(completeSummaries(markedQueue, submission).completed, ["marked"]);
assert.deepEqual(markedQueue.summaries[0].result, { ...clean, locale: "zh-CN" });
assert.deepEqual(completeSummaries(markedQueue, submission).completed, ["marked"]);
markedQueue.summaries[0].result = { ...marked, locale: "zh-CN" };
assert.deepEqual(completeSummaries(markedQueue, submission).completed, ["marked"], "existing completed jobs can be retried after the formatter update");
assert.equal(completeSummaries(markedQueue, { taskId: markedTask.id, summaries: [{ id: "marked", ...marked, summary: [marked.summary.join(" ").repeat(5)] }] }).errors[0].code, "conflict");
const short = { title: "设备更新", summary: ["推送时间待公布。"] };
assert.deepEqual(normalizeCardSummary(short), short, "sparse evidence must never be padded to a minimum length");
assert.throws(() => createLocalization(article, { title: "设备更新", summary: ["核心事实："] }, "zh-CN", "bot", ""), { code: "invalidData" });
let retries = 0;
const empty = await translateFeedBatch([article], "zh-CN", async () => {
  retries++;
  return JSON.stringify({ translations: [{ id: "1", title: "设备更新", summary: ["核心事实："] }] });
});
assert.equal(retries, 2);
assert.equal(empty.results.size, 0, "labels alone cannot become a blank completed card");

for (const mode of ["standard", "bot"]) {
  const h = createAutomaticAiHarness({ articles: [article], settings: { mcpEnabled: true, dashboardMode: mode }, providerResponse: request =>
    request.kind === "translation-batch" ? JSON.stringify({ translations: [{ id: "1", ...examples["zh-CN"] }] })
      : request.kind === "card" ? plain(examples["zh-CN"]) : undefined });
  await h.run();
  const organized = h.records.get("feed").items[0];
  assert.deepEqual({ title: organized.summaryTitle, summary: organized.summary }, examples["zh-CN"]);
  if (mode === "bot") assert(h.requests[0].system.includes(CARD_SUMMARY_WRITING_RULES), "native batch requests carry the shared writing rules");
}
const h = createBotSummaryHarness({ count: 1 });
await h.service.organize();
const task = pendingSummary(h.jobs);
completeSummaries(h.jobs, { taskId: task.id, summaries: [{ id: task.items[0].id, ...examples["zh-CN"] }] });
await h.service.sync();
const organized = h.records.get("feed").items[0];
assert.deepEqual({ title: organized.summaryTitle, summary: organized.summary }, examples["zh-CN"], "MCP results reach the same feed display fields as native output");

console.log("News card display parity tests passed");
