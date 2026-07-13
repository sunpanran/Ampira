export function createAiPermissionController(options) {
  const {
    state, els, t, aiProviderOrigin, deriveAiSetupControlState, aiSetupStage,
    settingsBusy, renderSettingsStatus,
  } = options;
  let aiGrantPending = false;
  let aiDraftPermissionGranted = false;
  let aiPermissionCheckedOrigin = "";
  let aiPermissionCheckGeneration = 0;
  let aiSetupState = deriveAiSetupControlState();
  let aiSetupFeedback = null;

  return {
    applyDeepSeekPreset,
    resetAiConsentForProviderChange,
    syncAiSetupControls,
    refreshAiSetupPermission,
    grantAiProviderOrigin,
    focusAiSetupRequirement,
    state: () => aiSetupState,
    clearFeedback: () => { aiSetupFeedback = null; },
  };

function applyDeepSeekPreset() {
  els.apiBaseUrlInput.value = "https://api.deepseek.com";
  els.apiStyleSelect.value = "chat_completions";
  els.modelInput.value = "deepseek-v4-flash";
  resetAiConsentForProviderChange();
  refreshAiSetupPermission();
  renderSettingsStatus(t("settings.deepseekApplied"));
}

function resetAiConsentForProviderChange() {
  const savedOrigin = aiProviderOrigin(state.settings?.savedBaseUrl || state.settings?.baseUrl || "");
  const draftOrigin = aiProviderOrigin(els.apiBaseUrlInput.value);
  if (!savedOrigin || savedOrigin === draftOrigin || !els.aiDisclosureConsent.checked) return;
  els.aiDisclosureConsent.checked = false;
  els.apiKeyInput.value = "";
  renderSettingsStatus(t("settings.service.providerConsentReset"));
}

function syncAiSetupControls() {
  aiSetupState = deriveAiSetupControlState({
    providerUrl: els.apiBaseUrlInput.value,
    consentAccepted: els.aiDisclosureConsent.checked,
    permissionGranted: aiDraftPermissionGranted,
    busy: settingsBusy(),
    grantPending: aiGrantPending,
  });
  const permissionApiAvailable = Boolean(
    globalThis.chrome?.permissions?.contains
    && globalThis.chrome?.permissions?.request
  );
  const grantDisabled = aiSetupState.grantDisabled || !permissionApiAvailable;

  els.apiBaseUrlInput.disabled = aiSetupState.providerUrlDisabled;
  els.aiDisclosureConsent.disabled = aiSetupState.consentDisabled;
  els.deepseekPreset.disabled = settingsBusy() || aiGrantPending;
  els.grantAiOrigin.disabled = grantDisabled;
  els.aiProviderFields.disabled = aiSetupState.protectedFieldsDisabled;
  if (grantDisabled && !settingsBusy() && !aiGrantPending) {
    els.grantAiOrigin.dataset.disabledReason = "prerequisite";
  } else {
    delete els.grantAiOrigin.dataset.disabledReason;
  }

  const label = els.grantAiOrigin.querySelector(".btn-label");
  if (label) {
    label.removeAttribute("data-i18n");
    label.textContent = t(aiSetupState.stage === aiSetupStage.READY
      ? "settings.service.aiOriginGranted"
      : "settings.service.grantAi");
  }
  els.aiFormAccessStatus.removeAttribute("data-i18n");
  const statusKey = aiSetupFeedback?.key
    || (aiGrantPending
      ? "settings.service.aiFormRequesting"
      : ({
      [aiSetupStage.INVALID_ORIGIN]: "settings.service.aiFormInvalidOrigin",
      [aiSetupStage.NEEDS_CONSENT]: "settings.service.aiFormNeedsConsent",
      [aiSetupStage.NEEDS_PERMISSION]: "settings.service.aiFormNeedsPermission",
      [aiSetupStage.READY]: "settings.service.aiFormReady",
    })[aiSetupState.stage]);
  els.aiFormAccessStatus.dataset.stage = aiSetupFeedback ? "error" : (aiGrantPending ? "grant-pending" : aiSetupState.stage);
  els.aiFormAccessStatus.textContent = t(statusKey, {
    origin: aiSetupState.origin,
    ...(aiSetupFeedback?.params || {}),
  });
}

async function refreshAiSetupPermission({ focusOnLock = false } = {}) {
  const generation = ++aiPermissionCheckGeneration;
  const snapshot = deriveAiSetupControlState({
    providerUrl: els.apiBaseUrlInput.value,
    consentAccepted: els.aiDisclosureConsent.checked,
  });
  const wasGranted = aiDraftPermissionGranted;
  const focusedProtectedControl = els.aiProviderFields.contains(document.activeElement);
  const canReuseCurrentCheck = aiPermissionCheckedOrigin === snapshot.origin && els.aiDisclosureConsent.checked;
  if (!canReuseCurrentCheck) {
    aiDraftPermissionGranted = false;
    aiPermissionCheckedOrigin = snapshot.origin;
    syncAiSetupControls();
  }
  if (!snapshot.originPattern || !els.aiDisclosureConsent.checked || !globalThis.chrome?.permissions?.contains) {
    aiDraftPermissionGranted = false;
    aiPermissionCheckedOrigin = snapshot.origin;
    syncAiSetupControls();
    moveFocusAfterAiLock({ focusOnLock, wasGranted, focusedProtectedControl });
    return false;
  }

  try {
    const granted = await chrome.permissions.contains({ origins: [snapshot.originPattern] });
    if (generation !== aiPermissionCheckGeneration) return false;
    if (aiProviderOrigin(els.apiBaseUrlInput.value) !== snapshot.origin || !els.aiDisclosureConsent.checked) return false;
    aiDraftPermissionGranted = granted === true;
  } catch {
    if (generation !== aiPermissionCheckGeneration) return false;
    aiDraftPermissionGranted = false;
  }
  aiPermissionCheckedOrigin = snapshot.origin;
  if (aiDraftPermissionGranted) aiSetupFeedback = null;
  syncAiSetupControls();
  moveFocusAfterAiLock({ focusOnLock, wasGranted, focusedProtectedControl });
  return aiDraftPermissionGranted;
}

function moveFocusAfterAiLock({ focusOnLock, wasGranted, focusedProtectedControl }) {
  if (!focusOnLock || !wasGranted || aiDraftPermissionGranted || !focusedProtectedControl) return;
  if (!els.settingsModal.classList.contains("open") || aiSetupState.stage !== aiSetupStage.NEEDS_PERMISSION) return;
  els.grantAiOrigin.focus({ preventScroll: true });
}

async function grantAiProviderOrigin() {
  const requested = deriveAiSetupControlState({
    providerUrl: els.apiBaseUrlInput.value,
    consentAccepted: els.aiDisclosureConsent.checked,
    permissionGranted: aiDraftPermissionGranted,
  });
  if (requested.stage !== aiSetupStage.NEEDS_PERMISSION) {
    focusAiSetupRequirement();
    return;
  }
  if (!globalThis.chrome?.permissions?.request) {
    renderSettingsStatus(t("api.notExtensionPage"));
    return;
  }

  aiSetupFeedback = null;
  aiGrantPending = true;
  syncAiSetupControls();
  let feedback = null;
  try {
    const granted = await chrome.permissions.request({ origins: [requested.originPattern] });
    if (granted !== true) {
      feedback = { key: "settings.service.aiFormDeclined", params: { origin: requested.origin } };
    }
  } catch (error) {
    feedback = {
      key: "settings.service.aiFormGrantFailed",
      params: { origin: requested.origin, message: String(error.message || error) },
    };
  } finally {
    aiGrantPending = false;
    const permissionGranted = await refreshAiSetupPermission();
    if (!permissionGranted && feedback) {
      aiSetupFeedback = feedback;
      syncAiSetupControls();
      renderSettingsStatus(t(feedback.key, feedback.params));
    } else if (permissionGranted && els.settingsModal.classList.contains("open")) {
      els.apiKeyInput.focus({ preventScroll: true });
    }
  }
}

function focusAiSetupRequirement() {
  syncAiSetupControls();
  if (aiSetupState.stage === aiSetupStage.INVALID_ORIGIN) {
    els.apiBaseUrlInput.focus({ preventScroll: true });
    renderSettingsStatus(t("permission.invalidServiceUrl"));
    return;
  }
  if (aiSetupState.stage === aiSetupStage.NEEDS_CONSENT) {
    els.aiDisclosureConsent.focus({ preventScroll: true });
    renderSettingsStatus(t("background.error.aiConsentRequired"));
    return;
  }
  if (aiSetupState.stage === aiSetupStage.NEEDS_PERMISSION) {
    els.grantAiOrigin.focus({ preventScroll: true });
  }
}

}
