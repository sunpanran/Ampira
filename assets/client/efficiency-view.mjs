export function createEfficiencyView(options) {
  const {
    state, els, t, tc, apiPost, createEmptyState, createIcon, createThemedIcon,
    localizedStatusMessage, localizedResponseMessage, localizedErrorMessage,
    displaySummaryTitle, itemUrl, formatDateTime, readingQueueItems,
    openAndMarkReadingQueue, openDailyItem, renderStatus,
    allTranslations, createBookmarkFavicon, displayBookmarkTitle,
    findNewsItemByReference, hostFromUrl, isNewsCard, openExternal,
    readingQueueOpenOnReadAll, renderDaily, renderOverviewStatus, renderSummaries,
    setIconLabel,
  } = options;
  return { renderEfficiencyPanel, refreshDailyDigest };
function dailyDigestStatusLabel(digest) {
  if (!digest?.generatedAt) return t("digest.status.waiting");
  if (digest.status === "ai") return t("digest.status.ai");
  if (digest.status === "quota-or-empty") return t("digest.status.quota");
  if (digest.status === "no-api-key") return t("digest.status.noService");
  if (digest.status === "fallback") return t("digest.status.failed");
  if (digest.status === "pending") return t("digest.status.waiting");
  return t("digest.status.notGenerated");
}

function createDailyDigestEmptyState(digest) {
  if (state.dailyDigestRefreshing) {
    return createEmptyState({
      title: t("digest.refreshing.title"),
      body: t("digest.refreshing.body"),
      variant: "compact",
    });
  }
  if (digest?.status === "no-api-key") {
    return createEmptyState({
      title: t("digest.noService.title"),
      body: t("digest.noService.body"),
      variant: "compact",
      actionLabel: t("action.openSettings"),
      onAction: openSettings,
    });
  }
  if (digest?.status === "fallback") {
    return createEmptyState({
      title: t("digest.failed.title"),
      body: t("digest.failed.body"),
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
    actionLabel: t("action.reorganize"),
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
  const card = createEfficiencyCard(t("digest.cardTitle"), dailyDigestStatusLabel(digest), "sparkling");
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
    const summary = document.createElement("div");
    summary.className = "ai-digest-summary";
    summary.append(...overviewLines.map((line) => {
      const paragraph = document.createElement("p");
      paragraph.textContent = line;
      return paragraph;
    }));
    nodes.push(summary);
  }
  nodes.push(createDigestRefreshButton());
  return nodes;
}

function createDigestRefreshButton() {
  const retry = document.createElement("button");
  retry.className = "ai-digest-refresh-mini";
  retry.type = "button";
  retry.disabled = state.dailyDigestRefreshing;
  setIconLabel(retry, "refresh-cw-01", t(state.dailyDigestRefreshing ? "action.organizing" : "action.reorganize"), "inline-icon", "btn-label");
  retry.addEventListener("click", refreshDailyDigest);
  return retry;
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
  els.efficiencyPanel.hidden = isSearching;
  if (isSearching) {
    els.efficiencyPanel.replaceChildren();
    return;
  }
  const queueItems = readingQueueItems();
  const dailyEvents = [...(state.data?.dailyDigest?.items || [])]
    .sort((left, right) => Number(right.importanceScore || 0) - Number(left.importanceScore || 0))
    .slice(0, 3);
  const cards = [
    createDailyEventsPanelCard(dailyEvents),
    createDailyDigestPanelCard(),
    createQueuePanelCard(queueItems),
  ];
  els.efficiencyPanel.replaceChildren(...cards);
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

function createDailyEventsPanelCard(items) {
  const card = createEfficiencyCard(t("events.cardTitle"), tc("unit.entries", items.length), "news");
  const list = document.createElement("div");
  list.className = "efficiency-list";
  if (!items.length) {
    list.append(createEmptyState({
      title: t("events.empty.title"),
      body: t("events.empty.body"),
      variant: "compact",
    }));
  } else {
    list.append(...items.map(createDailyEventPanelRow));
  }
  card.append(list);
  return card;
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
  row.title = item.url || "";
  row.addEventListener("click", () => openDigestItem(item));
  const main = document.createElement("span");
  main.className = "efficiency-row-main";
  const title = document.createElement("span");
  title.className = "efficiency-row-title";
  title.textContent = item.title || item.source || t("digest.importantNews");
  const meta = document.createElement("span");
  meta.className = "efficiency-row-meta";
  meta.textContent = item.source || item.host || "";
  main.append(title, meta);
  const badge = document.createElement("span");
  badge.className = "efficiency-score";
  badge.textContent = String(Math.round(Number(item.importanceScore || 0)));
  row.append(main, badge);
  return row;
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
