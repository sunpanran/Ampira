import assert from "node:assert/strict";
import { normalizeSettings } from "../../extension/core/settings.mjs";
import { botAnswersQuestions, botGeneratesBrief, botOrganizesNews, usesBotBrief, usesBotChat } from "../../extension/core/bot-mode.mjs";
import { botDashboardPayload } from "../../extension/core/bot-board.mjs";
import { createAutomaticAiHarness, syntheticArticle } from "../helpers/automatic-ai-harness.mjs";

const existing = normalizeSettings({ mcpEnabled: true, dashboardMode: "bot", botOrganizeNews: true });
assert(existing.botGenerateBrief && existing.botAnswerQuestions && existing.botOrganizeNews, "existing enabled features stay selected after upgrade");
const base = { dailyDigest: { status: "ai", overview: ["Native brief"] }, feed: { items: [{ articleId: "unchanged" }] } };
for (const brief of [true, false]) for (const news of [true, false]) for (const questions of [true, false]) {
  const settings = normalizeSettings({ ...existing, botGenerateBrief: brief, botOrganizeNews: news, botAnswerQuestions: questions });
  assert.equal(botGeneratesBrief(settings), brief); assert.equal(botOrganizesNews(settings), news); assert.equal(botAnswersQuestions(settings), questions);
  const bot = { ...settings, mode: "bot", modules: { today: { data: { brief: "Assistant brief" } } } };
  const result = botDashboardPayload(base, bot);
  assert.equal(usesBotBrief(result), brief); assert.equal(usesBotChat(result), questions);
  assert.equal(result.dailyDigest.overview[0], brief ? "Assistant brief" : "Native brief");
  assert.equal(result.feed, base.feed, "ownership changes must not replace native feed data");
  const disabled = { ...settings, mcpEnabled: false };
  assert(!botGeneratesBrief(disabled) && !botOrganizesNews(disabled) && !botAnswersQuestions(disabled));
  assert.equal(normalizeSettings(disabled).botGenerateBrief, brief, "master switch retains individual choices");
}
for (const botGenerateBrief of [true, false]) {
  const article = syntheticArticle("native-brief", { title: "本地设备发布显示功能更新", excerpt: "新版本改善显示效果，并支持现有设备。厂商公布了安装步骤和设备清单，本次更新不需要购买新的硬件。", contentLocale: "zh-CN" });
  const h = createAutomaticAiHarness({ articles: [article], settings: {
    mcpEnabled: true, dashboardMode: "bot", botGenerateBrief, botAnswerQuestions: false, cardSummaryEnabled: false,
  } });
  await h.run();
  assert.equal(h.requests.filter(request => request.kind === "digest").length, Number(!botGenerateBrief),
    "native automatic briefs resume only when daily brief ownership is unchecked");
}
console.log("Independent assistant takeover tests passed");
