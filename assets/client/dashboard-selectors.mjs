export function createPriorityRanker(options = {}) {
  const digestKeys = typeof options.digestKeys === "function" ? options.digestKeys : () => [];
  const itemKeys = typeof options.itemKeys === "function" ? options.itemKeys : () => [];
  const hotScore = typeof options.hotScore === "function" ? options.hotScore : () => 0;
  const itemTime = typeof options.itemTime === "function" ? options.itemTime : () => 0;
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
        ? (left, right) => Number(itemTime(right) || 0) - Number(itemTime(left) || 0)
        : compareImportant;
    },
  };
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
  return (Array.isArray(items) ? items : []).filter((item) => !seen.has(keyOf(item))).slice(0, safeLimit);
}
