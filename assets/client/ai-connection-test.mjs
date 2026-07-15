export function createAiConnectionTest(options) {
  const {
    els, t, apiPost, localizedResponseMessage, localizedErrorMessage,
    getAiSetupState, focusAiSetupRequirement, runSettingsAction,
    currentSettingsHaveUnsavedChanges, renderSettingsStatus,
  } = options;

  return { testKey, renderStatus };

  function testKey() {
    if (!getAiSetupState().formUnlocked) {
      focusAiSetupRequirement();
      return;
    }
    if (!String(els.modelInput.value || "").trim()) {
      renderStatus(t("background.error.aiModelRequired"), "error");
      els.modelInput.focus({ preventScroll: true });
      return;
    }
    return runSettingsAction(async (isCurrent) => {
      renderSettingsStatus(t("settings.test.testing"));
      renderStatus(t("settings.test.testing"), "testing");
      try {
        const result = await apiPost("/api/settings/test", {
          openaiApiKey: els.apiKeyInput.value,
          openaiBaseUrl: els.apiBaseUrlInput.value,
          openaiApiStyle: els.apiStyleSelect.value,
          openaiSummaryModel: els.modelInput.value,
          aiDisclosureAccepted: els.aiDisclosureConsent.checked,
        });
        if (!isCurrent()) return;
        const message = result.ok
          ? t(currentSettingsHaveUnsavedChanges() ? "settings.test.successSaveHint" : "settings.test.success")
          : t("settings.test.failed", { message: localizedResponseMessage(result, "error.requestFailed") });
        renderStatus(message, result.ok ? "success" : "error");
        renderSettingsStatus(message);
      } catch (error) {
        if (!isCurrent()) return;
        const message = t("settings.test.failed", { message: localizedErrorMessage(error) });
        renderStatus(message, "error");
        renderSettingsStatus(message);
      }
    });
  }

  function renderStatus(message = "", stateValue = "") {
    els.aiConnectionStatus.textContent = message;
    if (stateValue) els.aiConnectionStatus.dataset.state = stateValue;
    else delete els.aiConnectionStatus.dataset.state;
  }
}
