export function createDashboardController(options) {
  const {
    state, els, t, apiGet, apiPost, preloadDailyInspiration,
    inspirationPreloadTimeoutMs, renderConnectionError, renderStatus,
    renderOverviewStatus, localizedErrorMessage, renderExclusionList,
    renderExcludeFolderOptions, renderTodayMetaValue, renderWebsiteShortcuts, renderEfficiencyPanel,
    renderDaily, renderSummaries, renderSectionFilters, renderCategoryFilters,
    renderCategories, formatTodayMeta, getTodayKey, readNumber, writeJson,
    retainSeenArchiveEnabled, readSeenRecords, replaceSeenRecords,
    canRefresh = () => true, syncSearchCopy = () => {}, refreshFeedbackMinMs = 2000,
  } = options;
  let dashboardLoadToken = 0;
  let refreshPollToken = 0;
  let todayClockTimer = 0;

  return { loadDashboard, triggerRefresh, startPolling, renderAll, startTodayClock, renderTodayMeta, handleDayRollover };

async function loadDashboard(options = {}) {
  const token = ++dashboardLoadToken;
  try {
    const data = await apiGet("/api/dashboard");
    if (token !== dashboardLoadToken) return false;
    state.data = data;
    if (options.render !== false) {
      renderAll();
      preloadDailyInspiration(inspirationPreloadTimeoutMs);
    }
    return true;
  } catch (error) {
    if (token !== dashboardLoadToken) return false;
    renderConnectionError(error);
    return false;
  }
}

async function triggerRefresh(force) {
  if (!state.data || force !== true && !canRefresh()) return;
  const feedbackStartedAt = Date.now();
  els.refresh.disabled = true;
  els.settingsRefresh.disabled = true;
  setRefreshRequestFeedback(true);
  try {
    const result = await apiPost(`/api/refresh${force ? "?force=1" : ""}`);
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
