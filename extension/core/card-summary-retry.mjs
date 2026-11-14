import { hashText } from "./bookmarks.mjs";
import { articleContentFingerprint } from "./feed-content.mjs";

const RETRY_DELAYS_MS = [15 * 60_000, 60 * 60_000, 6 * 60 * 60_000];
const CONTENT_ERRORS = new Set(["AI_WRONG_LANGUAGE", "AI_EMPTY_RESPONSE", "AI_INVALID_OUTPUT", "AI_OUTPUT_LIMIT", "AI_INCOMPLETE_RESPONSE"]);

export function isAiContentError(error) {
  return CONTENT_ERRORS.has(error?.code);
}

export function cardSummaryContextKey(item, settings, locale) {
  return hashText(JSON.stringify([
    articleContentFingerprint(item),
    locale, settings.openaiBaseUrl, settings.openaiApiStyle, settings.openaiSummaryModel,
    settings.credentialGeneration,
  ]));
}

export function currentSummaryRetry(item, settings, locale) {
  const retry = item?.summaryRetry;
  return retry?.contextKey === cardSummaryContextKey(item, settings, locale)
    && Number.isFinite(Date.parse(retry.nextEligibleAt)) && Number(retry.failures) > 0
    ? retry : null;
}

export function nextSummaryRetry(item, settings, locale, error, now = Date.now()) {
  const previous = currentSummaryRetry(item, settings, locale);
  const failures = Math.min(1000, Math.max(0, Number(previous?.failures) || 0) + 1);
  const delay = RETRY_DELAYS_MS[Math.min(failures - 1, RETRY_DELAYS_MS.length - 1)];
  return {
    contextKey: cardSummaryContextKey(item, settings, locale),
    failures,
    lastFailedAt: new Date(now).toISOString(),
    nextEligibleAt: new Date(now + delay).toISOString(),
    errorCode: CONTENT_ERRORS.has(error?.code) ? error.code : "AI_INVALID_OUTPUT",
  };
}

export function withoutSummaryRetry(item) {
  const { summaryRetry, ...rest } = item;
  return rest;
}
