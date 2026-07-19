import messages from "./locales/popup.mjs";
import {
  DEFAULT_LOCALE,
  detectSupportedLocale,
  normalizeLocale,
} from "../../extension/core/locale.mjs";

let currentLocale = detectInitialLocale();

export function getLocale() {
  return currentLocale;
}

export function setLocale(value) {
  currentLocale = normalizeLocale(value);
  document.documentElement.lang = currentLocale;
  document.documentElement.dataset.locale = currentLocale;
  return currentLocale;
}

export function t(key) {
  return messages[currentLocale]?.[key] ?? messages[DEFAULT_LOCALE]?.[key] ?? key;
}

function detectInitialLocale() {
  const chromeLocale = globalThis.chrome?.i18n?.getUILanguage?.();
  const browserLocales = globalThis.navigator?.languages || [globalThis.navigator?.language];
  return detectSupportedLocale([chromeLocale, ...browserLocales], DEFAULT_LOCALE);
}
