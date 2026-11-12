import { briefTaskPhase } from "./ai-task-state.mjs";

export function createDashboardController(options) {
  const {
    state, els, t, apiGet, apiPost, preloadDailyInspiration,
    inspirationPreloadTimeoutMs, renderConnectionError, renderStatus,
    renderOverviewStatus, localizedErrorMessage, renderExclusionList,
    renderExcludeFolderOptions, renderTodayMetaValue, renderWebsiteShortcuts, renderEfficiencyPanel,
    renderDaily, renderSummaries, renderSectionFilters, renderCategoryFilters,
    renderCategories, formatTodayMeta, getTodayKey, readNumber, writeJson,
    retainSeenArchiveEnabled, readSeenRecords, replaceSeenRecords,
    canRefresh = () => true, syncSearchCopy = () => {}, syncAiSearchCapability = () => {}, refreshFeedbackMinMs = 2000,
  } = options;
  let dashboardLoadToken = 0;
  let refreshPollToken = 0;
  let todayClockTimer = 0;
  let dashboardLoadPromise = null;
  let pendingLoad = null;
  let aiProgressVersion = 0;
  let latestAiProgress = null;
  let needsFullRender = false;

  return { loadDashboard, applyAiProgress, triggerRefresh, startPolling, renderAll, startTodayClock, renderTodayMeta, handleDayRollover };

function loadDashboard(options = {}) {
  dashboardLoadToken += 1;
  const request = { scope: options.scope === "news" && state.data && !needsFullRender ? "news" : "all", render: options.render !== false };
  pendingLoad = mergeLoads(pendingLoad, request);
  if (!dashboardLoadPromise) dashboardLoadPromise = Promise.resolve().then(drainDashboardLoads);
  return dashboardLoadPromise;
}

async function drainDashboardLoads() {
  let loaded = false;
  try {
    while (pendingLoad) {
      const request = pendingLoad;
      pendingLoad = null;
      const token = dashboardLoadToken;
      const progressVersion = aiProgressVersion;
      try {
        const data = await apiGet(request.scope === "news" ? "/api/dashboard?scope=news" : "/api/dashboard");
        if (token !== dashboardLoadToken) {
          pendingLoad = mergeLoads(request, pendingLoad);
          continue;
        }
        state.data = request.scope === "news" ? { ...state.data, ...data } : data;
        if (request.scope === "all") needsFullRender = false;
        if (progressVersion !== aiProgressVersion) patchAiProgress();
        if (request.render) {
          if (request.scope === "news") renderNews();
          else {
            renderAll();
            preloadDailyInspiration(inspirationPreloadTimeoutMs);
          }
        }
        loaded = true;
      } catch (error) {
        if (token !== dashboardLoadToken) {
          pendingLoad = mergeLoads(request, pendingLoad);
          continue;
        }
        if (request.scope === "news") {
          renderOverviewStatus(t("connection.unavailable"), localizedErrorMessage(error));
        } else {
          needsFullRender = true;
          els.dailyBoard?.removeAttribute?.("aria-busy");
          els.summaryGrid?.removeAttribute?.("aria-busy");
          renderConnectionError(error);
        }
      }
    }
    return loaded;
  } finally {
    dashboardLoadPromise = null;
  }
}

function mergeLoads(left, right) {
  if (!left) return right;
  if (!right) return left;
  return { scope: left.scope === "all" || right.scope === "all" ? "all" : "news", render: left.render || right.render };
}

function applyAiProgress(payload) {
  if (!payload?.autoStatus) return;
  const previousBriefPhase = briefTaskPhase(state);
  latestAiProgress = payload;
  aiProgressVersion += 1;
  patchAiProgress();
  if (state.data) renderStatus();
  if (state.data && previousBriefPhase !== briefTaskPhase(state)) renderEfficiencyPanel();
  if (payload.contentChanged) void loadDashboard({ scope: "news" });
}

function patchAiProgress() {
  if (!state.data?.ai || !latestAiProgress) return;
  state.data.ai = { ...state.data.ai, autoStatus: latestAiProgress.autoStatus };
  if (state.data.organization) state.data.organization = { ...state.data.organization, ...latestAiProgress.autoStatus };
  if (Number.isFinite(latestAiProgress.usedToday)) state.data.ai.usedToday = latestAiProgress.usedToday;
}

function renderNews() {
  syncAiSearchCapability();
  renderStatus();
  renderEfficiencyPanel();
  renderDaily();
  renderSummaries();
}

async function triggerRefresh(force) {
  if (!state.data || force !== true && !canRefresh()) return;
  const feedbackStartedAt = Date.now();
  els.refresh.disabled = true;
  els.settingsRefresh.disabled = true;
  setRefreshRequestFeedback(true);
  try {
    const result = await apiPost(`/api/refresh${force ? "?force=1" : ""}`, { automatic: force !== true });
    if (state.data && result.status) {
      state.data.status = result.status;
      renderStatus();
      renderDaily();
      setRefreshRequestFeedback(true);
    }
    if (result.started || result.status?.running) startPolling();
    else await loadDashboard();
  } catch (error) {
    renderOverviewStatus(t("status.refreshRequestFailed"), localizedErrorMessage(error));
  } finally {
    const remainingFeedbackMs = refreshFeedbackMinMs - (Date.now() - feedbackStartedAt);
    if (remainingFeedbackMs > 0) {
      setRefreshRequestFeedback(true);
      await new Promise((resolve) => setTimeout(resolve, remainingFeedbackMs));
    }
    setRefreshRequestFeedback(false);
    if (state.data) renderStatus();
    else {
      els.refresh.disabled = true;
      els.settingsRefresh.disabled = true;
    }
  }
}

function setRefreshRequestFeedback(active) {
  for (const button of [els.refresh, els.settingsRefresh]) {
    if (active || !button.querySelector?.(".btn-icon")) button.classList?.toggle("is-loading", active);
    if (active) button.setAttribute?.("aria-busy", "true");
    else button.removeAttribute?.("aria-busy");
  }
}

function startPolling() {
  if (state.pollTimer) clearTimeout(state.pollTimer);
  const token = ++refreshPollToken;
  const poll = async () => {
    state.pollTimer = null;
    try {
      const status = await apiGet("/api/refresh");
      if (token !== refreshPollToken) return;
      if (state.data) {
        state.data.status = status;
        renderStatus();
        renderDaily();
      }
      if (status.running) {
        state.pollTimer = setTimeout(poll, 2500);
        return;
      }
      await loadDashboard();
    } catch (error) {
      if (token !== refreshPollToken) return;
      renderOverviewStatus(t("status.refreshStatusFailed"), localizedErrorMessage(error));
    }
  };
  state.pollTimer = setTimeout(poll, 2500);
}

function renderAll() {
  els.dailyBoard.removeAttribute("aria-busy");
  els.summaryGrid.removeAttribute("aria-busy");
  syncSearchCopy();
  syncAiSearchCapability();
  if (state.settings) renderExclusionList();
  else renderExcludeFolderOptions();
  renderStatus();
  renderTodayMeta();
  renderWebsiteShortcuts();
  renderEfficiencyPanel();
  renderDaily();
  renderSummaries();
  renderSectionFilters();
  renderCategoryFilters();
  renderCategories();
}

function startTodayClock() {
  renderTodayMeta();
  handleDayRollover();
  scheduleTodayClock();
}

function scheduleTodayClock() {
  if (todayClockTimer) clearTimeout(todayClockTimer);
  const delay = 60000 - (Date.now() % 60000) + 50;
  todayClockTimer = setTimeout(() => {
    renderTodayMeta();
    handleDayRollover();
    scheduleTodayClock();
  }, delay);
}

function renderTodayMeta() {
  renderTodayMetaValue(formatTodayMeta());
}

function handleDayRollover() {
  const nextDay = getTodayKey();
  if (nextDay === state.day) return;
  const previousDay = state.day;
  state.day = nextDay;
  state.variants.news = readNumber(`dash.variant.${nextDay}.news`, 0);
  state.variants.inspiration = readNumber(`dash.variant.${nextDay}.inspiration`, readNumber(`dash.variant.${nextDay}`, 0));
  state.variants.summary = readNumber(`dash.variant.${nextDay}.summary`, 0);
  if (!retainSeenArchiveEnabled()) {
    writeJson(`dash.seen.${previousDay}`, []);
    replaceSeenRecords(readSeenRecords(`dash.seen.${nextDay}`));
  }
  loadDashboard();
}

}
