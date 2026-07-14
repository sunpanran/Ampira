export function createSavedSourcePermissionController(options) {
  const {
    els, t, selectSettingsTab, requestSourcePermissions, loadDashboard, triggerRefresh,
    renderSettingsStatus, setSettingsBusy, isSettingsBusy, closeSettings, getSettingsSession,
    settingsSaveCloseDelayMs, wait,
  } = options;
  let pendingOrigins = [];
  let pendingScope = "";
  let deferred = false;

  return { show, clear, grant, dismiss, syncBusy };

  function show(origins, scope) {
    pendingOrigins = [...new Set(origins)];
    pendingScope = scope;
    deferred = false;
    render();
    selectSettingsTab("bookmarks");
    els.savedSourcePermissionPrompt.scrollIntoView({
      block: "nearest",
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    });
    window.setTimeout(() => els.grantSavedSourcePermissions.focus({ preventScroll: true }), 0);
  }

  function clear() {
    pendingOrigins = [];
    pendingScope = "";
    deferred = false;
    els.savedSourcePermissionPrompt.hidden = true;
    els.dismissSavedSourcePermissions.hidden = false;
  }

  async function grant() {
    const origins = [...pendingOrigins];
    if (isSettingsBusy() || !origins.length || typeof requestSourcePermissions !== "function") return;
    const session = getSettingsSession();
    setSettingsBusy(true);
    renderSettingsStatus(t("permission.requesting"));
    let granted = false;
    try {
      const request = requestSourcePermissions(origins);
      granted = await request;
    } catch (error) {
      if (session === getSettingsSession()) {
        defer();
        renderSettingsStatus(t("permission.requestDenied", { message: error.message || error }));
      }
      return;
    } finally {
      if (!granted && session === getSettingsSession()) setSettingsBusy(false);
    }
    if (session !== getSettingsSession()) return;
    if (granted !== true) {
      defer();
      renderSettingsStatus(t("settings.status.sourcePermissionDeclined"));
      return;
    }
    clear();
    renderSettingsStatus(t("settings.status.sourcePermissionGranted"));
    try {
      await loadDashboard();
      await triggerRefresh(true);
      await wait(settingsSaveCloseDelayMs);
      if (session === getSettingsSession() && els.settingsModal.classList.contains("open")) closeSettings(true);
    } catch (error) {
      if (session === getSettingsSession()) {
        renderSettingsStatus(t("settings.status.sourcePermissionRefreshFailed", { message: error.message || error }));
      }
    } finally {
      if (session === getSettingsSession() || !els.settingsModal.classList.contains("open")) setSettingsBusy(false);
    }
  }

  function dismiss() {
    if (isSettingsBusy() || !pendingOrigins.length) return;
    defer();
    renderSettingsStatus(t("settings.status.sourcePermissionDeclined"));
    els.grantSavedSourcePermissions.focus({ preventScroll: true });
  }

  function defer() {
    deferred = true;
    render();
  }

  function syncBusy(busy) {
    els.grantSavedSourcePermissions.disabled = busy || !pendingOrigins.length;
    els.dismissSavedSourcePermissions.disabled = busy;
    if (pendingOrigins.length) render();
    if (!busy && pendingOrigins.length) {
      window.setTimeout(() => els.grantSavedSourcePermissions.focus({ preventScroll: true }), 0);
    }
  }

  function render() {
    const count = pendingOrigins.length;
    els.savedSourcePermissionPrompt.hidden = count === 0;
    if (!count) return;
    const titleKey = deferred
      ? "settings.sourcePermission.titleDeferred"
      : "settings.sourcePermission.title";
    const bodyKey = `settings.sourcePermission.${deferred ? "deferred" : "body"}.${pendingScope}`;
    const originLabels = pendingOrigins.map(originLabel).filter(Boolean);
    els.savedSourcePermissionTitle.textContent = t(titleKey);
    els.savedSourcePermissionBody.textContent = t(bodyKey, { count });
    els.savedSourcePermissionOrigins.textContent = t("settings.sourcePermission.origins", {
      origins: originLabels.join(" · "),
    });
    els.dismissSavedSourcePermissions.hidden = deferred;
    const label = els.grantSavedSourcePermissions.querySelector(".btn-label");
    if (label) label.textContent = t(isSettingsBusy() ? "permission.requesting" : "settings.sourcePermission.grant");
  }
}

export function personalSourcePermissionScope(draft = {}, payload = {}) {
  const newsChanged = draft.newsSourceMode === "bookmarks"
    && ["newsSourceMode", "newsBookmarkFolder"].some((key) => Object.hasOwn(payload, key));
  const inspirationChanged = draft.inspirationSourceMode === "bookmarks"
    && ["inspirationSourceMode", "inspirationBookmarkFolder"].some((key) => Object.hasOwn(payload, key));
  if (newsChanged && inspirationChanged) return "both";
  if (newsChanged) return "news";
  if (inspirationChanged) return "inspiration";
  return "";
}

function originLabel(origin) {
  try {
    return new URL(String(origin || "").replace(/\/\*$/, "")).host;
  } catch {
    return "";
  }
}
