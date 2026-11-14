import { MAX_WEBSITE_SHORTCUTS } from "../../extension/core/settings.mjs";
import { createLoadingPhaseController, prefersReducedMotion } from "./motion.mjs";

export function refreshAvailability(data) {
  if (!data) return { available: false, reason: "loading", messageKey: "status.refreshUnavailable.loading" };
  if (data.status?.running === true) return { available: false, reason: "running", messageKey: "status.caching" };
  if (data.onboarding?.bookmarkConsentGranted === false && data.pipeline?.publicFeedSupplementEnabled !== true) {
    return { available: false, reason: "consent", messageKey: "status.refreshUnavailable.consent" };
  }
  const configuredSources = finiteCount(data.cache?.configuredSources, data.sourceQuality?.configured);
  const refreshableSources = finiteCount(data.cache?.refreshableSources, data.sourceQuality?.authorized);
  if (configuredSources === 0) {
    return { available: false, reason: "no-sources", messageKey: "status.refreshUnavailable.noSources" };
  }
  if (configuredSources !== null && configuredSources > 0 && refreshableSources === 0) {
    return { available: false, reason: "permission", messageKey: "status.refreshUnavailable.permission" };
  }
  return { available: true, reason: "", messageKey: "" };
}

function finiteCount(primary, fallback) {
  for (const value of [primary, fallback]) {
    if (value === null || value === undefined || value === "") continue;
    const number = Number(value);
    if (Number.isFinite(number)) return Math.max(0, Math.floor(number));
  }
  return null;
}

