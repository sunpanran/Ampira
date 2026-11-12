import assert from "node:assert/strict";
import { createSourceSettingsController } from "../../assets/client/source-settings-controller.mjs";

const descriptors = Object.fromEntries(["document", "Option"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
try {
  Object.defineProperty(globalThis, "document", { configurable: true, value: { createElement: element } });
  Object.defineProperty(globalThis, "Option", { configurable: true, value: function Option(text, value) { return { textContent: text, value }; } });
  for (const initiallyPopulated of [false, true]) {
    const state = { settings: { excludedNewsSources: initiallyPopulated ? [{ id: "saved", value: "saved.example" }] : [] } };
    const els = {
      exclusionDetails: { open: false }, exclusionStatus: element(), exclusionList: element(),
      excludeFolderSelect: element(), addExcludeFolder: element(), excludeInput: { value: "" },
      clearSourceSuggestions: element(), blockAllSuggestions: element(),
      sourceSuggestionList: element(), sourceSuggestionStatus: element(),
    };
    const controller = createSourceSettingsController({
      state, els, t: key => key, tc: (key, count) => `${key}:${count}`,
      setIconLabel: (node, icon, text) => { node.textContent = text; },
      createEmptyState: element, renderSettingsStatus() {},
      localizedSourceLabel: value => value, localizedSourceReason: value => value,
      localizedExclusionReason: () => "reason", newsSectionName: () => "News",
      normalizeUrl: value => value, confirmAction: async () => true,
    });
    controller.renderExclusionList();
    assert.equal(els.exclusionDetails.open, initiallyPopulated, "initial content keeps the existing default expansion");
    for (const userOpen of [true, false]) {
      els.exclusionDetails.open = userOpen;
      controller.renderExclusionList();
      state.settings.excludedNewsSources = [];
      controller.renderExclusionList();
      state.settings.excludedNewsSources = [{ id: "refreshed", value: "refreshed.example" }];
      controller.renderExclusionList();
      assert.equal(els.exclusionDetails.open, userOpen, "refresh and empty/populated changes must preserve the user's disclosure state");
    }
    els.exclusionDetails.open = false;
    els.excludeInput.value = "added.example";
    controller.addNewsExclusion();
    assert.equal(els.exclusionDetails.open, true, "explicitly adding a source reveals its result");
    els.exclusionDetails.open = false;
    els.excludeFolderSelect.selectedOptions = [{ value: "News/Folder", dataset: { section: "News", category: "Folder", folderPath: "Folder" } }];
    controller.addNewsFolderExclusion();
    assert.equal(els.exclusionDetails.open, true, "adding a folder reveals its result");
    state.settings.sourceQuality = { checked: 1, suggestions: [{ host: "suggestion.example", action: "block" }] };
    controller.renderSourceSuggestionList();
    els.exclusionDetails.open = false;
    els.sourceSuggestionList.children[0].children[1].listeners.click();
    assert.equal(els.exclusionDetails.open, true, "blocking a suggestion reveals its result");
    state.settings.sourceQuality.suggestions = [{ host: "bulk.example", action: "block" }];
    els.exclusionDetails.open = false;
    await controller.blockAllSourceSuggestions();
    assert.equal(els.exclusionDetails.open, true, "bulk blocking reveals its result");
    state.settings.excludedNewsSources = [{ id: "last", value: "last.example" }];
    controller.renderExclusionList();
    els.exclusionList.children[0].children[1].listeners.click();
    assert.equal(state.settings.excludedNewsSources.length, 0);
    assert.equal(els.exclusionDetails.open, true, "removing the last rule keeps the empty state in place");
  }
} finally {
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  }
}

console.log("settings disclosure state tests passed");

function element() {
  return {
    children: [], listeners: {}, dataset: {},
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; },
    addEventListener(type, listener) { this.listeners[type] = listener; },
  };
}
