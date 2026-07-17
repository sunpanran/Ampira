export function buildPermissionRows(requiredOrigins = [], grantedOrigins = []) {
  const required = normalizedOriginSet(requiredOrigins);
  const granted = normalizedOriginSet(grantedOrigins);
  return [...required]
    .sort((left, right) => left.localeCompare(right))
    .map((origin) => ({ origin, granted: granted.has(origin) }));
}

export function normalizeOriginPattern(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (text.includes("*")) {
    const exactWildcard = text.match(/^(https:\/\/[^/*]+|http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?)\/\*$/i);
    if (!exactWildcard) return "";
    return originPattern(exactWildcard[1]);
  }
  return originPattern(text);
}

export function originPattern(value) {
  try {
    const url = new URL(String(value || "").trim());
    if (url.username || url.password) return "";
    if (url.protocol === "https:") return `${url.origin}/*`;
    if (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)) return `${url.origin}/*`;
  } catch {
    // Invalid values are not permission origins.
  }
  return "";
}

export function revokedSourceKeys(sources = [], removedOrigins = []) {
  const removed = normalizedOriginSet(removedOrigins);
  return new Set((Array.isArray(sources) ? sources : [])
    .filter((source) => patternIsRemoved(originPattern(source?.url), removed))
    .map((source) => String(source?.key || ""))
    .filter(Boolean));
}

export function filterRevokedFeedItems(items = [], removedOrigins = [], sourceKeys = new Set()) {
  const removed = normalizedOriginSet(removedOrigins);
  const revokedKeys = sourceKeys instanceof Set ? sourceKeys : new Set(sourceKeys || []);
  return (Array.isArray(items) ? items : []).filter((item) => {
    if (revokedKeys.has(String(item?.sourceKey || ""))) return false;
    const sourcePattern = originPattern(item?.sourceOrigin || "");
    if (!sourcePattern) return false;
    const fetchPattern = originPattern(item?.fetchOrigin || item?.sourceOrigin || "");
    return Boolean(fetchPattern && !patternIsRemoved(sourcePattern, removed) && !patternIsRemoved(fetchPattern, removed));
  });
}

export function filterFeedItemsBySources(items = [], sources = [], grantedOrigins = []) {
  const expectedByKey = new Map((Array.isArray(sources) ? sources : [])
    .map((source) => [String(source?.key || ""), originPattern(source?.url || "")])
    .filter(([key, pattern]) => key && pattern));
  const granted = normalizedOriginSet(grantedOrigins);
  return (Array.isArray(items) ? items : []).filter((item) => {
    const expected = expectedByKey.get(String(item?.sourceKey || ""));
    if (!expected) return false;
    const actual = originPattern(item?.sourceOrigin || "");
    if (!actual || actual !== expected) return false;
    const fetchPattern = originPattern(item?.fetchOrigin || item?.sourceOrigin || "");
    if (!fetchPattern) return false;
    if (fetchPattern === actual) return true;
    return granted.has(fetchPattern);
  });
}

export function valueTouchesOrigins(value, removedOrigins = []) {
  const removed = normalizedOriginSet(removedOrigins);
  if (!removed.size) return false;
  return visit(value, removed, new Set());
}

function visit(value, removed, seen) {
  if (typeof value === "string") {
    const pattern = originPattern(value);
    return Boolean(pattern && patternIsRemoved(pattern, removed));
  }
  if (!value || typeof value !== "object" || seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) return value.some((entry) => visit(entry, removed, seen));
  return Object.values(value).some((entry) => visit(entry, removed, seen));
}

function normalizedOriginSet(values) {
  return new Set((Array.isArray(values) ? values : [])
    .map(normalizeOriginPattern)
    .filter(Boolean));
}

function patternIsRemoved(pattern, removed) {
  return Boolean(pattern && removed.has(pattern));
}