export function createStatusView(options) {
  const {
    state, els, dashboardLayout, t, formatDateTime, localizedStatusMessage, localizedErrorMessage,
    setIconLabel, createEmptyState,
  } = options;

  return {
    renderInitialLoadingState,
    renderStatus,
    renderOverviewStatus,
    renderConnectionError,
  };

function renderInitialLoadingState() {
  renderWebsiteShortcutLoadingState();
  els.dailyBoard.setAttribute("aria-busy", "true");
  els.dailyBoard.dataset.loading = "true";
  els.summaryGrid.setAttribute("aria-busy", "true");
  els.efficiencyPanel.dataset.loading = "true";
  for (const id of ["utility", "digest", "archive", "queue"]) dashboardLayout.mount(id, createLoadingPlaceholder("efficiency-skeleton"));
  for (const columnId of ["news", "inspiration"]) {
    const column = createLoadingPlaceholder("board-column-skeleton");
    column.dataset.columnId = columnId;
    dashboardLayout.mount(columnId, column);
  }
  els.summaryGrid.replaceChildren(...Array.from({ length: 8 }, () => createLoadingPlaceholder("summary-skeleton")));
  return createLoadingPhaseController([
    els.websiteShortcuts,
    els.efficiencyPanel,
    els.dailyBoard,
    els.summaryGrid,
  ]);
}

function renderWebsiteShortcutLoadingState() {
  if (!document.documentElement.classList.contains("has-website-shortcuts")) return;
  const rawCount = Number(document.documentElement.dataset.websiteShortcutCount);
  const count = Math.min(MAX_WEBSITE_SHORTCUTS, Math.max(0, Number.isFinite(rawCount) ? Math.floor(rawCount) : 0));
  els.websiteShortcuts.hidden = false;
  els.websiteShortcuts.dataset.loading = "true";
  els.websiteShortcuts.setAttribute("aria-busy", "true");
  els.websiteShortcuts.classList.toggle("is-empty", count === 0);
  els.websiteShortcutList.replaceChildren(...(
    count > 0
      ? Array.from({ length: count }, createWebsiteShortcutPlaceholder)
      : [createWebsiteShortcutEmptyPlaceholder()]
  ));
}

function createWebsiteShortcutPlaceholder() {
  const placeholder = document.createElement("div");
  placeholder.className = "website-shortcut website-shortcut-skeleton";
  placeholder.setAttribute("aria-hidden", "true");
  const icon = document.createElement("span");
  icon.className = "website-shortcut-icon loading-line";
  const label = document.createElement("span");
  label.className = "website-shortcut-label loading-line";
  placeholder.append(icon, label);
  return placeholder;
}

function createWebsiteShortcutEmptyPlaceholder() {
  const placeholder = document.createElement("div");
  placeholder.className = "website-shortcuts-empty website-shortcuts-empty-skeleton";
  placeholder.setAttribute("aria-hidden", "true");
  const copy = document.createElement("span");
  copy.className = "loading-line website-shortcuts-empty-copy";
  const action = document.createElement("span");
  action.className = "loading-line website-shortcuts-empty-action";
  placeholder.append(copy, action);
  return placeholder;
}

function createLoadingPlaceholder(extraClass = "") {
  const placeholder = document.createElement("div");
  placeholder.className = `card-skeleton ${extraClass}`.trim();
  placeholder.setAttribute("aria-hidden", "true");
  placeholder.append(...["short", "wide", "medium"].map((width) => {
    const line = document.createElement("span");
    line.className = `loading-line loading-line-${width}`;
    return line;
  }));
  return placeholder;
}

function renderStatus() {
  const status = state.data?.status || {};
  const ai = state.data?.ai || {};
  const refreshState = refreshAvailability(state.data);
  renderOverviewStatus();
  renderQuotaOverview(ai);
  renderCacheOverview(status, refreshState);
  const organization = state.data?.organization;
  renderAutoAiStatus(organization?.provider === "bot" ? { ...ai, enabled: organization.available, autoStatus: organization } : ai);
  renderRefreshButtons(refreshState);
  if (els.organizeNews) {
    const running = state.newsOrganizeRequest || organization?.running;
    els.organizeNews.disabled = Boolean(running || !(organization?.available ?? ai.enabled));
    els.organizeNews.classList.toggle("is-loading", Boolean(running));
    els.organizeNews.setAttribute("aria-busy", String(Boolean(running)));
    const icon = running ? "refresh-cw-01" : "stars-01";
    const label = t(running ? "action.organizing" : "action.organizeNews");
    const currentLabel = els.organizeNews.querySelector(".btn-label");
    // Keep the live icon so progress updates do not restart its loading or animation.
    if (!currentLabel || !els.organizeNews.querySelector(`.icon-${icon}`)) setIconLabel(els.organizeNews, icon, label);
    else if (currentLabel.textContent !== label) currentLabel.textContent = label;
    els.organizeNews.title = t(organization?.provider === "bot" && !organization.available ? "bot.connectFirst" : "action.organizeNews");
  }
}

function renderQuotaOverview(ai = {}) {
  const usedValue = Number(ai.usedToday);
  const limitValue = Number(ai.dailyLimit);
  const used = Number.isFinite(usedValue) ? Math.max(0, Math.floor(usedValue)) : 0;
  const limit = Number.isFinite(limitValue) ? Math.max(1, Math.floor(limitValue)) : 160;
  els.settingsQuotaStatus.textContent = `${used} / ${limit}`;
  const meterValue = Math.min(used, limit);
  els.settingsQuotaMeter.setAttribute("aria-valuemax", String(limit));
  els.settingsQuotaMeter.setAttribute("aria-valuenow", String(meterValue));
  els.settingsQuotaMeter.setAttribute("aria-valuetext", els.settingsQuotaStatus.textContent);
  els.settingsQuotaMeter.dataset.exhausted = String(used >= limit);
  els.settingsQuotaMeter.style.setProperty("--settings-quota-progress", `${meterValue / limit * 100}%`);
}

function setCacheOverviewLoading(isLoading) {
  const cacheItem = els.settingsCacheOverviewStatus.closest(".settings-overview-cache");
  cacheItem?.classList.toggle("is-loading", isLoading);
  els.settingsCacheLoadingIcon.hidden = !isLoading;
}

function renderCacheOverview(status = {}, refreshState = refreshAvailability(state.data)) {
  const isRunning = status.running === true;
  setCacheOverviewLoading(isRunning);
  els.settingsCacheOverviewStatus.closest(".settings-overview-cache")?.setAttribute("data-state",
    isRunning ? "running" : refreshState.available ? "ready" : "unavailable");
  els.settingsCacheOverviewStatus.removeAttribute("data-i18n");
  els.settingsCacheOverviewStatus.textContent = t(isRunning
    ? "settings.overview.cacheRunning"
    : refreshState.available ? "settings.overview.cacheReady" : "settings.overview.cacheUnavailable");
  els.settingsCacheOverviewDetail.removeAttribute("data-i18n");
  els.settingsCacheOverviewDetail.hidden = false;
  if (isRunning) {
    const progressValue = Number(status.progress);
    const progress = Number.isFinite(progressValue) ? Math.min(1, Math.max(0, progressValue)) : 0;
    els.settingsCacheOverviewDetail.textContent = t("settings.overview.cacheProgress", { percent: Math.round(progress * 100) });
    return;
  }
  if (!refreshState.available) {
    els.settingsCacheOverviewDetail.textContent = t(refreshState.messageKey);
    return;
  }
  const finishedAt = String(status.finishedAt || "");
  els.settingsCacheOverviewDetail.textContent = Number.isFinite(Date.parse(finishedAt))
    ? t("settings.overview.cacheUpdated", { time: formatDateTime(finishedAt) })
    : "";
  els.settingsCacheOverviewDetail.hidden = !els.settingsCacheOverviewDetail.textContent;
}

function renderAutoAiStatus(ai) {
  const auto = ai.autoStatus || {};
  const readinessPhase = !ai.configured
    ? "missing-key"
    : !ai.disclosureAccepted
      ? "missing-consent"
      : !ai.permissionGranted ? "missing-permission" : "not-ready";
  const phase = ai.enabled ? (auto.phase || "never") : readinessPhase;
  els.settingsAutoAiStatus.removeAttribute("data-i18n");
  els.settingsAutoAiDetail.removeAttribute("data-i18n");
  els.settingsAutoAiDetail.hidden = false;
  const labelKeys = {
    "running-digest": "settings.auto.runningDigest",
    "running-cards": "settings.auto.runningCards",
    completed: "settings.auto.completed",
    partial: "settings.auto.partial",
    "no-candidates": "settings.auto.noCandidates",
    quota: "settings.auto.quota",
    "not-ready": "settings.auto.notReady",
    "missing-key": "settings.auto.missingKey",
    "missing-consent": "settings.auto.missingConsent",
    "missing-permission": "settings.auto.missingPermission",
    error: "settings.auto.error",
    never: "settings.auto.never",
  };
  els.settingsAutoAiStatus.textContent = t(labelKeys[phase] || "settings.auto.never");
  els.settingsAutoAiStatus.closest(".settings-overview-auto")?.setAttribute("data-phase", phase);
  const processed = Math.max(0, Number(auto.processed || 0));
  const total = Math.max(0, Number(auto.total || 0));
  const attempted = Math.max(0, Number(auto.attempted ?? processed));
  const failed = Math.max(0, Number(auto.failed || 0));
  const deferred = Math.max(0, Number(auto.deferred || 0));
  if (phase === "never" || (total === 0 && ["completed", "no-candidates", "quota"].includes(phase))) {
    els.settingsAutoAiDetail.textContent = "";
    els.settingsAutoAiDetail.hidden = true;
    return;
  }
  if (["never", "missing-key", "missing-consent", "missing-permission", "not-ready"].includes(phase)) {
    const detailKeys = {
      "missing-key": "settings.auto.missingKeyDetail",
      "missing-consent": "settings.auto.missingConsentDetail",
      "missing-permission": "settings.auto.missingPermissionDetail",
      "not-ready": "settings.auto.notReadyDetail",
    };
    els.settingsAutoAiDetail.textContent = t(detailKeys[phase] || "settings.auto.neverDetail");
    return;
  }
  if (phase === "error") {
    const reason = auto.errorKey
      ? localizedErrorMessage({ messageKey: auto.errorKey, messageParams: auto.errorParams || {} })
      : t("settings.auto.unknownError");
    const stageKeys = {
      digest: "settings.auto.stageDigest",
      cards: "settings.auto.stageCards",
      refresh: "settings.auto.stageRefresh",
    };
    const stage = t(stageKeys[auto.errorStage] || "settings.auto.stageUnknown");
    els.settingsAutoAiDetail.textContent = t("settings.auto.errorDetail", {
      stage,
      reason,
      processed,
      total,
      attempted, failed, deferred,
      time: auto.lastRunAt ? formatDateTime(auto.lastRunAt) : t("settings.auto.noTime"),
    });
    return;
  }
  els.settingsAutoAiDetail.textContent = t(auto.running ? "settings.auto.runningDetail" : "settings.auto.detail", {
    processed,
    total,
    attempted, failed, deferred,
    time: auto.lastRunAt ? formatDateTime(auto.lastRunAt) : t("settings.auto.noTime"),
  });
}

function renderOverviewStatus(title, meta) {
  els.settingsOverviewTitle.removeAttribute("data-i18n");
  els.settingsOverviewMeta.removeAttribute("data-i18n");
  els.settingsOverviewTitle.textContent = title || "";
  els.settingsOverviewTitle.hidden = !title;
  els.settingsOverviewMeta.textContent = meta || "";
  els.settingsOverviewMeta.hidden = !meta;
}

function renderRefreshButtons(refreshState) {
  renderRefreshButton(els.refresh, refreshState);
  renderRefreshButton(els.settingsRefresh, refreshState);
}

function renderRefreshButton(button, refreshState) {
  const isRunning = refreshState.reason === "running";
  button.disabled = !refreshState.available;
  button.setAttribute("aria-busy", String(isRunning));
  if (refreshState.available || isRunning) button.removeAttribute("title");
  else button.setAttribute("title", t(refreshState.messageKey));
  if (refreshState.available) button.removeAttribute("data-disabled-reason");
  else button.dataset.disabledReason = isRunning ? "loading" : "prerequisite";
  if (isRunning) {
    button.classList.remove?.("is-spinner-stopping");
    if (button.classList.contains?.("is-loading") && button.querySelector?.(".btn-icon")) return;
    button.classList.toggle("is-loading", true);
    setIconLabel(button, "synchronize", t("status.caching"));
    return;
  }
  const spinningIcon = button.classList.contains?.("is-loading") && button.querySelector?.(".btn-icon");
  if (spinningIcon?.addEventListener && !prefersReducedMotion()) {
    button.classList.add("is-spinner-stopping");
    spinningIcon.addEventListener("animationiteration", () => {
      if (!button.classList.contains("is-spinner-stopping")) return;
      button.classList.remove("is-loading", "is-spinner-stopping");
      setIconLabel(button, "refresh-cw-01", t("action.refreshNews"));
    }, { once: true });
    return;
  }
  button.classList.remove?.("is-spinner-stopping");
  button.classList.toggle("is-loading", false);
  setIconLabel(button, "refresh-cw-01", t("action.refreshNews"));
}

function renderConnectionError(error) {
  const detail = localizedErrorMessage(error);
  renderOverviewStatus(t("connection.unavailable"), t("connection.retryMeta", { detail }));
  renderQuotaOverview();
  setCacheOverviewLoading(false);
  els.settingsCacheOverviewStatus.closest(".settings-overview-cache")?.setAttribute("data-state", "unavailable");
  els.settingsCacheOverviewStatus.removeAttribute("data-i18n");
  els.settingsCacheOverviewStatus.textContent = t("connection.backgroundPaused");
  els.settingsCacheOverviewDetail.removeAttribute("data-i18n");
  els.settingsCacheOverviewDetail.textContent = t("settings.overview.cachePaused");
  els.settingsCacheOverviewDetail.hidden = false;
  const unavailable = { available: false, reason: "connection", messageKey: "status.refreshUnavailable.connection" };
  renderRefreshButtons(unavailable);
  els.settingsAutoAiStatus.removeAttribute("data-i18n");
  els.settingsAutoAiDetail.removeAttribute("data-i18n");
  els.settingsAutoAiStatus.textContent = t("settings.auto.notReady");
  els.settingsAutoAiDetail.textContent = t("settings.auto.neverDetail");
  els.settingsAutoAiDetail.hidden = false;
  els.settingsAutoAiStatus.closest(".settings-overview-auto")?.setAttribute("data-phase", "not-ready");
  dashboardLayout.cancelDrag();
  for (const id of ["utility", "digest", "queue", "news", "inspiration", "archive"]) {
    const current = dashboardLayout.getCard(id);
    if (current && !current.matches(".card-skeleton, .dashboard-unavailable")) continue;
    const unavailableCard = document.createElement("div");
    unavailableCard.className = "dashboard-unavailable";
    unavailableCard.append(createEmptyState({
      title: t("connection.recoveringTitle"),
      body: t("connection.recoveringBody"),
      variant: "error",
    }));
    dashboardLayout.mount(id, unavailableCard);
  }
  els.summaryGrid.replaceChildren(createEmptyState({
    title: t("connection.cacheTitle"),
    body: t("connection.cacheBody"),
    variant: "error",
  }));
  els.categoryGrid.replaceChildren(createEmptyState({
    title: t("connection.entriesTitle"),
    body: t("connection.entriesBody"),
    variant: "error",
  }));
}

}
