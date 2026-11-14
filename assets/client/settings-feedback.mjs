export function createSettingsFeedback({ els, t, isBusy, hasUnsavedChanges }) {
  els.settingsForm.addEventListener?.("input", syncSettingsFooter);
  els.settingsForm.addEventListener?.("change", syncSettingsFooter);
  return { syncSettingsHeader, syncSettingsFooter, renderSettingsStatus };

  function syncSettingsHeader(panel) {
    const titleKey = panel.querySelector(".settings-panel-intro h3")?.dataset.i18n;
    if (titleKey) {
      els.settingsPanelTitle.dataset.i18n = titleKey;
      els.settingsPanelTitle.textContent = t(titleKey);
    }
    els.settingsModal.dataset.settingsTab = panel.dataset.settingsPanel;
  }

  function syncSettingsFooter() {
    const mcpPanel = els.settingsForm.querySelector?.('[data-settings-panel="bot"]');
    const busy = isBusy();
    const dirty = hasUnsavedChanges();
    const immediateOnly = Boolean(mcpPanel?.classList.contains("active")) && !busy && !dirty;
    els.settingsModal.classList.toggle("is-immediate-settings", immediateOnly);
    if (!busy && !dirty && els.settingsStatus.dataset.state === "pending") renderSettingsStatus("", "ready");
  }

  function renderSettingsStatus(extra, stateName = extra ? "notice" : "pending") {
    if (stateName === "pending" && hasUnsavedChanges?.() === false) stateName = "ready";
    els.settingsStatus.removeAttribute("data-i18n");
    els.settingsStatus.textContent = stateName === "ready" ? "" : extra || t("settings.status.unsaved");
    els.settingsStatus.dataset.state = stateName;
  }
}
