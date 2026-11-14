import assert from "node:assert/strict";
import { createStatusView } from "../../assets/client/status-view.mjs";
import { createHeaderCoverController } from "../../assets/client/header-cover-controller.mjs";
import { createSettingsFeedback } from "../../assets/client/settings-feedback.mjs";

const originalDescriptors = Object.fromEntries([
  "chrome",
  "CustomEvent",
  "document",
  "location",
  "localStorage",
  "navigator",
].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
const localeEvents = [];
const documentStub = {
  documentElement: { dataset: {}, lang: "" },
  addEventListener() {},
  dispatchEvent(event) { localeEvents.push(event); },
  querySelectorAll() { return []; },
};

try {
  defineGlobal("chrome", { i18n: { getUILanguage: () => "zh-CN" } });
  defineGlobal("CustomEvent", class {
    constructor(type, options = {}) {
      this.type = type;
      this.detail = options.detail;
    }
  });
  defineGlobal("document", documentStub);
  defineGlobal("location", { protocol: "file:" });
  defineGlobal("navigator", { language: "zh-CN", languages: ["zh-CN", "en"] });

  const i18n = await import(`../../assets/client/i18n.mjs?client-i18n-test=${Date.now()}`);
  assert.equal(i18n.getLocale(), "zh-CN", "the initial browser locale must be prepared before the module resolves");
  assert.equal(i18n.t("language.name"), "简体中文");
  assert.equal(i18n.t("action.cancel"), "取消", "note deletion must not expose an untranslated cancel key");
  assert.equal(i18n.t("aiSearch.userMessage", { number: 2 }), "你的第 2 条消息");
  assert.equal(i18n.t("aiSearch.assistantMessage"), "Ampira 回答");
  assert.throws(
    () => i18n.setLocale("en", { persist: false }),
    /Locale catalog has not been prepared: en/,
    "synchronous locale changes must not render with an unloaded catalog",
  );
  assert.deepEqual(await Promise.all([i18n.prepareLocale("en"), i18n.prepareLocale("en-US")]), ["en", "en"], "concurrent requests for one locale must share a safe result");
  assert.equal(i18n.setLocale("en", { persist: false }), "en");
  assert.equal(i18n.t("language.name"), "English");
  assert.equal(i18n.t("action.cancel"), "Cancel");
  assert.equal(i18n.t("aiSearch.userMessage", { number: 2 }), "Your message 2");
  assert.equal(i18n.t("aiSearch.assistantMessage"), "Ampira response");
  assert.equal(i18n.tc("unit.entries", 1), "1 entry");
  assert.equal(i18n.tc("unit.entries", 3), "3 entries");
  assert.deepEqual(i18n.allTranslations("action.openSettings"), ["Open settings", "打开设置", "開啟設定"]);
  assert.deepEqual(i18n.allTranslations("unknown.test.key"), ["unknown.test.key", "unknown.test.key", "unknown.test.key"]);

  await i18n.prepareLocale("zh-Hant");
  assert.equal(i18n.setLocale("zh-TW", { persist: false }), "zh-Hant");
  assert.equal(i18n.t("language.name"), "繁體中文");
  assert.equal(i18n.t("action.cancel"), "取消");
  assert.equal(i18n.t("aiSearch.userMessage", { number: 2 }), "你的第 2 則訊息");
  assert.equal(i18n.t("aiSearch.assistantMessage"), "Ampira 回答");
  assert.equal(documentStub.documentElement.lang, "zh-Hant");
  assert.equal(localeEvents.at(-1)?.type, "ampira:locale-changed");
  assert.equal(localeEvents.at(-1)?.detail?.locale, "zh-Hant");

  const statusNodes = ["connection.unavailable", "status.noRecord"].map(key => ({
    dataset: { i18n: key }, textContent: "",
    removeAttribute(name) { if (name === "data-i18n") delete this.dataset.i18n; },
  }));
  const statusView = createStatusView({
    els: { settingsOverviewTitle: statusNodes[0], settingsOverviewMeta: statusNodes[1] }, t: i18n.t,
  });
  const statusRoot = {
    querySelectorAll: selector => selector === "[data-i18n]" ? statusNodes.filter(node => node.dataset.i18n) : [],
  };
  for (const locale of ["zh-CN", "zh-Hant", "en"]) {
    i18n.setLocale(locale, { persist: false });
    for (const key of ["connection.backgroundPaused", "connection.recoveringTitle"]) {
      statusView.renderOverviewStatus(i18n.t("connection.unavailable"), i18n.t(key));
      i18n.translateDocument(statusRoot);
      assert.equal(statusNodes[1].textContent, i18n.t(key), "translating settings must preserve the current AI readiness instead of restoring the unconfigured hint");
    }
    statusView.renderOverviewStatus(i18n.t("status.waitingUpdate"), i18n.t("status.noRecord"));
    i18n.translateDocument(statusRoot);
    assert.equal(statusNodes[0].textContent, i18n.t("status.waitingUpdate"), "translation must preserve the runtime loading title");
    statusView.renderOverviewStatus();
    i18n.translateDocument(statusRoot);
    assert.equal(statusNodes[0].textContent, "", "translation must not restore a cleared overview title");
    assert.equal(statusNodes[0].hidden, true);
    assert.equal(statusNodes[1].hidden, true);
  }

  const coverElements = Object.fromEntries([
    "headerImageLocalChooseLabel", "headerImageLocalStatus", "headerImageLocalMeta",
    "headerImageLocalRemove", "headerImageLocalInput", "headerImageLocalChoose", "settingsStatus",
  ].map(id => [id, {
    dataset: {}, textContent: "", removeAttribute(name) { if (name === "data-i18n") delete this.dataset.i18n; },
  }]));
  coverElements.headerImageLocalChooseLabel.dataset.i18n = "settings.headerImage.localChoose";
  coverElements.settingsStatus.dataset.i18n = "settings.status.loading";
  const coverRoot = { querySelectorAll: selector => selector === "[data-i18n]"
    ? Object.values(coverElements).filter(node => node.dataset.i18n) : [] };
  let coverRecord = null;
  const coverHero = { dataset: {} };
  const cover = createHeaderCoverController({
    state: {}, els: coverElements, t: i18n.t, hero: coverHero,
    request: async () => ({ record: coverRecord, available: Boolean(coverRecord) }),
  });
  let dirtyDraft = false;
  const feedback = createSettingsFeedback({
    els: { ...coverElements, settingsForm: {}, settingsModal: { classList: { toggle() {} } } },
    t: i18n.t, isBusy: () => false, hasUnsavedChanges: () => dirtyDraft,
  });
  for (const locale of ["zh-CN", "zh-Hant", "en"]) {
    i18n.setLocale(locale, { persist: false });
    feedback.renderSettingsStatus();
    assert.equal(coverElements.settingsStatus.textContent, "", "an unchanged form must not claim unsaved changes");
    dirtyDraft = true;
    feedback.renderSettingsStatus();
    assert.equal(coverElements.settingsStatus.dataset.state, "pending");
    assert.equal(coverElements.settingsStatus.textContent, i18n.t("settings.status.unsaved"));
    dirtyDraft = false;
    feedback.syncSettingsFooter();
    assert.equal(coverElements.settingsStatus.dataset.state, "ready", "reverting a draft clears the pending notice");
    feedback.renderSettingsStatus(i18n.t("error.requestFailed"), "error");
    feedback.syncSettingsFooter();
    assert.equal(coverElements.settingsStatus.dataset.state, "error", "a clean draft must not erase operation errors");
    for (const record of [
      { name: "synthetic.webp", width: 640, height: 360, byteLength: 1024 },
      { videoId: "synthetic-video", name: "synthetic.mp4", width: 640, height: 360, byteLength: 2048 },
      null,
    ]) {
      coverRecord = record;
      await cover.load();
      feedback.renderSettingsStatus(i18n.t("settings.status.saved"));
      i18n.translateDocument(coverRoot);
      assert.equal(coverElements.headerImageLocalStatus.textContent, "", "deferred translation must not recreate redundant cover status text");
      assert.equal(coverElements.headerImageLocalStatus.hidden, true);
      assert.equal(coverElements.headerImageLocalMeta.hidden, !record, "local file identity stays available without a repeated status caption");
      assert.equal(coverElements.headerImageLocalChooseLabel.textContent, i18n.t(record ? "settings.headerImage.localReplace" : "settings.headerImage.localChoose"));
      assert.equal(coverElements.settingsStatus.textContent, i18n.t("settings.status.saved"), "translation must not restore the loading hint after settings have saved");
    }
    for (const [phase, key] of [["loading", "videoLoading"], ["ready", ""], ["error", "videoFailed"], ["ready", ""]]) {
      coverHero.dataset.headerVideoState = phase;
      cover.syncControls();
      i18n.translateDocument(coverRoot);
      assert.equal(coverElements.headerImageLocalStatus.textContent, key ? i18n.t(`settings.headerImage.${key}`) : "");
      assert.equal(coverElements.headerImageLocalStatus.hidden, !key, "cover feedback remains visible only while loading or on failure");
    }
  }

  const popupI18n = await import(`../../assets/client/popup-i18n.mjs?client-i18n-test=${Date.now()}`);
  popupI18n.setLocale("en-US");
  assert.equal(popupI18n.t("action.popup.loadingTitle"), "Saving");
  popupI18n.setLocale("zh-HK");
  assert.equal(popupI18n.t("action.popup.loadingTitle"), "正在儲存");
  assert.equal(popupI18n.t("unknown.popup.key"), "unknown.popup.key");

  const hints = new Map([["dash.uiLocale", "en"]]);
  defineGlobal("localStorage", { getItem: key => hints.get(key) || null, setItem: (key, value) => hints.set(key, value) });
  const hintedI18n = await import(`../../assets/client/i18n.mjs?locale-hint-test=${Date.now()}`);
  assert.equal(hintedI18n.getLocale(), "en", "a saved locale hint must win over the browser language before hydration");
  assert.equal(hintedI18n.t("language.name"), "English");
  await hintedI18n.prepareLocale("zh-Hant");
  hintedI18n.setLocale("zh-Hant", { persist: false });
  assert.equal(hints.get("dash.uiLocale"), "en", "unsaved language previews must not change the startup hint");
  hintedI18n.setLocale("zh-Hant");
  assert.equal(hints.get("dash.uiLocale"), "zh-Hant", "saved language changes must update the next tab's hint");
  const { writeValue } = await import("../../assets/client/storage.mjs");
  writeValue("dash.uiLocale", "");
  defineGlobal("localStorage", { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } });
  const blockedI18n = await import(`../../assets/client/i18n.mjs?locale-hint-blocked-test=${Date.now()}`);
  assert.equal(blockedI18n.getLocale(), "zh-CN", "blocked hint storage must fall back to the browser language");
} finally {
  for (const [key, descriptor] of Object.entries(originalDescriptors)) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  }
}

console.log("client i18n tests passed");

function defineGlobal(key, value) {
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value,
    writable: true,
  });
}
