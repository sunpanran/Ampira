const TITLE_KEYS = Object.freeze({
  ORIGIN_PERMISSION_REQUIRED: "reader.error.permissionTitle",
  READER_NOT_FOUND: "reader.error.notFoundTitle",
  READER_ACCESS_DENIED: "reader.error.deniedTitle",
  READER_TIMEOUT: "reader.error.timeoutTitle",
  READER_RESPONSE_TOO_LARGE: "reader.error.tooLargeTitle",
  READER_UNSUPPORTED_CONTENT: "reader.error.unsupportedTitle",
  READER_EXTRACTION_EMPTY: "reader.error.emptyTitle",
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
