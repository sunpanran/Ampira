import { animatePanelEntrance } from "./dom.mjs";
import { createUtilityCardView } from "./utility-card-view.mjs";

export function createEfficiencyView(options) {
  const {
    state, els, t, tc, apiPost, createEmptyState, createIcon, createThemedIcon,
    localizedStatusMessage, localizedResponseMessage, localizedErrorMessage,
    displaySummaryTitle, itemUrl, formatDateTime, readingQueueItems,
    openAndMarkReadingQueue, openDailyItem, renderStatus,
    allTranslations, createBookmarkFavicon, displayBookmarkTitle,
    findNewsItemByReference, hostFromUrl, isNewsCard, openExternal,
    readingQueueOpenOnReadAll, renderDaily, renderOverviewStatus, renderSummaries, selectDailyEvents,
    openAiSettings, getLocale, writeJson, writeValue, requestWeatherPermissions, attachLinkContextMenu,
  } = options;
  const utilityCardView = createUtilityCardView({
    state, t, tc, getLocale, apiPost, createEmptyState, createIcon,
    createEventsContent: createDailyEventsContent, writeJson, writeValue,
    requestWeatherPermissions, localizedErrorMessage,
  });
  let eventTitleReveal = null;
  let activeEventTitle = null;
  return { renderEfficiencyPanel, refreshDailyDigest, invalidateWeather: utilityCardView.invalidateWeather };
function dailyDigestStatusLabel(digest, ai) {
  if (ai?.enabled !== true) return t("digest.status.noService");
  if (!digest?.generatedAt) return t("digest.status.waiting");
  if (digest.status === "ai") return t("digest.status.ai");
  if (digest.status === "quota-or-empty") return t("digest.status.quota");
  if (digest.status === "no-api-key") return t("digest.status.noService");
  if (digest.status === "fallback") return t("digest.status.failed");
  if (digest.status === "pending") return t("digest.status.waiting");
  return t("digest.status.notGenerated");
}

function createDailyDigestEmptyState(digest) {
  if (state.data?.ai?.enabled !== true) {
    return createEmptyState({
      title: t("digest.noService.title"),
      body: t("digest.noService.body"),
      variant: "compact",
      actionLabel: t("action.configureAi"),
      onAction: openAiSettings,
    });
  }
  if (state.dailyDigestRefreshing) {
    return createEmptyState({
      title: t("digest.refreshing.title"),
      body: t("digest.refreshing.body"),
      variant: "compact",
    });
  }
  if (digest?.status === "fallback") {
    return createEmptyState({
      title: t("digest.failed.title"),
      body: digest.errorKey
        ? localizedErrorMessage({ messageKey: digest.errorKey, messageParams: digest.errorParams || {} })
        : t("digest.failed.body"),
      variant: "compact",
      actionLabel: t("action.reorganize"),
      onAction: refreshDailyDigest,
    });
  }
  if (digest?.status === "quota-or-empty") {
    return createEmptyState({
      title: t("digest.retry.title"),
      body: t("digest.retry.body"),
      variant: "compact",
      actionLabel: t("action.reorganize"),
      onAction: refreshDailyDigest,
    });
  }
  return createEmptyState({
    title: t("digest.empty.title"),
    body: t("digest.empty.body"),
    variant: "compact",
    actionLabel: t("action.generateDigest"),
    onAction: refreshDailyDigest,
  });
}

function hasGeneratedDailyDigestOverview(digest, lines) {
  if (digest?.status !== "ai") return false;
  const items = Array.isArray(digest?.items) ? digest.items.filter(Boolean) : [];
  if (items.length) return true;
  if (!lines.length) return false;
  return lines.some((line) => !isFallbackDailyDigestOverview(line));
}

function isFallbackDailyDigestOverview(line) {
  const text = String(line || "").trim();
  return [
    ...allTranslations("digest.legacyFallbackPrefix"),
    ...allTranslations("digest.legacyNoAiPrefix"),
  ].some((prefix) => text.startsWith(prefix));
}

function createDailyDigestPanelCard() {
  const digest = state.data?.dailyDigest;
  const card = createEfficiencyCard(t("digest.cardTitle"), dailyDigestStatusLabel(digest, state.data?.ai), "sparkling");
  card.classList.add("digest-card");
  const overview = document.createElement("div");
  overview.className = "ai-digest-overview";
  const overviewLines = Array.isArray(digest?.overview)
    ? digest.overview.map((line) => String(line || "").trim()).filter(Boolean)
    : [];
  if (hasGeneratedDailyDigestOverview(digest, overviewLines)) {
    overview.replaceChildren(...dailyDigestBriefNodes(digest));
  } else {
    overview.replaceChildren(createDailyDigestEmptyState(digest));
  }
  card.append(overview);
  return card;
}

function dailyDigestBriefNodes(digest) {
  const nodes = [];
  const overviewLines = Array.isArray(digest?.overview)
    ? digest.overview.map((line) => String(line || "").trim()).filter(Boolean).slice(0, 3)
    : [];
  if (overviewLines.length) {
    const summary = document.createElement("button");
    summary.className = "ai-digest-summary";
    summary.type = "button";
    summary.disabled = state.dailyDigestRefreshing;
    summary.title = t("action.reorganize");
    summary.setAttribute("aria-label", t("action.reorganize"));
    summary.addEventListener("click", refreshDailyDigest);
    summary.append(...dailyDigestParagraphs(overviewLines).map((line) => {
      const paragraph = document.createElement("span");
      paragraph.className = "ai-digest-paragraph";
      paragraph.textContent = line;
      return paragraph;
    }));
    nodes.push(summary);
  }
  return nodes;
}

function dailyDigestParagraphs(lines) {
  if (lines.length !== 1) return lines;
  const segments = lines[0].match(/[^；;。！？]+(?:[；;。！？]+|$)/gu)
    ?.map((segment) => segment.trim())
    .filter(Boolean) || [];
  if (segments.length < 2) return lines;
  const groupCount = Math.min(4, segments.length);
  const groups = Array.from({ length: groupCount }, () => []);
  segments.forEach((segment, index) => {
    groups[Math.min(groupCount - 1, Math.floor(index * groupCount / segments.length))].push(segment);
  });
  return groups.map((group) => group.join(""));
}

function openDigestItem(digestItem) {
  const item = findNewsItemByReference(digestItem);
  if (item) {
    openDailyItem(item);
    return;
  }
  if (digestItem?.url) openExternal(digestItem.url, digestItem.title || "");
}

function renderEfficiencyPanel() {
  if (!els.efficiencyPanel) return;
  const isSearching = Boolean(state.query);
  const isInitialEntrance = els.efficiencyPanel.dataset.loading === "true";
  els.efficiencyPanel.hidden = isSearching;
  if (isSearching) {
    els.efficiencyPanel.replaceChildren();
    return;
  }
  const queueItems = readingQueueItems();
  const dailyEvents = selectDailyEvents(state.data?.dailyDigest?.items || [], {
    limit: 3,
    recentLimit: 1,
    minSourceCount: 2,
  });
  const cards = [
    utilityCardView.render(dailyEvents),
    createDailyDigestPanelCard(),
    createQueuePanelCard(queueItems),
  ];
  const renderedCards = syncEfficiencyCards(els.efficiencyPanel, cards);
  if (isInitialEntrance) {
    delete els.efficiencyPanel.dataset.loading;
    animatePanelEntrance(renderedCards);
  }
}

function syncEfficiencyCards(panel, nextCards) {
  const currentCards = Array.from(panel.children);
  const renderedCards = nextCards.map((nextCard, index) => {
    const currentCard = currentCards[index];
    return currentCard?.matches?.(".efficiency-card") && currentCard.isEqualNode(nextCard)
      ? currentCard
      : nextCard;
  });
  const retainedCards = new Set(renderedCards);
  renderedCards.forEach((card, index) => {
    if (panel.children[index] !== card) panel.insertBefore(card, panel.children[index] || null);
  });
  Array.from(panel.children).forEach((card) => {
    if (!retainedCards.has(card)) card.remove();
  });
  return renderedCards;
}

function createQueuePanelCard(items) {
  const shouldOpen = readingQueueOpenOnReadAll();
  const readAll = document.createElement("button");
  readAll.className = "efficiency-action queue-read-all";
  readAll.type = "button";
  readAll.disabled = !items.length;
  readAll.title = items.length
    ? t(shouldOpen ? "queue.readAllOpen" : "queue.readAllNoOpen", { count: items.length })
    : t("queue.noPending");
  readAll.setAttribute("aria-label", readAll.title);
  readAll.textContent = t("action.readAll");
  readAll.addEventListener("click", () => openAndMarkReadingQueue(items));
  const card = createEfficiencyCard(t("queue.cardTitle"), tc("queue.pending", items.length), "bookmark-ribbon", readAll);
  card.classList.add("queue-card");
  const list = document.createElement("div");
  list.className = "efficiency-list";
  if (!items.length) {
    list.append(createEmptyState({
      title: t("queue.empty.title"),
      body: t("queue.empty.body"),
      variant: "compact",
    }));
  } else {
    list.append(...items.map(createQueuePanelRow));
  }
  card.append(list);
  return card;
}

function createDailyEventsContent(items) {
  const list = document.createElement("div");
  list.className = "efficiency-list utility-scroll-list events-list";
  if (!items.length) {
    list.append(createEmptyState({
      title: t("events.empty.title"),
      body: t("events.empty.body"),
      variant: "compact",
    }));
  } else {
    list.append(...items.map(createDailyEventPanelRow));
  }
  return list;
}

function createEfficiencyCard(titleText, metaText, iconName, action = null) {
  const card = document.createElement("section");
  card.className = "efficiency-card";
  const head = document.createElement("div");
  head.className = "efficiency-head";
  const title = document.createElement("div");
  title.className = "efficiency-title";
  title.append(createIcon(iconName, "card-icon"), document.createTextNode(titleText));
  const meta = document.createElement("span");
  meta.className = "efficiency-meta";
  meta.textContent = metaText;
  const tools = document.createElement("div");
  tools.className = "efficiency-head-tools";
  if (action) tools.append(action);
  tools.append(meta);
  head.append(title, tools);
  card.append(head);
  return card;
}

function createQueuePanelRow(item) {
  const row = document.createElement("button");
  row.className = "efficiency-row queue-row";
  row.type = "button";
  row.title = itemUrl(item);
  row.addEventListener("click", () => openDailyItem(item));
  attachLinkContextMenu(row, () => ({ url: itemUrl(item), item, canExplain: true }));
  const main = document.createElement("span");
  main.className = "efficiency-row-main";
  const title = document.createElement("span");
  title.className = "efficiency-row-title";
  title.textContent = isNewsCard(item) ? displaySummaryTitle(item) : displayBookmarkTitle(item);
  const meta = document.createElement("span");
  meta.className = "efficiency-row-meta";
  meta.textContent = [item.host || hostFromUrl(itemUrl(item)), item.category].filter(Boolean).join(" · ");
  main.append(title, meta);
  row.append(createBookmarkFavicon({ ...item, url: itemUrl(item) }), main);
  return row;
}

function createDailyEventPanelRow(item) {
  const row = document.createElement("button");
  row.className = "efficiency-row topic-row";
  row.type = "button";
  row.addEventListener("click", () => openDigestItem(item));
  const main = document.createElement("span");
  main.className = "efficiency-row-main";
  const title = document.createElement("span");
  title.className = "efficiency-row-title";
  title.textContent = item.title || item.source || t("digest.importantNews");
  attachEventTitleReveal(row, title);
  const meta = document.createElement("span");
  meta.className = "efficiency-row-meta";
  const confirmationLabel = item.eventConfidence === "high-confidence-single"
    ? t("events.singlePending")
    : tc("unit.sources", Number(item.sourceCount || 1));
  if (item.eventConfidence === "high-confidence-single") row.classList.add("is-unconfirmed");
  meta.textContent = [
    item.publisher || item.source || item.host || "",
    confirmationLabel,
  ].filter(Boolean).join(" · ");
  main.append(title, meta);
  const badge = document.createElement("span");
  badge.className = "efficiency-score";
  badge.textContent = String(Math.round(Number(item.importanceScore || 0)));
  row.append(main, badge);
  return row;
}

function attachEventTitleReveal(row, title) {
  const show = (event) => {
    if (event?.pointerType === "touch" || title.scrollWidth <= title.clientWidth + 1) return;
    const rect = title.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    if (!eventTitleReveal?.isConnected) {
      eventTitleReveal = document.createElement("div");
      eventTitleReveal.className = "news-title-reveal";
      eventTitleReveal.setAttribute("aria-hidden", "true");
      document.body.append(eventTitleReveal);
      window.addEventListener("scroll", hideEventTitleReveal, { capture: true, passive: true });
      window.addEventListener("resize", hideEventTitleReveal, { passive: true });
    }
    const inset = 8;
    const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
    const width = Math.min(Math.max(rect.width + 12, Math.min(320, viewportWidth - inset * 2)), 480, viewportWidth - inset * 2);
    eventTitleReveal.textContent = title.textContent;
    eventTitleReveal.style.width = `${width}px`;
    eventTitleReveal.style.left = `${Math.min(Math.max(rect.left - 6, inset), viewportWidth - width - inset)}px`;
    eventTitleReveal.style.top = `${Math.max(inset, rect.top - 5)}px`;
    eventTitleReveal.classList.remove("is-visible", "is-above");
    const revealHeight = eventTitleReveal.offsetHeight;
    const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
    const opensAbove = rect.top - 5 + revealHeight > viewportHeight - inset;
    eventTitleReveal.style.top = `${opensAbove ? Math.max(inset, rect.bottom + 5 - revealHeight) : Math.max(inset, rect.top - 5)}px`;
    eventTitleReveal.classList.toggle("is-above", opensAbove);
    activeEventTitle = title;
    void eventTitleReveal.offsetWidth;
    eventTitleReveal.classList.add("is-visible");
  };
  const hide = () => {
    if (activeEventTitle !== title) return;
    activeEventTitle = null;
    eventTitleReveal?.classList.remove("is-visible");
  };
  title.addEventListener("pointerenter", show);
  title.addEventListener("pointerleave", hide);
  row.addEventListener("focus", show);
  row.addEventListener("blur", hide);
}

function hideEventTitleReveal() {
  activeEventTitle = null;
  eventTitleReveal?.classList.remove("is-visible");
}

async function refreshDailyDigest(event) {
  event?.preventDefault();
  event?.stopPropagation?.();
  if (state.dailyDigestRefreshing) return;
  state.dailyDigestRefreshing = true;
  renderEfficiencyPanel();
  try {
    const result = await apiPost("/api/daily-summary/refresh");
    if (state.data) state.data.dailyDigest = result;
    renderEfficiencyPanel();
    renderSummaries();
    renderDaily();
  } catch (error) {
    renderOverviewStatus(t("digest.refreshFailed"), localizedErrorMessage(error));
  } finally {
    state.dailyDigestRefreshing = false;
    renderEfficiencyPanel();
  }
}
}
