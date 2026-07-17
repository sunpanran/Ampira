import assert from "node:assert/strict";
import {
  aiOutputMatchesLocale,
  aiOutputPartsMatchLocale,
  readerTranslationMatchesLocale,
  visibleAiProse,
} from "../../extension/core/ai-output-language.mjs";
import { shouldReleaseAutomaticAiQuota } from "../../extension/core/quota.mjs";

assert.equal(aiOutputMatchesLocale("好的。", "zh-CN"), true, "short Simplified Chinese answers must pass");
assert.equal(aiOutputMatchesLocale("Yes.", "zh-CN"), false, "short English answers must fail a Chinese target");
assert.equal(aiOutputMatchesLocale("使用 OpenAI API 整理 GPT-5 输出。", "zh-CN"), true, "Chinese prose may contain product and API names");
assert.equal(aiOutputMatchesLocale("這是一個完整的繁體中文回答。", "zh-CN"), false, "Traditional Chinese prose must fail a Simplified Chinese target");
assert.equal(aiOutputMatchesLocale("這是一個完整的繁體中文回答。", "zh-Hant"), true, "Traditional Chinese prose must pass its target");
assert.equal(aiOutputMatchesLocale("这是一个完整的简体中文回答。", "zh-Hant"), false, "Simplified Chinese prose must fail a Traditional Chinese target");
assert.equal(aiOutputMatchesLocale("Yes.", "en"), true, "short English answers must pass");
assert.equal(aiOutputMatchesLocale("可以。", "en"), false, "short Chinese answers must fail an English target");
assert.equal(aiOutputMatchesLocale("Use OpenAI with 北京 data sources.", "en"), true, "English prose may contain Chinese proper names");
assert.equal(aiOutputMatchesLocale("```js\nconst locale = 'en';\n```\nhttps://example.com/v1", "zh-CN"), true, "code and URLs alone must remain language-neutral");
assert.equal(visibleAiProse("RANK 1: 90\nTITLE 1: 中文标题\nOVERVIEW: 中文结论"), "中文标题 中文结论", "digest control prefixes must not affect classification");
assert.equal(aiOutputPartsMatchLocale(["中文总览", "English generated title"], "zh-CN"), false, "every generated structured field must match the target locale");
const mixedReaderTranslation = "English article title\n\n这是一个足够长的简体中文翻译正文，不能掩盖标题使用了错误的界面语言。";
assert.equal(aiOutputMatchesLocale(mixedReaderTranslation, "zh-CN"), true, "the aggregate classifier fixture must demonstrate the masked-title regression");
assert.equal(readerTranslationMatchesLocale(mixedReaderTranslation, "zh-CN"), false, "Reader titles and bodies must pass locale validation independently");
assert.equal(readerTranslationMatchesLocale("中文文章标题\n\n这是符合当前界面语言的翻译正文。", "zh-CN"), true, "a fully localized Reader translation must pass");
assert.equal(readerTranslationMatchesLocale("这是没有独立标题的中文翻译正文。", "zh-CN"), true, "single-part Reader output must remain supported");
assert.equal(shouldReleaseAutomaticAiQuota({ code: "AI_WRONG_LANGUAGE" }), false, "a completed but unusable language retry must consume its single automatic task quota");
assert.equal(shouldReleaseAutomaticAiQuota({ code: "AI_HTTP_ERROR" }), true, "provider failures before a usable response must release automatic quota");

console.log("AI output language tests passed");
