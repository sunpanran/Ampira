import { hashText } from "./bookmarks.mjs";

export const FEED_CONTENT_MAX_CHARS = 12000;
export const CARD_CONTEXT_MAX_CHARS = 6000;

export function boundedFeedText(value, limit = FEED_CONTENT_MAX_CHARS) {
  return String(value || "").trim().slice(0, limit).replace(/[\uD800-\uDBFF]$/, "");
}

export function feedContentFingerprint(item) {
  return hashText(JSON.stringify([
    item?.url, item?.sourceKey, item?.sourceOrigin, item?.fetchOrigin,
    item?.localizedByAi ? item.originalTitle : item?.title,
    item?.localizedByAi ? item.originalExcerpt : item?.excerpt,
    boundedFeedText(item?.contentText), item?.publishedAt || "", item?.modifiedAt || "",
  ]));
}

export function currentReaderContent(item) {
  return item?.readerContent?.fingerprint === feedContentFingerprint(item) ? item.readerContent : null;
}

export function articleContentText(item, limit = FEED_CONTENT_MAX_CHARS) {
  const feed = boundedFeedText(item?.contentText || (item?.localizedByAi ? item.originalExcerpt : item?.excerpt));
  const reader = boundedFeedText(currentReaderContent(item)?.text);
  return boundedFeedText(reader.length > feed.length ? reader : feed, limit);
}

export function articleContentFingerprint(item) {
  const reader = currentReaderContent(item);
  return hashText(JSON.stringify([feedContentFingerprint(item), reader?.text || "", reader?.modifiedAt || ""]));
}

export function preserveArticleEnrichment(item, previous) {
  if (feedContentFingerprint(item) !== feedContentFingerprint(previous)) return item;
  const readerContent = currentReaderContent(previous);
  return { ...item, ...(readerContent ? { readerContent } : {}),
    ...(!item.imageUrl && previous?.imageSource === "origin" ? {
      imageUrl: previous.imageUrl, imageUrls: previous.imageUrls, imageSource: "origin",
    } : {}) };
}

export function currentSummaryContent(item) {
  return !item?.summaryFingerprint || item.summaryFingerprint === articleContentFingerprint(item);
}
