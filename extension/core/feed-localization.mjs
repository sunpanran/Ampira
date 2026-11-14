import { articleContentFingerprint } from "./feed-content.mjs";
import { aiOutputPartsMatchLocale } from "./ai-output-language.mjs";
import { normalizeCardSummary } from "./card-summary-format.mjs";

export function localizationFingerprint(item) {
  return articleContentFingerprint(item);
}
export function validTranslation(value, locale) {
  return ["zh-CN", "zh-Hant", "en"].includes(locale) && typeof value?.title === "string" && value.title.trim().length > 0 && value.title.length <= 300
    && Array.isArray(value.summary) && value.summary.length > 0 && value.summary.length <= 3
    && value.summary.every(line => typeof line === "string" && line.trim().length > 0 && line.length <= 1000)
    && value.summary.join("\n").length <= 1000
    && aiOutputPartsMatchLocale([value.title, ...value.summary], locale);
}
export function cachedLocalization(item, locale) {
  const value = item?.localization;
  if (value?.locale !== locale || value.fingerprint !== localizationFingerprint(item) || !validTranslation(value, locale)) return null;
  const normalized = { ...value, ...normalizeCardSummary(value) };
  return validTranslation(normalized, locale) ? normalized : null;
}
export function withLocalization(item, value) {
  return { ...item, localization: value, summaryTitle: value.title, summary: value.summary,
    summaryStatus: "ai", summaryLocale: value.locale, summarizedAt: value.updatedAt, summaryProviderOrigin: value.providerOrigin || "" };
}
export function createLocalization(item, { title, summary }, locale, producer, updatedAt, providerOrigin = "") {
  if (!validTranslation({ title, summary }, locale)) throw Object.assign(new Error("invalid-translation"), { code: "invalidData" });
  const value = { ...normalizeCardSummary({ title, summary }), locale, producer, updatedAt, providerOrigin, fingerprint: localizationFingerprint(item) };
  if (!validTranslation(value, locale)) throw Object.assign(new Error("invalid-translation"), { code: "invalidData" });
  return value;
}
