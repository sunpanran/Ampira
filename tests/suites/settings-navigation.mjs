import assert from "node:assert/strict";
import { createSettingsController } from "../../assets/client/settings-controller.mjs";
import zhCN from "../../assets/client/locales/zh-CN.mjs";
import zhHant from "../../assets/client/locales/zh-Hant.mjs";
import en from "../../assets/client/locales/en.mjs";

const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
try {
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    requestAnimationFrame: callback => callback(),
    matchMedia: () => ({ matches: true }),
    getComputedStyle: () => ({ transform: "none" }),
  } });
  const titleKeys = {
    bookmarks: "settings.bookmarks.title", service: "settings.service.title",
    cache: "settings.cache.title", exclusions: "settings.exclusions.title",
    appearance: "settings.appearance.title", browser: "settings.browser.title",
    bot: "bot.settingsTab", about: "settings.about.title",
  };
  const panels = Object.entries(titleKeys).map(([tab, titleKey]) => ({
    dataset: { settingsPanel: tab }, classList: classes(tab === "bookmarks" ? ["active"] : []),
    querySelector: () => ({ dataset: { i18n: titleKey } }),
  }));
  const buttons = panels.map((panel, index) => ({
    dataset: { settingsTab: panel.dataset.settingsPanel }, classList: classes(),
    offsetLeft: 12, offsetTop: index * 45, offsetWidth: 152, offsetHeight: 42,
  }));
  const els = {
    settingsForm: { scrollTop: 0, querySelectorAll: () => panels, querySelector: () => panels.find(panel => panel.dataset.settingsPanel === "bot") },
    settingsTabs: { querySelectorAll: () => buttons, classList: classes(), style: { setProperty() {} } },
    settingsModal: { dataset: {}, classList: classes() },
    settingsPanelTitle: { dataset: {}, textContent: "" },
    settingsStatus: { dataset: { state: "ready" } },
  };
  let messages = zhCN;
  let revealed = 0;
  const indicatorUpdates = [];
  const controller = createSettingsController({
    els, state: {}, getLocale: () => "zh-CN", t: key => messages[key],
    revealActiveSettingsTab: () => { revealed += 1; },
    syncSegmentedIndicator: (control, button, options) => indicatorUpdates.push(options),
  });

  controller.selectSettingsTab("service");
  els.settingsForm.scrollTop = 180;
  controller.selectSettingsTab("bookmarks");
  els.settingsForm.scrollTop = 60;
  controller.selectSettingsTab("service");
  assert.equal(els.settingsForm.scrollTop, 180, "switching tabs restores the independent content scroll position");
  controller.selectSettingsTab("bookmarks");
  assert.equal(els.settingsForm.scrollTop, 60);

  for (const catalog of [zhCN, zhHant, en]) {
    messages = catalog;
    for (const [tab, titleKey] of Object.entries(titleKeys)) {
      controller.selectSettingsTab(tab);
      assert.equal(els.settingsPanelTitle.textContent, catalog[titleKey], "the fixed header follows the selected page in the active language");
      assert.equal(els.settingsPanelTitle.dataset.i18n, titleKey, "language preview can translate the current header without changing tabs");
      assert.equal(els.settingsModal.dataset.settingsTab, tab);
      assert.equal(panels.filter(panel => panel.classList.contains("active")).length, 1);
      assert.equal(buttons.filter(button => button.classList.contains("active")).length, 1);
      assert.equal(els.settingsModal.classList.contains("is-immediate-settings"), tab === "bot", "MCP keeps its immediate-save footer behavior");
    }
  }
  assert.equal(indicatorUpdates.length, 12, "each appearance page entry positions all four segmented controls");
  assert(indicatorUpdates.every(options => options.animate === false), "revealing appearance settings must not animate saved values from previous positions");
  const previousTitle = els.settingsPanelTitle.textContent;
  const previousRevealed = revealed;
  controller.selectSettingsTab("unknown");
  assert.equal(els.settingsPanelTitle.textContent, previousTitle);
  assert.equal(els.settingsModal.dataset.settingsTab, "about");
  assert.equal(revealed, previousRevealed, "invalid tabs leave the visible header and navigation intact");
} finally {
  if (windowDescriptor) Object.defineProperty(globalThis, "window", windowDescriptor);
  else delete globalThis.window;
}

function classes(initial = []) {
  const values = new Set(initial);
  return {
    contains: value => values.has(value),
    toggle(value, active) { if (active) values.add(value); else values.delete(value); },
    remove: value => values.delete(value),
  };
}

console.log("settings navigation tests passed");
