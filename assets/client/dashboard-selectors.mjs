import { newsTimeScope, publisherIdentity } from "../../extension/core/news-ranking.mjs";

export function createPriorityRanker(options = {}) {
  const digestKeys = typeof options.digestKeys === "function" ? options.digestKeys : () => [];
  const itemKeys = typeof options.itemKeys === "function" ? options.itemKeys : () => [];
  const hotScore = typeof options.hotScore === "function" ? options.hotScore : () => 0;
  const itemTime = typeof options.itemTime === "function" ? options.itemTime : () => 0;
  const itemQuality = typeof options.itemQuality === "function" ? options.itemQuality : () => 0;
  const priorityMap = new Map();

  (Array.isArray(options.digestItems) ? options.digestItems : []).forEach((item, index) => {
    const rawScore = item?.importanceScore;
    const score = rawScore === undefined || rawScore === null || rawScore === ""
      ? 100 - index * 4
      : Number(rawScore);
    const value = Math.max(0, Math.min(100, Number.isFinite(score) ? score : 0));
    for (const key of digestKeys(item).filter(Boolean)) priorityMap.set(key, value);
  });

  const priorityScore = (item) => {
    for (const key of itemKeys(item).filter(Boolean)) {
      if (priorityMap.has(key)) return priorityMap.get(key);
    }
    return 0;
  };

  const compareImportant = (left, right) => {
    const qualityDelta = Number(itemQuality(right) || 0) - Number(itemQuality(left) || 0);
    if (qualityDelta) return qualityDelta;
    const priorityDelta = priorityScore(right) - priorityScore(left);
    if (priorityDelta) return priorityDelta;
    const scoreDelta = Number(hotScore(right) || 0) - Number(hotScore(left) || 0);
    if (scoreDelta) return scoreDelta;
    return Number(itemTime(right) || 0) - Number(itemTime(left) || 0);
  };

  return {
    priorityMap,
    compareImportant,
    compareByOrder(order) {
      return order === "time"
        ? (left, right) => {
            const qualityDelta = Number(itemQuality(right) || 0) - Number(itemQuality(left) || 0);
            return qualityDelta || Number(itemTime(right) || 0) - Number(itemTime(left) || 0);
          }
        : compareImportant;
    },
  };
}

export function selectTodayNewsItems(items, options = {}) {
  const compare = typeof options.compare === "function" ? options.compare : () => 0;
  const now = options.now ?? Date.now();
  const recentLimit = Math.max(0, Math.floor(options.recentLimit === undefined ? 3 : Number(options.recentLimit) || 0));
  const pageSize = Math.max(1, Math.floor(Number(options.pageSize) || 10));
  const pageCount = Math.max(1, Math.floor(Number(options.pageCount) || 3));
  const publisherLimit = Math.max(0, Math.min(10, Math.floor(Number(options.publisherLimit) || 0)));
  const seenEvents = new Set();
  const eligible = (Array.isArray(items) ? items : []).map((item) => {
    const article = item?.feedItem || item;
    if (article?.eventRepresentative === false || article?.rankingEligible === false) return null;
    const eventKey = article?.eventId || article?.articleId || article?.entryKey || item?.key || item?.url;
    if (!eventKey || seenEvents.has(eventKey)) return null;
    const scope = newsTimeScope(article, now);
    if (!scope) return null;
    seenEvents.add(eventKey);
    return { item, scope };
  }).filter(Boolean);
  const today = eligible.filter((entry) => entry.scope === "today").map((entry) => entry.item).sort(compare);
  const recent = eligible.filter((entry) => entry.scope === "recent").map((entry) => entry.item).sort(compare).slice(0, recentLimit);
  return arrangePublisherBatches([...today, ...recent], pageSize, pageCount, publisherLimit);
}

