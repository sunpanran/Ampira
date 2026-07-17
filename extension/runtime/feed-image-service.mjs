const FEED_IMAGE_ENRICH_LIMIT = 12;
const FEED_IMAGE_PER_SOURCE_LIMIT = 2;
const FEED_IMAGE_CONCURRENCY = 3;
const FEED_IMAGE_HIT_CACHE_MS = 24 * 60 * 60 * 1000;
const FEED_IMAGE_MISS_CACHE_MS = 2 * 60 * 60 * 1000;
const FEED_IMAGE_ERROR_CACHE_MS = 15 * 60 * 1000;

export function selectFeedImageEnrichmentTargets(items, {
  limit = FEED_IMAGE_ENRICH_LIMIT,
  perSourceLimit = FEED_IMAGE_PER_SOURCE_LIMIT,
} = {}) {
  const sourceCounts = new Map();
  return [...(items || [])]
    .filter((item) => !item.imageUrl && sameOrigin(item.url, item.sourceOrigin))
    .sort((left, right) => Number(right.score || 0) - Number(left.score || 0)
      || Date.parse(right.publishedAt || right.fetchedAt || 0) - Date.parse(left.publishedAt || left.fetchedAt || 0))
    .filter((item) => {
      const key = String(item.sourceKey || "");
      const count = sourceCounts.get(key) || 0;
      if (!key || count >= perSourceLimit) return false;
      sourceCounts.set(key, count + 1);
      return true;
    })
    .slice(0, limit);
}

export function feedImageCacheFresh(record, item, now = Date.now()) {
  if (record?.capability !== "feed-image") return false;
  if (record.requestedUrl !== item?.url || record.sourceKey !== item?.sourceKey) return false;
  if (record.sourceOrigin !== safeOrigin(item?.sourceOrigin || "")) return false;
  const checkedAt = Date.parse(record.checkedAt || "");
  const maxAge = record.outcome === "hit"
    ? FEED_IMAGE_HIT_CACHE_MS
    : record.outcome === "miss" ? FEED_IMAGE_MISS_CACHE_MS : FEED_IMAGE_ERROR_CACHE_MS;
  return ["hit", "miss", "error"].includes(record.outcome)
    && Number.isFinite(checkedAt)
    && now - checkedAt >= 0
    && now - checkedAt < maxAge;
}

export function createFeedImageService(options) {
  const {
    fetchSourceImageCandidates, hasOriginPermission, mapWithConcurrency, cacheMutations,
    getRecord, setRecord, hashText, refreshCoordinator,
  } = options;

  return { enrichMissingFeedImages, updateImageQualityMetrics, imageQualityMetrics };

  async function enrichMissingFeedImages(items, { cacheEpoch, generation = null } = {}) {
    if (typeof fetchSourceImageCandidates !== "function" || typeof hasOriginPermission !== "function") return;
    const targets = selectFeedImageEnrichmentTargets(items);
    await mapWithConcurrency(targets, FEED_IMAGE_CONCURRENCY, async (item) => {
      if (!refreshStillCurrent(generation) || !cacheMutations.isCurrent(cacheEpoch)) return;
      const record = await loadFeedImageRecord(item, { cacheEpoch, generation });
      if (record?.outcome === "hit") applyFeedImageRecord(item, record);
    });
  }

  async function loadFeedImageRecord(item, { cacheEpoch, generation = null } = {}) {
    const requestedUrl = String(item.url || "");
    const sourceOrigin = safeOrigin(item.sourceOrigin || "");
    if (!requestedUrl || !sourceOrigin || !sameOrigin(requestedUrl, sourceOrigin)) return null;
    if (!await hasOriginPermission(requestedUrl)) return null;
    const cacheKey = `feed-image-${hashText(requestedUrl)}`;
    const cached = await getRecord(cacheKey, null);
    if (feedImageCacheFresh(cached, item, Date.now()) && await hasOriginPermission(requestedUrl)) return cached;

    let imageUrls = [];
    let outcome = "miss";
    try {
      imageUrls = await fetchSourceImageCandidates(requestedUrl, {
        validateResponse: async (response) => {
          const finalUrl = String(response?.url || requestedUrl);
          if (!sameOrigin(finalUrl, sourceOrigin) || !await hasOriginPermission(finalUrl)) {
            const error = new Error("SOURCE_PERMISSION_CHANGED");
            error.code = "SOURCE_PERMISSION_CHANGED";
            throw error;
          }
        },
      });
      outcome = imageUrls.length ? "hit" : "miss";
    } catch {
      if (!await hasOriginPermission(requestedUrl)) return null;
      outcome = "error";
    }
    if (!refreshStillCurrent(generation) || !cacheMutations.isCurrent(cacheEpoch)) return null;
    if (!await hasOriginPermission(requestedUrl) || !sameOrigin(requestedUrl, sourceOrigin)) return null;
    const record = {
      capability: "feed-image",
      outcome,
      requestedUrl,
      sourceKey: String(item.sourceKey || ""),
      sourceOrigin,
      imageUrl: imageUrls[0] || "",
      imageUrls: imageUrls.slice(0, 3),
      checkedAt: new Date().toISOString(),
      requiredOrigins: [sourceOrigin],
    };
    return cacheMutations.run(async (isCurrent) => {
      if (!isCurrent() || !refreshStillCurrent(generation) || !await hasOriginPermission(requestedUrl)) return null;
      await setRecord(cacheKey, record, "cache");
      return record;
    }, cacheEpoch);
  }

  function refreshStillCurrent(generation) {
    return generation === null || generation === undefined || refreshCoordinator.isCurrent(generation);
  }
}

function applyFeedImageRecord(item, record) {
  const imageUrls = [...new Set((Array.isArray(record.imageUrls) ? record.imageUrls : [record.imageUrl])
    .map((value) => String(value || "").trim()).filter(Boolean))].slice(0, 3);
  if (!imageUrls.length) return;
  item.imageUrl = imageUrls[0];
  item.imageUrls = imageUrls;
  item.imageSource = "origin";
}

function updateImageQualityMetrics(quality, items) {
  for (const [sourceKey, record] of Object.entries(quality || {})) {
    const sourceItems = (items || []).filter((item) => String(item.sourceKey || "") === sourceKey);
    if (!sourceItems.length && Number(record.itemCount || 0) > 0) continue;
    const imageCount = sourceItems.filter((item) => Boolean(item.imageUrl)).length;
    quality[sourceKey] = {
      ...record,
      imageCount,
      feedImageCount: sourceItems.filter((item) => item.imageSource === "feed").length,
      enrichedImageCount: sourceItems.filter((item) => item.imageSource === "origin").length,
      missingImageCount: Math.max(0, sourceItems.length - imageCount),
    };
  }
}

function imageQualityMetrics(items) {
  const list = Array.isArray(items) ? items : [];
  const imageCount = list.filter((item) => Boolean(item.imageUrl)).length;
  return {
    imageCount,
    feedImageCount: list.filter((item) => item.imageSource === "feed").length,
    enrichedImageCount: list.filter((item) => item.imageSource === "origin").length,
    missingImageCount: Math.max(0, list.length - imageCount),
  };
}

function sameOrigin(left, right) {
  try { return new URL(left).origin === new URL(right).origin; } catch { return false; }
}

function safeOrigin(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)
      ? url.origin
      : "";
  } catch {
    return "";
  }
}
