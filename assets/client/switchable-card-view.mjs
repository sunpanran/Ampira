import { CARD_TYPE_ICONS, CARD_TYPE_TITLES, DASHBOARD_CARD_TYPES, DASHBOARD_CARD_TYPES_KEY } from "./dashboard-card-types.mjs";
import { createTodoCardView } from "./todo-card-view.mjs";
import { createLazyController } from "./lazy-controller.mjs";
import { animateElement } from "./motion.mjs";
import { nodesEqualIgnoringIconLoadState, spanText } from "./dom.mjs";

export function createSwitchableCardView(options) {
  const { id, state, t, tc, createIcon, createEventsContent, createDigestContent, createArchiveContent,
    writeJson, weatherState, notifyTodos, localizedErrorMessage } = options;
  let eventItems = [];
  let renderedType = "";
  let titleSignature = "";
  let weatherView = null, weatherLoading = null, weatherLoadError = "";
  let stockView = null, stockLoading = null, stockLoadError = "";
  let countdownView = null, countdownLoading = null, countdownLoadError = "";
  const getType = () => state.cardTypes[id];
  const card = document.createElement("section");
  card.className = "efficiency-card utility-card";
  card.dataset.dashboardCard = id;
  card.dataset.efficiencyCard = id;
  const head = document.createElement("div");
  head.className = "efficiency-head";
  const title = document.createElement("div");
  title.className = "efficiency-title";
  const tools = document.createElement("div");
  tools.className = "efficiency-head-tools";
  const metadata = document.createElement("div");
  metadata.className = "efficiency-head-tools utility-type-tools";
  tools.append(metadata);
  head.append(title, tools);
  const body = document.createElement("div");
  body.className = "utility-card-body";
  card.append(head, body);
  const getFocusFallback = () => title;
  const todoView = createTodoCardView({
    state, t, createIcon, writeJson, instanceId: id,
    requestRender: () => render(), onChange: () => notifyTodos(id),
    getContentRoot: () => body, getFocusFallback,
  });
  const modePicker = createLazyController({
    load: async () => {
      const { createUtilityCardPicker } = await import("./utility-card-picker.mjs");
      return createUtilityCardPicker({
        card, covered: [head, body], t, createIcon,
        choices: DASHBOARD_CARD_TYPES.map((value) => ({ value, icon: CARD_TYPE_ICONS[value], labelKey: CARD_TYPE_TITLES[value] })),
        getValue: getType, onSelect: selectType, getFocusTarget: getFocusFallback,
      });
    },
    onError: (error) => { title.title = localizedErrorMessage(error); },
  });

  function selectType(type) {
    if (!DASHBOARD_CARD_TYPES.includes(type) || type === getType()) return;
    state.cardTypes = { ...state.cardTypes, [id]: type };
    writeJson(DASHBOARD_CARD_TYPES_KEY, state.cardTypes);
    render();
    options.onTypeChange?.();
  }

  function render(items = eventItems, settings = {}) {
    eventItems = Array.isArray(items) ? items : [];
    const type = getType();
    const changed = type !== renderedType;
    if (changed) {
      if (renderedType === "weather") weatherView?.deactivate();
      if (renderedType === "stocks") stockView?.deactivate();
      if (renderedType === "countdown") countdownView?.deactivate();
      if (renderedType === "todo") todoView.resetComposer();
      if (type === "weather") weatherState.read({ retryStale: true });
      renderedType = type;
    }
    card.dataset.cardType = type;
    card.dataset.utilityMode = type;
    const pending = todoView.syncAddButton(type === "todo");
    const view = type === "weather" ? renderWeather()
      : type === "stocks" ? renderStocks()
      : type === "countdown" ? renderCountdown()
      : type === "todo" ? { content: todoView.createContent(), meta: spanText(tc("todo.pending", pending), "efficiency-meta utility-meta"), actions: [todoView.addButton] }
      : type === "digest" ? createDigestContent()
      : type === "archive" ? createArchiveContent()
      : type === "queue" ? options.createQueueContent()
      : ["news", "inspiration"].includes(type) ? options.createDailyContent(id, type)
      : { content: createEventsContent(eventItems), meta: spanText(tc("unit.entries", eventItems.length), "efficiency-meta utility-meta") };
    card.classList.toggle("digest-card", type === "digest");
    card.classList.toggle("is-archive", type === "archive");
    card.classList.toggle("queue-card", type === "queue");
    const daily = ["news", "inspiration"].includes(type);
    card.classList.toggle("board-column", daily);
    card.classList.toggle("is-news", type === "news");
    card.classList.toggle("is-inspiration", type === "inspiration");
    head.classList.toggle("column-head", daily);
    title.classList.toggle("column-title", daily);
    if (daily) card.dataset.columnId = id;
    else delete card.dataset.columnId;
    card.classList.toggle("is-bot-content", Boolean(view.bot));
    card.classList.toggle("is-resolving", Boolean(view.resolving));
    card.setAttribute("aria-busy", String(Boolean(view.busy)));
    const label = t(CARD_TYPE_TITLES[type]);
    const icon = view.icon || CARD_TYPE_ICONS[type];
    const signature = icon + ":" + label;
    if (signature !== titleSignature) {
      titleSignature = signature;
      title.replaceChildren(createIcon(icon, "card-icon"), spanText(label, "dashboard-panel-label"));
    }
    modePicker.call("sync");
    syncMetadata([view.meta, ...(view.actions || [])].filter(Boolean));
    const current = body.firstElementChild;
    const reconciled = !changed && current && options.reconcileContent?.(type, current, view.content, settings);
    if (!reconciled && current !== view.content && (changed || !current || !nodesEqualIgnoringIconLoadState(current, view.content))) {
      const scroll = current?.scrollTop || 0;
      body.replaceChildren(view.content);
      if (!changed) view.content.scrollTop = scroll;
    }
    if (settings.animate) animateElement(body, [{ opacity: .35 }, { opacity: 1 }], { duration: "state", easing: "enter", willChange: "auto" });
    return card;
  }

  function syncMetadata(nodes) {
    nodes.forEach((node, index) => {
      const current = metadata.children[index];
      if (current === node || current && nodesEqualIgnoringIconLoadState(current, node)) return;
      if (current) {
        const focused = current.contains(document.activeElement);
        current.replaceWith(node);
        if (focused) node.focus({ preventScroll: true });
      }
      else metadata.append(node);
    });
    while (metadata.children.length > nodes.length) metadata.lastElementChild.remove();
  }

  function renderWeather() {
    if (weatherView) return weatherView.render();
    if (!weatherLoading && !weatherLoadError) {
      weatherLoading = import("./weather-card-view.mjs").then(({ createWeatherCardView }) => {
        weatherView = createWeatherCardView({
          ...options, weatherState, isActive: () => getType() === "weather",
          requestRender: (settings) => render(eventItems, settings),
        });
      }).catch((error) => { weatherLoadError = localizedErrorMessage(error); }).finally(() => {
        weatherLoading = null;
        if (getType() === "weather") render();
      });
    }
    return { content: options.createEmptyState({
      title: t(weatherLoadError ? "weather.error.title" : "weather.loading.title"),
      body: weatherLoadError || t("weather.loading.body"), variant: "compact",
      actionLabel: weatherLoadError ? t("weather.retry") : "",
      onAction: () => { weatherLoadError = ""; render(); },
    }) };
  }

  function openTodoComposer() {
    modePicker.close();
    selectType("todo");
    if (card.dataset.cardType !== "todo") render();
    card.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    if (!todoView.openComposer()) getFocusFallback().focus({ preventScroll: true });
  }

  function renderStocks() {
    if (stockView) return stockView.render();
    if (!stockLoading && !stockLoadError) {
      stockLoading = Promise.all([import("./stock-card-view.mjs"), options.getStockState()]).then(([module, stockState]) => {
        stockView = module.createStockCardView({ ...options, stockState,
          isActive: () => getType() === "stocks", requestRender: () => render() });
      }).catch(error => { stockLoadError = localizedErrorMessage(error); }).finally(() => {
        stockLoading = null;
        if (getType() === "stocks") render();
      });
    }
    return { busy: !stockLoadError, content: options.createEmptyState({ title: t(stockLoadError ? "stocks.error" : "stocks.loading"),
      body: stockLoadError, variant: "compact", actionLabel: stockLoadError ? t("stocks.retry") : "",
      onAction: () => { stockLoadError = ""; render(); } }) };
  }

  function contextActions(target) {
    if (modePicker.call("isOpen")) return [];
    return [...(getType() === "countdown" ? countdownView?.contextActions(target) || [] : []),
      { label: t("context.switchCard"), icon: "grid-view", action: () => modePicker.open() }];
  }

  function renderCountdown() {
    if (countdownView) return countdownView.render();
    if (!countdownLoading && !countdownLoadError) {
      countdownLoading = Promise.all([import("./countdown-card-view.mjs"), options.getCountdownState()]).then(([module, countdownState]) => {
        countdownView = module.createCountdownCardView({ ...options, countdownState, requestRender: () => render() });
      }).catch(error => { countdownLoadError = localizedErrorMessage(error); }).finally(() => {
        countdownLoading = null;
        if (getType() === "countdown") render();
      });
    }
    return { busy: !countdownLoadError, content: options.createEmptyState({
      title: t(countdownLoadError ? "countdown.loadError" : "countdown.loading"), body: countdownLoadError, variant: "compact",
      actionLabel: countdownLoadError ? t("countdown.retry") : "", onAction: () => { countdownLoadError = ""; render(); },
    }) };
  }

  return { card, render, openTodoComposer, contextActions };
}
