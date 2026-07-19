export const SUPPORTED_LOCALES = Object.freeze(["en", "zh-CN", "zh-Hant"]);
export const DEFAULT_LOCALE = "zh-CN";

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
