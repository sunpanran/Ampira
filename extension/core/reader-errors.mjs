import { DEFAULT_LOCALE, translate } from "./runtime-i18n.mjs";

export function readerError(code, retryable, details = {}) {
  const messageKey = readerMessageKey(code);
  const messageParams = Number.isFinite(Number(details.status)) ? { status: Number(details.status) } : {};
  const error = new Error(translate(DEFAULT_LOCALE, messageKey, messageParams));
  error.code = code;
  error.messageKey = messageKey;
  error.messageParams = messageParams;
  error.retryable = retryable === true;
  error.details = details;
  return error;
}

function readerMessageKey(code) {
  return {
    READER_NOT_FOUND: "reader.error.notFoundBody",
    READER_ACCESS_DENIED: "reader.error.deniedBody",
    READER_TIMEOUT: "reader.error.timeoutBody",
    READER_RESPONSE_TOO_LARGE: "reader.error.tooLargeBody",
    READER_UNSUPPORTED_CONTENT: "reader.error.unsupportedBody",
    READER_EXTRACTION_EMPTY: "reader.error.emptyBody",
    READER_NETWORK_ERROR: "reader.error.networkBody",
    READER_HTTP_ERROR: "reader.error.httpBody",
  }[code] || "reader.error.genericBody";
}
