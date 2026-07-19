import assert from "node:assert/strict";

const originalDescriptors = Object.fromEntries([
  "chrome",
  "CustomEvent",
  "document",
  "location",
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
  assert.throws(
    () => i18n.setLocale("en", { persist: false }),
    /Locale catalog has not been prepared: en/,
    "synchronous locale changes must not render with an unloaded catalog",
  );
  assert.deepEqual(await Promise.all([i18n.prepareLocale("en"), i18n.prepareLocale("en-US")]), ["en", "en"], "concurrent requests for one locale must share a safe result");
  assert.equal(i18n.setLocale("en", { persist: false }), "en");
  assert.equal(i18n.t("language.name"), "English");
  assert.equal(i18n.tc("unit.entries", 1), "1 entry");
  assert.equal(i18n.tc("unit.entries", 3), "3 entries");
  assert.deepEqual(i18n.allTranslations("action.openSettings"), ["Open settings", "打开设置", "開啟設定"]);
  assert.deepEqual(i18n.allTranslations("unknown.test.key"), ["unknown.test.key", "unknown.test.key", "unknown.test.key"]);

  await i18n.prepareLocale("zh-Hant");
  assert.equal(i18n.setLocale("zh-TW", { persist: false }), "zh-Hant");
  assert.equal(i18n.t("language.name"), "繁體中文");
  assert.equal(documentStub.documentElement.lang, "zh-Hant");
  assert.equal(localeEvents.at(-1)?.type, "ampira:locale-changed");
  assert.equal(localeEvents.at(-1)?.detail?.locale, "zh-Hant");

  const popupI18n = await import(`../../assets/client/popup-i18n.mjs?client-i18n-test=${Date.now()}`);
  popupI18n.setLocale("en-US");
  assert.equal(popupI18n.t("action.popup.loadingTitle"), "Saving");
  popupI18n.setLocale("zh-HK");
  assert.equal(popupI18n.t("action.popup.loadingTitle"), "正在儲存");
  assert.equal(popupI18n.t("unknown.popup.key"), "unknown.popup.key");
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
