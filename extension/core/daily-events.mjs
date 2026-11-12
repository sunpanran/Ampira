import { newsTimeScope, publisherIdentity, verifiedTime } from "./news-item-model.mjs";

// Use only the currently visible Feed. A digest may refine a matching headline,
// but cannot add events or restore evidence removed by permission/time filters.
export function buildDailyEventCandidates(items, digestItems = [], now = Date.now()) {
  const digestByArticle = new Map();
  for (const item of Array.isArray(digestItems) ? digestItems : []) {
    for (const key of [item?.id, item?.url].filter(Boolean)) digestByArticle.set(key, item);
  }
  const events = new Map();
  const seenArticles = new Set();
  for (const item of Array.isArray(items) ? items : []) {
    if (!item || item.rankingEligible === false || !newsTimeScope(item, now)) continue;
    const articleKey = item.url || item.articleId || item.entryKey;
    const eventKey = item.eventId || articleKey;
    if (!articleKey || !eventKey || seenArticles.has(articleKey)) continue;
    seenArticles.add(articleKey);
    if (!events.has(eventKey)) events.set(eventKey, []);
    events.get(eventKey).push(item);
  }
  return [...events.entries()].map(([eventId, entries]) => {
    const item = [...entries].sort((left, right) => (
      Number(newsTimeScope(right, now) === "today") - Number(newsTimeScope(left, now) === "today")
      || Number(left.localizationPending === true) - Number(right.localizationPending === true)
      || Number(right.eventRepresentative === true) - Number(left.eventRepresentative === true)
      || eventImportance(right) - eventImportance(left)
      || verifiedTime(right) - verifiedTime(left)
      || String(left.articleId || left.url).localeCompare(String(right.articleId || right.url))
    ))[0];
    const sourceCount = new Set(entries.map((entry) => publisherIdentity(entry).replace(/^www\./, "")).filter(Boolean)).size;
    const cached = digestByArticle.get(item.articleId) || digestByArticle.get(item.url);
    const digest = cached?.publishedAt === item.publishedAt && !cached.localizationPending && !item.localizationPending ? cached : null;
    return {
      ...item,
      id: item.articleId || item.entryKey || item.url,
      eventId,
      eventRepresentative: true,
      title: digest?.title || item.title,
      sourceCount,
      eventSourceCount: sourceCount,
      articleCount: entries.length,
      eventConfidence: sourceCount >= 2 ? "corroborated"
        : item.eventConfidence === "high-confidence-single" ? "high-confidence-single" : "single-source",
      importanceScore: eventImportance(digest || item),
    };
  });
}

export function eventImportance(item) {
  const score = Number(item?.importanceScore ?? item?.publicImportanceScore ?? item?.localImportanceScore ?? item?.score ?? 0);
  return Number.isFinite(score) ? Math.max(0, Math.min(100, score)) : 0;
}
