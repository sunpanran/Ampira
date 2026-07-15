import { originPattern } from "../core/permission-state.mjs";
import {
  CARD_SUMMARY_POLICY_VERSION,
  cleanGeneratedSummaryLine,
  extractGeneratedSummaryTitle,
  limitGeneratedSummaryLines,
} from "../core/summary-text.mjs";
import { settingsLocale } from "./runtime-result.mjs";

const CARD_SUMMARY_EXCERPT_MAX_CHARS = 2000;
const CARD_SUMMARY_MAX_CHARS = 200;

export function createCardSummaryPolicy(options = {}) {
  const localeForSettings = options.settingsLocale || settingsLocale;
  const patternForOrigin = options.originPattern || originPattern;
  const policyVersion = options.policyVersion || CARD_SUMMARY_POLICY_VERSION;

  return {
    policyVersion,
    automaticCardSummaryContext,
    generatedCardSummary,
    isCurrentCardSummary,
    preserveCardAiSummary,
    sanitizeCardAiSummaries,
  };

  function isCurrentCardSummary(item, locale = "") {
    return item?.summaryStatus === "ai"
      && item?.summaryPolicyVersion === policyVersion
      && (!locale || item?.summaryLocale === locale);
  }

  function preserveCardAiSummary(item, previous, settings) {
    const locale = localeForSettings(settings);
    if (!isCurrentCardSummary(previous, locale) || !previous.summaryTitle || !Array.isArray(previous.summary) || !previous.summary.length) return item;
    if (patternForOrigin(previous.summaryProviderOrigin || "") !== patternForOrigin(settings.openaiBaseUrl)) return item;
    return {
      ...item,
      summaryTitle: previous.summaryTitle,
      summary: previous.summary,
      summaryStatus: "ai",
      summaryPolicyVersion: policyVersion,
      summaryLocale: locale,
      summarizedAt: previous.summarizedAt || "",
      summaryProviderOrigin: previous.summaryProviderOrigin,
    };
  }

  function sanitizeCardAiSummaries(items, settings, configuredForAi) {
    const locale = localeForSettings(settings);
    return (items || []).map((item) => {
      if (item.summaryStatus !== "ai") return item;
      if (configuredForAi && isCurrentCardSummary(item, locale) && patternForOrigin(item.summaryProviderOrigin || "") === patternForOrigin(settings.openaiBaseUrl)) return item;
      const { summarizedAt, summaryPolicyVersion, summaryLocale, summaryProviderOrigin, summaryTitle, ...rest } = item;
      const excerpt = String(item.excerpt || "").trim();
      return { ...rest, summary: excerpt ? [excerpt] : [], summaryStatus: excerpt ? "excerpt" : "raw" };
    });
  }
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
  const lines = rawLines.map(cleanGeneratedSummaryLine).filter(Boolean);
  const summaryLines = lines.length > 1
    ? lines.slice(0, 3)
    : (lines[0]?.match(/[^。！？.!?]+[。！？.!?]?/g) || lines).map((line) => line.trim()).filter(Boolean).slice(0, 3);
  return { title, summary: limitGeneratedSummaryLines(summaryLines, CARD_SUMMARY_MAX_CHARS, 3) };
}
