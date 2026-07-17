import assert from "node:assert/strict";
import { translate, translateAiPrompt } from "../../extension/core/i18n.mjs";
import { normalizeUserUrl } from "../../extension/core/search.mjs";
import { readerTextFromBlocks } from "../../extension/core/reader.mjs";
import { limitArticleSummary, normalizeArticleContext, normalizeQuestionContext } from "../../extension/core/ai-search.mjs";
import { createAiSearchService } from "../../extension/runtime/ai-search-service.mjs";

assert.equal([...limitArticleSummary("甲".repeat(600), "zh-CN")].length, 500, "Chinese article explanations must enforce the 500-character boundary");
assert(limitArticleSummary("甲".repeat(600), "zh-CN").endsWith("…"), "truncated Chinese explanations must disclose truncation");
assert.equal(limitArticleSummary(Array.from({ length: 240 }, (_, index) => `word${index}.`).join(" "), "en").split(/\s+/).length <= 180, true, "English article explanations must enforce the 180-word boundary");

const boundedContext = normalizeArticleContext({
  type: "article",
  url: "https://news.example/article",
  summary: "摘要".repeat(300),
  turns: Array.from({ length: 9 }, (_, index) => ({
    question: `question-${index}-${"问".repeat(600)}`,
    answer: `answer-${index}-${"答".repeat(1300)}`,
  })),
}, "zh-CN", normalizeUserUrl);
assert.equal(boundedContext.turns.length <= 6, true, "article follow-up context must retain at most six completed turns");
assert.equal(boundedContext.turns.reduce((total, turn) => total + [...turn.question, ...turn.answer].length, 0) <= 4000, true, "article follow-up history must stay within 4,000 Unicode characters");
assert(boundedContext.turns.at(-1).question.startsWith("question-8-"), "history trimming must preserve the newest completed turn");

const boundedQuestionContext = normalizeQuestionContext({
  type: "question",
  initialQuery: "Ampira 有哪些搜索方式？",
  initialAnswer: "Ampira 支持本地内容搜索和 AI 问答。",
  turns: Array.from({ length: 9 }, (_, index) => ({
    question: `question-${index}-${"问".repeat(600)}`,
    answer: `answer-${index}-${"答".repeat(1300)}`,
  })),
});
assert.equal(boundedQuestionContext.turns.length <= 6, true, "question follow-up context must retain at most six completed turns");
assert.equal(boundedQuestionContext.turns.reduce((total, turn) => total + [...turn.question, ...turn.answer].length, 0) <= 4000, true, "question follow-up history must stay within 4,000 Unicode characters");
assert.equal(normalizeQuestionContext({ type: "question", initialQuery: "", initialAnswer: "answer" }), null, "question follow-up context must require its initial question");

const harness = createHarness();
const initial = await harness.service.answerAiSearch({ query: "https://news.example/article" });
assert.equal(initial.usedAi, true);
assert.equal(initial.mode, "article");
assert.equal([...initial.answer].length <= 500, true, "provider output must be bounded before it is cached or rendered");
assert.equal(harness.requests[0].maxTokens, 900, "article explanations must use their compact output budget");
assert.equal(harness.requests[0].preferVisibleOutput, true, "article explanations should disable avoidable hidden reasoning where supported");
const excerpt = harness.requests[0].input.split("网页摘录：")[1] || "";
assert.equal([...excerpt].length, 8000, "article explanations must send at most 8,000 source characters");
assert(harness.hashInputs.some((value) => value.includes("6:")), "the language-guarded prompt must invalidate older AI search cache entries");
assert.equal(harness.cacheWrites.length, 1, "the initial article explanation should remain cacheable");

const followup = await harness.service.answerAiSearch({
  query: "其中最关键的限制是什么？",
  articleContext: {
    type: "article",
    url: "https://news.example/article",
    summary: initial.answer,
    turns: Array.from({ length: 8 }, (_, index) => ({ question: `追问 ${index}`, answer: `回答 ${index}` })),
  },
});
assert.equal(followup.usedAi, true);
assert.equal(followup.mode, "article-followup");
assert.equal(harness.cachedArticleReads, 1, "follow-up questions must prefer the permission-bound Reader cache");
assert.equal(harness.liveArticleReads, 1, "follow-up questions must not repeat the initial live article read when cache is available");
assert.equal(harness.cacheWrites.length, 1, "follow-up answers must not create persistent AI search cache entries");
assert.equal(harness.requests.at(-1).maxTokens, 900);
assert(harness.requests.at(-1).input.includes("当前问题：其中最关键的限制是什么？"));

const questionHarness = createHarness();
const question = await questionHarness.service.answerAiSearch({ query: "Ampira 如何整理内容？" });
assert.equal(question.usedAi, true);
assert.equal(question.mode, "dashboard");
const questionFollowup = await questionHarness.service.answerAiSearch({
  query: "能具体一点吗？",
  questionContext: {
    type: "question",
    initialQuery: "Ampira 如何整理内容？",
    initialAnswer: question.answer,
    turns: [{ question: "适合日常使用吗？", answer: "适合。" }],
  },
});
assert.equal(questionFollowup.usedAi, true);
assert.equal(questionFollowup.mode, "question-followup");
assert(questionHarness.requests.at(-1).input.includes("首轮问题：Ampira 如何整理内容？"));
assert(questionHarness.requests.at(-1).input.includes("当前问题：能具体一点吗？"));
assert.equal(questionHarness.cacheWrites.length, 1, "question follow-up answers must not create persistent AI search cache entries");

