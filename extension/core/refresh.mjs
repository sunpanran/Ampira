const DEFAULT_REFRESH_SOURCE_LIMIT = 80;

export function selectRefreshSources(sources, limit = DEFAULT_REFRESH_SOURCE_LIMIT) {
  return selectRefreshBatch(sources, 0, limit).sources;
}

export function selectRefreshBatch(sources, cursor = 0, limit = DEFAULT_REFRESH_SOURCE_LIMIT, options = {}) {
  const list = Array.isArray(sources) ? sources : [];
  const safeLimit = Math.max(0, Math.floor(Number(limit) || 0));
  const isPriority = typeof options.priority === "function" ? options.priority : () => false;
  const priority = list.filter((source) => isPriority(source)).slice(0, safeLimit);
  const rotating = list.filter((source) => !isPriority(source));
  const requestedCursor = Math.max(0, Math.floor(Number(cursor) || 0));
  const start = requestedCursor < rotating.length ? requestedCursor : 0;
  const selected = rotating.slice(start, start + Math.max(0, safeLimit - priority.length));
  const nextCursor = selected.length && start + selected.length < rotating.length ? start + selected.length : 0;
  return { sources: [...priority, ...selected], nextCursor };
}

export function retainActiveUnrefreshedItems(previousItems, activeSources, refreshedSources) {
  const activeKeys = sourceKeys(activeSources);
  const refreshedKeys = sourceKeys(refreshedSources);
  return (Array.isArray(previousItems) ? previousItems : []).filter((item) => {
    const key = String(item?.sourceKey || "");
    return key && activeKeys.has(key) && !refreshedKeys.has(key);
  });
}

function sourceKeys(sources) {
  return new Set((Array.isArray(sources) ? sources : []).map((source) => String(source?.key || "")).filter(Boolean));
}
