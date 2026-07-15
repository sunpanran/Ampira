import assert from "node:assert/strict";
import { translate, translateAiPrompt } from "../../extension/core/i18n.mjs";
import { normalizeUserUrl } from "../../extension/core/search.mjs";
import { readerTextFromBlocks } from "../../extension/core/reader.mjs";
import { limitArticleSummary, normalizeArticleContext } from "../../extension/core/ai-search.mjs";
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

const harness = createHarness();
const initial = await harness.service.answerAiSearch({ query: "https://news.example/article" });
assert.equal(initial.usedAi, true);
assert.equal(initial.mode, "article");
assert.equal([...initial.answer].length <= 500, true, "provider output must be bounded before it is cached or rendered");
assert.equal(harness.requests[0].maxTokens, 900, "article explanations must use their compact output budget");
assert.equal(harness.requests[0].preferVisibleOutput, true, "article explanations should disable avoidable hidden reasoning where supported");
const excerpt = harness.requests[0].input.split("网页摘录：")[1] || "";
assert.equal([...excerpt].length, 8000, "article explanations must send at most 8,000 source characters");
assert(harness.hashInputs.some((value) => value.includes("5:")), "the compact prompt must invalidate older AI search cache entries");
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

console.log("AI search tests passed");

function createHarness({ cachedArticleError = null, changeProviderDuringValidation = false } = {}) {
  const settings = {
    uiLocale: "zh-CN",
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
  const service = createAiSearchService({
    getRecord: async (_key, fallback) => fallback,
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
      return "核心判断：" + "结论。".repeat(100) + "\n关键信息：\n• " + "事实。".repeat(120);
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
