export function createSettingsFeedback({ els, t, isBusy, hasUnsavedChanges }) {
  els.settingsForm.addEventListener?.("input", syncSettingsFooter);
  els.settingsForm.addEventListener?.("change", syncSettingsFooter);
  return { syncSettingsFooter, renderSettingsStatus };

  function syncSettingsFooter() {
    const mcpPanel = els.settingsForm.querySelector?.('[data-settings-panel="bot"]');
    const immediateOnly = Boolean(mcpPanel?.classList.contains("active")) && !isBusy() && !hasUnsavedChanges();
    els.settingsModal.classList.toggle("is-immediate-settings", immediateOnly);
  }

  function renderSettingsStatus(extra, stateName = extra ? "notice" : "pending") {
    els.settingsStatus.textContent = extra || t("settings.status.unsaved");
    els.settingsStatus.dataset.state = stateName;
  }
}
