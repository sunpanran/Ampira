import { normalizeUserUrl, normalizeSearchQuery, PRIORITY_BOOKMARK_LIMIT } from "../../extension/core/search.mjs";
import { requestPermissions } from "./permission-client.mjs";
import { createSearchResultsView } from "./search-results-view.mjs";
import { animateElement, MOTION_DURATION, MOTION_EASING } from "./motion.mjs";
import { usesBotChat } from "../../extension/core/bot-mode.mjs";

const SEARCH_RESIZE_DURATION = 300;

export function searchRecommendationRows(query, results, { historyStatus, browserEnabled, hasConversation, aiEnabled } = {}) {
  const text = normalizeSearchQuery(query);
  const url = normalizeUserUrl(text);
  const rows = [];
  const priority = [];
  const groups = { bookmark: [], ampira: [], history: [] };
  if (text) {
    for (const result of results) {
      const source = ["bookmark", "ampira", "history"].find(value => result.sources.includes(value));
      if (!source) continue;
      const row = { ...result, kind: "result", icon: { bookmark: "bookmark", ampira: "news", history: "clock" }[source] };
      if (source === "bookmark" && ["exact", "prefix"].includes(result.bookmarkMatch) && priority.length < PRIORITY_BOOKMARK_LIMIT) priority.push(row);
      else groups[source].push(row);
    }
  }
  if (url) rows.push({ id: "direct", kind: "direct", url, titleKey: "search.unified.openUrl", detail: url, icon: "arrow-up-right" });
  rows.push(...priority);
  if (text) {
    rows.push({ id: "web", kind: "web", titleKey: browserEnabled ? "search.unified.web" : "search.unified.enableWeb", detail: text, icon: "search" });
  }
  if (aiEnabled) rows.push({ id: "ai", kind: "ai", titleKey: "search.unified.ask", detail: text, icon: "spark" });
  if (hasConversation) rows.push({ id: "resume", kind: "resume", titleKey: "search.unified.resume", icon: "message-question-circle" });
  rows.push(...groups.bookmark, ...groups.ampira, ...groups.history);
  if (text && historyStatus === "permission") rows.push({ id: "history", kind: "history", titleKey: "search.unified.enableHistory", icon: "clock" });
  return rows;
}

export function defaultSearchRecommendation(rows) {
  return rows.find(row => ["direct", "result", "web"].includes(row.kind))?.id || "";
}