const permissionFailure = createHarness({ cachedArticleError: typedError("ORIGIN_PERMISSION_REQUIRED", "background.error.websitePermission", { origin: "https://news.example" }) });
const denied = await permissionFailure.service.answerAiSearch({
  query: "还能继续吗？",
  articleContext: { type: "article", url: "https://news.example/article", summary: "摘要", turns: [] },
});
assert.equal(denied.usedAi, false);
assert.equal(denied.errorKey, "background.error.websitePermission");
assert.equal(permissionFailure.requests.length, 0, "revoked website access must block the provider call");

const changedProvider = createHarness({ changeProviderDuringValidation: true });
const changed = await changedProvider.service.answerAiSearch({ query: "https://news.example/article" });
assert.equal(changed.usedAi, false);
assert.equal(changed.errorKey, "background.error.aiConfigurationChanged", "a provider change before dispatch must reject the stale request");
assert.equal(changedProvider.cacheWrites.length, 0);

const wrongThenCorrect = createHarness({ providerResponses: [
  "This response is in English and must be rejected.",
  "核心判断：这是符合当前界面语言的结论。\n关键信息：\n• 这是经过纠正后的事实说明。",
] });
const corrected = await wrongThenCorrect.service.answerAiSearch({ query: "https://news.example/article" });
assert.equal(corrected.usedAi, true);
assert.equal(corrected.answer.includes("符合当前界面语言"), true);
assert.equal(wrongThenCorrect.requests.length, 2, "a wrong-language response must trigger exactly one repair request");
assert.equal(wrongThenCorrect.cacheWrites.length, 1, "only the corrected response may be cached");
assert(wrongThenCorrect.requests[1].system.includes("outputLanguageRepair") === false, "the repair instruction must be localized instead of exposing its message key");
assert(wrongThenCorrect.requests[1].system.includes("上一次输出没有遵守"), "the second request must include the stronger language repair instruction");

const wrongTwice = createHarness({ providerResponses: [
  "This response is in English and must be rejected.",
  "The retry is still in English and must also be rejected.",
] });
const rejected = await wrongTwice.service.answerAiSearch({ query: "https://news.example/article" });
assert.equal(rejected.usedAi, false);
assert.equal(rejected.errorKey, "background.error.aiWrongLanguage");
assert.equal(wrongTwice.requests.length, 2, "language repair must stop after one retry");
assert.equal(wrongTwice.cacheWrites.length, 0, "wrong-language responses must never be cached");

const localeChanged = createHarness({ changeLocaleAfterResponse: true });
const stale = await localeChanged.service.answerAiSearch({ query: "https://news.example/article" });
assert.equal(stale.locale, "en");
assert.equal(stale.usedAi, false);
assert.equal(stale.errorKey, "background.error.aiLocaleChanged");
assert.equal(stale.answer, translate("en", "background.error.aiLocaleChanged"));
assert.equal(localeChanged.cacheWrites.length, 0, "a response generated for the previous locale must not be cached or relabeled");

const poisonedCache = createHarness({ cachedAiResult: {
  ok: true,
  locale: "zh-CN",
  type: "url",
  mode: "article",
  answer: "This cached AI response is still in English.",
  links: [{ title: "Fixture article", url: "https://news.example/article" }],
  usedAi: true,
} });
const refreshedCache = await poisonedCache.service.answerAiSearch({ query: "https://news.example/article" });
assert.equal(refreshedCache.cached, undefined);
assert.equal(refreshedCache.usedAi, true);
assert.equal(poisonedCache.requests.length, 1, "a cached response that fails language validation must be regenerated");

for (const [uiLocale, wrongResponse, correctResponse] of [
  ["en", "这是错误的简体中文回答。", "This corrected answer is written in the current interface language."],
  ["zh-Hant", "这是错误的简体中文回答。", "這是符合目前介面語言的繁體中文回答。"],
]) {
  const localizedRepair = createHarness({ uiLocale, providerResponses: [wrongResponse, correctResponse] });
  const localizedResult = await localizedRepair.service.answerAiSearch({ query: "https://news.example/article" });
  assert.equal(localizedResult.usedAi, true, `${uiLocale} repair must return the corrected provider response`);
  assert.equal(localizedResult.answer.includes(correctResponse), true);
  assert.equal(localizedRepair.requests.length, 2, `${uiLocale} repair must make exactly two provider requests`);
  assert(localizedRepair.requests[0].system.startsWith(`AMPIRA_OUTPUT_LOCALE=${uiLocale}`));
}

console.log("AI search tests passed");

