export function createNewsOrganizationController({ state, els, apiPost, loadDashboard, renderStatus, renderOverviewStatus, localizedErrorMessage, t }) {
  els.organizeNews.addEventListener("click", async () => {
    if (state.newsOrganizeRequest || state.data?.organization?.running) return;
    state.newsOrganizeRequest = true; renderStatus();
    try { await apiPost("/api/news/organize", {}); await loadDashboard({ scope: "news" }); }
    catch (error) { renderOverviewStatus(t("summary.manualFailed"), localizedErrorMessage(error)); }
    finally { state.newsOrganizeRequest = false; renderStatus(); }
  });
}
