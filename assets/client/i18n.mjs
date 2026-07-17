import { readValue, writeValue } from "./storage.mjs";
import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  detectSupportedLocale,
  formatDateTimeForLocale,
  normalizeLocale,
  translate,
  translateCount,
  translationsFor,
} from "../../extension/core/i18n.mjs";

export { DEFAULT_LOCALE, SUPPORTED_LOCALES, normalizeLocale };
export const LOCALE_STORAGE_KEY = "dash.uiLocale";

let currentLocale = detectInitialLocale();

export function getLocale() {
  return currentLocale;
}

export function setLocale(value, { persist = true, translate = true } = {}) {
  const previous = currentLocale;
  currentLocale = normalizeLocale(value);
  document.documentElement.lang = currentLocale;
  document.documentElement.dataset.locale = currentLocale;
  if (persist) writeStoredLocale(currentLocale);
  if (translate) translateDocument(document);
  if (previous !== currentLocale) {
    document.dispatchEvent(new CustomEvent("ampira:locale-changed", { detail: { locale: currentLocale } }));
  }
  return currentLocale;
}

export function t(key, params = {}) {
  return translate(currentLocale, key, params);
}

export function tc(key, count, params = {}) {
  return translateCount(currentLocale, key, count, params);
}

export function allTranslations(key, params = {}) {
  return translationsFor(key, params);
}

export function translateDocument(root = document) {
  for (const node of root.querySelectorAll("[data-i18n]")) node.textContent = t(node.dataset.i18n);
  translateAttributes(root, "data-i18n-aria-label", "aria-label");
  translateAttributes(root, "data-i18n-title", "title");
  translateAttributes(root, "data-i18n-placeholder", "placeholder");
}

export function formatLocaleDateTime(value = new Date(), options = {}) {
  return formatDateTimeForLocale(currentLocale, value, options);
}

function translateAttributes(root, dataAttribute, attribute) {
  for (const node of root.querySelectorAll(`[${dataAttribute}]`)) {
    const key = node.getAttribute(dataAttribute);
    if (key) node.setAttribute(attribute, t(key));
  }
}

function detectInitialLocale() {
  const stored = readStoredLocale();
  if (stored) return normalizeLocale(stored);
  const chromeLocale = globalThis.chrome?.i18n?.getUILanguage?.();
  const browserLocales = globalThis.navigator?.languages || [globalThis.navigator?.language];
  return detectSupportedLocale([chromeLocale, ...browserLocales], DEFAULT_LOCALE);
}

function readStoredLocale() {
  return readValue(LOCALE_STORAGE_KEY) || "";
}

function writeStoredLocale(locale) {
  writeValue(LOCALE_STORAGE_KEY, locale);
}
