import { createBotSummaryService } from "../../extension/runtime/bot-summary-service.mjs";
import { syncSummaries, pendingSummary, completeSummaries } from "../../integrations/local-mcp/summary-queue.mjs";
import { createQuotaManager } from "../../extension/core/quota.mjs";
import { filterPresentableFeedItems } from "../../extension/core/feed-language-policy.mjs";
import { syntheticArticle } from "./automatic-ai-harness.mjs";

export const summaryText = { title: "产品显示功能更新", summary: ["这次更新改善显示效果，并支持现有设备。"] };
export function createBotSummaryHarness({ limit = 50, count = 20 } = {}) {
  const settings = { mcpEnabled: true, dashboardMode: "bot", botOrganizeNews: true, uiLocale: "zh-CN", cardSummaryEnabled: true, dailyAiLimit: limit };
  const articles = Array.from({ length: count }, (_, index) => syntheticArticle(`item-${index}`, index % 2
    ? { title: `产品显示更新 ${index}`, excerpt: "更新改善画面显示，现有设备可以获得支持。", contentLocale: "zh-CN" }
    : { externalDiscovery: true }));
  const records = new Map([["feed", { items: articles }]]), jobs = {}, calls = [], events = [], statuses = [], storage = {};
  const quota = createQuotaManager({ get: async key => ({ [key]: storage[key] }), set: async value => Object.assign(storage, value) });
  let permitted = true, epoch = 0, afterTransport, offline = false, briefCalls = 0;
  const configuration = { connectionId: "synthetic", connection: { endpoint: "http://127.0.0.1:43123" } };
  const service = createBotSummaryService({
    getSettings: async () => settings, settingsLocale: value => value.uiLocale,
    getRecord: async (key, fallback) => structuredClone(records.get(key) || fallback), setRecord: async (key, value) => records.set(key, structuredClone(value)),
    cacheMutations: { capture: () => epoch, isCurrent: value => epoch === value, run: async (action, value = epoch) => action(() => epoch === value) },
    capturePermissionEpoch: () => epoch, isPermissionEpochCurrent: value => epoch === value,
    selectPermitted: async (_settings, items) => permitted ? items : [],
    presentable: async items => filterPresentableFeedItems(items, "zh-CN", { aiConfigured: false }),
    quotaManager: quota, setAiAutoStatus: async value => statuses.push(value), onComplete: async () => { briefCalls++; },
    broadcast: (type, payload) => events.push({ type, payload }),
    botBoard: { config: async () => configuration, syncSummaries: async (input, cleanup) => {
      calls.push({ input, cleanup });
      if (offline) throw new Error("Synthetic offline companion");
      const result = syncSummaries(jobs, input);
      if (afterTransport) { const action = afterTransport; afterTransport = null; action(); }
      return result;
    } },
  });
  const answer = () => { const task = pendingSummary(jobs); return task && completeSummaries(jobs, { taskId: task.id, summaries: task.items.map(item => ({ id: item.id, ...summaryText })) }); };
  return { service, settings, configuration, articles, records, jobs, calls, events, statuses, quota, answer,
    interrupt: action => { afterTransport = action; }, revoke: () => { permitted = false; epoch++; },
    offline: value => { offline = value; }, briefCalls: () => briefCalls,
    drain: async () => { for (let i = 0; i < 100 && (await service.status()).running; i++) { answer(); await service.sync(); } },
  };
}
