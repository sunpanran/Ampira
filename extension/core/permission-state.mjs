export function buildPermissionRows(requiredOrigins = [], grantedOrigins = []) {
  const required = normalizedOriginSet(requiredOrigins);
  const granted = normalizedOriginSet(grantedOrigins);
  const origins = [...new Set([...required, ...granted])];
  return origins
    .map((origin) => {
      const directlyGranted = granted.has(origin);
      const coveredByBroad = !directlyGranted && [...granted].some((pattern) => broadPatternCovers(pattern, origin));
      const coversRequired = directlyGranted && [...required].some((requiredOrigin) => (
        !granted.has(requiredOrigin) && broadPatternCovers(origin, requiredOrigin)
      ));
      return {
        origin,
        granted: directlyGranted || coveredByBroad,
        directlyGranted,
        coveredByBroad,
        coversRequired,
        required: required.has(origin),
        legacy: directlyGranted && !required.has(origin) && !coversRequired,
      };
    })
    .sort((left, right) => (
      Number(right.required) - Number(left.required)
      || Number(right.coversRequired) - Number(left.coversRequired)
      || left.origin.localeCompare(right.origin)
    ));
}

export function normalizeOriginPattern(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (["https://*/*", "http://*/*", "*://*/*"].includes(text.toLowerCase())) {
    return text.toLowerCase();
  }
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
    return !patternIsRemoved(sourcePattern, removed);
  });
}

export function filterFeedItemsBySources(items = [], sources = []) {
  const expectedByKey = new Map((Array.isArray(sources) ? sources : [])
    .map((source) => [String(source?.key || ""), originPattern(source?.url || "")])
    .filter(([key, pattern]) => key && pattern));
  return (Array.isArray(items) ? items : []).filter((item) => {
    const expected = expectedByKey.get(String(item?.sourceKey || ""));
    if (!expected) return false;
    const actual = originPattern(item?.sourceOrigin || "");
    return Boolean(actual && actual === expected);
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
  return Boolean(pattern && (removed.has(pattern) || [...removed].some((candidate) => broadPatternCovers(candidate, pattern))));
}

function broadPatternCovers(broad, exact) {
  if (broad === "*://*/*") return exact.startsWith("https://") || exact.startsWith("http://");
  if (broad === "https://*/*") return exact.startsWith("https://");
  if (broad === "http://*/*") return exact.startsWith("http://");
  return false;
}
