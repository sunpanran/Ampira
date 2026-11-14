import assert from "node:assert/strict";
import { DEFAULT_SETTINGS } from "../../extension/core/constants.mjs";
import { normalizeSettings } from "../../extension/core/settings.mjs";
import { createAutomaticAiHarness, syntheticArticle, WRONG_CARD } from "../helpers/automatic-ai-harness.mjs";

assert.equal(DEFAULT_SETTINGS.dailyAiLimit, 160);
assert.equal(normalizeSettings({}).dailyAiLimit, 160);
for (const limit of [50, 100, 160, 200]) assert.equal(normalizeSettings({ dailyAiLimit: limit }).dailyAiLimit, limit,
  "changing the default must preserve saved limits");

const native = id => syntheticArticle(id, { title: `产品更新 ${id}`, excerpt: "更新改善显示效果，并支持现有设备。", contentLocale: "zh-CN" });
const translated = { title: "显示功能更新", summary: ["这次更新改善显示效果，并支持现有设备。"] };
for (const scenario of ["native", "foreign", "translation-batch"]) {
  let repaired = false;
  const make = scenario === "native" ? native : syntheticArticle;
  const h = createAutomaticAiHarness({ articles: [make("retry-fail"), make("already-good")],
    settings: scenario === "translation-batch" ? { mcpEnabled: true, dashboardMode: "bot" } : {},
    providerResponse: request => {
      if (request.kind === "translation-batch") return JSON.stringify({ translations: JSON.parse(request.input).translations.map(item => ({ id: item.id,
        ...(!repaired && item.title.includes("retry-fail") ? { title: "Wrong language", summary: ["This remains in English."] } : translated) })) });
      if (request.articleId === "retry-fail" && !repaired) return WRONG_CARD;
    },
  });
  await h.run(undefined, { organize: false });
  await h.service.organizeNews(); await h.service.waitForOrganization();
  const failed = h.records.get("feed").items.find(item => item.articleId === "retry-fail");
  assert.equal(h.statuses.at(-1).phase, "partial");
  assert.equal(h.statuses.at(-1).failed, 1);
  assert(Date.parse(failed.summaryRetry.nextEligibleAt) > Date.now(), "failed output enters its automatic cooldown");
  const summaries = () => h.requests.filter(request => request.kind !== "digest");
  const firstCalls = summaries().length;
  await h.run();
  assert.equal(summaries().length, firstCalls, "background refresh must still respect the cooldown");
  const completedAt = h.records.get("feed").items.find(item => item.articleId === "already-good").summarizedAt;
  const quotaBefore = (await h.quota.read(20)).used, requestsBefore = h.requests.length;
  repaired = true;
  const started = await Promise.all([h.service.organizeNews(), h.service.organizeNews()]);
  await h.service.waitForOrganization();
  assert.equal(started.filter(result => result.started).length, 1, "repeated clicks coalesce into one retry");
  const retry = h.requests.slice(requestsBefore);
  assert.equal(retry.length, 1, "an explicit retry immediately sends only the unfinished entry");
  if (scenario === "translation-batch") {
    assert.equal(retry[0].kind, "translation-batch");
    const inputs = JSON.parse(retry[0].input).translations;
    assert.equal(inputs.length, 1); assert(inputs[0].title.includes("retry-fail"));
  } else assert.equal(retry[0].articleId, "retry-fail");
  assert.equal(h.records.get("feed").items.find(item => item.articleId === "already-good").summarizedAt, completedAt, "successful cached entries are not regenerated");
  assert.equal(h.records.get("feed").items.find(item => item.articleId === "retry-fail").summaryRetry, undefined);
  assert.equal(h.statuses.at(-1).phase, "completed");
  assert.equal(h.statuses.at(-1).processed, 1);
  assert.equal(h.statuses.at(-1).deferred, 0);
  assert.equal((await h.quota.read(20)).used, quotaBefore + 1);
}
{
  const h = createAutomaticAiHarness({ articles: [native("retry-fail")], providerResponse: request => request.kind === "card" ? WRONG_CARD : undefined });
  await h.run(undefined, { organize: false });
  await h.service.organizeNews(); await h.service.waitForOrganization();
  await h.service.organizeNews(); await h.service.waitForOrganization();
  assert.equal(h.requests.filter(request => request.kind === "card").length, 4, "each click allows only the existing single correction attempt");
  assert.equal(h.records.get("feed").items.find(item => item.articleId === "retry-fail").summaryRetry.failures, 2);
  await h.run();
  assert.equal(h.requests.filter(request => request.kind === "card").length, 4, "failed explicit retries retain a background cooldown");
}
for (const blockedBy of ["quota", "permission"]) {
  const h = createAutomaticAiHarness({ articles: [native("retry-fail")], dailyAiLimit: blockedBy === "quota" ? 1 : 20,
    providerResponse: () => WRONG_CARD });
  await h.run(undefined, { organize: false });
  await h.service.organizeNews(); await h.service.waitForOrganization();
  if (blockedBy === "permission") h.control.permitted = false;
  const before = h.requests.length;
  await h.service.organizeNews(); await h.service.waitForOrganization();
  assert.equal(h.requests.length, before, "explicit retries must preserve quota and source-permission checks");
}
console.log("Explicit organization retry and default allowance tests passed");
