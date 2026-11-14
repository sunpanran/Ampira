import { createSwitchableCardView } from "../../assets/client/switchable-card-view.mjs";
import { createFocusCardState } from "../../assets/client/focus-card-state.mjs";
import { createTopicsCardState } from "../../assets/client/topics-card-state.mjs";
import { createActivityController } from "../../assets/client/activity-controller.mjs";
import { createInitialState } from "../../assets/client/state.mjs";
import { createIcon } from "../../assets/client/icons.mjs";
import { createEmptyState } from "../../assets/client/ui-primitives.mjs";
import { hydrateStorage, applyExternalStoragePatch, readJson, writeJson, flushStorage } from "../../assets/client/storage.mjs";
import { sendExtensionRequest as request } from "../../assets/client/api.mjs";
import { t, tc, getLocale, prepareLocale, setLocale } from "../../assets/client/i18n.mjs";
import { displaySummaryTitle, itemUrl } from "../../assets/client/item-presenter.mjs";
import { FOCUS_STATE_KEY, normalizeFocusState } from "../../extension/core/focus.mjs";
import { TRACKED_TOPICS_KEY, normalizeTrackedTopics } from "../../extension/core/tracked-topics.mjs";
import { TODO_ITEMS_KEY, normalizeTodoItems } from "../../assets/client/utility-card-model.mjs";

const root = document.getElementById("personal-fixture");
const types = { utility: "focus", digest: "topics", archive: "todo", news: "focus", inspiration: "topics", queue: "todo" };
if (new URL(location.href).searchParams.has("seed")) {
  await request({ type: "client-state:set", payload: { values: {
    [FOCUS_STATE_KEY]: JSON.stringify(normalizeFocusState(null)),
    [TRACKED_TOPICS_KEY]: JSON.stringify(normalizeTrackedTopics({ topics: [
      { id: "video", name: "AI 视频", words: ["AI 视频", "视频生成", "镜头"], source: "all" },
      { id: "blender", name: "Blender", words: ["Blender"], source: "all" },
    ] })),
    [TODO_ITEMS_KEY]: JSON.stringify([{ id: "fixture-task", text: "完成项目方案", createdAt: new Date().toISOString(), completed: false, completedAt: "" }]),
    "dash.dashboard.cardTypes.v1": JSON.stringify(types),
  } } });
}
await hydrateStorage(); await prepareLocale("zh-CN"); setLocale("zh-CN", { persist: false });
const state = createInitialState();
state.cardTypes = { ...types }; state.settings = {};
const entries = [
  ["a", "多镜头生成中的角色一致性", "AI 视频参考与角色一致性检查。", "public-test", "创作笔记"],
  ["b", "参考视频如何影响动作与节奏", "视频生成中的动作参考与节奏控制。", "bookmark-test", "影像手记"],
  ["c", "从分镜到成片：衔接检查清单", "镜头衔接的方向和节奏。", "bookmark-test", "创作笔记"],
  ["d", "Blender 材质与灯光检查", "Blender 材质预览的比较方法。", "bookmark-test", "三维手记"],
].map(([key, title, excerpt, sourceKey, source], index) => ({
  key, sourceKey, url: "https://example.com/fixture/" + key, host: "example.com", publisher: source, cardType: "news",
  title: source, feedItem: { articleId: key, title, excerpt, sourceKey, source, publishedAt: new Date(Date.now() - (index + 1) * 3_600_000).toISOString() },
  summary: { title, description: excerpt, summary: [excerpt], itemUrl: "https://example.com/fixture/" + key },
}));
state.data = { feed: { items: [] }, bookmarks: [] };
const views = new Map();
function renderAll() { for (const view of views.values()) view.render(); }
function receive(values) {
  applyExternalStoragePatch(values);
  state.todos = normalizeTodoItems(readJson(TODO_ITEMS_KEY, []));
  focus.syncFromStorage(); topics.syncFromStorage(); renderAll();
}
const cardRequest = message => {
  if (window.fixture?.failNextCardRequest) { window.fixture.failNextCardRequest = false; throw new Error("Synthetic connection failure"); }
  return request(message);
};
const focus = createFocusCardState({ request: cardRequest, notify: renderAll, onValues: values => {
  if (Object.hasOwn(values, TODO_ITEMS_KEY)) state.todos = normalizeTodoItems(readJson(TODO_ITEMS_KEY, state.todos));
} });
const topics = createTopicsCardState({ request: cardRequest, notify: renderAll });
const activity = createActivityController({
  state, itemUrl, t, readJson, writeJson, request, renderAll, renderEfficiencyPanel: renderAll, renderActivitySurfaces: renderAll,
  newsSummaryItems: () => entries, hostFromUrl: () => "example.com", newsSectionName: () => "News", newsCardType: "news",
  isNewsCard: item => item.cardType === "news", displaySummaryTitle, displayTitle: displaySummaryTitle, displayBookmarkTitle: displaySummaryTitle,
  openExternal: (...args) => { window.fixture.opened = args; }, openExternalWindow() {},
});
for (const [index, id] of Object.keys(types).entries()) {
  const slot = document.createElement("div"); slot.className = "dashboard-slot"; slot.dataset.slotSize = index < 3 ? "compact" : "tall";
  const empty = () => ({ content: document.createElement("div") });
  const view = createSwitchableCardView({
    id, state, t, tc, getLocale, request, readJson, writeJson, createIcon, createEmptyState,
    localizedErrorMessage: error => error.message || String(error),
    weatherState: { read() {} }, getFocusState: async () => focus, getTopicsState: async () => topics,
    notifyTodos: renderAll, onTypeChange: renderAll, newsSummaryItems: () => entries, displaySummaryTitle,
    formatDateTime: value => new Intl.DateTimeFormat(getLocale(), { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value)),
    isQueued: activity.isQueued, toggleReadingQueue: activity.toggleReadingQueue, openDailyItem: activity.openDailyItem,
    attachLinkContextMenu() {}, createDigestContent: empty, createArchiveContent: empty, createQueueContent: empty,
    createEventsContent: () => document.createElement("div"), createDailyContent: empty,
  });
  views.set(id, view); slot.append(view.card); root.append(slot);
  view.card.addEventListener("contextmenu", event => { event.preventDefault(); view.contextActions(event.target).at(-1).action(); });
}
window.addEventListener("ampira:runtime-message", event => {
  if (event.detail.type === "personal-cards.changed" || event.detail.type === "content-sync.changed") receive(event.detail.payload.values);
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") { focus.ensure({ force: true }); topics.ensure({ force: true }); }
});
window.fixture = { state, views, focus, topics, request, readJson, flushStorage, receive, render: renderAll,
  async locale(locale) { await prepareLocale(locale); setLocale(locale, { persist: false }); renderAll(); },
  theme(mode) { document.documentElement.dataset.colorMode = mode; },
};
renderAll();
window.fixtureReady = true;
