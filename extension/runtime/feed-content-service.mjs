import { boundedFeedText, currentReaderContent, feedContentFingerprint } from "../core/feed-content.mjs";
import { mapWithConcurrency, safeOrigin } from "./runtime-utils.mjs";

const CONTENT_TARGET_LIMIT = 8;
const CONTENT_PER_SOURCE_LIMIT = 2;
const CONTENT_MIN_CHARS = 600;
const CONTENT_HIT_TTL_MS = 6 * 60 * 60 * 1000;
const CONTENT_MISS_TTL_MS = 30 * 60 * 1000;

export function selectFeedContentTargets(items, now = Date.now()) {
  const counts = new Map();
  return (items || []).filter(item => {
    if (!sameSource(item) || boundedFeedText(item.contentText || item.excerpt).length >= CONTENT_MIN_CHARS) return false;
    const cached = currentReaderContent(item);
    const age = now - Date.parse(cached?.checkedAt || "");
    if (age >= 0 && age < (cached?.text ? CONTENT_HIT_TTL_MS : CONTENT_MISS_TTL_MS)) return false;
    return true;
  }).sort((a, b) => Number(b.score || 0) - Number(a.score || 0)).filter(item => {
    const count = counts.get(item.sourceKey) || 0;
    if (count >= CONTENT_PER_SOURCE_LIMIT) return false;
    counts.set(item.sourceKey, count + 1);
    return true;
  }).slice(0, CONTENT_TARGET_LIMIT);
}

export function createFeedContentService({ fetchReader, readerTextFromBlocks, hasOriginPermission }) {
  return { enrichFeedContent };
  async function enrichFeedContent(items, { signal, isCurrent = () => true } = {}) {
    if (typeof fetchReader !== "function" || typeof readerTextFromBlocks !== "function" || typeof hasOriginPermission !== "function") return;
    await mapWithConcurrency(selectFeedContentTargets(items), 2, async item => {
      if (signal?.aborted || !isCurrent() || !await hasOriginPermission(item.url)) return;
      let text = "", modifiedAt = "";
      try {
        const reader = await fetchReader(item.url, {
          signal, timeoutMs: 6000,
          validateResponse: async response => {
            if (!sameSource(item, response.url || item.url) || !isCurrent() || !await hasOriginPermission(item.url)) throw new Error("SOURCE_PERMISSION_CHANGED");
          },
        });
        if (!sameSource(item, reader.url || item.url) || reader.staleReason || reader.source === "stale-cache") return;
        text = boundedFeedText(readerTextFromBlocks(reader.blocks));
        modifiedAt = String(reader.modifiedAt || "");
        if (text.length <= boundedFeedText(item.contentText || item.excerpt).length) text = "";
      } catch {
        // Missing/blocked bodies keep the original feed and get a short cooldown.
      }
      if (signal?.aborted || !isCurrent() || !await hasOriginPermission(item.url)) return;
      const previous = currentReaderContent(item);
      item.readerContent = { fingerprint: feedContentFingerprint(item),
        text: text || previous?.text || "", modifiedAt: modifiedAt || previous?.modifiedAt || "",
        checkedAt: new Date().toISOString() };
    }, { signal, isCurrent });
  }
}

function sameSource(item, url = item?.url) {
  const origin = safeOrigin(item?.sourceOrigin);
  return Boolean(origin && origin === safeOrigin(url));
}
