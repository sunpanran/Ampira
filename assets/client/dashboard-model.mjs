import { normalizeComparableText } from "./text.mjs";
import { normalizeUrl } from "./urls.mjs";

export function pageForItems(items, count, variant) {
  const pageSize = Math.max(1, Math.floor(Number(count) || 1));
  const pageCount = Math.max(1, Math.ceil((items || []).length / pageSize));
  const normalizedVariant = ((Number(variant) || 0) % pageCount + pageCount) % pageCount;
  const start = normalizedVariant * pageSize;
  return {
    items: (items || []).slice(start, start + pageSize),
    page: normalizedVariant + 1,
    pageCount,
    variant: normalizedVariant,
    total: (items || []).length,
  };
}

export function findNewsItemByReference(items, reference = {}) {
  const list = Array.isArray(items) ? items : [];
  const referenceKeys = new Set([reference.key, reference.id, reference.articleId, reference.entryKey].map(clean).filter(Boolean));
  if (referenceKeys.size) {
    const exact = list.find((item) => itemKeys(item).some((key) => referenceKeys.has(key)));
    if (exact) return exact;
  }
  const urlKey = normalizeUrl(reference.url || reference.itemUrl || "");
  if (urlKey) {
    const exact = list.find((item) => itemUrls(item).some((url) => normalizeUrl(url) === urlKey));
    if (exact) return exact;
  }
  const titleKey = normalizeComparableText(reference.title || "");
  if (titleKey) {
    const exact = list.find((item) => itemTitles(item).some((title) => normalizeComparableText(title) === titleKey));
    if (exact) return exact;
  }
  const sourceKey = clean(reference.sourceKey);
  if (!sourceKey) return null;
  const sourceMatches = list.filter((item) => clean(item.sourceKey || item.feedItem?.sourceKey) === sourceKey);
  return sourceMatches.length === 1 ? sourceMatches[0] : null;
}

export function seededShuffle(items, seedText) {
  const list = [...(items || [])];
  const random = mulberry32(hashText(seedText));
  for (let index = list.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [list[index], list[target]] = [list[target], list[index]];
  }
  return list;
}

function hashText(text) {
  let value = 2166136261;
  for (const character of String(text || "")) {
    value ^= character.charCodeAt(0);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

function itemKeys(item) {
  return [item?.key, item?.feedItem?.articleId, item?.feedItem?.entryKey, item?.summary?.entryKey].map(clean).filter(Boolean);
}

function itemUrls(item) {
  return [item?.url, item?.feedItem?.url, item?.summary?.itemUrl].map(clean).filter(Boolean);
}

function itemTitles(item) {
  return [item?.summary?.title, item?.feedItem?.title, item?.title].map(clean).filter(Boolean);
}

function clean(value) {
  return String(value || "").trim();
}

function mulberry32(seed) {
  return function next() {
    let value = seed += 0x6D2B79F5;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}
