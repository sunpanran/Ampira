import en from "./runtime-locales/en.mjs";
import zhCN from "./runtime-locales/zh-CN.mjs";
import zhHant from "./runtime-locales/zh-Hant.mjs";
import {
  DEFAULT_LOCALE,
  normalizeLocale,
} from "./locale.mjs";

export {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  detectSupportedLocale,
  formatDateTimeForLocale,
  formatListForLocale,
  formatNumberForLocale,
  normalizeLocale,
} from "./locale.mjs";

const messages = Object.freeze({ en, "zh-CN": zhCN, "zh-Hant": zhHant });

export function translate(locale, key, params = {}) {
  const normalized = normalizeLocale(locale);
  const value = messages[normalized]?.[key] ?? messages[DEFAULT_LOCALE]?.[key] ?? key;
  return interpolate(value, params);
}

export function translateAiPrompt(locale, key, params = {}) {
  const normalized = normalizeLocale(locale);
  return `AMPIRA_OUTPUT_LOCALE=${normalized}\n\n${translate(normalized, key, params)}\n\n${translate(normalized, "background.prompt.outputLanguage")}`;
}

export function defaultBookmarkFoldersForLocale(locale) {
  return {
    news: translate(locale, "bookmarkFolder.defaultNews"),
    inspiration: translate(locale, "bookmarkFolder.defaultInspiration"),
  };
}

export function runtimeLocaleMessages(locale) {
  return messages[normalizeLocale(locale)];
}

function interpolate(value, params) {
  return String(value).replace(/\{(\w+)\}/g, (match, name) => (
    Object.hasOwn(params, name) ? String(params[name]) : match
  ));
}