function createHarness({
  cachedArticleError = null,
  changeProviderDuringValidation = false,
  providerResponses = null,
  changeLocaleAfterResponse = false,
  cachedAiResult = null,
  uiLocale = "zh-CN",
} = {}) {
  const settings = {
    uiLocale,
    bookmarkConsentGranted: false,
    openaiBaseUrl: "https://api.example/v1",
    openaiApiStyle: "chat_completions",
    openaiSummaryModel: "example-model",
    credentialGeneration: 3,
  };
  const provider = { ...settings, openaiApiKey: "test-key" };
  const reader = {
    requestedUrl: "https://news.example/article",
    url: "https://news.example/article",
    canonicalUrl: "https://news.example/article",
    title: "Fixture article",
    siteName: "Fixture News",
    description: "",
    blocks: [{ type: "paragraph", runs: [{ text: "正".repeat(10000) }] }],
  };
  const requests = [];
  const cacheWrites = [];
  const hashInputs = [];
  let liveArticleReads = 0;
  let cachedArticleReads = 0;
  let providerReads = 0;
  let providerResponseIndex = 0;
  const service = createAiSearchService({
    getRecord: async (key, fallback) => String(key).startsWith("search-") && cachedAiResult ? cachedAiResult : fallback,
    setRecord: async (key, value, kind) => { cacheWrites.push({ key, value, kind }); },
    searchFeed: () => [],
    settingsLocale: (value) => value.uiLocale,
    translate,
    translateAiPrompt,
    normalizeUserUrl,
    hasOriginPermission: async () => true,
    secretStatus: async () => ({}),
    currentFeedPermissionState: async () => ({ permitted: [], grantedOrigins: [], permittedByKey: new Map() }),
    getSettings: async () => settings,
    currentBookmarkModel: async () => ({ bookmarks: [] }),
    emptyBookmarkModel: () => ({ bookmarks: [] }),
    assertUrlsStillPermitted: async () => true,
    cacheSourceIdentitiesPermitted: () => true,
    configuredFeedSources: () => [],
    readArticle: async () => { liveArticleReads += 1; return reader; },
    readCachedArticle: async () => {
      cachedArticleReads += 1;
      if (cachedArticleError) throw cachedArticleError;
      return { ...reader, source: "cache" };
    },
    readWebsiteOverview: async () => reader,
    hashText: (value) => { hashInputs.push(value); return `hash-${hashInputs.length}`; },
    aiConfigured: async () => true,
    requestAiCompletion: async (_providerSettings, request) => {
      await request.validateRequest();
      requests.push(request);
      const responses = providerResponses || ["核心判断：" + "结论。".repeat(100) + "\n关键信息：\n• " + "事实。".repeat(120)];
      const response = responses[Math.min(providerResponseIndex, responses.length - 1)];
      providerResponseIndex += 1;
      if (changeLocaleAfterResponse) settings.uiLocale = "en";
      return response;
    },
    providerOrigin: (value) => new URL(value).origin,
    readProviderProfile: async () => {
      providerReads += 1;
      return changeProviderDuringValidation && providerReads > 1
        ? { ...provider, credentialGeneration: provider.credentialGeneration + 1 }
        : provider;
    },
    readDeviceConsent: async () => ({ aiDisclosureAccepted: true }),
    readSecrets: async () => ({}),
    providerTestApiKey: () => "test-key",
    providerTestConsentAllowed: () => true,
    providerCredentialAvailable: () => true,
    providerRequiresApiKey: () => true,
    isValidServiceUrl: () => true,
    typedError,
    resultMessage: (_settings, ok, key) => ({ ok, message: translate("zh-CN", key) }),
    errorResult: (_settings, error) => ({ ok: false, error }),
    testImageSearchConnection: async () => ({ count: 0 }),
    safeOrigin: (value) => { try { return new URL(value).origin; } catch { return ""; } },
    uniqueStrings: (values) => [...new Set(values)],
    withFeedCacheMetadata: (value, _items, capability, providerUrl = "") => ({
      ...value,
      capability,
      sourceIdentities: [],
      ...(providerUrl ? { providerOrigin: new URL(providerUrl).origin } : {}),
    }),
    filterFeedItemsBySources: (items) => items,
    cacheMutations: { capture: () => 1, isCurrent: () => true, run: async (operation) => operation(() => true) },
    hasOriginPermissions: async () => true,
    cacheUrlsPermitted: async () => true,
    localDateKey: () => "2026-07-15",
    readerTextFromBlocks,
    assertFeedItemsStillPermitted: async () => true,
    normalizeSettings: (value) => value,
    aiAccessPolicy: {
      currentProviderCapability: async () => ({ configured: true, provider }),
      aiSearchResultPermitted: async () => true,
    },
  });
  return {
    service,
    requests,
    cacheWrites,
    hashInputs,
    get liveArticleReads() { return liveArticleReads; },
    get cachedArticleReads() { return cachedArticleReads; },
  };
}

function typedError(code, messageKey, messageParams = {}) {
  return Object.assign(new Error(messageKey), { code, messageKey, messageParams, retryable: false });
}
