const EMPTY_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const FUTURE_TIME_TOLERANCE_MS = 15 * 60 * 1000;

export function sourceStatusForFetch(result, itemCount) {
  if (Number(itemCount) > 0) return "healthy";
  return result?.pendingFeed ? "permissionRequired" : "empty";
}

export function sourceFetchProfile(previousRecord, previousItems) {
  if (Array.isArray(previousItems) && previousItems.length) return previousRecord || {};
  return {
    ...(previousRecord || {}),
    validators: { etag: "", lastModified: "" },
  };
}

export function shouldRetainPreviousItemsAfterEmpty(result, previousItems, previousRecord, now = Date.now()) {
  if (result?.outcome !== "empty" || !Array.isArray(previousItems) || !previousItems.length) return false;
  const hasRecentVerifiedItem = previousItems.some((item) => {
    if (item?.timeUnverified === true) return false;
    const publishedAt = Date.parse(String(item?.publishedAt || ""));
    const age = Number(now) - publishedAt;
    return Number.isFinite(publishedAt) && age >= -FUTURE_TIME_TOLERANCE_MS && age <= EMPTY_CACHE_MAX_AGE_MS;
  });
  const outcomes = Array.isArray(previousRecord?.recentOutcomes) ? previousRecord.recentOutcomes : [];
  let trailingEmpty = 0;
  for (let index = outcomes.length - 1; index >= 0 && outcomes[index] === "empty"; index -= 1) trailingEmpty += 1;
  return hasRecentVerifiedItem && trailingEmpty < 2;
}

export function selectDistinctEventEvidence(items, limit = 3) {
  const selected = [];
  const publishers = new Set();
  for (const item of Array.isArray(items) ? items : []) {
    const publisher = String(item?.publisherHost || item?.publisher || item?.host || item?.sourceKey || item?.source || "")
      .trim().toLowerCase() || "unknown";
    if (publishers.has(publisher)) continue;
    publishers.add(publisher);
    selected.push(item);
    if (selected.length >= Math.max(0, Number(limit) || 0)) break;
  }
  return selected;
}
