import { requestOrigins } from "./permission-client.mjs";

export function createSourceCoverageController(options) {
  const {
    state, els, t, tc, apiPost, setIconLabel, createEmptyState, renderSettingsStatus,
    localizedErrorMessage, formatDateTime, getSourceQuality,
  } = options;
  const sourceActions = new Set();

  function renderSourceCoverage() {
    if (!els.sourceCoverageSummary || !els.sourceCoverageList) return;
    const summary = getSourceQuality();
    const metrics = [
      ["settings.sources.available", Number(summary.healthy || 0)],
      ["settings.sources.permissionPending", Number(summary.permissionRequired || 0)],
      ["settings.sources.needsReview", Number(summary.failed || 0) + Number(summary.empty || 0)],
    ];
    els.sourceCoverageSummary.replaceChildren(...metrics.map(([labelKey, value]) => {
      const metric = document.createElement("div");
      metric.className = "source-coverage-metric";
      const valueNode = document.createElement("strong");
      valueNode.textContent = String(value);
      const label = document.createElement("span");
      label.textContent = t(labelKey);
      metric.append(valueNode, label);
      return metric;
    }));
    const records = Object.values(summary.records || {}).sort(compareSourceRecords);
    if (!records.length) {
      els.sourceCoverageList.replaceChildren(createEmptyState({
        title: t("settings.sources.emptyTitle"),
        body: t("settings.sources.emptyBody"),
        variant: "compact",
      }));
      return;
    }
    els.sourceCoverageList.replaceChildren(...records.map(createSourceHealthRow));
  }

  function createSourceHealthRow(record) {
    const row = document.createElement("div");
    row.className = `source-health-row is-${record.status || "waiting"}`;
    const main = document.createElement("div");
    main.className = "source-health-main";
    const title = document.createElement("strong");
    title.textContent = record.title || record.host || t("exclusion.unnamedSource");
    const meta = document.createElement("span");
    const checkedAt = record.lastCheckedAt
      ? t("settings.sources.lastChecked", { time: formatDateTime(record.lastCheckedAt) })
      : t("settings.sources.notChecked");
    const nextEligibleAt = Date.parse(String(record.nextEligibleAt || ""));
    const retryAt = Number.isFinite(nextEligibleAt) && nextEligibleAt > Date.now()
      ? t("settings.sources.retryAfter", { time: formatDateTime(record.nextEligibleAt) })
      : "";
    meta.textContent = [
      record.host,
      t(`settings.sources.status.${record.status || "waiting"}`),
      tc("unit.entries", Number(record.itemCount || 0)),
      checkedAt,
      retryAt,
    ].filter(Boolean).join(" · ");
    main.append(title, meta);
    const actions = document.createElement("div");
    actions.className = "source-health-actions";
    if (record.pendingFeed?.origin) {
      const grant = document.createElement("button");
      grant.className = "btn";
      grant.type = "button";
      setIconLabel(grant, "key-01", t("settings.sources.grantFeed"));
      grant.addEventListener("click", () => grantSourceFeed(record, grant));
      actions.append(grant);
    }
    const retry = document.createElement("button");
    retry.className = "btn";
    retry.type = "button";
    retry.disabled = sourceActions.has(record.sourceKey) || record.status === "permissionRequired" && !record.pendingFeed?.origin;
    setIconLabel(retry, "synchronize", t("settings.sources.retry"));
    retry.addEventListener("click", () => refreshSourceRecord(record, retry));
    actions.append(retry);
    row.append(main, actions);
    return row;
  }

  async function grantSourceFeed(record, button) {
    const pattern = permissionPattern(record.pendingFeed?.origin);
    if (!pattern || !globalThis.chrome?.permissions?.request) return;
    button.disabled = true;
    try {
      const granted = await requestOrigins([pattern]);
      if (granted !== true) {
        renderSettingsStatus(t("permission.requestDeclined"));
        return;
      }
      await refreshSourceRecord(record, button);
    } catch (error) {
      renderSettingsStatus(t("settings.sources.actionFailed", { message: localizedErrorMessage(error) }));
    } finally {
      if (button.isConnected) button.disabled = false;
    }
  }

  async function refreshSourceRecord(record, button) {
    const sourceKey = String(record.sourceKey || "");
    if (!sourceKey || sourceActions.has(sourceKey)) return;
    sourceActions.add(sourceKey);
    if (button) button.disabled = true;
    renderSettingsStatus(t("settings.sources.refreshing", { title: record.title || record.host || sourceKey }));
    try {
      const result = await apiPost("/api/feed/source/refresh", { sourceKey });
      if (result?.sourceQuality) {
        if (state.data) state.data.sourceQuality = result.sourceQuality;
        if (state.settings) state.settings.sourceQuality = result.sourceQuality;
      }
      renderSourceCoverage();
      renderSettingsStatus(t("settings.sources.refreshed", { count: Number(result?.itemCount || 0) }));
    } catch (error) {
      renderSettingsStatus(t("settings.sources.actionFailed", { message: localizedErrorMessage(error) }));
    } finally {
      sourceActions.delete(sourceKey);
      renderSourceCoverage();
    }
  }

  return { renderSourceCoverage };
}

function permissionPattern(value) {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol === "https:" || url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)) return `${url.origin}/*`;
  } catch {
    // Invalid discovered origins never reach Chrome's permission prompt.
  }
  return "";
}

function compareSourceRecords(left, right) {
  const order = { error: 0, permissionRequired: 1, empty: 2, waiting: 3, healthy: 4 };
  return (order[left?.status] ?? 5) - (order[right?.status] ?? 5)
    || String(left?.title || left?.host || "").localeCompare(String(right?.title || right?.host || ""));
}
