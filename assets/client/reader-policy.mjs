const TITLE_KEYS = Object.freeze({
  ORIGIN_PERMISSION_REQUIRED: "reader.error.permissionTitle",
  READER_NOT_FOUND: "reader.error.notFoundTitle",
  READER_ACCESS_DENIED: "reader.error.deniedTitle",
  READER_TIMEOUT: "reader.error.timeoutTitle",
  READER_RESPONSE_TOO_LARGE: "reader.error.tooLargeTitle",
  READER_UNSUPPORTED_CONTENT: "reader.error.unsupportedTitle",
  READER_EXTRACTION_EMPTY: "reader.error.emptyTitle",
  READER_NETWORK_ERROR: "reader.error.networkTitle",
  READER_HTTP_ERROR: "reader.error.httpTitle",
});

const BODY_KEYS = Object.freeze({
  ORIGIN_PERMISSION_REQUIRED: "reader.error.permissionBody",
  READER_NOT_FOUND: "reader.error.notFoundBody",
  READER_ACCESS_DENIED: "reader.error.deniedBody",
  READER_TIMEOUT: "reader.error.timeoutBody",
  READER_RESPONSE_TOO_LARGE: "reader.error.tooLargeBody",
  READER_UNSUPPORTED_CONTENT: "reader.error.unsupportedBody",
  READER_EXTRACTION_EMPTY: "reader.error.emptyBody",
  READER_NETWORK_ERROR: "reader.error.networkBody",
  READER_HTTP_ERROR: "reader.error.httpBody",
  READER_ERROR: "reader.error.staleBody",
});

export function readerErrorTitleKey(code) {
  return TITLE_KEYS[code] || "reader.error.genericTitle";
}

export function readerErrorBodyKey(code) {
  return BODY_KEYS[code] || "";
}

export function readerLocalFallback(item, url, fallbackTitle = "") {
  const groups = [
    item?.summary?.summary,
    item?.feedItem?.summary,
    [item?.summary?.description],
    [item?.feedItem?.excerpt],
    [item?.excerpt],
  ];
  const lines = groups.map(cleanFallbackLines).find((values) => values.length) || [];
  if (!lines.length) return null;
  const title = firstFallbackText(item?.summary?.title, item?.feedItem?.title, item?.title, fallbackTitle);
  const siteName = firstFallbackText(item?.publisher, item?.summary?.sourceTitle, item?.host, safeReaderHost(url));
  return {
    ok: true,
    schemaVersion: 2,
    requestedUrl: String(url || ""),
    url: String(url || ""),
    canonicalUrl: String(url || ""),
    title,
    siteName,
    publishedAt: firstFallbackText(item?.summary?.publishedAt, item?.feedItem?.publishedAt),
    blocks: lines.map((text) => ({ type: "paragraph", runs: [{ text }] })),
    quality: "partial",
    source: "local-excerpt",
  };
}

export function safeReaderOrigin(value) {
  try {
    const url = new URL(value);
    if (url.protocol === "https:" || url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)) return url.origin;
  } catch {
    return "";
  }
  return "";
}

export function sameOrigin(left, right) {
  try {
    return new URL(left).origin === new URL(right).origin;
  } catch {
    return false;
  }
}

function cleanFallbackLines(values) {
  const seen = new Set();
  const lines = [];
  for (const value of Array.isArray(values) ? values : []) {
    const text = String(value || "").replace(/\s+/g, " ").trim().slice(0, 1200);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    lines.push(text);
    if (lines.length >= 3) break;
  }
  return lines;
}

function firstFallbackText(...values) {
  return values.map((value) => String(value || "").trim()).find(Boolean) || "";
}

function safeReaderHost(value) {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
