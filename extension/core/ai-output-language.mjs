import { classifyContentLocale } from "./feed-language-policy.mjs";
import { normalizeLocale } from "./locale.mjs";

const CODE_FENCE = /```[\s\S]*?```/g;
const INLINE_CODE = /`[^`\r\n]*`/g;
const URL = /\bhttps?:\/\/[^\s<>()]+/gi;
const EMAIL = /\b[^\s@]+@[^\s@]+\.[^\s@]+\b/g;
const DIGEST_RANK_LINE = /^\s*RANK\s+\d+\s*:\s*[-+]?\d+(?:\.\d+)?\s*$/i;
const DIGEST_PREFIX = /^\s*(?:OVERVIEW|TITLE\s+\d+)\s*:\s*/i;

export function visibleAiProse(value) {
  return String(value || "")
    .replace(CODE_FENCE, " ")
    .replace(INLINE_CODE, " ")
    .replace(URL, " ")
    .replace(EMAIL, " ")
    .split(/\r?\n/)
    .filter((line) => !DIGEST_RANK_LINE.test(line))
    .map((line) => line.replace(DIGEST_PREFIX, ""))
    .join("\n")
    .replace(/[\p{Number}\p{Punctuation}\p{Symbol}\s]+/gu, " ")
    .trim();
}

export function aiOutputMatchesLocale(value, locale) {
  const prose = visibleAiProse(value);
  if (!prose) return true;
  return proseMatchesLocale(prose, normalizeLocale(locale));
}

export function aiOutputPartsMatchLocale(parts, locale) {
  const target = normalizeLocale(locale);
  return (Array.isArray(parts) ? parts : [parts]).every((part) => {
    const prose = visibleAiProse(part);
    return !prose || proseMatchesLocale(prose, target);
  });
}

export function readerTranslationMatchesLocale(value, locale) {
  const parts = String(value || "").split(/\n\s*\n/);
  if (parts.length <= 1) return aiOutputMatchesLocale(value, locale);
  const title = parts.shift().trim();
  const text = parts.join("\n\n").trim();
  return aiOutputPartsMatchLocale([title, text].filter(Boolean), locale);
}

function proseMatchesLocale(prose, target) {
  const classified = classifyContentLocale(prose);
  if (target === "en") {
    if (classified.locale === "en") return true;
    if (!classified.latinCount) return false;
    if (!classified.hanCount) return classified.latinCount >= 2;
    return classified.latinCount >= 4 && classified.latinCount >= classified.hanCount * 2;
  }

  if (!classified.hanCount) return false;
  if (classified.latinCount >= 10 && classified.latinCount >= classified.hanCount * 3) return false;
  const targetScore = target === "zh-CN" ? classified.simplifiedScore : classified.traditionalScore;
  const oppositeScore = target === "zh-CN" ? classified.traditionalScore : classified.simplifiedScore;
  if (oppositeScore > 0 && (targetScore === 0 || oppositeScore >= targetScore * 2)) return false;
  return classified.locale !== (target === "zh-CN" ? "zh-Hant" : "zh-CN");
}
