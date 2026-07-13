export function cardTone(item) {
  if (item?.cardType === "inspiration" || (!item?.cardType && item?.section === "审美")) return "inspiration";
  if (item?.cardType === "bookmark") return "bookmark";
  return "news";
}

export function cardIconName(item) {
  if (cardTone(item) === "inspiration") return "sparkling";
  if (cardTone(item) === "bookmark") return "bookmark-ribbon";
  return "news";
}

export function isHotNewsItem(item, isNewsCard) {
  if (!isNewsCard(item)) return false;
  const summary = item.summary;
  if (!summary || summary.error || summary.hidden || summary.advertisement || summary.stale) return false;
  if (summary.newsStatus && summary.newsStatus !== "hot") return false;
  return Boolean(summary.isHotNews || summary.publishedAt || summary.updatedAt);
}

export function isSummaryFillItem(item, isNewsCard) {
  const summary = item.summary;
  return Boolean(
    isNewsCard(item)
    && summary
    && !summary.error
    && !summary.hidden
    && !summary.advertisement
    && !summary.stale
  );
}
