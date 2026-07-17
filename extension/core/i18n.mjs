import en from "../../assets/client/locales/en.mjs";
import zhCN from "../../assets/client/locales/zh-CN.mjs";
import zhHant from "../../assets/client/locales/zh-Hant.mjs";

export const SUPPORTED_LOCALES = Object.freeze(["en", "zh-CN", "zh-Hant"]);
export const DEFAULT_LOCALE = "zh-CN";

const messages = Object.freeze({ en, "zh-CN": zhCN, "zh-Hant": zhHant });

export function normalizeLocale(value, fallback = DEFAULT_LOCALE) {
  const locale = String(value || "").trim().replace(/_/g, "-");
  if (!locale) return fallback;
  const lower = locale.toLowerCase();
  if (lower === "en" || lower.startsWith("en-")) return "en";
  if (
    lower === "zh-hant"
    || lower.startsWith("zh-hant-")
    || lower === "zh-tw"
    || lower === "zh-hk"
    || lower === "zh-mo"
  ) return "zh-Hant";
  if (
    lower === "zh"
    || lower === "zh-cn"
    || lower === "zh-sg"
    || lower === "zh-hans"
    || lower.startsWith("zh-hans-")
  ) return "zh-CN";
  return fallback;
}

export function detectSupportedLocale(values, fallback = DEFAULT_LOCALE) {
  for (const value of Array.isArray(values) ? values : [values]) {
    const normalized = normalizeLocale(value, "");
    if (normalized) return normalized;
  }
  return fallback;
}

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

export function translationsFor(key, params = {}) {
  return SUPPORTED_LOCALES.map((locale) => translate(locale, key, params));
}

export function formatDateTimeForLocale(locale, value = new Date(), options = {}) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(normalizeLocale(locale), options).format(date);
}

export function formatNumberForLocale(locale, value, options = {}) {
  return new Intl.NumberFormat(normalizeLocale(locale), options).format(value);
}

export function formatListForLocale(locale, values, options = {}) {
  const list = Array.isArray(values) ? values.map(String) : [];
  return new Intl.ListFormat(normalizeLocale(locale), { style: "long", type: "conjunction", ...options }).format(list);
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
