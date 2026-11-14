import { topicComparable } from "../../extension/core/tracked-topics.mjs";

export function trackedItemKey(item) {
  const key = String(item?.key || item?.feedItem?.articleId || item?.url || "");
  if (key.length <= 256) return key;
  let hash = 2166136261;
  for (const character of key) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return "long-" + key.length + "-" + (hash >>> 0).toString(36);
}

function includesWord(text, word) {
  let start = text.indexOf(word);
  while (start >= 0) {
    const before = text[start - 1] || "", after = text[start + word.length] || "";
    if ((!/^[a-z0-9]/.test(word) || !/[a-z0-9_]/.test(before))
      && (!/[a-z0-9]$/.test(word) || !/[a-z0-9_]/.test(after))) return true;
    start = text.indexOf(word, start + 1);
  }
  return false;
}

export function topicMatchWords(item, topic) {
  const feed = item?.feedItem || item || {}, summary = item?.summary || {};
  const sourceKey = String(feed.sourceKey || item?.sourceKey || "");
  const isPublic = sourceKey.startsWith("public-");
  if (topic.source === "public" && !isPublic || topic.source === "bookmarks" && isPublic) return [];
  const text = topicComparable([feed.title, summary.title, feed.excerpt, summary.description,
    ...(Array.isArray(feed.summary) ? feed.summary : []), ...(Array.isArray(summary.summary) ? summary.summary : [])]
    .filter(value => typeof value === "string").map(value => value.slice(0, 4000)).join(" "));
  return topic.words.filter(word => includesWord(text, topicComparable(word)));
}

export function selectTrackedItems(items, topic, { dismissed = new Set() } = {}) {
  if (!topic) return [];
  const unique = new Set();
  return (Array.isArray(items) ? items : []).map(item => {
    const key = trackedItemKey(item);
    if (!key || unique.has(key) || dismissed.has(item.key)) return null;
    unique.add(key);
    const words = topicMatchWords(item, topic);
    if (!words.length) return null;
    const feed = item.feedItem || item;
    const timestamp = feed.publishedAt || feed.fetchedAt || item.summary?.fetchedAt || "";
    return { item, key, words, timestamp, time: Date.parse(timestamp) || 0 };
  }).filter(Boolean).sort((a, b) => b.time - a.time);
}
