import { MAX_WEBSITE_SHORTCUTS } from "../../extension/core/settings.mjs";
import { createLoadingPhaseController } from "./motion.mjs";

export function refreshAvailability(data) {
  if (!data) return { available: false, reason: "loading", messageKey: "status.refreshUnavailable.loading" };
  if (data.status?.running === true) return { available: false, reason: "running", messageKey: "status.refreshUnavailable.running" };
  if (data.onboarding?.bookmarkConsentGranted === false) {
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
    state, els, t, formatDateTime, localizedStatusMessage, localizedErrorMessage,
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
  els.efficiencyPanel.replaceChildren(...Array.from({ length: 3 }, () => createLoadingPlaceholder("efficiency-skeleton")));
  els.dailyBoard.replaceChildren(...["news", "inspiration", "archive"].map((columnId) => {
    const column = document.createElement("section");
    column.className = "board-column loading-column";
    column.dataset.columnId = columnId;
    const head = document.createElement("div");
    head.className = "column-head loading-line loading-line-heading";
    const list = document.createElement("div");
    list.className = "card-list";
    list.append(createLoadingPlaceholder());
    column.append(head, list);
    return column;
  }));
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
  const overviewMetaKey = ai.enabled
    ? "settings.overview.aiReady"
    : ai.configured
      ? "settings.overview.aiNeedsAttention"
      : "settings.overview.aiNotConfigured";
  renderOverviewStatus(t("settings.overview.aiService"), t(overviewMetaKey));
  els.settingsOverviewAction.textContent = t(ai.configured ? "settings.overview.manage" : "settings.overview.configure");
  renderQuotaOverview(ai);
  renderCacheOverview(status, refreshState);
  renderAutoAiStatus(ai);
  renderCacheStatus();
  renderRefreshButtons(refreshState);
}

function renderQuotaOverview(ai = {}) {
  const usedValue = Number(ai.usedToday);
  const limitValue = Number(ai.dailyLimit);
  const used = Number.isFinite(usedValue) ? Math.max(0, Math.floor(usedValue)) : 0;
  const limit = Number.isFinite(limitValue) ? Math.max(1, Math.floor(limitValue)) : 50;
  const remaining = Math.max(0, limit - used);
  els.settingsQuotaStatus.textContent = `${used} / ${limit}`;
  els.settingsQuotaDetail.removeAttribute("data-i18n");
  els.settingsQuotaDetail.textContent = t("settings.overview.quotaDetail", { used, remaining });
}

function setCacheOverviewLoading(isLoading) {
  const cacheItem = els.settingsCacheOverviewStatus.closest(".settings-overview-cache");
  cacheItem?.classList.toggle("is-loading", isLoading);
  els.settingsCacheLoadingIcon.hidden = !isLoading;
}

function renderCacheOverview(status = {}, refreshState = refreshAvailability(state.data)) {
  const isRunning = status.running === true;
  setCacheOverviewLoading(isRunning);
  els.settingsCacheOverviewStatus.removeAttribute("data-i18n");
  els.settingsCacheOverviewStatus.textContent = t(isRunning
    ? "settings.overview.cacheRunning"
    : refreshState.available ? "settings.overview.cacheReady" : "settings.overview.cacheUnavailable");
  els.settingsCacheOverviewDetail.removeAttribute("data-i18n");
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
    : t("settings.overview.cacheNoRecord");
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
  const labelKeys = {
    "running-digest": "settings.auto.runningDigest",
    "running-cards": "settings.auto.runningCards",
    completed: "settings.auto.completed",
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
  const used = Math.max(0, Number(ai.usedToday || 0));
  const limit = Math.max(1, Number(ai.dailyLimit || 50));
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
      time: auto.lastRunAt ? formatDateTime(auto.lastRunAt) : t("settings.auto.noTime"),
    });
    return;
  }
  els.settingsAutoAiDetail.textContent = t(auto.running ? "settings.auto.runningDetail" : "settings.auto.detail", {
    processed,
    total,
    used,
    limit,
    time: auto.lastRunAt ? formatDateTime(auto.lastRunAt) : t("settings.auto.noTime"),
  });
}

