import { providerRequiresApiKey } from "../../extension/core/provider-policy.mjs";
import {
  CUSTOM_PROVIDER,
  aiProviderConfiguration,
  aiProviderPresetForUrl,
  aiProviderPresets,
  aiProviderRegionForUrl,
} from "./ai-provider-presets.mjs";
import { containsOrigins, requestOrigins } from "./permission-client.mjs";
import { setDisclosureVisibility } from "./motion.mjs";

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
  let selectedProvider = CUSTOM_PROVIDER;
  let userEditing = false;
  let uiPrepared = false;

  return {
    initializeAiProviderUi,
    prepareAiProviderUi,
    resetAiConsentForProviderChange,
    syncAiSetupControls,
    refreshAiSetupPermission,
    grantAiProviderOrigin,
    focusAiSetupRequirement,
    state: () => aiSetupState,
    clearFeedback: () => { aiSetupFeedback = null; },
  };

  function initializeAiProviderUi() {
    renderProviderCatalog();
    bindProviderUi();
  }

  function bindProviderUi() {
    const selectFromCatalog = (event) => {
      const button = event.target.closest("button[data-provider-id]");
      if (!button) return;
      selectProvider(button.dataset.providerId);
    };
    els.aiProviderPrimaryList.addEventListener("click", selectFromCatalog);
    els.aiProviderMoreList.addEventListener("click", selectFromCatalog);
    els.editAiProvider.addEventListener("click", () => openProviderEditor(false));
    els.changeAiProvider.addEventListener("click", () => openProviderEditor(true));
    els.closeAiProviderCatalog.addEventListener("click", () => {
      setDisclosureVisibility(els.aiProviderCatalog, false);
      setDisclosureVisibility(els.aiProviderConfiguration, true);
      els.apiBaseUrlInput.focus();
    });
    els.toggleMoreProviders.addEventListener("click", toggleMoreProviders);
    els.aiProviderRegionSelect.addEventListener("change", () => {
      const configuration = aiProviderConfiguration(selectedProvider, els.aiProviderRegionSelect.value);
      if (configuration) applyProviderConfiguration(configuration);
    });
    document.addEventListener("ampira:locale-changed", () => {
      renderProviderCatalog();
      renderRegionOptions();
      syncAiSetupControls();
    });
  }

  function prepareAiProviderUi() {
    selectedProvider = aiProviderPresetForUrl(els.apiBaseUrlInput.value) || CUSTOM_PROVIDER;
    uiPrepared = true;
    userEditing = false;
    renderRegionOptions();
    syncProviderConfiguration();
    syncAiSetupControls();
  }

  function selectProvider(providerId) {
    const provider = [...aiProviderPresets("primary"), ...aiProviderPresets("more")]
      .find((item) => item.id === providerId) || CUSTOM_PROVIDER;
    selectedProvider = provider;
    userEditing = true;
    if (provider.id === CUSTOM_PROVIDER.id) {
      els.apiBaseUrlInput.value = "";
      els.apiStyleSelect.value = CUSTOM_PROVIDER.apiStyle;
      els.modelInput.value = "";
      els.modelInput.placeholder = CUSTOM_PROVIDER.modelPlaceholder;
      syncModelDocsLink();
      resetAiConsentForProviderChange({ force: true });
    } else {
      renderRegionOptions();
      const configuration = aiProviderConfiguration(provider, els.aiProviderRegionSelect.value);
      applyProviderConfiguration(configuration);
    }
    renderRegionOptions();
    syncProviderConfiguration();
    setDisclosureVisibility(els.aiProviderCatalog, false);
    setDisclosureVisibility(els.aiProviderConfiguration, true);
    syncAiSetupControls();
    (els.aiProviderRegionField.hidden ? els.apiBaseUrlInput : els.aiProviderRegionSelect)
      .focus();
    renderSettingsStatus(t("settings.service.providerSelected", { provider: providerName(provider) }));
  }

  function applyProviderConfiguration(configuration) {
    const previousOrigin = aiProviderOrigin(els.apiBaseUrlInput.value);
    els.apiBaseUrlInput.value = configuration.baseUrl || "";
    els.apiStyleSelect.value = configuration.apiStyle || "chat_completions";
    els.modelInput.value = configuration.model || "";
    els.modelInput.placeholder = configuration.modelPlaceholder || "model-name";
    syncModelDocsLink(configuration.modelDocs);
    if (previousOrigin !== aiProviderOrigin(els.apiBaseUrlInput.value)) {
      resetAiConsentForProviderChange({ force: true });
    }
    refreshAiSetupPermission();
  }

  function openProviderEditor(showCatalog) {
    userEditing = true;
    const editorWasHidden = els.aiProviderEditor.hidden;
    setDisclosureVisibility(els.aiProviderCatalog, showCatalog, { animate: !editorWasHidden });
    setDisclosureVisibility(els.aiProviderConfiguration, !showCatalog, { animate: !editorWasHidden });
    setDisclosureVisibility(els.aiProviderEditor, true);
    syncAiSetupControls();
    const focusTarget = showCatalog
      ? (els.aiProviderCatalog.querySelector("button[aria-pressed='true']")
        || els.aiProviderPrimaryList.querySelector("button"))
      : els.apiBaseUrlInput;
    focusTarget?.focus({ preventScroll: !showCatalog });
    if (showCatalog) focusTarget?.scrollIntoView({ block: "nearest" });
  }

  function toggleMoreProviders() {
    const expanded = els.toggleMoreProviders.getAttribute("aria-expanded") !== "true";
    els.toggleMoreProviders.setAttribute("aria-expanded", String(expanded));
    setDisclosureVisibility(els.aiProviderMoreList, expanded);
    const symbol = els.toggleMoreProviders.querySelector("[aria-hidden='true']");
    if (symbol) symbol.textContent = expanded ? "−" : "＋";
  }

  function renderProviderCatalog() {
    renderProviderList(els.aiProviderPrimaryList, aiProviderPresets("primary"));
    renderProviderList(els.aiProviderMoreList, [...aiProviderPresets("more"), CUSTOM_PROVIDER]);
  }

  function renderProviderList(container, providers) {
    const fragment = document.createDocumentFragment();
    for (const provider of providers) {
      const item = document.createElement("div");
      item.className = "ai-provider-list-item";
      item.setAttribute("role", "listitem");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "ai-provider-option";
      button.dataset.providerId = provider.id;
      button.setAttribute("aria-pressed", String(provider.id === selectedProvider.id));
      const mark = document.createElement("span");
      mark.className = "ai-provider-mark";
      mark.setAttribute("aria-hidden", "true");
      renderProviderMark(mark, provider);
      const copy = document.createElement("span");
      copy.className = "ai-provider-option-copy";
      const name = document.createElement("strong");
      name.textContent = providerName(provider);
      const hint = document.createElement("small");
      hint.textContent = t(provider.hintKey);
      copy.append(name, hint);
      const check = document.createElement("span");
      check.className = "ai-provider-option-check";
      check.setAttribute("aria-hidden", "true");
      check.textContent = "✓";
      button.append(mark, copy, check);
      item.append(button);
      fragment.append(item);
    }
    container.replaceChildren(fragment);
  }

  function renderRegionOptions() {
    const regions = selectedProvider.regions || [];
    els.aiProviderRegionField.hidden = regions.length === 0;
    if (!regions.length) {
      els.aiProviderRegionSelect.replaceChildren();
      syncModelDocsLink();
      renderProviderCatalogSelection();
      return;
    }
    const selectedRegion = aiProviderRegionForUrl(selectedProvider, els.apiBaseUrlInput.value);
    const fragment = document.createDocumentFragment();
    for (const region of regions) {
      const option = document.createElement("option");
      option.value = region.id;
      option.textContent = t(region.labelKey);
      option.selected = region.id === selectedRegion;
      fragment.append(option);
    }
    els.aiProviderRegionSelect.replaceChildren(fragment);
    syncModelDocsLink();
    renderProviderCatalogSelection();
  }

  function renderProviderCatalogSelection() {
    for (const button of els.aiProviderCatalog.querySelectorAll("button[data-provider-id]")) {
      button.setAttribute("aria-pressed", String(button.dataset.providerId === selectedProvider.id));
    }
  }

  function syncProviderConfiguration() {
    const custom = selectedProvider.id === CUSTOM_PROVIDER.id;
    const busy = settingsBusy() || aiGrantPending;
    els.apiBaseUrlInput.readOnly = !custom;
    els.apiStyleSelect.disabled = busy || !custom;
    els.aiProviderRegionSelect.disabled = busy || !selectedProvider.regions?.length;
    syncModelDocsLink();
    renderProviderCatalogSelection();
  }

  function syncModelDocsLink(explicitUrl = "") {
    const url = explicitUrl || selectedProvider.modelDocs || "";
    els.aiModelDocsLink.hidden = !url;
    if (url) els.aiModelDocsLink.href = url;
    els.modelInput.placeholder = selectedProvider.modelPlaceholder || selectedProvider.model || "model-name";
  }

  function resetAiConsentForProviderChange({ force = false } = {}) {
    const savedOrigin = aiProviderOrigin(state.settings?.savedBaseUrl || state.settings?.baseUrl || "");
    const draftOrigin = aiProviderOrigin(els.apiBaseUrlInput.value);
    if (!force && (!savedOrigin || savedOrigin === draftOrigin || !els.aiDisclosureConsent.checked)) return;
    const hadConsentOrKey = els.aiDisclosureConsent.checked || Boolean(els.apiKeyInput.value);
    els.aiDisclosureConsent.checked = false;
    els.apiKeyInput.value = "";
    aiDraftPermissionGranted = false;
    aiPermissionCheckedOrigin = draftOrigin;
    if (hadConsentOrKey) renderSettingsStatus(t("settings.service.providerConsentReset"));
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
    const requiresKey = providerRequiresApiKey(els.apiBaseUrlInput.value);
    const savedOrigin = aiProviderOrigin(state.settings?.savedBaseUrl || state.settings?.baseUrl || "");
    const sameSavedOrigin = savedOrigin && savedOrigin === aiSetupState.origin;
    const credentialReady = !requiresKey
      || Boolean(String(els.apiKeyInput.value || "").trim())
      || Boolean(sameSavedOrigin && state.settings?.hasOpenAIKey);
    const modelReady = Boolean(String(els.modelInput.value || "").trim());
    const readyToTest = aiSetupState.stage === aiSetupStage.READY && credentialReady && modelReady;
    const savedIdentityMatches = sameProviderValue(els.apiBaseUrlInput.value, state.settings?.savedBaseUrl || state.settings?.baseUrl)
      && els.apiStyleSelect.value === (state.settings?.savedApiStyle || state.settings?.apiStyle)
      && String(els.modelInput.value || "").trim() === String(state.settings?.savedModel || state.settings?.model || "").trim();
    const savedCredentialReady = !requiresKey || Boolean(state.settings?.hasOpenAIKey);
    const savedConfiguration = savedIdentityMatches
      && state.settings?.aiDisclosureAccepted === true
      && savedCredentialReady
      && modelReady;
    const configured = readyToTest && savedConfiguration;
    const busy = settingsBusy() || aiGrantPending;
    const grantDisabled = aiSetupState.grantDisabled || !permissionApiAvailable;

    els.apiBaseUrlInput.disabled = aiSetupState.providerUrlDisabled;
    els.aiDisclosureConsent.disabled = aiSetupState.consentDisabled;
    els.grantAiOrigin.disabled = grantDisabled;
    els.testKey.disabled = busy || !readyToTest;
    els.clearKey.disabled = busy;
    els.editAiProvider.disabled = busy;
    els.changeAiProvider.disabled = busy;
    els.aiProviderCatalog.querySelectorAll("button").forEach((button) => { button.disabled = busy; });
    els.aiProviderFields.disabled = aiSetupState.protectedFieldsDisabled;
    els.aiProviderFields.hidden = !aiSetupState.formUnlocked;
    els.aiProviderKeyField.hidden = !requiresKey;
    els.aiProviderAccessStep.hidden = aiSetupState.stage === aiSetupStage.READY;
    els.clearKey.hidden = !(sameSavedOrigin && state.settings?.hasOpenAIKey);
    if (grantDisabled && !settingsBusy() && !aiGrantPending) {
      els.grantAiOrigin.dataset.disabledReason = "prerequisite";
    } else {
      delete els.grantAiOrigin.dataset.disabledReason;
    }

    if (uiPrepared && !userEditing) {
      const hasSavedConfiguration = Boolean(aiSetupState.origin && savedConfiguration);
      els.aiProviderEditor.hidden = configured;
      els.aiProviderCatalog.hidden = configured || hasSavedConfiguration;
      els.aiProviderConfiguration.hidden = !configured && !els.aiProviderCatalog.hidden;
    }
    syncProviderConfiguration();
    syncProviderSummary({ configured, readyToTest, credentialReady, modelReady });
    syncAccessStatus();
  }

  function syncProviderSummary({ configured, readyToTest, credentialReady, modelReady }) {
    const provider = aiProviderPresetForUrl(els.apiBaseUrlInput.value) || selectedProvider || CUSTOM_PROVIDER;
    const statusKey = configured
      ? "settings.service.providerStatusConfigured"
      : (readyToTest
        ? "settings.service.providerStatusReadyToSave"
      : (!aiSetupState.origin
        ? "settings.service.providerStatusIncomplete"
        : (!modelReady
          ? "settings.service.providerStatusMissingModel"
          : (!credentialReady
            ? "settings.service.providerStatusMissingKey"
            : "settings.service.providerStatusNeedsAuthorization"))));
    const statusState = configured ? "configured" : (readyToTest ? "ready" : (modelReady && credentialReady ? "needs-authorization" : "incomplete"));
    renderProviderMark(els.aiProviderSummaryMark, provider);
    els.aiProviderSummaryName.textContent = providerName(provider);
    els.aiProviderSummaryStatus.textContent = t(statusKey);
    els.aiProviderSummaryStatus.dataset.state = statusState;
    const origin = aiSetupState.origin || String(els.apiBaseUrlInput.value || "").trim() || "—";
    const model = String(els.modelInput.value || "").trim() || t("settings.service.modelPending");
    els.aiProviderSummaryMeta.textContent = `${origin} · ${model}`;
  }

  function renderProviderMark(mark, provider) {
    mark.replaceChildren();
    if (!provider.icon?.light || !provider.icon?.dark) {
      mark.textContent = provider.mark || "API";
      return;
    }
    if (provider.icon.light === provider.icon.dark) {
      const image = document.createElement("img");
      image.className = "ai-provider-logo";
      image.src = provider.icon.light;
      image.alt = "";
      image.draggable = false;
      mark.append(image);
      return;
    }
    for (const [theme, source] of Object.entries(provider.icon)) {
      const image = document.createElement("img");
      image.className = `ai-provider-logo ai-provider-logo-${theme}`;
      image.src = source;
      image.alt = "";
      image.draggable = false;
      mark.append(image);
    }
  }

  function syncAccessStatus() {
    const label = els.grantAiOrigin.querySelector(".btn-label");
    if (label) label.textContent = t(aiSetupState.stage === aiSetupStage.READY
      ? "settings.service.aiOriginGranted"
      : "settings.service.acceptAndGrant");
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
    els.aiFormAccessStatus.dataset.stage = aiSetupFeedback
      ? "error"
      : (aiGrantPending ? "grant-pending" : aiSetupState.stage);
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
      const granted = await containsOrigins([snapshot.originPattern]);
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
    let requested = deriveAiSetupControlState({
      providerUrl: els.apiBaseUrlInput.value,
      consentAccepted: els.aiDisclosureConsent.checked,
      permissionGranted: aiDraftPermissionGranted,
    });
    if (requested.stage === aiSetupStage.INVALID_ORIGIN) {
      focusAiSetupRequirement();
      return;
    }
    if (!globalThis.chrome?.permissions?.request) {
      renderSettingsStatus(t("api.notExtensionPage"));
      return;
    }

    els.aiDisclosureConsent.checked = true;
    requested = deriveAiSetupControlState({
      providerUrl: els.apiBaseUrlInput.value,
      consentAccepted: true,
      permissionGranted: aiDraftPermissionGranted,
    });
    if (requested.stage === aiSetupStage.READY) {
      syncAiSetupControls();
      focusProviderCredential();
      return;
    }

    aiSetupFeedback = null;
    aiGrantPending = true;
    syncAiSetupControls();
    let feedback = null;
    let permissionRequest;
    try {
      permissionRequest = requestOrigins([requested.originPattern]);
      const granted = await permissionRequest;
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
        focusProviderCredential();
      }
    }
  }

  function focusProviderCredential() {
    (providerRequiresApiKey(els.apiBaseUrlInput.value) ? els.apiKeyInput : els.modelInput)
      .focus({ preventScroll: true });
  }

  function focusAiSetupRequirement() {
    syncAiSetupControls();
    if (aiSetupState.stage === aiSetupStage.INVALID_ORIGIN) {
      els.apiBaseUrlInput.focus({ preventScroll: true });
      renderSettingsStatus(t("permission.invalidServiceUrl"));
      return;
    }
    if (aiSetupState.stage === aiSetupStage.NEEDS_CONSENT || aiSetupState.stage === aiSetupStage.NEEDS_PERMISSION) {
      els.grantAiOrigin.focus({ preventScroll: true });
    }
  }

  function providerName(provider) {
    return provider.nameKey ? t(provider.nameKey) : provider.name;
  }

  function sameProviderValue(left, right) {
    return String(left || "").trim().replace(/\/+$/, "") === String(right || "").trim().replace(/\/+$/, "");
  }
}
