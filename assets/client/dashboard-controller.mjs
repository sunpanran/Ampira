export function createDashboardController(options) {
  const {
    state, els, t, apiGet, apiPost, preloadDailyInspiration,
    inspirationPreloadTimeoutMs, renderConnectionError, renderStatus,
    renderOverviewStatus, localizedErrorMessage, renderExclusionList,
    renderExcludeFolderOptions, renderTodayMetaValue, renderEfficiencyPanel,
    renderDaily, renderSummaries, renderSectionFilters, renderCategoryFilters,
    renderCategories, formatFullDateTime, getTodayKey, readNumber, writeJson,
    retainSeenArchiveEnabled, readSeenRecords, replaceSeenRecords,
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
  if (!state.data) return;
  els.refresh.disabled = true;
  try {
    const result = await apiPost(`/api/refresh${force ? "?force=1" : ""}`);
    if (state.data && result.status) {
      state.data.status = result.status;
      renderStatus();
    }
    if (result.started || result.status?.running) startPolling();
    else await loadDashboard();
  } catch (error) {
    renderOverviewStatus(t("status.refreshRequestFailed"), localizedErrorMessage(error));
  } finally {
    els.refresh.disabled = Boolean(state.data?.status?.running);
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
  if (state.settings) renderExclusionList();
  else renderExcludeFolderOptions();
  renderStatus();
  renderTodayMeta();
  renderEfficiencyPanel();
  renderDaily();
  renderSummaries();
  renderSectionFilters();
  renderCategoryFilters();
  renderCategories();
}

function startTodayClock() {
  renderTodayMeta();
  if (todayClockTimer) clearInterval(todayClockTimer);
  todayClockTimer = setInterval(() => {
    renderTodayMeta();
    handleDayRollover();
  }, 1000);
}

function renderTodayMeta() {
  renderTodayMetaValue(formatFullDateTime());
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