export function createUnifiedSearchController({ state, els, t, request, aiSearch, openResult, openExternalWindow,
  setActiveNavButton, syncNavToCurrentSection, localizedErrorMessage,
  requestPermission = requestPermissions, doc = globalThis.document, view = globalThis.window }) {
  let mode = "search";
  let generation = 0;
  let intent = 0;
  let timer = 0;
  let loadingTimer = 0;
  let loadingVisible = false;
  let resultQuery = "";
  let sizeAnimation = null;
  let layoutKey = "";
  let closeTimer = 0;
  let results = [];
  let rows = [];
  let activeId = "";
  let manuallySelected = false;
  let loading = false;
  let busy = false;
  let hasConversation = false;
  let previousFocus = null;
  let sources = {};
  let browserEnabled = state.settings?.browserSearchEnabled === true;
  let notice = "";
  let composing = false;
  const input = els.unifiedSearchInput;
  const list = els.unifiedSearchResults;
  const surface = els.unifiedSearch;
  const footer = els.unifiedSearchStatus.parentElement;
  const canAsk = () => state.data?.ai?.enabled === true || usesBotChat(state.data);
  const isOpen = () => els.aiSearchOverlay.classList.contains("open") && !els.aiSearchOverlay.classList.contains("closing");
  const currentQuery = () => normalizeSearchQuery(input.value);
  const resultsView = createSearchResultsView({ list, t, doc, onSelect: row => {
    activeId = row.id;
    manuallySelected = true;
    syncSelection();
    void execute(row);
  } });

  function rememberFocus() {
    if (!els.aiSearchOverlay.classList.contains("open")) previousFocus = doc.activeElement;
  }

  function restoreFocus() {
    const target = previousFocus?.isConnected ? previousFocus : els.aiSearchNav;
    target?.focus({ preventScroll: true });
    previousFocus = null;
  }

  function setMode(next) {
    mode = next;
    els.aiSearchOverlay.classList.add("has-continuous-motion");
    surface.hidden = next !== "search";
    els.aiSearchPanel.classList.toggle("is-searching", next === "search");
    els.aiSearchPanel.classList.toggle("is-conversing", next === "conversation");
    els.aiSearchOverlay.setAttribute("aria-labelledby", next === "search" ? "unifiedSearchTitle" : "aiSearchTitleText");
    // Establish the hidden state once; interrupted transitions keep their current frame.
    if (!els.aiSearchOverlay.classList.contains("open")) view.getComputedStyle(els.aiSearchOverlay).backgroundColor;
  }

  function open(text) {
    intent += 1;
    rememberFocus();
    view.clearTimeout(closeTimer);
    aiSearch.close();
    aiSearch.call("suspend");
    setMode("search");
    els.aiSearchOverlay.classList.remove("closing");
    els.aiSearchOverlay.classList.add("open");
    if (sizeAnimation?.playState === "paused") sizeAnimation.play();
    setActiveNavButton(els.aiSearchNav);
    if (typeof text === "string") input.value = text;
    input.focus({ preventScroll: true });
    input.setSelectionRange(input.value.length, input.value.length);
    refresh(0);
  }

  async function openConversation(query = "", shouldRun = false) {
    intent += 1;
    rememberFocus();
    generation += 1;
    view.clearTimeout(timer);
    view.clearTimeout(loadingTimer);
    view.clearTimeout(closeTimer);
    sizeAnimation?.cancel();
    sizeAnimation = null;
    setMode("conversation");
    hasConversation = true;
    const token = generation;
    const opened = await aiSearch.open(query, shouldRun);
    if (!opened && token === generation) open();
  }

  function close({ restore = true } = {}) {
    intent += 1;
    generation += 1;
    view.clearTimeout(timer);
    view.clearTimeout(loadingTimer);
    if (mode === "conversation") {
      clearResults();
      if (!restore) previousFocus = null;
      aiSearch.close();
      return;
    }
    if (!isOpen()) return;
    // Cancel pending conversation work without handing this overlay to its close timer.
    aiSearch.close();
    aiSearch.call("suspend");
    sizeAnimation?.pause();
    els.aiSearchOverlay.classList.add("closing");
    closeTimer = view.setTimeout(() => {
      closeTimer = 0;
      els.aiSearchOverlay.classList.remove("open", "closing");
      clearResults();
      syncNavToCurrentSection();
      if (restore) restoreFocus();
      else previousFocus = null;
    }, doc.hidden || view.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : MOTION_DURATION.state);
  }

  function clearResults() {
    results = [];
    resultQuery = "";
    rows = [];
    activeId = "";
    sizeAnimation?.cancel();
    sizeAnimation = null;
    layoutKey = "";
    resultsView.clear();
    list.hidden = true;
    input.setAttribute("aria-expanded", "false");
  }

  function refresh(delay = 150, { reset = false } = {}) {
    generation += 1;
    const token = generation;
    view.clearTimeout(timer);
    view.clearTimeout(loadingTimer);
    const query = currentQuery();
    if (reset || !query) { results = []; activeId = ""; }
    if (!query) resultQuery = "";
    if (query !== resultQuery) {
      manuallySelected = false;
      if (!results.some(result => result.id === activeId)) activeId = "";
    }
    loading = true;
    loadingVisible = false;
    notice = "";
    render();
    loadingTimer = view.setTimeout(() => {
      if (token === generation && loading) { loadingVisible = true; render(); }
    }, 300);
    timer = view.setTimeout(() => void retrieve(token, query), delay);
  }

  async function retrieve(token, query) {
    try {
      const response = await request({ type: "search:query", payload: { query } });
      if (token !== generation || mode !== "search" || !isOpen() || query !== currentQuery()) return;
      if (response.stale) { refresh(); return; }
      if (resultQuery !== query) list.scrollTop = 0;
      resultQuery = query;
      results = (response.results || []).filter(result => normalizeUserUrl(result.url));
      sources = response.sources || {};
      browserEnabled = response.browserSearchEnabled === true;
      if (Object.values(sources).includes("error")) notice = t("search.unified.partialError");
    } catch (error) {
      if (token !== generation) return;
      results = [];
      resultQuery = query;
      notice = t(error?.code === "UNKNOWN_REQUEST" ? "search.unified.reloadExtension" : "search.unified.failed");
    } finally {
      if (token === generation) {
        view.clearTimeout(loadingTimer);
        loading = false;
        loadingVisible = false;
        render();
      }
    }
  }

  function render() {
    if (mode !== "search") return;
    const query = currentQuery();
    // Keep the compact layout until the first response, rather than expanding twice.
    const rowQuery = loading && !resultQuery ? "" : query;
    rows = searchRecommendationRows(rowQuery, results, {
      historyStatus: sources.history, browserEnabled, hasConversation,
      aiEnabled: canAsk(),
    });
    if (!loading && (!manuallySelected || !rows.some(row => row.id === activeId))) activeId = defaultSearchRecommendation(rows);
    else if (!rows.some(row => row.id === activeId)) activeId = "";
    const showFooter = Boolean(rowQuery || (query && loadingVisible));
    const nextLayoutKey = `${showFooter}\n${rows.map(row => `${row.id}:${Boolean(row.detail)}`).join("\n")}`;
    const layoutChanged = layoutKey !== nextLayoutKey;
    const previousHeight = layoutChanged && layoutKey ? Number.parseFloat(view.getComputedStyle(surface).height) : 0;
    if (layoutChanged) { sizeAnimation?.cancel(); sizeAnimation = null; }
    const entering = resultsView.render(rows, { activeId, stale: loading || composing || resultQuery !== query });
    if (!loading && isOpen()) {
      for (const node of entering) animateElement(node, [{ opacity: 0 }, { opacity: 1 }], {
        duration: "state", easing: "enter", willChange: "auto",
      });
    }
    list.hidden = rows.length === 0;
    footer.hidden = !showFooter;
    if (layoutChanged) {
      const height = Number.parseFloat(view.getComputedStyle(surface).height);
      if (previousHeight && Math.abs(previousHeight - height) > 1 && isOpen()
        && !doc.hidden && !view.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        const animation = surface.animate([{ height: `${previousHeight}px` }, { height: `${height}px` }], {
          duration: SEARCH_RESIZE_DURATION, easing: MOTION_EASING.move,
        });
        sizeAnimation = animation;
        animation.addEventListener("finish", () => {
          if (sizeAnimation === animation) sizeAnimation = null;
          animation.cancel();
        }, { once: true });
      }
      layoutKey = nextLayoutKey;
    }
    input.setAttribute("aria-expanded", String(rows.length > 0));
    list.setAttribute("aria-busy", String(loading));
    syncSelection();
    renderStatus();
  }

  function renderStatus() {
    const text = notice || (loadingVisible ? t("search.unified.loading")
      : !loading && currentQuery() && !results.length ? t("search.unified.empty")
      : results.length ? t("search.unified.count", { count: results.length }) : "");
    if (els.unifiedSearchStatus.textContent !== text) els.unifiedSearchStatus.textContent = text;
    els.unifiedSearchStatus.title = text;
    surface.classList.toggle("has-notice", Boolean(notice));
  }

  function syncSelection(scroll = false) {
    let active = null;
    for (const element of list.children) {
      const selected = element.dataset.searchId === activeId;
      element.classList.toggle("is-active", selected);
      element.setAttribute("aria-selected", String(selected));
      if (selected) active = element;
    }
    if (active) input.setAttribute("aria-activedescendant", active.id);
    else input.removeAttribute("aria-activedescendant");
    if (scroll) active?.scrollIntoView({ block: "nearest" });
    const stale = rows.find(row => row.id === activeId)?.kind === "result" && (loading || composing || resultQuery !== currentQuery());
    els.unifiedSearchSubmit.disabled = busy || !active || stale;
  }

  async function execute(row = rows.find(entry => entry.id === activeId)) {
    if (!row || !rows.includes(row) || busy || composing || mode !== "search" || !isOpen()) return;
    const query = currentQuery();
    if (row.kind === "result" && (loading || resultQuery !== query)) return;
    const token = generation;
    busy = true;
    const actionIntent = intent;
    syncSelection();
    try {
      if (row.kind === "history") {
        const granted = await requestPermission(["history"]);
        if (actionIntent !== intent || !isOpen()) return;
        if (granted) refresh(0);
        else { notice = t("search.unified.permissionDeclined"); render(); }
      } else if (row.kind === "web") {
        if (!query) return;
        if (!browserEnabled) {
          const granted = await requestPermission(["search"]);
          if (actionIntent !== intent || !isOpen()) return;
          if (!granted) { notice = t("search.unified.permissionDeclined"); render(); return; }
          browserEnabled = true;
        }
        await request({ type: "browser:search", payload: { query } });
      } else if (row.kind === "ai") {
        if (canAsk()) await openConversation(query, true);
      } else if (row.kind === "resume") {
        await openConversation();
      } else {
        const url = normalizeUserUrl(row.url);
        if (!url) return;
        close({ restore: row.contentKind !== "article" || state.settings?.floatingWebOpenEnabled !== true });
        if (row.kind === "result" && row.contentKind === "article") openResult({ ...row, url });
        else openExternalWindow(url);
      }
    } catch (error) {
      if (token === generation) { notice = localizedErrorMessage(error); render(); }
    } finally { busy = false; syncSelection(); }
  }

  function keydown(event) {
    if (event.isComposing || composing || event.keyCode === 229) return;
    if (["ArrowDown", "ArrowUp"].includes(event.key) && rows.length) {
      event.preventDefault();
      const index = rows.findIndex(row => row.id === activeId);
      const next = index < 0 ? (event.key === "ArrowDown" ? 0 : rows.length - 1)
        : (index + (event.key === "ArrowDown" ? 1 : rows.length - 1)) % rows.length;
      activeId = rows[next].id;
      manuallySelected = true;
      syncSelection(true);
    } else if (event.key === "Enter") {
      event.preventDefault();
      void execute();
    }
  }

  function invalidate({ reset = true } = {}) {
    generation += 1;
    view.clearTimeout(timer);
    view.clearTimeout(loadingTimer);
    if (isOpen() && mode === "search") refresh(0, { reset });
    else if (reset) clearResults();
  }

  function trapFocus(event) {
    if (mode !== "search") { aiSearch.call("trapFocus", event); return; }
    if (event.key !== "Tab") return;
    const focusable = [...surface.querySelectorAll("input, button:not([disabled])")];
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && doc.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && doc.activeElement === last) { event.preventDefault(); first?.focus(); }
  }

  els.unifiedSearchForm.addEventListener("submit", event => { event.preventDefault(); void execute(); });
  input.addEventListener("input", () => { intent += 1; if (!composing) refresh(); });
  input.addEventListener("compositionstart", () => {
    composing = true;
    generation += 1;
    view.clearTimeout(timer);
    view.clearTimeout(loadingTimer);
    loading = true;
    loadingVisible = false;
    render();
  });
  input.addEventListener("compositionend", () => { composing = false; refresh(); });
  input.addEventListener("keydown", keydown);
  list.addEventListener("pointermove", event => {
    if (event.pointerType === "touch") return;
    const node = event.target.closest?.("[data-search-id]");
    if (!node || node.getAttribute("aria-disabled") === "true" || node.dataset.searchId === activeId) return;
    activeId = node.dataset.searchId;
    manuallySelected = true;
    syncSelection();
  });
  view.addEventListener("ampira:favicon-permission-changed", () => { if (isOpen()) render(); });
  els.backToSearch.addEventListener("click", () => open());
  view.addEventListener("ampira:runtime-message", event => {
    if (["search.invalidated", "settings.changed"].includes(event.detail?.type)) invalidate();
    else if (event.detail?.type === "dashboard.updated") invalidate({ reset: false });
  });
  const permissionChanged = details => {
    if (details?.permissions?.some(name => ["history", "search"].includes(name))) invalidate();
  };
  globalThis.chrome?.permissions?.onRemoved?.addListener(permissionChanged);
  globalThis.chrome?.permissions?.onAdded?.addListener(permissionChanged);
  doc.addEventListener("visibilitychange", () => { if (!doc.hidden && isOpen()) invalidate(); });
  doc.addEventListener("ampira:locale-changed", () => { if (isOpen()) invalidate(); });

  return { open, openConversation, close, trapFocus, restoreFocus, invalidate };
}
