import { normalizeComparableText, truncateText } from "./text.mjs";
import { normalizeUrl } from "./urls.mjs";
import { isHotNewsItem as matchesHotNews, isSummaryFillItem as matchesSummaryFill } from "./card-policy.mjs";

export function createSummaryView(options) {
  const {
    state, els, t, tc, apiPost, isDisplayableFeedItem, itemUrl, displaySummaryTitle,
    summaryDetailLines, cleanSummaryLines, isCorrectlySummarized, localizedCategory,
    localizedSourceLabel, localizedResponseMessage, localizedErrorMessage,
    formatDateTime, faviconUrl, hostFromUrl, createIcon, createThemedIcon,
    createReadingActions, createManualSummaryButton, attachLinkContextMenu,
    activateCardFromKeyboard, matchesQuery, findNewsItemByReference, createPriorityRanker,
    mergeRankedUnique, selectUnseenPool, shuffle, pageForItems, newsCardType,
    hotSummaryPageSize, summaryCardSelector, cardSummaryEnabled,
    summaryDetailMaxLength,
    animateCardsIn, animateCardsOut, batchLabel, canReuseCard, clearCardAnimationState,
    createEmptyState, isNewsCard, loadDashboard, newsSectionName, openSummaryItem,
    prefersReducedMotion, renderOverviewStatus, renderStatus, setCardItemIdentity,
    syncSegmentedIndicator, triggerRefresh, writeValue,
  } = options;
  let summaryRenderToken = 0;
  return { renderSummaries, newsSummaryItems, updateSummaryCard, reshuffleSummaries, createNewsRanker, refreshSummaryItem };
function renderSummaries() {
  const token = ++summaryRenderToken;
  const news = newsSummaryItems(true);
  const pool = summaryPoolItems(news);
  const page = pageForItems(pool, hotSummaryPageSize, state.variants.summary);
  state.variants.summary = page.variant;
  syncSummaryOrderButtons();
  els.summaryBatch.disabled = page.pageCount <= 1;
  els.summaryBatch.textContent = t(page.pageCount <= 1 ? "action.allShown" : "action.nextBatch");
  const visible = page.items;
  els.summaryMeta.textContent = batchLabel(page);
  if (!visible.length) {
    renderSummaryGrid([createEmptyState({
      title: t("summary.empty.title"),
      body: t("summary.empty.body"),
      variant: "panel",
      actionLabel: t("action.cache"),
      onAction: () => triggerRefresh(true),
    })], token);
    return;
  }
  renderSummaryGrid(visible.map(createSummaryCard), token);
}

function renderSummaryGrid(nodes, token) {
  const grid = els.summaryGrid;
  const currentCards = directSummaryCards(grid);
  const nextCards = nodes.filter((node) => node.matches?.(summaryCardSelector));
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

function newsSummaryItems(respectQuery) {
  const unifiedItems = Array.isArray(state.data?.feed?.items) ? state.data.feed.items : [];
  return unifiedItems
    .filter(isDisplayableFeedItem)
    .map(unifiedFeedItem)
    .filter((item) => !state.dismissed.has(item.key))
    .filter((item) => !respectQuery || matchesQuery(item));
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
      summaryPolicyVersion: Number(feedItem.summaryPolicyVersion || 0),
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
  return mergeRankedUnique([
    news.filter(isHotNewsItem),
    news.filter(isSummaryFillItem),
  ], {
    compare,
    keyOf: (item) => item.key,
    limit,
  });
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

function syncSummaryOrderButtons() {
  for (const button of els.summaryOrder.querySelectorAll("button[data-order]")) {
    button.classList.toggle("active", button.dataset.order === state.summaryOrder);
  }
  syncSegmentedIndicator(els.summaryOrder);
}

function reshuffleSummaries() {
  const pool = summaryPoolItems(newsSummaryItems(true));
  const page = pageForItems(pool, hotSummaryPageSize, state.variants.summary);
  state.variants.summary = (page.variant + 1) % page.pageCount;
  writeValue(`dash.variant.${state.day}.summary`, String(state.variants.summary));
  renderSummaries();
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
  const isRefreshing = state.manualRefreshKeys.has(item.key);
  const cardTitle = displaySummaryTitle(item);
  const card = document.createElement("article");
  card.className = `summary-card ${isRefreshing ? "is-refreshing" : ""} ${state.opened.has(item.key) && !state.seen.has(item.key) ? "opened" : ""}`.trim();
  setCardItemIdentity(card, item);
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
  card.append(thumb);
  if (thumb.classList.contains("is-favicon-thumb")) card.classList.add("has-favicon-thumb");
  const body = document.createElement("div");
  body.className = "summary-body";
  const top = document.createElement("div");
  top.className = "summary-top";
  const headMain = document.createElement("div");
  headMain.className = "summary-head-main";
  const pill = document.createElement("span");
  pill.className = "pill news";
  const discoveryLabel = item.externalDiscovery
    ? t("category.externalDiscovery")
    : item.timeUnverified ? t("category.timeUnverified") : localizedCategory(item);
  pill.append(createIcon("news", "pill-icon"), document.createTextNode(discoveryLabel));
  const meta = document.createElement("span");
  meta.className = "summary-meta";
  meta.textContent = item.summary?.publishedAt || item.summary?.updatedAt || item.summary?.fetchedAt
    ? formatDateTime(item.summary.publishedAt || item.summary.updatedAt || item.summary.fetchedAt)
    : "";
  const cardActions = document.createElement("div");
  cardActions.className = "summary-card-actions";
  cardActions.append(createReadingActions(item, { source: "news", compact: true, includeRead: false }));
  if (cardSummaryEnabled() && !isCorrectlySummarized(item)) cardActions.append(createManualSummaryButton(item, isRefreshing));
  headMain.append(pill, meta);
  top.append(headMain, cardActions);
  const title = document.createElement("span");
  title.className = "summary-title";
  title.textContent = cardTitle;
  const source = document.createElement("span");
  source.className = "summary-meta";
  source.textContent = item.host || item.url;
  const lines = document.createElement("div");
  lines.className = "summary-lines";
  const detailText = truncateText(summaryDetailLines(item, cardTitle).slice(0, 3).join(" "), summaryDetailMaxLength);
  if (detailText) {
    const node = document.createElement("div");
    node.className = "summary-line";
    node.textContent = detailText;
    lines.append(node);
  }
  body.append(top, title, source, lines);
  card.append(body);
  return card;
}

function createSummaryThumb(item) {
  const thumb = document.createElement("div");
  const imageUrl = item.summary?.imageUrl || "";
  const imageUrls = [...new Set((Array.isArray(item.summary?.imageUrls) ? item.summary.imageUrls : [imageUrl])
    .map((value) => String(value || "").trim()).filter(Boolean))];
  const fallbackUrl = faviconUrl({ ...item, url: itemUrl(item) });
  thumb.className = `thumb ${imageUrl ? "" : "is-favicon-thumb"}`.trim();

  if (imageUrl) {
    const img = document.createElement("img");
    let imageIndex = Math.max(0, imageUrls.indexOf(imageUrl));
    img.src = imageUrls[imageIndex] || imageUrl;
    img.alt = "";
    img.loading = "lazy";
    img.referrerPolicy = "no-referrer";
    img.addEventListener("error", () => {
      imageIndex += 1;
      if (imageUrls[imageIndex]) {
        img.src = imageUrls[imageIndex];
        return;
      }
      renderSummaryFaviconThumb(thumb, fallbackUrl);
    });
    thumb.append(img);
  } else {
    renderSummaryFaviconThumb(thumb, fallbackUrl);
  }

  return thumb;
}

function renderSummaryFaviconThumb(thumb, fallbackUrl) {
  const favicon = fallbackUrl || "favicon.svg";
  thumb.className = "thumb is-favicon-thumb";
  thumb.closest(".summary-card")?.classList.add("has-favicon-thumb");
  const glow = document.createElement("img");
  glow.className = "thumb-favicon-glow";
  glow.src = favicon;
  glow.alt = "";
  glow.loading = "lazy";
  glow.referrerPolicy = "no-referrer";
  glow.setAttribute("aria-hidden", "true");
  glow.addEventListener("error", () => {
    if (glow.src.endsWith("/favicon.svg")) return;
    glow.src = "favicon.svg";
  }, { once: true });
  thumb.replaceChildren(glow);
}

async function refreshSummaryItem(item, event) {
  event.preventDefault();
  event.stopPropagation();
  if (state.manualRefreshKeys.has(item.key)) return;

  const articleUrl = itemUrl(item);
  let latestItem = item;
  state.manualRefreshKeys.add(item.key);
  updateSummaryCard(item);
  try {
    const result = await apiPost("/api/summary/refresh", {
      articleId: item.feedItem?.articleId || item.key,
      sourceKey: item.sourceKey,
      url: articleUrl,
    });
    if (!result.ok) throw new Error(localizedResponseMessage(result, "error.requestFailed"));
    await loadDashboard();
    latestItem = findNewsItemByReference({
      articleId: item.feedItem?.articleId || item.key,
      sourceKey: item.sourceKey,
      url: itemUrl(item),
      title: displaySummaryTitle(item),
    }) || item;
    if (state.data?.ai && result.quota) {
      state.data.ai.usedToday = result.quota.usedToday;
      state.data.ai.dailyLimit = result.quota.dailyLimit;
      renderStatus();
    }
  } catch (error) {
    renderOverviewStatus(t("summary.manualFailed"), localizedErrorMessage(error));
  } finally {
    state.manualRefreshKeys.delete(item.key);
    updateSummaryCard(latestItem);
  }
}

function updateSummaryCard(item) {
  if (!isHotNewsItem(item) || !matchesQuery(item)) {
    renderSummaries();
    return;
  }
  const current = [...els.summaryGrid.querySelectorAll(".summary-card")]
    .find((node) => node.dataset.key === item.key);
  if (current) syncSummaryCard(current, createSummaryCard(item));
  else renderSummaries();
}

function syncSummaryCard(currentCard, nextCard) {
  currentCard.className = nextCard.className;
  currentCard.dataset.itemVersion = nextCard.dataset.itemVersion || "";
  currentCard.ampiraItem = nextCard.ampiraItem;
  currentCard.title = nextCard.title;
  currentCard.setAttribute("aria-label", nextCard.getAttribute("aria-label") || "");

  const currentThumb = currentCard.querySelector(":scope > .thumb");
  const nextThumb = nextCard.querySelector(":scope > .thumb");
  if (currentThumb && nextThumb && currentThumb.isEqualNode(nextThumb)) {
    nextThumb.remove();
  } else if (currentThumb && nextThumb) {
    currentThumb.replaceWith(nextThumb);
  } else if (nextThumb) {
    currentCard.prepend(nextThumb);
  } else {
    currentThumb?.remove();
  }

  const currentBody = currentCard.querySelector(":scope > .summary-body");
  const nextBody = nextCard.querySelector(":scope > .summary-body");
  if (currentBody && nextBody) currentBody.replaceWith(nextBody);
  else if (nextBody) currentCard.append(nextBody);
  else currentBody?.remove();
  return currentCard;
}
}
