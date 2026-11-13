import { animatePanelEntrance, nodesEqualIgnoringIconLoadState, spanText } from "./dom.mjs";
import { createSwitchableCardView } from "./switchable-card-view.mjs";
import { animateKeyedLayout, captureKeyedLayout } from "./motion.mjs";
import { briefTaskPhase, isAiTaskBusy } from "./ai-task-state.mjs";
import { usesBotBrief } from "../../extension/core/bot-mode.mjs";
import { createDigestCardView } from "./digest-card-view.mjs";
import { createWeatherCardState } from "./weather-card-state.mjs";
import { SWITCHABLE_CARD_IDS, todoCardTarget } from "./dashboard-card-types.mjs";
import { buildDailyEventCandidates } from "../../extension/core/daily-events.mjs";

export function shouldShowQueueReadAll(items) {
  return Boolean(items?.length);
}

export function createEfficiencyView(options) {
  const {
    state, els, dashboardLayout, t, tc, apiPost, confirmManualAiUsage, createEmptyState, createIcon,
    localizedErrorMessage, displaySummaryTitle, itemUrl, readingQueueItems,
    openAndMarkReadingQueue, openDailyItem,
    createBookmarkFavicon, displayBookmarkTitle,
    findNewsItemByReference, hostFromUrl, isNewsCard, openExternal,
    readingQueueOpenOnReadAll, renderDaily, renderOverviewStatus, renderSummaries, selectDailyEvents,
    openAiSettings, getLocale, writeJson, writeValue, requestWeatherPermissions, attachLinkContextMenu, createArchiveContent,
  } = options;
  let eventTitleReveal = null;
  let activeEventTitle = null;
  let dailyDigestRevealPending = false;
  let dailyDigestActionPending = false;
  const views = new Map();
  const renderType = (type, except) => {
    for (const [id, view] of views) if (id !== except && state.cardTypes[id] === type) view.render();
  };
  const weatherState = createWeatherCardState({ state, apiPost, localizedErrorMessage, notify: () => renderType("weather") });
  let stockState = null;
  const getStockState = () => stockState ||= import("./stock-card-state.mjs").then(({ createStockCardState }) =>
    createStockCardState({ apiPost, localizedErrorMessage, writeJson, notify: () => renderType("stocks") }))
    .catch(error => { stockState = null; throw error; });
  const refreshStocks = () => {
    if (document.visibilityState === "visible" && Object.values(state.cardTypes).includes("stocks")) {
      stockState?.then(shared => shared.ensure()).catch(() => {});
    }
  };
  let countdownState = null;
  const getCountdownState = () => countdownState ||= import("./countdown-card-state.mjs").then(({ createCountdownCardState }) =>
    createCountdownCardState({ writeJson, notify: () => renderType("countdown") }))
    .catch(error => { countdownState = null; throw error; });
  const refreshUtilityDates = () => {
    refreshStocks();
    if (document.visibilityState === "visible" && Object.values(state.cardTypes).includes("countdown")) {
      countdownState?.then(shared => shared.refreshDay()).catch(() => {});
    }
  };
  for (const id of SWITCHABLE_CARD_IDS) {
    const digestView = createDigestCardView({ state, t, createEmptyState, createIcon, localizedErrorMessage, openAiSettings,
      openExternal, refreshDailyDigest, isRevealPending: () => dailyDigestRevealPending });
    views.set(id, createSwitchableCardView({
      id, state, t, tc, getLocale, apiPost, createEmptyState, createIcon, writeJson, writeValue, attachLinkContextMenu,
      createEventsContent: createDailyEventsContent, createDigestContent: digestView.render, createArchiveContent,
      createQueueContent, createDailyContent: options.createDailyContent, onTypeChange: renderDaily,
      reconcileContent: (type, current, next, settings) => {
        if (type === "queue") syncQueuePanelList(current, next);
        else if (["news", "inspiration"].includes(type)) options.syncDailyContent(current, next, settings);
        else return false;
        return true;
      },
      requestWeatherPermissions, localizedErrorMessage, weatherState, getStockState, getCountdownState, notifyTodos: (source) => renderType("todo", source),
    }));
  }
  document.addEventListener("visibilitychange", () => {
    refreshUtilityDates();
    if (document.visibilityState === "visible" && Object.values(state.cardTypes).includes("weather")) weatherState.ensure({ retryStale: true });
  });
  const utilityTimer = window.setInterval(refreshUtilityDates, 60_000);
  window.addEventListener("pagehide", () => window.clearInterval(utilityTimer), { once: true });
  function getTodoTargetCard() {
    const order = Array.from(dashboardLayout.root.querySelectorAll(".dashboard-slot > [data-dashboard-card]"), (card) => card.dataset.dashboardCard);
    const focusedId = document.activeElement?.closest?.("[data-dashboard-card]")?.dataset.dashboardCard;
    return views.get(todoCardTarget(state.cardTypes, order, focusedId));
  }
  function getCardContextActions(target) {
    const card = target.closest("[data-dashboard-card]");
    const view = views.get(card?.dataset.dashboardCard);
    return view?.card === card ? view.contextActions(target) : [];
  }
  function renderDailyCards(id, settings) {
    for (const [cardId, view] of views) {
      if ((!id || id === cardId) && ["news", "inspiration"].includes(state.cardTypes[cardId])) {
        dashboardLayout.mount(cardId, view.render(undefined, settings));
      }
    }
  }
  return { renderEfficiencyPanel, renderDailyCards, refreshDailyDigest, invalidateWeather: weatherState.invalidate,
    invalidateStocks: () => stockState?.then(shared => shared.invalidate()).catch(() => {}),
    syncPersonalCards() {
      stockState?.then(shared => shared.syncFromStorage()).catch(() => {});
      countdownState?.then(shared => shared.syncFromStorage()).catch(() => {});
    },
    getTodoTargetCard: () => getTodoTargetCard()?.card, openTodoComposer: () => getTodoTargetCard()?.openTodoComposer(), getCardContextActions };
function openDigestItem(digestItem) {
  const item = findNewsItemByReference(digestItem);
  if (item) {
    openDailyItem(item);
    return;
  }
  if (digestItem?.url) openExternal(digestItem.url, digestItem.title || "", null, { contentKind: "news" });
}

function renderEfficiencyPanel() {
  if (!els.efficiencyPanel) return;
  dashboardLayout.sync();
  const queueLayouts = new Map(Array.from(views, ([id, view]) => [id, captureKeyedLayout(view.card, ".queue-row[data-key]")]));
  const isInitialEntrance = els.efficiencyPanel.dataset.loading === "true";
  const now = Date.now();
  const eventCandidates = buildDailyEventCandidates(state.data?.feed?.items || [],
    (state.data?.nativeDailyDigest || state.data?.dailyDigest)?.items || [], now);
  const dailyEvents = selectDailyEvents(eventCandidates, {
    now,
    limit: 3,
    recentLimit: 1,
    minSourceCount: 2,
  });
  const renderedCards = Array.from(views, ([id, view]) => {
    const card = view.render(dailyEvents, { immediate: isInitialEntrance });
    dashboardLayout.mount(id, card);
    return card;
  });
  delete els.dailyBoard.dataset.loading;
  if (isInitialEntrance) {
    delete els.efficiencyPanel.dataset.loading;
    if (state.data?.onboarding?.completed !== false) animatePanelEntrance(renderedCards);
  } else {
    for (const [id, view] of views) animateKeyedLayout(view.card, queueLayouts.get(id), ".queue-row[data-key]");
  }
}

function syncQueuePanelList(currentList, nextList) {
  currentList.className = nextList.className;
  const currentRows = directQueueRows(currentList);
  const nextRows = directQueueRows(nextList);
  if (currentRows.length !== currentList.children.length || nextRows.length !== nextList.children.length) {
    currentList.replaceChildren(...nextList.childNodes);
    return;
  }
  const currentByKey = new Map(currentRows.map((row) => [row.dataset.key || "", row]));
  const resolvedRows = nextRows.map((nextRow) => {
    const currentRow = currentByKey.get(nextRow.dataset.key || "");
    return currentRow && nodesEqualIgnoringIconLoadState(currentRow, nextRow) ? currentRow : nextRow;
  });
  resolvedRows.forEach((row, index) => {
    if (currentList.children[index] !== row) currentList.insertBefore(row, currentList.children[index] || null);
  });
  while (currentList.children.length > resolvedRows.length) currentList.lastElementChild?.remove();
}

function directQueueRows(list) {
  return Array.from(list.children).filter((node) => node.matches?.(".queue-row[data-key]"));
}

function createQueueContent() {
  const items = readingQueueItems();
  const shouldOpen = readingQueueOpenOnReadAll();
  const hasChosenReadAllBehavior = state.settings?.readingQueueReadAllPrompted === true;
  let readAll = null;
  if (shouldShowQueueReadAll(items)) {
    readAll = document.createElement("button");
    readAll.className = "efficiency-action queue-read-all";
    readAll.type = "button";
    readAll.title = t(hasChosenReadAllBehavior ? (shouldOpen ? "queue.readAllOpen" : "queue.readAllNoOpen") : "queue.readAllChoose", { count: items.length });
    readAll.setAttribute("aria-label", readAll.title);
    readAll.textContent = t("action.readAll");
    readAll.addEventListener("click", () => openAndMarkReadingQueue(readingQueueItems()));
  }
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
  return { content: list, meta: items.length ? spanText(String(items.length), "count") : null, actions: readAll ? [readAll] : [] };
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

function createQueuePanelRow(item) {
  const row = document.createElement("button");
  row.className = "efficiency-row queue-row";
  row.type = "button";
  row.dataset.key = String(item.key || itemUrl(item));
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
    item.resolvedTimeScope === "recent" ? t("events.recent") : "",
  ].filter(Boolean).join(" · ");
  main.append(title, meta);
  row.append(main);
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
  if (dailyDigestActionPending) return;
  dailyDigestActionPending = true;
  try { await runDailyDigestRefresh(); } finally { dailyDigestActionPending = false; }
}

async function runDailyDigestRefresh() {
  if (isAiTaskBusy(briefTaskPhase(state))) return;
  if (!usesBotBrief(state.data) && !await confirmManualAiUsage()) return;
  if (isAiTaskBusy(briefTaskPhase(state))) return;
  delete state.dailyDigestErrorAt;
  state.dailyDigestRefreshing = true;
  renderEfficiencyPanel();
  try {
    const result = await apiPost("/api/daily-summary/refresh");
    if (state.data) state.data.dailyDigest = result;
    dailyDigestRevealPending = true;
    renderSummaries();
    renderDaily();
  } catch (error) {
    state.dailyDigestErrorAt = String(state.data?.dailyDigest?.generatedAt || "");
    renderOverviewStatus(t("digest.refreshFailed"), localizedErrorMessage(error));
  } finally {
    state.dailyDigestRefreshing = false;
    renderEfficiencyPanel();
    dailyDigestRevealPending = false;
  }
}
}
