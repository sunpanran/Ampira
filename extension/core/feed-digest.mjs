import { normalizeLocale, translate } from "./i18n.mjs";
import {
  buildDailyCandidates,
  dailyCandidateFingerprint,
} from "./news-ranking.mjs";

export function buildFallbackDigest(items, reason = "no-api-key", locale = "zh-CN", options = {}) {
  const normalizedLocale = normalizeLocale(locale);
  const now = options.now ?? Date.now();
  const selected = options.preselected === true
    ? (Array.isArray(items) ? items : []).slice(0, 12)
    : buildDailyCandidates(items, {
        now,
        limit: 12,
        recentLimit: 3,
        publisherLimit: options.publisherLimit,
        aiRankingEnabled: options.aiRankingEnabled,
      });
  return {
    locale: normalizedLocale,
    date: localDateKey(now),
    generatedAt: new Date(now).toISOString(),
    candidateFingerprint: dailyCandidateFingerprint(selected, { publisherLimit: options.publisherLimit }),
    status: reason,
    overview: selected.length
      ? [translate(normalizedLocale, "background.digest.organized"), translate(normalizedLocale, "background.digest.configureAiHint")]
      : [translate(normalizedLocale, "background.digest.empty")],
    items: selected.map((item) => ({
      id: item.articleId,
      title: item.title,
      summary: item.excerpt || translate(normalizedLocale, "background.digest.openOriginal"),
      reason: translate(normalizedLocale, "background.digest.highPriority"),
      url: item.url,
      source: item.source,
      host: item.host,
      publisher: item.publisher || item.source,
      publisherHost: item.publisherHost || item.host,
      publishedAt: item.publishedAt || "",
      eventId: item.eventId || "",
      sourceCount: Number(item.eventSourceCount || 1),
      articleCount: Number(item.eventArticleCount || 1),
      eventConfidence: item.eventConfidence || "single-source",
      timeScope: item.timeScope || "",
      localImportanceScore: Number(item.localImportanceScore ?? item.publicImportanceScore ?? item.score ?? 0),
      importanceScore: Number(item.localImportanceScore ?? item.publicImportanceScore ?? item.score ?? 0),
      type: item.externalDiscovery ? "internet" : "bookmark",
    })),
  };
}

function localDateKey(value = Date.now()) {
  const now = new Date(value);
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
