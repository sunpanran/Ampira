import { getElementGroups } from "../../assets/client/elements.mjs";
import { createInitialState } from "../../assets/client/state.mjs";
import { createDailyView } from "../../assets/client/daily-view.mjs";
import { createSummaryView } from "../../assets/client/summary-view.mjs";
import { createCardTransition } from "../../assets/client/card-transition.mjs";
import { createSwitchableCardView } from "../../assets/client/switchable-card-view.mjs";
import { createDashboardLayoutController } from "../../assets/client/dashboard-layout-controller.mjs";
import { DASHBOARD_CARD_IDS } from "../../extension/core/dashboard-layout.mjs";
import { createIcon, createThemedIcon, hydrateIcons } from "../../assets/client/icons.mjs";
import { createEmptyState, setIconLabel } from "../../assets/client/ui-primitives.mjs";
import { INSPIRATION_COVER_ASSETS } from "../../assets/client/inspiration-cover.mjs";
import { buildInspirationPreset } from "../../extension/core/inspiration-preset.mjs";
import { localizedCategory } from "../../assets/client/localized-labels.mjs";
import { bindElasticActionFeedback, bindNavigationPressFeedback, playElasticActionFeedback } from "../../assets/client/motion.mjs";
import { getLocale, prepareLocale, setLocale, t, tc } from "../../assets/client/i18n.mjs";

const markup = new DOMParser().parseFromString(await (await fetch("/dashboard.html")).text(), "text/html");
markup.querySelectorAll("script").forEach(node => node.remove());
document.body.replaceChildren(...[...markup.body.children].map(node => document.importNode(node, true)));
await prepareLocale("zh-CN");
setLocale("zh-CN", { persist: false, translate: false });
hydrateIcons();
const els = Object.assign({}, ...Object.values(getElementGroups()));
const state = createInitialState();
state.settings = {};
state.day = "2026-11-15";
state.cardTypes = { utility: "news", digest: "inspiration", archive: "news", news: "news", inspiration: "inspiration", queue: "inspiration" };
const imageUrl = index => new URL(INSPIRATION_COVER_ASSETS[index % INSPIRATION_COVER_ASSETS.length], document.baseURI).href;
state.data = {
  bookmarks: buildInspirationPreset("zh-CN").bookmarks,
  feed: { items: Array.from({ length: 35 }, (_, index) => ({
    articleId: `news-${index}`, sourceKey: "fixture", url: `https://example.com/news-${index}`,
    source: "合成资讯", host: "example.com", title: `城市公共空间与数字设计观察 · ${index + 1}`,
    excerpt: "仅用于本地动效检查的合成内容。核对连续切换时的图文衔接、滚动裁切与焦点保留。",
    imageUrl: imageUrl(index), publishedAt: new Date().toISOString(), score: 100 - index,
  })) },
};
const emptyNode = () => document.createElement("span");
const preview = { get: () => null, fingerprint: () => "fixture", isRejected: () => false,
  request: async () => null, reject: async () => null, rejectUrl() {}, preload: async () => [] };
const cardTransition = createCardTransition({ exitMs: 120, enterMs: 300 });
const summary = createSummaryView({
  state, els, t, localizedCategory: () => "设计观察", formatDateTime: () => "今天", faviconUrl: () => "/favicon.svg",
  createThemedIcon, createReadingActions: emptyNode, createManualSummaryButton: emptyNode,
  attachLinkContextMenu() {}, activateCardFromKeyboard() {}, cardSummaryEnabled: () => false,
  ...cardTransition, createEmptyState, batchLabel: page => `${page.page}/${page.pageCount}`,
  isNewsCard: item => item.cardType === "news", newsSectionName: () => "资讯", openSummaryItem() {}, writeValue() {}, newsPreviews: preview,
});
const layout = createDashboardLayoutController({ state, els, t, request: async () => ({}), localizedErrorMessage: String });
const views = new Map();
const opened = [];
const renderDailyCards = (id, settings) => {
  for (const [key, view] of views) if (!id || key === id) layout.mount(key, view.render([], settings));
};
const daily = createDailyView({
  state, els, dashboardLayout: layout, t, createEmptyState, createThemedIcon, createReadingActions: emptyNode,
  createBookmarkFavicon: () => { const icon = createIcon("news", "bookmark-favicon"); return icon; },
  contextAttachLink() {}, openDailyItem: item => opened.push(item.key), newsSummaryItems: summary.newsSummaryItems, inspirationPreviews: preview,
  faviconUrl: () => "/favicon.svg", writeValue() {}, createNewsRanker: summary.createNewsRanker,
  createSeenButton: emptyNode, displayBookmarkTitle: item => item.title, localizedCategory, openExternal() {},
  persistSeen() {}, renderAll() {}, renderDailyCards, renderTodayMeta() {}, setIconLabel,
  localizedStatusMessage: String, confirmAction: async () => false, cardTransition,
});
for (const id of DASHBOARD_CARD_IDS) {
  const view = createSwitchableCardView({
    id, state, t, tc, getLocale, createIcon, createDailyContent: daily.createDailyContent,
    createDigestContent: () => ({ content: emptyNode() }), createArchiveContent: () => ({ content: emptyNode() }),
    createQueueContent: () => ({ content: emptyNode() }), createEventsContent: emptyNode,
    writeJson() {}, notifyTodos() {}, localizedErrorMessage: String,
    reconcileContent(type, current, next, settings) {
      if (!["news", "inspiration"].includes(type)) return false;
      daily.syncDailyContent(current, next, settings);
      return true;
    },
  });
  views.set(id, view);
}
daily.renderDaily();
summary.renderSummaries({ immediate: true });
document.querySelectorAll(".nav-btn").forEach(bindNavigationPressFeedback);
bindElasticActionFeedback(els.summaryBatch);
bindElasticActionFeedback(document.querySelector("#navLogo"));
els.summaryBatch.addEventListener("click", () => {
  playElasticActionFeedback(els.summaryBatch);
  summary.reshuffleSummaries();
});
document.querySelector("#navLogo").addEventListener("click", event => playElasticActionFeedback(event.currentTarget));
delete els.dailyBoard.dataset.loading;
delete els.efficiencyPanel.dataset.loading;

// Pause native snapshot animations at their first frame for reproducible motion sampling.
const nativeStart = document.startViewTransition.bind(document);
window.batchFixture = { state, daily, summary, views, layout, pause: false, transitions: [], errors: [] };
document.startViewTransition = update => {
  const transition = nativeStart(update);
  window.batchFixture.transitions.push(transition);
  transition.ready.then(() => {
    if (!window.batchFixture.pause) return;
    window.batchFixture.animations = document.getAnimations().filter(animation => animation.effect?.pseudoElement?.startsWith("::view-transition"));
    window.batchFixture.animations.forEach(animation => { animation.pause(); animation.currentTime = 0; });
  }).catch(() => {});
  return transition;
};
window.inspirationFixture = {
  state, daily, views, layout, opened,
  async setLocale(locale) {
    await prepareLocale(locale);
    setLocale(locale, { persist: false, translate: false });
    state.data.bookmarks = buildInspirationPreset(locale).bookmarks;
    renderDailyCards(undefined, { immediate: true });
  },
  setBookmarks(bookmarks) {
    state.data.bookmarks = bookmarks;
    renderDailyCards(undefined, { immediate: true });
  },
};
window.fixtureReady = true;
