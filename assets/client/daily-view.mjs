import { isHotNewsItem as matchesHotNews, isSummaryFillItem as matchesSummaryFill } from "./card-policy.mjs";
import { createDailyBatchTransition } from "./daily-batch-transition.mjs";
import { createDailyCardView } from "./daily-card-view.mjs";
import { spanText } from "./dom.mjs";
import { orderPresetInspiration } from "./inspiration-preset-selection.mjs";
import { createArchiveCardView } from "./archive-card-view.mjs";
import { setKeyboardShortcutHint } from "./keyboard-shortcuts.mjs";
import { playBatchActionFeedback } from "./motion.mjs";

export function shouldShowColumnAction(column) {
  const type = column?.action;
  if (!type) return false;
  if (type === "clearSeen") return Boolean(column.items?.length);
  if (type === "reshuffle") return Number(column.pageInfo?.pageCount) > 1;
  return true;
}

export function createDailyView(options) {
  const {
    state, els, dashboardLayout, t, itemUrl, displayTitle, displaySummaryTitle,
    createEmptyState, createThemedIcon, createReadingActions,
    createBookmarkFavicon, contextAttachLink, openDailyItem,
    newsSummaryItems, inspirationPreviews,
    isHttpUrl, faviconUrl, hostFromUrl,
    writeValue, pageForItems, shuffle,
    dailyNewsCount, dailyNewsBatchLimit, dailyInspirationCount,
    dailyInspirationBatchLimit, updateInspirationPreloadTimeoutMs,
    dailyBoardCardSelector, newsCardType,
    inspirationCardType,
    createNewsRanker, createSeenButton, displayBookmarkTitle, localizedCategory,
    mergeRankedUnique, selectTodayNewsItems, selectUnseenPool, openExternal, persistSeen, renderAll, renderDailyCards,
    renderTodayMeta, setIconLabel, localizedStatusMessage, confirmAction, cardTransition,
  } = options;
  const {
    animateCardsIn, animateCardsOut, canReuseCard, clearCardAnimationState,
    prefersReducedMotion, setCardItemIdentity,
  } = cardTransition;
  let dailyBoardRenderToken = 0;
  const dailyColumnTransitionTimers = new Map();
  const {
    activateCardFromKeyboard,
    createNewsListCard,
    createDailyCard,
    preloadBrowserImage,
    updateVisibleInspirationThumbs,
    createArchiveCard,
  } = createDailyCardView({
    dashboardLayout,
    state, els, t, itemUrl, displayTitle, displaySummaryTitle, createThemedIcon,
    createReadingActions, createBookmarkFavicon, contextAttachLink, openDailyItem,
    createSeenButton, localizedCategory, inspirationPreviews, faviconUrl,
    isHttpUrl, hostFromUrl, openExternal, displayBookmarkTitle, isNewsCard,
    isInspirationCard, setCardItemIdentity,
  });
  const archiveView = createArchiveCardView({
    state, t, createEmptyState, createArchiveCard, setIconLabel, confirmAction, persistSeen, renderAll,
    newsSummaryItems, hostFromUrl, newsSectionName, newsCardType, isNewsCard,
  });
  const dailyBatchTransition = createDailyBatchTransition({
    getColumn: dashboardLayout.getCard,
    animateCardsIn, canReuseCard, clearCardAnimationState, dailyBoardCardSelector,
    dailyColumns, directDailyCards, els, prefersReducedMotion,
    renderColumn: (columnId, batchTransition) => {
      renderDailyColumn(columnId, { batchTransition, preserveBatchTransition: true });
      for (const column of dailyColumns()) {
        if (column.id !== columnId && column.type === state.cardTypes[columnId]) {
          renderDailyColumn(column.id, { preserveBatchTransition: true });
        }
      }
    },
  });
  return {
    reshuffleDailyColumn, createArchiveContent: archiveView.render,
    createDailyContent, syncDailyContent,
    renderDaily, animateCardsIn, animateCardsOut, batchLabel, canReuseCard,
    clearCardAnimationState, isNewsCard, newsSectionName, prefersReducedMotion,
    setCardItemIdentity, activateCardFromKeyboard, preloadDailyInspiration,
    preloadBrowserImage, updateVisibleInspirationThumbs,
  };
function renderDaily() {
  dailyBatchTransition.cancel();
  dailyBoardRenderToken += 1;
  for (const id of dailyColumnTransitionTimers.keys()) cancelDailyColumnTransition(id);
  els.dailySection.hidden = false;
  dashboardLayout.sync();
  renderTodayMeta();
  renderDailyCards();
}

function dailyColumns() {
  return Object.entries(state.cardTypes).filter(([, type]) => ["news", "inspiration"].includes(type))
    .map(([id, type]) => dailyColumn(id, type));
}

function dailyColumn(id, type) {
  const pageInfo = dailyPageForCardType(type === "news" ? newsCardType : inspirationCardType,
    type === "news" ? dailyNewsCount : dailyInspirationCount);
  return { id, type, items: pageInfo.items, action: "reshuffle", pageInfo };
}

function renderDailyColumn(columnId, options = {}) {
  if (!options.preserveBatchTransition) dailyBatchTransition.cancel();
  const column = dailyColumns().find((candidate) => candidate.id === columnId);
  const currentColumn = dashboardLayout.getCard(columnId);
  if (!column || !currentColumn) {
    renderDaily();
    return;
  }
  const restoreActionFocus = currentColumn.contains(document.activeElement)
    && document.activeElement?.classList.contains("column-action");
  cancelDailyColumnTransition(columnId);
  renderDailyCards(columnId, {
    batchTransition: options.batchTransition,
    immediate: true,
  });
  const action = currentColumn.querySelector(":scope > .column-head .column-action");
  if (restoreActionFocus) action?.focus({ preventScroll: true });
}
function syncDailyContent(current, next, settings = {}) {
  syncDailyCardList(current, next, dailyBoardRenderToken, { immediate: prefersReducedMotion(), ...settings });
}

function syncDailyCardList(currentList, nextList, token, options = {}) {
  const columnId = currentList.closest(".board-column")?.dataset.columnId || "";
  const currentCards = directDailyCards(currentList);
  const nextCards = directDailyCards(nextList);
  if (options.batchTransition) {
    dailyBatchTransition.renderCardList(currentList, nextList, options.batchTransition);
    return;
  }
  if (!currentCards.length) {
    currentList.className = nextList.className;
    currentList.replaceChildren(...nextList.childNodes);
    if (!options.immediate) animateCardsIn(directDailyCards(currentList));
    return;
  }
  if (!nextCards.length) {
    const finishEmptyState = () => {
      if (token !== dailyBoardRenderToken) return;
      currentList.className = nextList.className;
      currentList.replaceChildren(...nextList.childNodes);
    };
    const leavingCards = currentCards.filter((card) => card.dataset.key);
    if (leavingCards.length && !options.immediate && !prefersReducedMotion()) {
      const exitDuration = animateCardsOut(leavingCards);
      scheduleDailyColumnTransition(columnId, finishEmptyState, exitDuration);
    } else {
      finishEmptyState();
    }
    return;
  }
  const nextKeys = new Set(nextCards.map((card) => card.dataset.key).filter(Boolean));
  const leavingCards = currentCards.filter((card) => card.dataset.key && !nextKeys.has(card.dataset.key));
  const applyDiff = () => {
    if (token !== dailyBoardRenderToken) return;
    dailyBatchTransition.applyCardListDiff(currentList, nextList, nextCards, { animateEntries: !options.immediate });
  };
  if (leavingCards.length && !options.immediate && !prefersReducedMotion()) {
    const exitDuration = animateCardsOut(leavingCards);
    scheduleDailyColumnTransition(columnId, applyDiff, exitDuration);
  } else {
    applyDiff();
  }
}

function scheduleDailyColumnTransition(columnId, callback, delayMs) {
  cancelDailyColumnTransition(columnId);
  const timer = window.setTimeout(() => {
    if (dailyColumnTransitionTimers.get(columnId) === timer) dailyColumnTransitionTimers.delete(columnId);
    callback();
  }, delayMs);
  if (columnId) dailyColumnTransitionTimers.set(columnId, timer);
}

function cancelDailyColumnTransition(columnId) {
  const timer = dailyColumnTransitionTimers.get(columnId);
  if (timer === undefined) return;
  window.clearTimeout(timer);
  dailyColumnTransitionTimers.delete(columnId);
}

function directDailyCards(root) {
  return Array.from(root.children).filter((node) => node.matches?.(dailyBoardCardSelector));
}

function createDailyColumnEmptyState(column) {
  if (column.type === "news" && state.data?.status?.running === true) return createDailyNewsCachingState();
  const emptyStates = {
    news: {
      title: t("daily.empty.newsTitle"),
      body: t("daily.empty.newsBody"),
    },
    inspiration: {
      title: t("daily.empty.inspirationTitle"),
      body: t("daily.empty.inspirationBody"),
    },
  };
  return createEmptyState({
    ...(emptyStates[column.type] || {
      title: t("daily.empty.defaultTitle"),
      body: t("daily.empty.defaultBody"),
    }),
    variant: "compact",
  });
}

function createDailyNewsCachingState() {
  const status = state.data?.status || {};
  const rawProgress = Number(status.progress);
  const progress = Number.isFinite(rawProgress) ? Math.min(1, Math.max(0, rawProgress)) : 0;
  const percent = Math.round(progress * 100);
  const node = document.createElement("div");
  node.className = "empty-state is-compact is-loading news-cache-state";
  node.setAttribute("role", "status");
  node.setAttribute("aria-live", "polite");
  node.setAttribute("aria-busy", "true");

  const copy = document.createElement("div");
  copy.className = "empty-state-copy";
  const title = document.createElement("div");
  title.className = "empty-state-title";
  title.textContent = t("daily.loading.newsTitle");
  const body = document.createElement("div");
  body.className = "empty-state-body";
  body.textContent = t("daily.loading.newsBody", {
    message: localizedStatusMessage(status, "status.nextBatchPreparing"),
  });
  copy.append(title, body);

  const meter = document.createElement("div");
  meter.className = "news-cache-state-meter";
  meter.setAttribute("role", "progressbar");
  meter.setAttribute("aria-label", t("daily.loading.progressLabel"));
  meter.setAttribute("aria-valuemin", "0");
  meter.setAttribute("aria-valuemax", "100");
  meter.setAttribute("aria-valuenow", String(percent));
  const fill = document.createElement("span");
  fill.style.width = `${percent}%`;
  meter.append(fill);

  node.append(copy, meter);
  return node;
}

function createDailyContent(id, type) {
  const column = dailyColumn(id, type);
  const meta = column.pageInfo.pageCount > 1 ? spanText(batchLabel(column.pageInfo), "batch-hint") : null;
  const action = createColumnAction(column);
  const list = document.createElement("div");
  list.className = "card-list";
  const renderer = type === "news" ? createNewsListCard : createDailyCard;
  if (column.items.length) {
    if (type === "news") list.classList.add("link-list");
    list.append(...column.items.map(item => renderer(item)));
  } else {
    list.classList.add("is-empty");
    list.append(createDailyColumnEmptyState(column));
  }
  return { content: list, meta, actions: action ? [action] : [] };
}

function createColumnAction(column) {
  const type = column.action;
  if (!shouldShowColumnAction(column)) return null;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "column-action";
  if (type === "reshuffle") {
    setIconLabel(button, "shuffle-01", t("action.reshuffle"), "inline-icon", "btn-label");
    button.classList.add("accent");
    button.dataset.batchAction = column.id;
    setKeyboardShortcutHint(button, "batch", t("action.reshuffle"), state.settings);
    button.addEventListener("click", () => reshuffleDailyColumn(column.id));

  }
  return button;
}

function reshuffleDailyColumn(columnId) {
  const type = state.cardTypes[columnId];
  if (!["news", "inspiration"].includes(type)) return;
  const count = type === "news" ? dailyNewsCount : dailyInspirationCount;
  const page = dailyPageForCardType(type === "news" ? newsCardType : inspirationCardType, count);
  if (page.pageCount <= 1) return;
  state.variants[type] = (page.variant + 1) % page.pageCount;
  writeValue(`dash.variant.${state.day}.${type}`, String(state.variants[type]));
  if (type === "inspiration") writeValue(`dash.variant.${state.day}`, String(state.variants[type]));
  playBatchActionFeedback(dashboardLayout.getCard(columnId)?.querySelector("[data-batch-action]"));
  dailyBatchTransition.run(columnId);
  if (type === "inspiration") void preloadDailyInspiration(updateInspirationPreloadTimeoutMs);
}

function newsSectionName() {
  return state.data?.sections?.find((section) => section.cardType === newsCardType)?.name
    || state.settings?.newsBookmarkFolder
    || t("bookmarkFolder.defaultNews");
}

function inspirationSectionName() {
  return state.data?.sections?.find((section) => section.cardType === inspirationCardType)?.name
    || state.settings?.inspirationBookmarkFolder
    || t("bookmarkFolder.defaultInspiration");
}

function isNewsCard(item) {
  return item?.cardType === newsCardType;
}

function isInspirationCard(item) {
  return item?.cardType === inspirationCardType;
}

function dailyPageForCardType(cardType, count) {
  if (cardType === newsCardType) {
    return fixedDailyPage(dailyNewsItems(), state.seen, count, dailyNewsBatchLimit, state.variants.news);
  }
  return fixedDailyPage(dailyInspirationItems(), state.seen, count, dailyInspirationBatchLimit, state.variants.inspiration);
}

function fixedDailyPage(items, seenKeys, count, batchLimit, variant) {
  const cappedItems = (Array.isArray(items) ? items : []).slice(0, count * batchLimit);
  const page = pageForItems(cappedItems, count, variant);
  return {
    ...page,
    items: page.items.filter((item) => !seenKeys.has(item.key)),
  };
}

function dailyInspirationItems() {
  const items = (state.data?.bookmarks || []).filter(isInspirationCard);
  const seed = `${state.day}.${inspirationSectionName()}`;
  if (items.length && items.every((item) => item.sourceKind === "preset")) {
    return orderPresetInspiration(items, { seed, shuffle });
  }
  return shuffle(items, seed);
}

function preloadDailyInspiration(timeoutMs = updateInspirationPreloadTimeoutMs) {
  if (!state.data || (state.data.bot && state.data.bot.scopes?.inspiration !== false) || !state.settings?.bookmarkConsentGranted) return Promise.resolve([]);
  const pool = selectUnseenPool(
    dailyInspirationItems(),
    state.seen,
    dailyInspirationCount * dailyInspirationBatchLimit,
  );
  const current = pageForItems(pool, dailyInspirationCount, state.variants.inspiration).items;
  const items = [...current, ...pool].filter((item) => !item.coverAsset && item.sourceKind !== "preset");
  if (!items.length) return Promise.resolve([]);
  return inspirationPreviews.preload(items, { timeoutMs }).catch(() => []);
}

function batchLabel(pageInfo) {
  if (!pageInfo || pageInfo.total <= pageInfo.items.length) return t("batch.label", { page: 1, total: 1 });
  return t("batch.label", { page: pageInfo.page, total: pageInfo.pageCount });
}

function dailyNewsItems() {
  const news = newsSummaryItems(false);
  const ranker = createNewsRanker();
  const ranked = mergeRankedUnique([
    news.filter((item) => matchesHotNews(item, isNewsCard)),
    news.filter((item) => matchesSummaryFill(item, isNewsCard)),
  ], {
    compare: ranker.compareImportant,
    keyOf: (item) => item.key || item.url,
  });
  return selectTodayNewsItems(ranked, {
    compare: ranker.compareImportant,
    recentLimit: 3,
    pageSize: dailyNewsCount,
    pageCount: dailyNewsBatchLimit,
    publisherLimit: state.settings?.todayNewsPerPublisherLimit ?? 0,
  });
}

}
