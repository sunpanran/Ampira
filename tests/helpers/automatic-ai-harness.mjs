import { createRefreshService } from "../../extension/runtime/refresh-service.mjs";
import { createAiSearchService } from "../../extension/runtime/ai-search-service.mjs";
import { createRuntimeStatusStore } from "../../extension/runtime/status-store.mjs";
import { createQuotaManager, shouldReleaseAutomaticAiQuota } from "../../extension/core/quota.mjs";
import { localDateKey } from "../../extension/core/news-ranking.mjs";

import { filterPresentableFeedItems } from "../../extension/core/feed-language-policy.mjs";
import { originPattern } from "../../extension/core/permission-state.mjs";
import { typedError } from "../../extension/runtime/runtime-result.mjs";
import { translate } from "./full-i18n.mjs";

export const GOOD_CARD = "标题：Apple Vision Pro 推出更新\n这次更新改善了显示效果，并向现有用户开放。\n具体适用设备以官方公布的名单为准。";
export const WRONG_CARD = "Title: A new product update\nThe update improves display quality for existing users.\nThe official list describes supported devices.";

export function syntheticArticle(id, extra = {}) {
  return {
    articleId: id, entryKey: id, sourceKey: "fixture", source: "Synthetic News",
    sourceOrigin: "https://news.example", fetchOrigin: "https://news.example",
    url: `https://news.example/${id}`, title: `Product update ${id}`,
    excerpt: "The product update improves the display quality and supports existing devices.",
    contentLocale: "en", publishedAt: new Date().toISOString(), rankingEligible: true,
    score: 50, ...extra,
  };
}

