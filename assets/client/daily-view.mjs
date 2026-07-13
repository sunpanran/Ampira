import { isHotNewsItem as matchesHotNews, isSummaryFillItem as matchesSummaryFill } from "./card-policy.mjs";
import { createDailyCardView } from "./daily-card-view.mjs";
import { animatePanelEntrance } from "./dom.mjs";

export function createDailyView(options) {
  const {
    state, els, t, tc, itemUrl, displayTitle, displaySummaryTitle, summaryText,
    createEmptyState, createIcon, createThemedIcon, createReadingActions,
    createBookmarkFavicon, contextAttachLink, openDailyItem, toggleSeen,
    defaultSeenSource, newsSummaryItems, inspirationPreviews, apiGet,
    normalizeUrl, isHttpUrl, faviconUrl, hostFromUrl, formatDateTime,
    writeValue, writeJson, readJson, pageForItems, shuffle,
    dailyNewsCount, dailyNewsBatchLimit, dailyInspirationCount,
    dailyInspirationBatchLimit, updateInspirationPreloadTimeoutMs,
    dailyBoardCardSelector, cardExitMs, cardEnterMs, newsCardType,
    inspirationCardType, bookmarkCardType, legacyNewsSection,
    legacyInspirationSection,
    createNewsRanker, createSeenButton, displayBookmarkTitle, localizedCategory,
    mergeRankedUnique, selectTodayNewsItems, selectUnseenPool, openExternal, persistSeen, renderAll,
    renderTodayMeta, setIconLabel,
  } = options;
  let dailyBoardRenderToken = 0;
  const {
    activateCardFromKeyboard,
    createNewsListCard,
    createDailyCard,
    preloadBrowserImage,
    updateVisibleInspirationThumbs,
    createArchiveCard,
  } = createDailyCardView({
    state, els, t, itemUrl, displayTitle, displaySummaryTitle, createIcon,
    createReadingActions, createBookmarkFavicon, contextAttachLink, openDailyItem,
    createSeenButton, localizedCategory, inspirationPreviews, faviconUrl,
    isHttpUrl, hostFromUrl, openExternal, displayBookmarkTitle, isNewsCard,
    isInspirationCard, setCardItemIdentity,
  });
  return {
    renderDaily, animateCardsIn, animateCardsOut, batchLabel, canReuseCard,
    clearCardAnimationState, isNewsCard, newsSectionName, prefersReducedMotion,
    setCardItemIdentity, activateCardFromKeyboard, preloadDailyInspiration,
    preloadBrowserImage, updateVisibleInspirationThumbs,
  };
function renderDaily() {
  const isSearching = Boolean(state.query);
  document.documentElement.classList.toggle("is-dashboard-searching", isSearching);
  els.dailySection.classList.toggle("is-searching", isSearching);
  els.dailySection.hidden = false;
  if (els.efficiencyPanel) els.efficiencyPanel.hidden = isSearching;
  if (isSearching) {
    renderTodayMeta();
    renderDailyBoard([], { hideAfter: true });
    return;
  }
  const newsPage = dailyPageForCardType(newsCardType, dailyNewsCount);
  const inspirationPage = dailyPageForCardType(inspirationCardType, dailyInspirationCount);
  const newsBase = newsPage.items;
  const inspirationBase = inspirationPage.items;
  const seenItems = seenArchiveItems();
  const columns = [
    { id: "news", label: t("daily.news"), icon: "news", items: newsBase, action: "reshuffle", pageInfo: newsPage },
    { id: "inspiration", label: t("daily.inspiration"), icon: "sparkling", items: inspirationBase, action: "reshuffle", pageInfo: inspirationPage },
    { id: "archive", label: t("daily.archive"), icon: "bookmark-ribbon", items: seenItems, action: "clearSeen", compact: true }
  ];
  renderTodayMeta();
  renderDailyBoard(columns.map(createBoardColumn));
}

function renderDailyBoard(nodes, options = {}) {
  const token = ++dailyBoardRenderToken;
  const board = els.dailyBoard;
  if (options.hideAfter) {
    board.classList.remove("is-transitioning");
    board.replaceChildren();
    board.hidden = true;
    return;
  }
  board.hidden = false;
  if (board.dataset.loading === "true") {
    delete board.dataset.loading;
    board.replaceChildren(...nodes);
    animatePanelEntrance(nodes, { delay: 60 });
    animateCardsIn(dailyBoardCards(board));
    return;
  }
  if (!board.children.length || prefersReducedMotion()) {
    board.replaceChildren(...nodes);
    animateCardsIn(dailyBoardCards(board));
    return;
  }
  syncDailyBoardColumns(board, nodes, token);
}

function syncDailyBoardColumns(board, nextColumns, token) {
  const currentById = new Map(Array.from(board.children).map((column) => [column.dataset.columnId || "", column]));
  const nextIds = new Set(nextColumns.map((column) => column.dataset.columnId || ""));
  nextColumns.forEach((nextColumn, index) => {
    const columnId = nextColumn.dataset.columnId || "";
    const currentColumn = currentById.get(columnId);
    if (!currentColumn) {
      board.insertBefore(nextColumn, board.children[index] || null);
      animateCardsIn(dailyBoardCards(nextColumn));
      return;
    }
    syncDailyBoardColumn(currentColumn, nextColumn, token);
    if (board.children[index] !== currentColumn) board.insertBefore(currentColumn, board.children[index] || null);
  });
  Array.from(board.children).forEach((column) => {
    if (!nextIds.has(column.dataset.columnId || "")) column.remove();
  });
}

function syncDailyBoardColumn(currentColumn, nextColumn, token) {
  const currentHead = currentColumn.querySelector(":scope > .column-head");
  const nextHead = nextColumn.querySelector(":scope > .column-head");
  if (currentHead && nextHead && !currentHead.isEqualNode(nextHead)) currentHead.replaceWith(nextHead);
  const currentList = currentColumn.querySelector(":scope > .card-list");
  const nextList = nextColumn.querySelector(":scope > .card-list");
  if (!currentList || !nextList) {
    currentColumn.replaceChildren(...nextColumn.childNodes);
    animateCardsIn(dailyBoardCards(currentColumn));
    return;
  }
  syncDailyCardList(currentList, nextList, token);
}

function syncDailyCardList(currentList, nextList, token) {
  const currentCards = directDailyCards(currentList);
  const nextCards = directDailyCards(nextList);
  if (!currentCards.length) {
    currentList.className = nextList.className;
    currentList.replaceChildren(...nextList.childNodes);
    animateCardsIn(directDailyCards(currentList));
    return;
  }
  if (!nextCards.length) {
    const finishEmptyState = () => {
      if (token !== dailyBoardRenderToken) return;
      currentList.className = nextList.className;
      currentList.replaceChildren(...nextList.childNodes);
    };
    const leavingCards = currentCards.filter((card) => card.dataset.key);
    if (leavingCards.length && !prefersReducedMotion()) {
      const exitDuration = animateCardsOut(leavingCards);
      window.setTimeout(finishEmptyState, exitDuration);
    } else {
      finishEmptyState();
    }
    return;
  }
  const nextKeys = new Set(nextCards.map((card) => card.dataset.key).filter(Boolean));
  const leavingCards = currentCards.filter((card) => card.dataset.key && !nextKeys.has(card.dataset.key));
  const applyDiff = () => {
    if (token !== dailyBoardRenderToken) return;
    applyDailyCardListDiff(currentList, nextList, nextCards);
  };
  if (leavingCards.length && !prefersReducedMotion()) {
    const exitDuration = animateCardsOut(leavingCards);
    window.setTimeout(applyDiff, exitDuration);
  } else {
    applyDiff();
  }
}

function applyDailyCardListDiff(currentList, nextList, nextCards) {
  const currentByKey = new Map(directDailyCards(currentList)
    .filter((card) => card.dataset.key && !card.classList.contains("is-leaving"))
    .map((card) => [card.dataset.key, card]));
  const fragment = document.createDocumentFragment();
  const enteringCards = [];
  nextCards.forEach((nextCard) => {
    const key = nextCard.dataset.key || "";
    const currentCard = currentByKey.get(key);
    if (currentCard) {
      clearCardAnimationState(nextCard);
      clearCardAnimationState(currentCard);
      fragment.append(canReuseCard(currentCard, nextCard) ? currentCard : nextCard);
      return;
    }
    enteringCards.push(nextCard);
    fragment.append(nextCard);
  });
  currentList.className = nextList.className;
  currentList.replaceChildren(fragment);
  animateCardsIn(enteringCards);
}

function dailyBoardCards(root) {
  return Array.from(root.querySelectorAll(dailyBoardCardSelector));
}

function directDailyCards(root) {
  return Array.from(root.children).filter((node) => node.matches?.(dailyBoardCardSelector));
}

function animateCardsOut(cards) {
  let longest = cardExitMs;
  cards.forEach((card) => {
    const delay = 0;
    longest = Math.max(longest, delay + cardExitMs);
    card.classList.remove("is-entering");
    card.classList.add("is-leaving");
    card.style.setProperty("--card-motion-delay", `${delay}ms`);
    card.style.setProperty("--card-motion-duration", `${cardExitMs}ms`);
  });
  return longest;
}

function animateCardsIn(cards) {
  if (prefersReducedMotion()) return;
  cards.forEach((card, index) => {
    const delay = Math.min(index * 12, 84);
    card.classList.remove("is-leaving");
    card.classList.add("is-entering");
    card.style.setProperty("--card-motion-delay", `${delay}ms`);
    card.style.setProperty("--card-motion-duration", `${cardEnterMs}ms`);
    card.addEventListener("animationend", () => {
      card.classList.remove("is-entering");
      card.style.removeProperty("--card-motion-delay");
      card.style.removeProperty("--card-motion-duration");
    }, { once: true });
  });
}

function clearCardAnimationState(card) {
  card.classList.remove("is-entering", "is-leaving");
  card.style.removeProperty("--card-motion-delay");
  card.style.removeProperty("--card-motion-duration");
}

function setCardItemIdentity(card, item) {
  card.dataset.key = String(item?.key || "");
  card.dataset.itemVersion = cardItemVersion(item);
}

function canReuseCard(currentCard, nextCard) {
  return Boolean(nextCard.dataset.itemVersion)
    && currentCard.dataset.itemVersion === nextCard.dataset.itemVersion
    && currentCard.isEqualNode(nextCard);
}

function cardItemVersion(item) {
  let text;
  try {
    text = JSON.stringify(item) || "";
  } catch {
    return "";
  }
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function prefersReducedMotion() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;
}

function createDailyColumnEmptyState(column) {
  const emptyStates = {
    news: {
      title: t("daily.empty.newsTitle"),
      body: t("daily.empty.newsBody"),
    },
    inspiration: {
      title: t("daily.empty.inspirationTitle"),
      body: t("daily.empty.inspirationBody"),
    },
    archive: {
      title: t("daily.empty.archiveTitle"),
      body: t("daily.empty.archiveBody"),
    },
  };
  return createEmptyState({
    ...(emptyStates[column.id] || {
      title: t("daily.empty.defaultTitle"),
      body: t("daily.empty.defaultBody"),
    }),
    variant: ["news", "inspiration", "archive"].includes(column.id) ? "compact" : "panel",
  });
}

function createBoardColumn(column) {
  const section = document.createElement("section");
  section.className = `board-column ${column.id ? `is-${column.id}` : ""}`;
  section.dataset.columnId = column.id || "";
  const head = document.createElement("div");
  head.className = "column-head";
  const title = document.createElement("div");
  title.className = "column-title";
  const icon = createIcon(column.icon, "card-icon");
  title.append(icon, document.createTextNode(column.label));
  const tools = document.createElement("div");
  tools.className = "column-tools";
  if (column.pageInfo?.pageCount > 1 && column.action === "reshuffle") {
    const hint = document.createElement("span");
    hint.className = "batch-hint";
    hint.textContent = batchLabel(column.pageInfo);
    tools.append(hint);
  }
  const action = createColumnAction(column);
  if (action) tools.append(action);
  const count = document.createElement("span");
  count.className = "count";
  count.textContent = String(column.items.length);
  tools.append(count);
  head.append(title, tools);
  const list = document.createElement("div");
  list.className = "card-list";
  const renderer = column.id === "news" ? createNewsListCard : (column.compact ? createArchiveCard : createDailyCard);
  if (column.items.length) {
    if (column.id === "news") list.classList.add("link-list");
    list.append(...column.items.map((item) => renderer(item)));
  } else {
    list.classList.add("is-empty");
    list.append(createDailyColumnEmptyState(column));
  }
  section.append(head, list);
  return section;
}

function createColumnAction(column) {
  const type = column.action;
  if (!type) return null;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "column-action";
  if (type === "reshuffle") {
    setIconLabel(button, "shuffle-01", t("action.reshuffle"), "inline-icon", "btn-label");
    button.classList.add("accent");
    button.addEventListener("click", () => reshuffleDailyColumn(column.id));
  } else if (type === "clearSeen") {
    setIconLabel(button, "trash-01", t("action.clear"), "inline-icon", "btn-label");
    button.classList.add("danger");
    button.disabled = column.items.length === 0;
    button.addEventListener("click", clearSeenArchive);
  }
  return button;
}

async function reshuffleDailyColumn(columnId) {
  if (!Object.prototype.hasOwnProperty.call(state.variants, columnId)) return;
  const count = columnId === "news" ? dailyNewsCount : dailyInspirationCount;
  const page = dailyPageForCardType(columnId === "news" ? newsCardType : inspirationCardType, count);
  state.variants[columnId] = (page.variant + 1) % page.pageCount;
  writeValue(`dash.variant.${state.day}.${columnId}`, String(state.variants[columnId]));
  if (columnId === "inspiration") writeValue(`dash.variant.${state.day}`, String(state.variants[columnId]));
  if (columnId === "inspiration") await preloadDailyInspiration(updateInspirationPreloadTimeoutMs);
  renderDaily();
}

function clearSeenArchive() {
  if (!state.seen.size) return;
  state.seen.clear();
  state.seenMeta.clear();
  persistSeen();
  renderAll();
}

function seenArchiveItems() {
  const byKey = new Map(displayArchiveItems().map((item) => [item.key, item]));
  return Array.from(state.seen)
    .map((key) => archiveItemForSeenKey(key, byKey.get(key)))
    .filter(Boolean);
}

function displayArchiveItems() {
  const bookmarks = state.data?.bookmarks || [];
  return [
    ...bookmarks,
    ...newsSummaryItems(false).filter((item) => item.sourceKey),
  ];
}

function archiveItemForSeenKey(key, item) {
  const meta = state.seenMeta.get(key) || {};
  if (!item && !meta.title && !meta.url) return null;
  return {
    ...(item || fallbackArchiveItem(key, meta)),
    key,
    seenSource: meta.source || inferArchiveSource(item),
    seenTitle: meta.title || "",
    seenUrl: meta.url || "",
  };
}

function fallbackArchiveItem(key, meta) {
  const url = meta.url || "";
  const isNews = meta.source === "news";
  return {
    key,
    title: meta.title || hostFromUrl(url) || url || key,
    url,
    host: hostFromUrl(url),
    section: isNews ? newsSectionName() : t("nav.bookmarks"),
    category: isNews ? t("category.news") : t("category.website"),
    cardType: isNews ? newsCardType : "",
  };
}

function inferArchiveSource(item) {
  return item?.sourceKey || isNewsCard(item) ? "news" : "bookmark";
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
  return item?.cardType === newsCardType || (!item?.cardType && item?.section === legacyNewsSection);
}

function isInspirationCard(item) {
  return item?.cardType === inspirationCardType || (!item?.cardType && item?.section === legacyInspirationSection);
}

function isBookmarkCard(item) {
  return item?.cardType === bookmarkCardType;
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
  return shuffle(
    (state.data?.bookmarks || []).filter(isInspirationCard),
    `${state.day}.${inspirationSectionName()}`
  );
}

function preloadDailyInspiration(timeoutMs = updateInspirationPreloadTimeoutMs) {
  if (!state.data || !state.settings?.bookmarkConsentGranted) return Promise.resolve([]);
  const pool = selectUnseenPool(
    dailyInspirationItems(),
    state.seen,
    dailyInspirationCount * dailyInspirationBatchLimit,
  );
  const current = pageForItems(pool, dailyInspirationCount, state.variants.inspiration).items;
  const items = [...current, ...pool];
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
    publisherLimit: state.settings?.todayNewsPerPublisherLimit ?? 2,
  });
}

}
