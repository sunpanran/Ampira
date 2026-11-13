import { finiteTime, newsTimeScope, publisherIdentity, verifiedTime } from "../../extension/core/news-item-model.mjs";
import { eventImportance } from "../../extension/core/daily-events.mjs";

const HIGH_CONFIDENCE_SINGLE_MAX_AGE_MS = 12 * 60 * 60 * 1000;

export function localizationPending(item) {
  return item?.localizationPending === true || item?.feedItem?.localizationPending === true;
}

export function compareLocalization(left, right) {
  return Number(localizationPending(left)) - Number(localizationPending(right));
}

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
    const languageDelta = compareLocalization(left, right);
    if (languageDelta) return languageDelta;
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
            return compareLocalization(left, right) || qualityDelta || Number(itemTime(right) || 0) - Number(itemTime(left) || 0);
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
    if (article?.rankingEligible === false) return null;
    const eventKey = article?.todayNewsId || article?.eventId || article?.articleId || article?.entryKey || item?.key || item?.url;
    if (!eventKey) return null;
    const scope = newsTimeScope(article, now);
    if (!scope) return null;
    return { item, scope, eventKey };
  }).filter(Boolean).sort((left, right) => compareLocalization(left.item, right.item)
    || Number(right.scope === "today") - Number(left.scope === "today")
    || compare(left.item, right.item)
    || verifiedTime(right.item?.feedItem || right.item) - verifiedTime(left.item?.feedItem || left.item))
    .filter(({ eventKey }) => {
      if (seenEvents.has(eventKey)) return false;
      seenEvents.add(eventKey);
      return true;
    });
  const today = eligible.filter((entry) => entry.scope === "today").map((entry) => entry.item).sort(compare);
  const recent = eligible.filter((entry) => entry.scope === "recent").map((entry) => entry.item)
    .sort((a, b) => compareLocalization(a, b) || compare(a, b)).slice(0, recentLimit);
  return arrangePublisherBatches([...today, ...recent], pageSize, pageCount, publisherLimit);
}

export function selectDailyEvents(items, options = {}) {
  const now = finiteTime(options.now, Date.now());
  const limit = Math.max(0, Math.floor(options.limit === undefined ? 3 : Number(options.limit) || 0));
  const recentLimit = Math.max(0, Math.floor(options.recentLimit === undefined ? 1 : Number(options.recentLimit) || 0));
  const minSourceCount = Math.max(1, Math.floor(options.minSourceCount === undefined ? 2 : Number(options.minSourceCount) || 1));
  const sourceCount = (item) => {
    const count = Number(item?.sourceCount ?? item?.eventSourceCount ?? 1);
    return Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  };
  const eventKey = (item) => String(item?.eventId || item?.id || item?.url || item?.title || "");
  const compare = (left, right) => eventImportance(right) - eventImportance(left)
    || sourceCount(right) - sourceCount(left)
    || verifiedTime(right) - verifiedTime(left)
    || eventKey(left).localeCompare(eventKey(right));
  const scoped = (Array.isArray(items) ? items : []).flatMap((item) => {
    if (!item || item.eventRepresentative === false || item.rankingEligible === false || !eventKey(item)) return [];
    const resolvedTimeScope = newsTimeScope(item, now);
    return resolvedTimeScope ? [{ ...item, resolvedTimeScope }] : [];
  });
  const selected = [];
  const seenEvents = new Set();
  let recentCount = 0;
  let singleCount = 0;
  for (const pending of [false, true]) {
    const group = scoped.filter((item) => localizationPending(item) === pending);
    const corroborated = group.filter((item) => sourceCount(item) >= minSourceCount);
    const single = group.filter((item) => sourceCount(item) === 1
      && item.eventConfidence === "high-confidence-single"
      && item.resolvedTimeScope === "today"
      && isFreshHighConfidenceSingle(item, now));
    const ordered = [
      ...corroborated.filter((item) => item.resolvedTimeScope === "today").sort(compare),
      ...corroborated.filter((item) => item.resolvedTimeScope === "recent").sort(compare),
      ...single.sort(compare),
    ];
    for (const item of ordered) {
      if (selected.length >= limit) return selected;
      const key = eventKey(item);
      const recent = item.resolvedTimeScope === "recent";
      const fallback = sourceCount(item) < minSourceCount;
      if (seenEvents.has(key) || recent && recentCount >= recentLimit || fallback && singleCount >= 1) continue;
      selected.push(item);
      seenEvents.add(key);
      if (recent) recentCount += 1;
      if (fallback) singleCount += 1;
    }
  }
  return selected;
}

function isFreshHighConfidenceSingle(item, nowValue) {
  const publishedAt = verifiedTime(item);
  const age = nowValue - publishedAt;
  return publishedAt > 0 && age >= 0 && age <= HIGH_CONFIDENCE_SINGLE_MAX_AGE_MS;
}

function arrangePublisherBatches(items, pageSize, pageCount, publisherLimit) {
  const remaining = [...items].sort(compareLocalization);
  const output = [];
  const maxItems = pageSize * pageCount;
  while (remaining.length && output.length < maxItems) {
    const batch = [];
    const deferred = [];
    const counts = new Map();
    for (const item of remaining) {
      if (localizationPending(item) && !localizationPending(remaining[0])) break;
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
    // Only fill with untranslated items once every readable item is selected.
    if (batch.length < pageSize && !remaining.some((item) => !localizationPending(item) && !batch.includes(item))) {
      for (const item of remaining.filter(localizationPending)) {
        if (!batch.includes(item)) batch.push(item);
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
  const inputGroups = Array.isArray(groups) ? groups : [];
  const orderedGroups = [false, true].flatMap((pending) => inputGroups.map((group) => (
    (Array.isArray(group) ? group : []).filter((item) => localizationPending(item) === pending)
  )));
  for (const group of orderedGroups) {
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
