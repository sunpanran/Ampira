export function createAiConnectionTest(options) {
  const {
    els, t, request, confirmManualAiUsage, localizedResponseMessage, localizedErrorMessage,
    getAiSetupState, focusAiSetupRequirement, runSettingsAction,
    currentSettingsHaveUnsavedChanges, renderSettingsStatus,
  } = options;

  return { testKey, renderStatus };

  async function testKey() {
    if (!getAiSetupState().formUnlocked) {
      focusAiSetupRequirement();
      return;
    }
    if (!String(els.modelInput.value || "").trim()) {
      renderStatus(t("background.error.aiModelRequired"), "error");
      els.modelInput.focus({ preventScroll: true });
      return;
    }
    if (!await confirmManualAiUsage()) return;
    return runSettingsAction(async (isCurrent) => {
      renderStatus();
      renderSettingsStatus(t("settings.test.testing"));
      try {
        const result = await request({ type: "settings:test", payload: {
          openaiApiKey: els.apiKeyInput.value,
          openaiBaseUrl: els.apiBaseUrlInput.value,
          openaiApiStyle: els.apiStyleSelect.value,
          openaiSummaryModel: els.modelInput.value,
          aiDisclosureAccepted: els.aiDisclosureConsent.checked,
        } });
        if (!isCurrent()) return;
        const message = result.ok
          ? t(currentSettingsHaveUnsavedChanges() ? "settings.test.successSaveHint" : "settings.test.success")
          : t("settings.test.failed", { message: localizedResponseMessage(result, "error.requestFailed") });
        renderSettingsStatus(message);
      } catch (error) {
        if (!isCurrent()) return;
        const message = t("settings.test.failed", { message: localizedErrorMessage(error) });
        renderSettingsStatus(message);
      }
    });
  }

  function renderStatus(message = "", stateValue = "") {
    els.aiConnectionStatus.textContent = message;
    els.aiConnectionStatus.hidden = !message;
    if (stateValue) els.aiConnectionStatus.dataset.state = stateValue;
    else delete els.aiConnectionStatus.dataset.state;
  }
}
