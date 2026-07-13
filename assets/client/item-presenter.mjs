import { allTranslations } from "./i18n.mjs";
import { cleanTitleText, normalizeComparableText, similarityScore, textLength, truncateText } from "./text.mjs";
import { cleanGeneratedSummaryLine, hasStructuralSummaryPrefix, isStructuralSummaryHeading, normalizeSummaryMarkup } from "../../extension/core/summary-text.mjs";

const QUICK_REFERENCE_LINES = new Set(allTranslations("summary.quickReference"));
const SUMMARY_TITLE_MAX_LENGTH = 64;

export function displayTitle(item) {
  const title = item.summary && !item.summary.hidden ? item.summary.title : item.title;
  return title && title.trim() ? title.trim() : (item.host || item.url);
}

export function displaySummaryTitle(item) {
  const candidates = item.summary && !item.summary.hidden ? [item.summary.title, item.title] : [item.title];
  for (const candidate of candidates) {
    const title = cleanSummaryTitle(candidate);
    if (title) return title;
  }
  return item.host || item.url;
}

export function cleanSummaryTitle(value) {
  const title = normalizeSummaryMarkup(cleanTitleText(value));
  if (isStructuralSummaryHeading(title) || hasStructuralSummaryPrefix(title)) return "";
  return truncateText(title, SUMMARY_TITLE_MAX_LENGTH);
}

export function itemUrl(item) {
  return item.summary && !item.summary.hidden ? (item.summary.itemUrl || item.url) : item.url;
}

export function summaryText(item) {
  return summaryLines(item).join(" ");
}

export function summaryDetailLines(item) {
  const lines = summaryLines(item);
  const fullTitles = [item.summary?.title, item.title].map(cleanTitleText).filter(Boolean);
  const filtered = lines
    .map((line) => stripTitlePrefix(line, fullTitles))
    .filter((line) => line && !fullTitles.some((candidate) => isRepeatedSummaryLine(line, candidate)));
  const expanded = expandSummaryDetailLines(filtered.length ? filtered : lines);
  if (expanded.some((line) => textLength(line) >= 12)) return expanded;
  const fallback = item.summary?.description ? cleanSummaryLines([item.summary.description]) : [];
  return fallback.length ? expandSummaryDetailLines(fallback) : expanded;
}

export function summaryLines(item) {
  if (item.summary?.hidden || item.summary?.error) return [];
  if (Array.isArray(item.summary?.summary) && item.summary.summary.length) return cleanSummaryLines(item.summary.summary);
  if (item.summary?.description) return cleanSummaryLines([item.summary.description]);
  return [];
}

export function isCorrectlySummarized(item) {
  const summary = item.summary;
  if (!summary || summary.error || summary.hidden || summary.advertisement || summary.stale) return false;
  if (summary.newsStatus && summary.newsStatus !== "hot") return false;
  if (summary.summaryStatus !== "ai" || !cleanSummaryTitle(summary.summaryTitle)) return false;
  return cleanSummaryLines(Array.isArray(summary.summary) ? summary.summary : []).length >= 2;
}

export function cleanSummaryLines(lines) {
  return lines.map(cleanGeneratedSummaryLine)
    .filter((line) => line && !QUICK_REFERENCE_LINES.has(line) && !isSummaryStatusLine(line));
}

function stripTitlePrefix(line, titles) {
  let text = String(line || "").trim();
  for (const title of [...titles].sort((a, b) => textLength(b) - textLength(a))) {
    if (!title || !text.startsWith(title)) continue;
    text = text.slice(title.length).replace(/^[\s:：,，.。;；|｜—–-]+/, "").trim();
    break;
  }
  return text;
}

function expandSummaryDetailLines(lines) {
  return lines.flatMap((line) => {
    const parts = String(line || "").split(/(?<=[。！？!?；;])\s*/u).map((part) => part.trim()).filter(Boolean);
    return parts.length > 1 ? parts : [line];
  });
}

function isRepeatedSummaryLine(line, title) {
  const lineKey = normalizeComparableText(line);
  const titleKey = normalizeComparableText(title);
  if (!lineKey || !titleKey) return false;
  if (lineKey === titleKey) return true;
  if (titleKey.length >= 8 && lineKey.includes(titleKey)) return true;
  if (lineKey.length >= 8 && titleKey.includes(lineKey)) return true;
  return similarityScore(lineKey, titleKey) >= .72;
}

function isSummaryStatusLine(line) {
  return [
    ...allTranslations("summary.status.quotaReached"),
    ...allTranslations("summary.status.noContent"),
    ...allTranslations("summary.status.noService"),
    ...allTranslations("summary.status.basicExcerpt"),
  ].some((value) => line.includes(value));
}