function renderOverviewStatus(title, meta) {
  els.settingsOverviewTitle.textContent = title || t("status.waitingUpdate");
  els.settingsOverviewMeta.textContent = meta || t("status.noRecord");
}

function renderRefreshButtons(refreshState) {
  renderRefreshButton(els.refresh, refreshState);
  renderRefreshButton(els.settingsRefresh, refreshState);
  const message = refreshState.available ? "" : t(refreshState.messageKey);
  els.refreshAvailability.textContent = message;
  els.refreshAvailability.classList.toggle("is-visible", Boolean(message));
}

function renderRefreshButton(button, refreshState) {
  const isRunning = refreshState.reason === "running";
  button.disabled = !refreshState.available;
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
  if (spinningIcon?.addEventListener) {
    button.classList.add("is-spinner-stopping");
    spinningIcon.addEventListener("animationiteration", () => {
      if (!button.classList.contains("is-spinner-stopping")) return;
      button.classList.remove("is-loading", "is-spinner-stopping");
      setIconLabel(button, "refresh-cw-01", t("action.cache"));
    }, { once: true });
    return;
  }
  button.classList.toggle("is-loading", false);
  setIconLabel(button, "refresh-cw-01", t("action.cache"));
}

function renderCacheStatus() {
  const cache = state.data?.cache || {};
  els.settingsCacheStatus.textContent = t("status.cacheDetail", {
    ready: cache.ready || 0,
    target: cache.target || state.settings?.hotNewsCacheSize || state.settings?.defaultHotNewsCacheSize || 192,
    message: localizedStatusMessage(cache, "status.nextBatchPreparing"),
  });
}

function currentPipelineStage(stages = {}) {
  const labels = {
    discovering: t("pipeline.discovering"),
    fetching: t("pipeline.fetching"),
    extracting: t("pipeline.extracting"),
    deduplicating: t("pipeline.deduplicating"),
    enriching: "AI",
    complete: t("pipeline.complete"),
  };
  for (const key of Object.keys(labels)) if (stages?.[key] === "running") return labels[key];
  return t("pipeline.complete");
}

function setMeter(bar, label, value) {
  const percent = Math.max(0, Math.min(100, Number(value) || 0));
  bar.style.width = `${percent}%`;
  label.textContent = `${percent}%`;
}

function percentage(used, total) {
  if (!Number.isFinite(total) || total <= 0) return 0;
  return Math.round(Math.max(0, Math.min(1, used / total)) * 100);
}

function renderConnectionError(error) {
  const detail = localizedErrorMessage(error);
  renderOverviewStatus(t("connection.unavailable"), t("connection.retryMeta", { detail }));
  renderQuotaOverview();
  setCacheOverviewLoading(false);
  els.settingsCacheOverviewStatus.removeAttribute("data-i18n");
  els.settingsCacheOverviewStatus.textContent = t("connection.backgroundPaused");
  els.settingsCacheOverviewDetail.removeAttribute("data-i18n");
  els.settingsCacheOverviewDetail.textContent = t("settings.overview.cachePaused");
  const unavailable = { available: false, reason: "connection", messageKey: "status.refreshUnavailable.connection" };
  renderRefreshButtons(unavailable);
  els.settingsAutoAiStatus.textContent = t("settings.auto.notReady");
  els.settingsAutoAiDetail.textContent = t("settings.auto.neverDetail");
  els.settingsAutoAiStatus.closest(".settings-overview-auto")?.setAttribute("data-phase", "not-ready");
  els.dailyBoard.replaceChildren(createEmptyState({
    title: t("connection.recoveringTitle"),
    body: t("connection.recoveringBody"),
    variant: "error",
  }));
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
