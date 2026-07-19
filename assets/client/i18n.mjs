import { readValue, writeValue } from "./storage.mjs";
import allTranslationMessages from "./locales/all-translations.mjs";
import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  detectSupportedLocale,
  formatDateTimeForLocale,
  normalizeLocale,
} from "../../extension/core/locale.mjs";

export { DEFAULT_LOCALE, SUPPORTED_LOCALES, normalizeLocale };
export const LOCALE_STORAGE_KEY = "dash.uiLocale";

const localeLoaders = Object.freeze({
  en: () => import("./locales/en.mjs"),
  "zh-CN": () => import("./locales/zh-CN.mjs"),
  "zh-Hant": () => import("./locales/zh-Hant.mjs"),
});
const localeCatalogs = new Map();
const localeLoads = new Map();
let currentLocale = detectInitialLocale();
await prepareLocale(currentLocale);

export function getLocale() {
  return currentLocale;
}

export async function prepareLocale(value) {
  const locale = normalizeLocale(value);
  if (localeCatalogs.has(locale)) return locale;
  let pending = localeLoads.get(locale);
  if (!pending) {
    pending = localeLoaders[locale]().then((module) => {
      localeCatalogs.set(locale, module.default);
      localeLoads.delete(locale);
      return locale;
    }).catch((error) => {
      localeLoads.delete(locale);
      throw error;
    });
    localeLoads.set(locale, pending);
  }
  return pending;
}

export function setLocale(value, { persist = true, translate = true } = {}) {
  const previous = currentLocale;
  const locale = normalizeLocale(value);
  if (!localeCatalogs.has(locale)) {
    throw new Error(`Locale catalog has not been prepared: ${locale}`);
  }
  currentLocale = locale;
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
  const value = currentMessages()[key] ?? key;
  return interpolate(value, params);
}

export function tc(key, count, params = {}) {
  const rule = new Intl.PluralRules(currentLocale).select(Number(count) || 0);
  const messages = currentMessages();
  const candidates = [`${key}.${rule}`, `${key}.other`, key];
  const selected = candidates.find((candidate) => Object.hasOwn(messages, candidate)) || key;
  return t(selected, { ...params, count });
}

export function allTranslations(key, params = {}) {
  const values = allTranslationMessages[key];
  if (!Array.isArray(values)) return SUPPORTED_LOCALES.map(() => t(key, params));
  return values.map((value) => interpolate(value, params));
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

function currentMessages() {
  return localeCatalogs.get(currentLocale) || {};
}

function interpolate(value, params) {
  return String(value).replace(/\{(\w+)\}/g, (match, name) => (
    Object.hasOwn(params, name) ? String(params[name]) : match
  ));
}
