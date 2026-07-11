const DEFAULT_REFRESH_SOURCE_LIMIT = 80;

export function selectRefreshSources(sources, limit = DEFAULT_REFRESH_SOURCE_LIMIT) {
  return selectRefreshBatch(sources, 0, limit).sources;
}

export function selectRefreshBatch(sources, cursor = 0, limit = DEFAULT_REFRESH_SOURCE_LIMIT) {
  const list = Array.isArray(sources) ? sources : [];
  const safeLimit = Math.max(0, Math.floor(Number(limit) || 0));
  const requestedCursor = Math.max(0, Math.floor(Number(cursor) || 0));
  const start = requestedCursor < list.length ? requestedCursor : 0;
  const selected = list.slice(start, start + safeLimit);
  const nextCursor = selected.length && start + selected.length < list.length ? start + selected.length : 0;
  return { sources: selected, nextCursor };
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