export function createAutomaticAiHarness({ articles, dailyAiLimit = 20, providerResponse, settings: overrides = {}, runtime = {} }) {
  const settings = {
    bookmarkConsentGranted: true, uiLocale: "zh-CN", cardSummaryEnabled: true,
    openaiBaseUrl: "https://ai.example/v1", openaiSummaryModel: "synthetic-model",
    openaiApiStyle: "chat-completions", credentialGeneration: 1, dailyAiLimit,
    hotNewsCacheSize: 192, hotNewsEntriesPerSource: 30, todayNewsPerPublisherLimit: 0,
    ...overrides,
  };
  const records = new Map();
  const requests = [];
  const statuses = [];
  const events = [];
  const control = { active: true, permitted: true, articles: structuredClone(articles), settings };
  const storage = {};
  const quota = createQuotaManager({
    get: async (key) => ({ [key]: storage[key] }),
    set: async (value) => Object.assign(storage, value),
  });
  const sources = [...new Map(articles.map((item) => [item.sourceKey, {
    key: item.sourceKey, url: item.sourceOrigin, externalDiscovery: item.externalDiscovery === true,
  }])).values()];
  const permissions = async () => ({
    sources, permitted: control.permitted ? sources : [], denied: control.permitted ? [] : sources,
    grantedOrigins: control.permitted ? sources.map((source) => originPattern(source.url)) : [],
    permittedByKey: new Map(control.permitted ? sources.map((source) => [source.key, originPattern(source.url)]) : []),
  });
  const assertPermitted = async () => {
    if (!control.permitted) throw typedError("SOURCE_PERMISSION_CHANGED", "background.error.sourcePermission");
    return { origins: ["https://news.example"] };
  };
  const getRecord = async (key, fallback = null) => {
    if (key === "refresh-source-cursor" && control.refreshError) {
      control.refreshFailures = (control.refreshFailures || 0) + 1;
      throw new Error("Synthetic refresh storage failure");
    }
    return structuredClone(records.get(key) ?? fallback);
  };
  const setRecord = async (key, value) => records.set(key, structuredClone(value));
  const cacheMutations = {
    capture: () => 0, isCurrent: () => control.active,
    run: async (operation) => operation(() => control.active),
  };
  const getSettings = async () => structuredClone(settings);
  const statusStore = createRuntimeStatusStore({
    getRecord, setRecord, createStages: () => [], readUsage: async () => (await quota.read(dailyAiLimit)).used,
    broadcast: (type, value) => {
      events.push({ type, value: structuredClone(value) });
      if (value.autoStatus) statuses.push(structuredClone(value.autoStatus));
    },
  });
  const ai = createAiSearchService({
    getSettings, settingsLocale: (value) => value.uiLocale, translate, typedError,
    normalizeSettings: (value) => value,
    readProviderProfile: async () => ({ ...settings, openaiApiKey: "synthetic-test-key" }),
    readDeviceConsent: async () => ({ aiDisclosureAccepted: true }),
    providerRequiresApiKey: () => true, hasOriginPermission: async () => true,
    hasOriginPermissions: async () => true, aiAccessPolicy: {},
    requestAiCompletion: async (_settings, request) => {
      await request.validateRequest();
      const kind = request.system.includes("AMPIRA_TRANSLATION_BATCH") ? "translation-batch" : request.system.includes("OVERVIEW:") ? "digest" : "card";
      const article = kind === "card" ? control.articles.find((item) => request.input.includes(item.url)) : null;
      const entry = { kind, articleId: article?.articleId, system: request.system, input: request.input };
      requests.push(entry);
      const supplied = providerResponse ? await providerResponse(entry, control, requests) : undefined;
      if (supplied !== undefined) return supplied;
      if (kind === "translation-batch") return JSON.stringify({ translations: JSON.parse(request.input).translations.map(item => ({
        id: item.id, title: "产品显示功能更新", summary: ["这次更新改善显示效果，并支持现有设备。"],
      })) });
      return kind === "card" ? GOOD_CARD
        : "OVERVIEW: 多个产品公布了显示功能更新，现有设备可以获得改进。\nOVERVIEW: 更新范围以各自公布的设备名单为准。\nOVERVIEW: 后续关注实际推出时间。\nRANK 1: 80\nTITLE 1: 产品显示更新";
    },
  });
  const presentable = (items, value, ready) => filterPresentableFeedItems(items, value.uiLocale, {
    aiConfigured: ready, providerOrigin: value.openaiBaseUrl,
  });
  const service = createRefreshService({
    ...statusStore, getSettings, cacheMutations,
    refreshCoordinator: { isCurrent: (value) => value === 1 && control.active },
    currentBookmarkModel: async () => ({ bookmarks: sources }), emptyBookmarkModel: () => ({ bookmarks: [] }),
    currentFeedPermissionState: permissions, getRecord, setRecord,
    setRecords: async (writes) => { for (const write of writes) await setRecord(write.key, write.value); },
    broadcast: (type, value) => events.push({ type, value }),
    fetchSourceArticles: async (source) => ({
      items: structuredClone(control.articles.filter((item) => item.sourceKey === source.key)), outcome: "success",
    }),
    sourceFetchOptions: () => ({}), assertFeedItemsStillPermitted: assertPermitted,
    withFeedCacheMetadata: (value) => value, aiConfigured: async () => true,
    readQuota: (limit) => quota.read(limit),
    runAiWithinQuota: async (value, operation) => {
      const reservation = await quota.reserve(value.dailyAiLimit);
      if (!reservation) return { usedAi: false, value: null };
      try { return { usedAi: true, value: await operation() }; }
      catch (error) { if (shouldReleaseAutomaticAiQuota(error)) await quota.release(reservation); throw error; }
    },
    runAiBatchWithinQuota: async (value, count, operation) => {
      const reservation = await quota.reserve(value.dailyAiLimit, count);
      if (!reservation) return { usedAi: false, value: null };
      try { return { usedAi: true, value: await operation(reservation.units) }; }
      catch (error) { if (shouldReleaseAutomaticAiQuota(error)) await quota.release(reservation); throw error; }
    },
    callProvider: ai.callProvider, digestCachePermitted: () => true, presentableFeedItems: presentable,
    localDateKey, sanitizeDailyDigest: async (digest) => ({ digest, cacheEpoch: 0, permissionEpoch: 0 }),
    isPermissionEpochCurrent: () => control.active && control.permitted,
    feedImageService: { enrichMissingFeedImages: async () => {}, updateImageQualityMetrics: () => {} },
    ...runtime,
  });
  return { service, control, requests, records, statuses, events, quota, run: async (signal, options = {}) => {
    await service.runRefresh(1, { signal, ...options }); await service.waitForOrganization();
  } };
}
