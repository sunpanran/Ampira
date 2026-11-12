import { createSummarySessionOrder } from "./summary-session-order.mjs";
import { createSummaryOrganizationController } from "./summary-organization-controller.mjs";
import { normalizeComparableText, truncateText } from "./text.mjs";
import { normalizeUrl } from "./urls.mjs";
import { isHotNewsItem as matchesHotNews, isSummaryFillItem as matchesSummaryFill } from "./card-policy.mjs";
import { summaryEmptyStateKind } from "./empty-state-policy.mjs";
import { aiTaskLabelKey, isAiTaskBusy, summaryTaskPhase } from "./ai-task-state.mjs";
import { createAiTaskStatus } from "./ui-primitives.mjs";
import { createSummaryImageThumbs } from "./summary-image-thumb.mjs";
import { createSummaryBatchTransition } from "./summary-batch-transition.mjs";
import { cleanupSummaryThumbTransitions, crossfadeSummaryThumb, syncSummaryThumb } from "./summary-thumb-transition.mjs";
import { setKeyboardShortcutHint } from "./keyboard-shortcuts.mjs";

export function createSummaryView(options) {
  const {
    state, els, t, isDisplayableFeedItem, itemUrl, displaySummaryTitle,
    summaryDetailLines, isCorrectlySummarized, localizedCategory,
    formatDateTime, faviconUrl, hostFromUrl, createThemedIcon,
    createReadingActions, createManualSummaryButton, attachLinkContextMenu,
    activateCardFromKeyboard, createPriorityRanker,
    mergeRankedUnique, pageForItems, newsCardType,
    hotSummaryPageSize, summaryCardSelector, cardSummaryEnabled,
    summaryDetailMaxLength,
    animateCardsIn, animateCardsOut, batchLabel, canReuseCard, clearCardAnimationState,
    createEmptyState, isNewsCard, newsSectionName, openSummaryItem,
    prefersReducedMotion, setCardItemIdentity,
    triggerRefresh, writeValue, newsPreviews,
  } = options;
  const sessionOrder = createSummarySessionOrder();
  const refreshSummaryItem = createSummaryOrganizationController({ ...options, updateSummaryCard });
  let summaryRenderToken = 0;
  const { createSummaryThumb, updateVisibleNewsThumbs } = createSummaryImageThumbs({
    els, faviconUrl, itemUrl, newsPreviews,
  });
  const summaryBatchTransition = createSummaryBatchTransition({
    cleanup: cleanupSummaryBatchTransition,
    prefersReducedMotion,
    prepare: prepareSummaryBatchTransition,
    update: (batchTransition) => renderSummaries({
      batchTransition,
      immediate: !batchTransition,
      preserveBatchTransition: true,
    }),
  });
  return {
    renderSummaries, newsSummaryItems, updateSummaryCard, reshuffleSummaries,
    createNewsRanker, refreshSummaryItem, updateVisibleNewsThumbs,
  };
function renderSummaries({ batchTransition = null, immediate = false, preserveBatchTransition = false } = {}) {
  if (!preserveBatchTransition) summaryBatchTransition.cancel();
  const token = ++summaryRenderToken;
  const news = newsSummaryItems(false);
  const pool = summaryPoolItems(news);
  const page = pageForItems(pool, hotSummaryPageSize, state.variants.summary);
  state.variants.summary = page.variant;
  const order = state.summaryOrder === "time" ? "time" : "importance";
  if (els.summaryOrder.value !== order) els.summaryOrder.value = order;
  els.summaryBatch.disabled = page.pageCount <= 1;
  const batchButtonLabel = els.summaryBatch.querySelector(".btn-label");
  if (batchButtonLabel) batchButtonLabel.textContent = t(page.pageCount <= 1 ? "action.allShown" : "action.nextBatch");
  setKeyboardShortcutHint(els.summaryBatch, "batch", t(page.pageCount <= 1 ? "action.allShown" : "action.nextBatch"), state.settings);
  const visible = page.items;
  els.summaryMeta.textContent = batchLabel(page);
  if (!visible.length) {
    const emptyKind = summaryEmptyStateKind("");
    renderSummaryGrid([createEmptyState({
      title: t(emptyKind === "noMatches" ? "empty.noMatches.title" : "summary.empty.title"),
      body: t(emptyKind === "noMatches" ? "empty.noMatches.body" : "summary.empty.body"),
      variant: "plain",
      actionLabel: emptyKind === "noMatches" ? "" : t("action.cache"),
      onAction: emptyKind === "noMatches" ? undefined : () => triggerRefresh(true),
    })], token, { batchTransition, immediate });
    return;
  }
  renderSummaryGrid(visible.map(createSummaryCard), token, { batchTransition, immediate });
}

function renderSummaryGrid(nodes, token, { batchTransition = null, immediate = false } = {}) {
  const grid = els.summaryGrid;
  const currentCards = directSummaryCards(grid);
  const nextCards = nodes.filter((node) => node.matches?.(summaryCardSelector));
  if (batchTransition) {
    renderSummaryBatchGrid(grid, nodes, currentCards, nextCards, batchTransition);
    return;
  }
  if (immediate) {
    grid.replaceChildren(...nodes);
    return;
  }
  if (!currentCards.length || prefersReducedMotion()) {
    grid.replaceChildren(...nodes);
    animateCardsIn(directSummaryCards(grid));
    return;
  }
  if (!nextCards.length) {
    const finishEmptyState = () => {
      if (token !== summaryRenderToken) return;
      grid.replaceChildren(...nodes);
    };
    const exitDuration = animateCardsOut(currentCards);
    window.setTimeout(finishEmptyState, exitDuration);
    return;
  }
  const nextKeys = new Set(nextCards.map((card) => card.dataset.key).filter(Boolean));
  const leavingCards = currentCards.filter((card) => card.dataset.key && !nextKeys.has(card.dataset.key));
  const applyDiff = () => {
    if (token !== summaryRenderToken) return;
    applySummaryGridDiff(grid, nodes);
  };
  if (leavingCards.length && !prefersReducedMotion()) {
    const exitDuration = animateCardsOut(leavingCards);
    window.setTimeout(applyDiff, exitDuration);
  } else {
    applyDiff();
  }
}

function applySummaryGridDiff(grid, nodes) {
  const currentByKey = new Map(directSummaryCards(grid)
    .filter((card) => card.dataset.key && !card.classList.contains("is-leaving"))
    .map((card) => [card.dataset.key, card]));
  const enteringCards = [];
  const resolvedNodes = nodes.map((node) => {
    if (!node.matches?.(summaryCardSelector)) {
      return node;
    }
    const currentCard = currentByKey.get(node.dataset.key || "");
    if (currentCard) {
      clearCardAnimationState(node);
      clearCardAnimationState(currentCard);
      return canReuseCard(currentCard, node) ? currentCard : syncSummaryCard(currentCard, node);
    }
    enteringCards.push(node);
    return node;
  });
  resolvedNodes.forEach((node, index) => {
    if (grid.children[index] !== node) grid.insertBefore(node, grid.children[index] || null);
  });
  while (grid.children.length > resolvedNodes.length) grid.lastElementChild?.remove();
  animateCardsIn(enteringCards);
}

function directSummaryCards(root) {
  return Array.from(root.children).filter((node) => node.matches?.(summaryCardSelector));
}

function prepareSummaryBatchTransition() {
  const pool = summaryPoolItems(newsSummaryItems(false));
  const page = pageForItems(pool, hotSummaryPageSize, state.variants.summary);
  const nextCardCount = page.items.length;
  directSummaryCards(els.summaryGrid).forEach((card, index) => {
    const transitionNode = index < nextCardCount
      ? summaryBatchContent(card) || card
      : card;
    setSummaryBatchTransitionName(transitionNode, index);
  });
  return { nextCardCount };
}

function renderSummaryBatchGrid(grid, nodes, currentCards, nextCards, transitionState) {
  if (nodes.length !== nextCards.length || nextCards.length !== transitionState.nextCardCount) {
    grid.replaceChildren(...nodes);
    return;
  }

  for (const child of Array.from(grid.children)) {
    if (!child.matches?.(summaryCardSelector)) child.remove();
  }

  const sharedCount = Math.min(currentCards.length, nextCards.length);
  for (let index = 0; index < sharedCount; index += 1) {
    const nextContent = summaryBatchContent(nextCards[index]) || nextCards[index];
    setSummaryBatchTransitionName(nextContent, index);
    syncSummaryCard(currentCards[index], nextCards[index], { crossfadeThumb: true });
  }

  for (let index = sharedCount; index < nextCards.length; index += 1) {
    setSummaryBatchTransitionName(nextCards[index], index);
    grid.append(nextCards[index]);
  }

  for (let index = currentCards.length - 1; index >= nextCards.length; index -= 1) {
    currentCards[index].remove();
  }
}

function summaryBatchContent(card) {
  return card?.querySelector?.(":scope > .summary-card-content") || null;
}

function setSummaryBatchTransitionName(node, index) {
  node?.style?.setProperty("view-transition-name", `signal-feed-card-${index + 1}`);
}

function cleanupSummaryBatchTransition() {
  const cards = directSummaryCards(els.summaryGrid);
  for (const card of cards) {
    card.style.removeProperty("view-transition-name");
    summaryBatchContent(card)?.style.removeProperty("view-transition-name");
  }
  cleanupSummaryThumbTransitions(cards);
}

function newsSummaryItems() {
  const unifiedItems = Array.isArray(state.data?.feed?.items) ? state.data.feed.items : [];
  return unifiedItems
    .filter(isDisplayableFeedItem)
    .map(unifiedFeedItem)
    .filter((item) => !state.dismissed.has(item.key));
}

function unifiedFeedItem(feedItem) {
  const lines = Array.isArray(feedItem.summary) && feedItem.summary.length
    ? feedItem.summary
    : (feedItem.excerpt ? [feedItem.excerpt] : []);
  const publishedAt = feedItem.publishedAt || "";
  return {
    key: feedItem.articleId || feedItem.entryKey,
    sourceKey: feedItem.sourceKey || "",
    section: newsSectionName(),
    cardType: newsCardType,
    title: feedItem.source || feedItem.host || t("category.news"),
    host: feedItem.host || hostFromUrl(feedItem.url || ""),
    publisher: feedItem.publisher || feedItem.source || "",
    publisherHost: feedItem.publisherHost || feedItem.host || "",
    category: feedItem.category || t("category.news"),
    categoryKey: feedItem.categoryKey || "",
    url: feedItem.url,
    feedItem,
    externalDiscovery: feedItem.externalDiscovery === true,
    timeUnverified: feedItem.timeUnverified === true,
    summary: {
      entryKey: feedItem.articleId || feedItem.entryKey,
      itemUrl: feedItem.url,
      title: feedItem.summaryStatus === "ai" && feedItem.summaryTitle ? feedItem.summaryTitle : feedItem.title,
      summaryTitle: feedItem.summaryTitle || "",
      sourceTitle: feedItem.source,
      host: feedItem.host,
      category: feedItem.category,
      categoryKey: feedItem.categoryKey || "",
      summary: lines,
      description: feedItem.excerpt || "",
      imageUrl: feedItem.imageUrl || "",
      imageUrls: Array.isArray(feedItem.imageUrls) ? feedItem.imageUrls : [],
      publishedAt,
      fetchedAt: feedItem.fetchedAt || "",
      hotScore: Number(feedItem.score || 0),
      isHotNews: true,
      newsStatus: "hot",
      summaryStatus: feedItem.summaryStatus === "ai" ? "ai" : (lines.length ? "excerpt" : "raw"),
      summaryLocale: feedItem.summaryLocale || "",
      timeUnverified: feedItem.timeUnverified === true,
      externalDiscovery: feedItem.externalDiscovery === true,
      clusterId: feedItem.clusterId || "",
      eventId: feedItem.eventId || "",
      eventSourceCount: Number(feedItem.eventSourceCount || 1),
      eventRepresentative: feedItem.eventRepresentative !== false,
      scoreBreakdown: feedItem.scoreBreakdown || {},
    },
  };
}

function summaryPoolItems(news) {
  const compare = createNewsRanker().compareByOrder(state.summaryOrder);
  const limit = state.data?.ai?.hotNewsCacheSize || state.settings?.hotNewsCacheSize || 192;
  const ranked = mergeRankedUnique([
    news.filter(isHotNewsItem),
    news.filter(isSummaryFillItem),
  ], {
    compare,
    keyOf: (item) => item.key,
    limit,
  });
  return sessionOrder.arrange(ranked, state.summaryOrder);
}

function isHotNewsItem(item) {
  return matchesHotNews(item, isNewsCard);
}

function isSummaryFillItem(item) {
  return matchesSummaryFill(item, isNewsCard);
}

function createNewsRanker() {
  return createPriorityRanker({
    digestItems: state.data?.dailyDigest?.items || [],
    digestKeys: (item) => [normalizeUrl(item.url), normalizeComparableText(item.title)],
    itemKeys: (item) => [
      normalizeUrl(itemUrl(item)),
      normalizeUrl(item.summary?.itemUrl),
      normalizeComparableText(displaySummaryTitle(item)),
    ],
    hotScore: (item) => item.summary?.hotScore,
    itemTime: summaryTime,
    itemQuality: summaryQuality,
  });
}

function reshuffleSummaries() {
  const pool = summaryPoolItems(newsSummaryItems(false));
  const page = pageForItems(pool, hotSummaryPageSize, state.variants.summary);
  if (page.pageCount <= 1) return;
  state.variants.summary = (page.variant + 1) % page.pageCount;
  writeValue(`dash.variant.${state.day}.summary`, String(state.variants.summary));
  summaryBatchTransition.run();
}

function summaryTime(item) {
  if (item.timeUnverified || item.summary?.timeUnverified) return 0;
  const value = item.summary?.publishedAt || item.summary?.updatedAt || item.summary?.fetchedAt || "";
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : 0;
}

function summaryQuality(item) {
  const summary = item.summary;
  if (!summary) return 0;
  const hasBody = Boolean(
    String(summary.description || "").trim() ||
    (Array.isArray(summary.summary) && summary.summary.some((line) => String(line || "").trim()))
  );
  const isBareUnverified = Boolean(summary.timeUnverified || item.timeUnverified) &&
    !String(summary.imageUrl || "").trim() &&
    !hasBody;
  return isBareUnverified ? 0 : 1;
}

function createSummaryCard(item) {
  let phase = summaryTaskPhase(state, item.key);
  if (phase === "failed" && isCorrectlySummarized(item)) phase = "";
  const isRefreshing = isAiTaskBusy(phase);
  const cardTitle = displaySummaryTitle(item);
  const card = document.createElement("article");
  card.className = `summary-card ${state.opened.has(item.key) && !state.seen.has(item.key) ? "opened" : ""}`.trim();
  if (isRefreshing) card.setAttribute("aria-busy", "true");
  setCardItemIdentity(card, item);
  card.dataset.previewFingerprint = newsPreviews.fingerprint(item);
  card.ampiraItem = item;
  card.tabIndex = 0;
  card.setAttribute("role", "link");
  card.title = cardTitle;
  card.setAttribute("aria-label", t("card.openStory", { title: cardTitle }));
  card.addEventListener("click", (event) => {
    if (event.target.closest("button")) return;
    openSummaryItem(card.ampiraItem);
  });
  card.addEventListener("keydown", (event) => {
    activateCardFromKeyboard(event, () => openSummaryItem(card.ampiraItem));
  });
  attachLinkContextMenu(card, () => {
    const currentItem = card.ampiraItem;
    return { url: itemUrl(currentItem), title: displaySummaryTitle(currentItem), item: currentItem };
  });
  const thumb = createSummaryThumb(item);
  if (thumb.classList.contains("is-favicon-thumb")) card.classList.add("has-favicon-thumb");
  const content = document.createElement("div");
  content.className = "summary-card-content";
  const body = document.createElement("div");
  body.className = "summary-body";
  const top = document.createElement("div");
  top.className = "summary-top";
  const headMain = document.createElement("div");
  headMain.className = "summary-head-main";
  const pill = document.createElement("span");
  pill.className = `pill news${item.externalDiscovery ? " is-discovery" : ""}`;
  const discoveryLabel = item.externalDiscovery
    ? t("category.externalDiscovery")
    : item.timeUnverified ? t("category.timeUnverified") : localizedCategory(item);
  pill.append(createThemedIcon("news", "pill-icon"), document.createTextNode(discoveryLabel));
  const timestamp = item.summary?.publishedAt || item.summary?.updatedAt || item.summary?.fetchedAt || "";
  const meta = document.createElement("time");
  meta.className = "summary-meta summary-time";
  meta.dateTime = timestamp;
  meta.textContent = timestamp ? formatDateTime(timestamp) : "";
  const cardActions = document.createElement("div");
  cardActions.className = "summary-card-actions";
  cardActions.append(createReadingActions(item, { source: "news", compact: true }));
  if (cardSummaryEnabled() && !isCorrectlySummarized(item)) cardActions.append(createManualSummaryButton(item, isRefreshing, phase));
  card.dataset.summaryActionCount = String(cardActions.querySelectorAll("button").length);
  headMain.append(pill);
  top.append(headMain);
  const title = document.createElement("span");
  title.className = "summary-title";
  title.textContent = cardTitle;
  const sourceRow = document.createElement("div");
  sourceRow.className = "summary-source-row";
  const source = document.createElement("span");
  source.className = "summary-meta summary-source";
  source.textContent = item.host || item.url;
  source.title = source.textContent;
  sourceRow.append(source);
  if (meta.textContent) sourceRow.append(meta);
  if (phase) sourceRow.append(createAiTaskStatus(phase, t(aiTaskLabelKey(phase))));
  const lines = document.createElement("div");
  lines.className = "summary-lines";
  const fullDetailText = summaryDetailLines(item, cardTitle).slice(0, 3).join(" ");
  const detailText = truncateText(fullDetailText, summaryDetailMaxLength);
  if (detailText) {
    const node = document.createElement("div");
    node.className = "summary-line";
    node.textContent = detailText;
    node.title = fullDetailText;
    lines.append(node);
  }
  body.append(top, title, sourceRow, lines);
  content.append(body);
  card.append(thumb, content, cardActions);
  return card;
}

function updateSummaryCard(item) {
  if (!isHotNewsItem(item)) {
    renderSummaries();
    return [...els.summaryGrid.querySelectorAll(".summary-card")]
      .find((node) => node.dataset.key === item.key) || null;
  }
  const current = [...els.summaryGrid.querySelectorAll(".summary-card")].find((node) => node.dataset.key === item.key);
  if (current) {
    syncSummaryCard(current, createSummaryCard(item));
    return current;
  }
  renderSummaries();
  return [...els.summaryGrid.querySelectorAll(".summary-card")]
    .find((node) => node.dataset.key === item.key) || null;
}

function syncSummaryCard(currentCard, nextCard, { crossfadeThumb = false } = {}) {
  currentCard.className = nextCard.className;
  for (const key of Object.keys(currentCard.dataset)) delete currentCard.dataset[key];
  for (const [key, value] of Object.entries(nextCard.dataset)) currentCard.dataset[key] = value;
  currentCard.ampiraItem = nextCard.ampiraItem;
  currentCard.tabIndex = nextCard.tabIndex;
  currentCard.setAttribute("role", nextCard.getAttribute("role") || "link");
  currentCard.title = nextCard.title;
  currentCard.setAttribute("aria-label", nextCard.getAttribute("aria-label") || "");
  if (nextCard.getAttribute("aria-busy") === "true") currentCard.setAttribute("aria-busy", "true");
  else currentCard.removeAttribute("aria-busy");
  if (crossfadeThumb) crossfadeSummaryThumb(currentCard, nextCard);
  else syncSummaryThumb(currentCard, nextCard);
  syncSummaryActions(currentCard, nextCard);
  const currentContent = summaryBatchContent(currentCard);
  const nextContent = summaryBatchContent(nextCard);
  if (currentContent && nextContent) currentContent.replaceWith(nextContent);
  else if (nextContent) currentCard.append(nextContent);
  else currentContent?.remove();
  return currentCard;
}
function syncSummaryActions(currentCard, nextCard) {
  const currentActions = currentCard.querySelector(":scope > .summary-card-actions");
  const nextActions = nextCard.querySelector(":scope > .summary-card-actions");
  if (!currentActions) { if (nextActions) currentCard.append(nextActions); return; }
  if (!nextActions) { currentActions.remove(); return; }
  currentActions.className = nextActions.className;
  currentActions.replaceChildren(...nextActions.childNodes);
}
}