export function selectDailyEvents(items, options = {}) {
  const now = options.now ?? Date.now();
  const limit = Math.max(1, Math.floor(Number(options.limit) || 3));
  const recentLimit = Math.max(0, Math.floor(options.recentLimit === undefined ? 1 : Number(options.recentLimit) || 0));
  const minSourceCount = Math.max(1, Math.floor(options.minSourceCount === undefined ? 2 : Number(options.minSourceCount) || 1));
  const sourceCount = (item) => Math.max(1, Number(item?.sourceCount ?? item?.eventSourceCount ?? 1) || 1);
  const compare = (left, right) => sourceCount(right) - sourceCount(left)
    || Number(right?.importanceScore || 0) - Number(left?.importanceScore || 0)
    || Number(right?.localImportanceScore || 0) - Number(left?.localImportanceScore || 0);
  const seenEvents = new Set();
  const scoped = (Array.isArray(items) ? items : []).map((item) => {
    const eventKey = item?.eventId || item?.id || item?.url || item?.title;
    if (!eventKey || seenEvents.has(eventKey) || sourceCount(item) < minSourceCount) return null;
    const resolvedTimeScope = newsTimeScope(item, now) || item?.timeScope || "";
    if (!resolvedTimeScope) return null;
    seenEvents.add(eventKey);
    return { ...item, resolvedTimeScope };
  }).filter(Boolean);
  const today = scoped.filter((item) => item.resolvedTimeScope === "today").sort(compare);
  const recent = scoped.filter((item) => item.resolvedTimeScope === "recent").sort(compare).slice(0, recentLimit);
  return [...today, ...recent].slice(0, limit);
}

function arrangePublisherBatches(items, pageSize, pageCount, publisherLimit) {
  const remaining = [...items];
  const output = [];
  const maxItems = pageSize * pageCount;
  while (remaining.length && output.length < maxItems) {
    const batch = [];
    const deferred = [];
    const counts = new Map();
    for (const item of remaining) {
      const publisher = publisherIdentity(item?.feedItem || item) || "unknown";
      if (publisherLimit && (counts.get(publisher) || 0) >= publisherLimit) {
        deferred.push(item);
        continue;
      }
      counts.set(publisher, (counts.get(publisher) || 0) + 1);
      batch.push(item);
      if (batch.length >= pageSize) break;
    }
    if (batch.length < pageSize) {
      for (const item of deferred) {
        if (batch.includes(item)) continue;
        batch.push(item);
        if (batch.length >= pageSize) break;
      }
    }
    if (!batch.length) break;
    const selected = new Set(batch);
    output.push(...batch);
    for (let index = remaining.length - 1; index >= 0; index -= 1) {
      if (selected.has(remaining[index])) remaining.splice(index, 1);
    }
  }
  return output.slice(0, maxItems);
}

export function mergeRankedUnique(groups, options = {}) {
  const compare = typeof options.compare === "function" ? options.compare : () => 0;
  const keyOf = typeof options.keyOf === "function" ? options.keyOf : (item) => item?.key;
  const limit = Number.isFinite(Number(options.limit)) ? Math.max(0, Math.floor(Number(options.limit))) : Number.POSITIVE_INFINITY;
  if (limit === 0) return [];
  const selected = [];
  const selectedKeys = new Set();
  for (const group of Array.isArray(groups) ? groups : []) {
    for (const item of [...(Array.isArray(group) ? group : [])].sort(compare)) {
      const key = keyOf(item);
      if (!item || !key || selectedKeys.has(key)) continue;
      selectedKeys.add(key);
      selected.push(item);
      if (selected.length >= limit) return selected;
    }
  }
  return selected;
}

export function groupItemsByKey(items, keyOf, predicate = () => true) {
  const groups = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    if (!predicate(item)) continue;
    const key = keyOf(item);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return groups;
}

export function selectUnseenPool(items, seenKeys, limit, keyOf = (item) => item?.key) {
  const seen = seenKeys instanceof Set ? seenKeys : new Set(seenKeys || []);
  const safeLimit = Math.max(0, Math.floor(Number(limit) || 0));
  return (Array.isArray(items) ? items : []).slice(0, safeLimit).filter((item) => !seen.has(keyOf(item)));
}
