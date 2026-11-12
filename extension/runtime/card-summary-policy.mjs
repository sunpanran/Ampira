import { originPattern } from "../core/permission-state.mjs";
import { aiOutputMatchesLocale } from "../core/ai-output-language.mjs";
import { localizedSummaryMatchesLocale } from "../core/feed-language-policy.mjs";
import { currentSummaryRetry, withoutSummaryRetry } from "../core/card-summary-retry.mjs";
import { extractGeneratedSummaryTitle } from "../core/summary-text.mjs";
import { normalizeCardSummary } from "../core/card-summary-format.mjs";
import { settingsLocale } from "./runtime-result.mjs";
import { cachedLocalization, withLocalization } from "../core/feed-localization.mjs";

const CARD_SUMMARY_EXCERPT_MAX_CHARS = 2000;

export function createCardSummaryPolicy(options = {}) {
  const localeForSettings = options.settingsLocale || settingsLocale;
  const patternForOrigin = options.originPattern || originPattern;

  return {
    automaticCardSummaryContext,
    generatedCardSummary,
    isCurrentCardSummary,
    preserveCardAiSummary,
    sanitizeCardAiSummaries,
    validateCardSummaryOutput,
  };

  function isCurrentCardSummary(item, locale = "") {
    if (item?.localization) return Boolean(cachedLocalization(item, locale || item.localization.locale));
    return item?.summaryStatus === "ai" && (!locale || item?.summaryLocale === locale)
      && localizedSummaryMatchesLocale(item.summaryTitle, item.summary, locale || item.summaryLocale);
  }

  function preserveCardAiSummary(item, previous, settings) {
    const locale = localeForSettings(settings);
    if (previous?.localization) {
      const shared = cachedLocalization({ ...item, localization: previous.localization }, locale);
      return shared ? withLocalization(withoutSummaryRetry(item), shared) : item;
    }
    const retry = currentSummaryRetry({ ...item, summaryRetry: previous?.summaryRetry }, settings, locale);
    item = retry ? { ...item, summaryRetry: retry } : withoutSummaryRetry(item);
    if (!isCurrentCardSummary(previous, locale) || !previous.summaryTitle || !Array.isArray(previous.summary) || !previous.summary.length) return item;
    if (patternForOrigin(previous.summaryProviderOrigin || "") !== patternForOrigin(settings.openaiBaseUrl)) return item;
    return {
      ...withoutSummaryRetry(item),
      summaryTitle: previous.summaryTitle,
      summary: previous.summary,
      summaryStatus: "ai",
      summaryLocale: locale,
      summarizedAt: previous.summarizedAt || "",
      summaryProviderOrigin: previous.summaryProviderOrigin,
    };
  }

  function sanitizeCardAiSummaries(items, settings, configuredForAi) {
    const locale = localeForSettings(settings);
    return (items || []).map((item) => {
      if (!currentSummaryRetry(item, settings, locale)) item = withoutSummaryRetry(item);
      const shared = cachedLocalization(item, locale);
      if (shared) return withLocalization(item, shared);
      if (item.summaryStatus !== "ai" && !item.localization) return item;
      if (!item.localization && configuredForAi && isCurrentCardSummary(item, locale) && patternForOrigin(item.summaryProviderOrigin || "") === patternForOrigin(settings.openaiBaseUrl)) return item;
      const { localization, summarizedAt, summaryLocale, summaryProviderOrigin, summaryTitle, ...rest } = item;
      const excerpt = String(item.excerpt || "").trim();
      return { ...rest, summary: excerpt ? [excerpt] : [], summaryStatus: excerpt ? "excerpt" : "raw" };
    });
  }
}

export function validateCardSummaryOutput(value, locale) {
  const { title, summary } = generatedCardSummary(value);
  const fields = [];
  if (!title || !aiOutputMatchesLocale(title, locale)) fields.push("title");
  if (!summary.length) fields.push("summary");
  summary.forEach((line, index) => {
    if (!aiOutputMatchesLocale(line, locale)) fields.push(`summary[${index + 1}]`);
  });
  return {
    valid: fields.length === 0,
    code: !title || !summary.length ? "AI_INVALID_OUTPUT" : "AI_WRONG_LANGUAGE",
    messageKey: !title || !summary.length ? "background.error.aiInvalidOutput" : "background.error.aiWrongLanguage",
    fields,
  };
}

function automaticCardSummaryContext(candidate) {
  return {
    text: String(candidate.excerpt || "").trim().slice(0, CARD_SUMMARY_EXCERPT_MAX_CHARS),
    origins: [],
  };
}

function generatedCardSummary(value) {
  const text = String(value || "").trim();
  if (!text) return { title: "", summary: [] };
  const rawLines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const title = rawLines.map((line) => extractGeneratedSummaryTitle(line)).find(Boolean) || "";
  return normalizeCardSummary({ title, summary: rawLines });
}
