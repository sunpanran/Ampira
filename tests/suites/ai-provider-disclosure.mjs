import assert from "node:assert/strict";
import { createAiPermissionController } from "../../assets/client/ai-permission-controller.mjs";
import { AI_SETUP_STAGE, aiProviderOrigin, deriveAiSetupControlState } from "../../assets/client/ai-settings-policy.mjs";

const descriptors = Object.fromEntries(["document", "chrome"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
try {
  for (const configured of [false, true]) {
    const document = Object.assign(element("document"), {
      hidden: true, activeElement: null,
      createElement: element,
      createDocumentFragment: () => element("fragment"),
    });
    let permissionGranted = configured;
    Object.defineProperty(globalThis, "document", { configurable: true, value: document });
    Object.defineProperty(globalThis, "chrome", { configurable: true, value: { permissions: {
      contains: async () => permissionGranted,
      request: async () => true,
    } } });
    const nodes = new Map();
    const els = new Proxy({}, { get: (_, key) => {
      if (!nodes.has(key)) nodes.set(key, element("div"));
      return nodes.get(key);
    } });
    els.aiProviderCatalog.append(els.aiProviderPrimaryList, els.aiProviderOtherList);
    els.aiProviderEditor.hidden = true;
    els.aiProviderCatalog.hidden = true;
    els.aiProviderConfiguration.hidden = true;
    const state = { settings: {
      baseUrl: configured ? "https://api.openai.com/v1" : "",
      apiStyle: "responses", model: "saved-model",
      aiDisclosureAccepted: configured, hasOpenAIKey: configured,
    } };
    els.apiBaseUrlInput.value = state.settings.baseUrl;
    els.apiStyleSelect.value = state.settings.apiStyle;
    els.modelInput.value = state.settings.model;
    els.aiDisclosureConsent.checked = configured;
    const controller = createAiPermissionController({
      state, els, t: (key) => key, aiProviderOrigin, deriveAiSetupControlState,
      aiSetupStage: AI_SETUP_STAGE, settingsBusy: () => false, renderSettingsStatus() {},
    });
    controller.initializeAiProviderUi();
    assert.deepEqual(els.aiProviderPrimaryList.querySelectorAll("button[data-provider-id]").map((button) => button.dataset.providerId),
      ["openai", "gemini", "deepseek", "grok", "kimi", "qwen", "openrouter"]);
    assert.deepEqual(els.aiProviderOtherList.querySelectorAll("button[data-provider-id]").map((button) => button.dataset.providerId),
      ["ollama", "custom"]);
    controller.prepareAiProviderUi();
    assert.equal(els.aiProviderConfiguration.dataset.custom, String(!configured));
    assert.equal(els.aiProviderApiStyleControl.hidden, configured);
    assert.equal(els.aiProviderApiStyleValue.hidden, !configured);
    assert.equal(els.aiProviderBaseUrlHelp.hidden, configured);
    assert.equal(els.aiProviderApiStyleHelp.hidden, configured);
    assert.equal(els.aiProviderApiStyleValue.textContent, "Responses");
    await controller.refreshAiSetupPermission();
    assertClosed("initial setup and permission hydration must leave both panels collapsed");

    for (const [trigger, panel, close] of [
      [els.editAiProvider, els.aiProviderConfiguration, els.closeAiProviderConfiguration],
      [els.changeAiProvider, els.aiProviderCatalog, els.closeAiProviderCatalog],
    ]) {
      trigger.click();
      assert.equal(els.aiProviderEditor.hidden, false);
      assert.equal(panel.hidden, false);
      assert.equal(trigger.getAttribute("aria-expanded"), "true");
      trigger.click();
      assertClosed("a second click must close the active panel");
      assert.equal(document.activeElement, trigger);
      trigger.click();
      close.click();
      assertClosed("each panel close button must collapse the whole editor");
      assert.equal(document.activeElement, trigger, "closing must restore focus to a visible trigger");
    }

    els.editAiProvider.click();
    els.modelInput.value = "unsaved-model";
    els.apiKeyInput.value = "synthetic-draft-key";
    els.changeAiProvider.click();
    assert.equal(els.aiProviderConfiguration.hidden, true);
    assert.equal(els.aiProviderCatalog.hidden, false);
    assert.equal(els.editAiProvider.getAttribute("aria-expanded"), "false");
    els.editAiProvider.click();
    assert.equal(els.aiProviderCatalog.hidden, true);
    els.editAiProvider.click();
    permissionGranted = false;
    await controller.refreshAiSetupPermission();
    document.dispatch("ampira:locale-changed");
    assertClosed("permission and locale refreshes must not reopen a closed editor");
    els.editAiProvider.click();
    assert.equal(els.modelInput.value, "unsaved-model");
    assert.equal(els.apiKeyInput.value, "synthetic-draft-key", "collapse and switching views must preserve the draft");

    els.changeAiProvider.click();
    const selected = els.aiProviderPrimaryList.querySelector("button[data-provider-id]");
    els.aiProviderPrimaryList.dispatch("click", { target: selected });
    await controller.refreshAiSetupPermission();
    assert.equal(els.aiProviderCatalog.hidden, true);
    assert.equal(els.aiProviderConfiguration.hidden, false, "selecting a provider must show its configuration");
    assert.equal(els.editAiProvider.getAttribute("aria-expanded"), "true");
    assert.equal(els.changeAiProvider.getAttribute("aria-expanded"), "false");
    els.editAiProvider.click();
    assertClosed("the selected provider configuration must remain collapsible");

    controller.focusAiSetupRequirement();
    assert.equal(els.aiProviderEditor.hidden, false, "explicit validation must reveal the field that needs attention");
    assert.equal(els.aiProviderConfiguration.hidden, false);
    controller.prepareAiProviderUi();
    assertClosed("a fresh settings session must reset the disclosure state");

    for (const [index, id] of ["ollama", "custom"].entries()) {
      els.changeAiProvider.click();
      const other = els.aiProviderOtherList.querySelectorAll("button[data-provider-id]")[index];
      els.aiProviderOtherList.dispatch("click", { target: other });
      assert.equal(els.aiProviderConfiguration.hidden, false, `${id} must open configuration from the bottom group`);
      assert.equal(els.apiBaseUrlInput.value, id === "ollama" ? "http://localhost:11434/v1" : "");
      assert.equal(els.apiBaseUrlInput.readOnly, id !== "custom");
      assert.equal(els.aiProviderApiStyleControl.hidden, id !== "custom");
      assert.equal(els.aiProviderApiStyleValue.hidden, id === "custom");
      assert.equal(els.aiProviderBaseUrlHelp.hidden, id !== "custom");
      assert.equal(els.aiProviderApiStyleHelp.hidden, id !== "custom");
      assert.equal(els.aiProviderApiStyleValue.textContent, "settings.service.chatCompletions");
      assert.equal(other.getAttribute("aria-pressed"), "true");
      els.closeAiProviderConfiguration.click();
    }

    els.apiBaseUrlInput.value = "https://api.siliconflow.cn/v1";
    els.apiStyleSelect.value = "chat_completions";
    els.modelInput.value = "saved-provider-model";
    els.apiKeyInput.value = "synthetic-unsaved-key";
    controller.prepareAiProviderUi();
    els.editAiProvider.click();
    assert.equal(els.apiBaseUrlInput.value, "https://api.siliconflow.cn/v1");
    assert.equal(els.modelInput.value, "saved-provider-model");
    assert.equal(els.apiKeyInput.value, "synthetic-unsaved-key");
    assert.equal(els.apiBaseUrlInput.readOnly, false, "removed presets must reopen as editable custom configurations");
    assert.equal(els.aiProviderApiStyleControl.hidden, false);
    assert.equal(els.aiProviderApiStyleValue.hidden, true);
    assert.equal(els.apiBaseUrlInput.getAttribute("aria-describedby"), "aiProviderBaseUrlHelp");

    function assertClosed(message) {
      assert.equal(els.aiProviderEditor.hidden, true, message);
      assert.equal(els.editAiProvider.getAttribute("aria-expanded"), "false");
      assert.equal(els.changeAiProvider.getAttribute("aria-expanded"), "false");
    }
  }
} finally {
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  }
}

console.log("AI provider disclosure tests passed");

function element(tagName) {
  const attributes = new Map();
  const events = new Map();
  return {
    tagName, hidden: false, disabled: false, checked: false, value: "", dataset: {}, children: [],
    style: { setProperty() {}, removeProperty() {} },
    setAttribute: (name, value) => attributes.set(name, String(value)),
    getAttribute: (name) => attributes.get(name) ?? null,
    removeAttribute: (name) => attributes.delete(name),
    addEventListener: (type, handler) => events.set(type, handler),
    dispatch(type, event = {}) { events.get(type)?.(event); },
    click() { this.dispatch("click", { target: this }); },
    focus() { globalThis.document.activeElement = this; },
    scrollIntoView() {},
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; },
    contains(target) { return this === target || this.children.some((child) => child.contains(target)); },
    closest() { return this; },
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
    querySelectorAll(selector) {
      return this.children.flatMap((child) => {
        const matches = child.tagName === "button" && selector.startsWith("button")
          && (!selector.includes("data-provider-id") || child.dataset.providerId)
          && (!selector.includes("aria-pressed") || child.getAttribute("aria-pressed") === "true");
        return [...(matches ? [child] : []), ...child.querySelectorAll(selector)];
      });
    },
  };
}
