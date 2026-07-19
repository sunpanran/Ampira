import en from "../../assets/client/locales/en.mjs";
import zhCN from "../../assets/client/locales/zh-CN.mjs";
import zhHant from "../../assets/client/locales/zh-Hant.mjs";
import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  normalizeLocale,
} from "../../extension/core/locale.mjs";

export {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  detectSupportedLocale,
  formatDateTimeForLocale,
  formatListForLocale,
  formatNumberForLocale,
  normalizeLocale,
} from "../../extension/core/locale.mjs";

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

export function translateCount(locale, key, count, params = {}) {
  const normalized = normalizeLocale(locale);
  const rule = new Intl.PluralRules(normalized).select(Number(count) || 0);
  const candidates = [`${key}.${rule}`, `${key}.other`, key];
  const selected = candidates.find((candidate) => (
    Object.hasOwn(messages[normalized] || {}, candidate)
    || Object.hasOwn(messages[DEFAULT_LOCALE] || {}, candidate)
  ));
  return translate(normalized, selected || key, { ...params, count });
}

export function defaultBookmarkFoldersForLocale(locale) {
  return {
    news: translate(locale, "bookmarkFolder.defaultNews"),
    inspiration: translate(locale, "bookmarkFolder.defaultInspiration"),
  };
}

export function localeMessages(locale) {
  return messages[normalizeLocale(locale)];
}

function interpolate(value, params) {
  return String(value).replace(/\{(\w+)\}/g, (match, name) => (
    Object.hasOwn(params, name) ? String(params[name]) : match
  ));
}
