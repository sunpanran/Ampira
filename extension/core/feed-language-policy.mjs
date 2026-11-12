import { normalizeLocale } from "./locale.mjs";
import { cachedLocalization, withLocalization } from "./feed-localization.mjs";

import { classifyContentLocale } from "./content-language.mjs";
import { aiOutputMatchesLocale, aiOutputPartsMatchLocale, visibleAiProse } from "./ai-output-language.mjs";

export { classifyContentLocale };

export function classifyFeedEntryLocale(title, summary, declaredLocale = "") {
  const declared = normalizeDeclaredLocale(declaredLocale);
  const titleLanguage = classifyContentLocale(title, declared);
  const summaryLanguage = classifyContentLocale(summary, declared);
  if (titleLanguage.confidence === "detected" && titleLanguage.locale !== declared) {
    return { ...titleLanguage, detectedField: "title" };
  }
  if (summaryLanguage.confidence === "detected" && summaryLanguage.locale !== declared) {
    return { ...summaryLanguage, detectedField: "summary" };
  }
  if (titleLanguage.confidence === "detected") return { ...titleLanguage, detectedField: "title" };
  if (summaryLanguage.confidence === "detected") return { ...summaryLanguage, detectedField: "summary" };
  return { ...classifyContentLocale(`${title}\n${summary}`, declared), detectedField: "combined" };
}

export function contentMatchesLocale(value, locale) {
  return Boolean(visibleAiProse(value)) && aiOutputMatchesLocale(value, locale);
}

export function localizedSummaryMatchesLocale(title, summary, locale) {
  const lines = (Array.isArray(summary) ? summary : []).map((part) => String(part || "").trim()).filter(Boolean);
  return Boolean(String(title || "").trim()) && lines.length > 0
    && aiOutputPartsMatchLocale([title, ...lines], locale);
}

export function feedItemNeedsLocalization(item, locale) {
  const target = normalizeLocale(locale);
  if (cachedLocalization(item, target)) return false;
  if (!item?.localization && item?.summaryStatus === "ai" && item.summaryLocale === target
    && localizedSummaryMatchesLocale(item.summaryTitle, item.summary, target)) return false;
  const parts = [item?.title, item?.excerpt].filter((part) => visibleAiProse(part));
  return parts.length > 0 && !aiOutputPartsMatchLocale(parts, target);
}

export function filterPresentableFeedItems(items = [], locale, options = {}) {
  const target = normalizeLocale(locale);
  return (Array.isArray(items) ? items : []).flatMap((item) => {
    const shared = cachedLocalization(item, target);
    if (shared) item = withLocalization(item, shared);
    if (!isPresentableFeedItem(item, target, options)) return [];
    const localized = Boolean(shared) || options.aiConfigured && !item.localization && item.summaryStatus === "ai" && item.summaryLocale === target
      && sameOrigin(item.summaryProviderOrigin, options.providerOrigin)
      && localizedSummaryMatchesLocale(item.summaryTitle, item.summary, target);
    const localizationPending = feedItemNeedsLocalization(localized ? item : { ...item, summaryStatus: "" }, target);
    if (!localized) return [{ ...item, localizationPending }];
    const localizedSummary = Array.isArray(item.summary) ? item.summary.filter(Boolean) : [];
    return [{
      ...item,
      title: item.summaryTitle,
      excerpt: localizedSummary.join(" "),
      summary: localizedSummary,
      presentationLocale: target,
      localizedByAi: true,
      localizationPending: false,
    }];
  });
}

export function isPresentableFeedItem(item, locale, {
  aiConfigured = false,
  providerOrigin = "",
} = {}) {
  if (cachedLocalization(item, normalizeLocale(locale))) return true;
  if (item?.externalDiscovery !== true) return true;
  const target = normalizeLocale(locale);
  const contentLocale = normalizeDeclaredLocale(item?.contentLocale);
  if (contentLocale === target) return true;
  // A name-heavy native headline can disagree with the coarse source detector.
  const originalParts = [item?.title, item?.excerpt].filter((part) => visibleAiProse(part));
  if (originalParts.length && aiOutputPartsMatchLocale(originalParts, target)) return true;
  if (item?.localization || !aiConfigured || item?.summaryStatus !== "ai" || item?.summaryLocale !== target) return false;
  if (!sameOrigin(item?.summaryProviderOrigin, providerOrigin)) return false;
  return localizedSummaryMatchesLocale(item?.summaryTitle, item?.summary, target);
}

function normalizeDeclaredLocale(locale) {
  const text = String(locale || "").trim();
  if (!text) return "";
  return normalizeLocale(text);
}

function sameOrigin(left, right) {
  try {
    return new URL(String(left || "")).origin === new URL(String(right || "")).origin;
  } catch {
    return false;
  }
}
