import { decodeResponseBuffer, fetchBounded } from "./network.mjs";
import { readerError } from "./reader-errors.mjs";

export const READER_REQUEST_TIMEOUT_MS = 12000;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

export async function fetchReaderHtml(url, timeoutMs = READER_REQUEST_TIMEOUT_MS, options = {}) {
  let response;
  let buffer;
  try {
    const bounded = await fetchBounded(url, {
      redirect: "error",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      headers: { accept: "text/html, application/xhtml+xml;q=0.9, text/plain;q=0.5, */*;q=0.1" },
    }, {
      timeoutMs,
      maxBytes: MAX_RESPONSE_BYTES,
      validateResponse: options.validateResponse,
    });
    response = bounded.response;
    buffer = bounded.buffer;
  } catch (error) {
    if (error?.messageKey) throw error;
    if (error?.code === "NETWORK_TIMEOUT") throw readerError("READER_TIMEOUT", true, { url });
    if (error?.code === "RESPONSE_TOO_LARGE") throw readerError("READER_RESPONSE_TOO_LARGE", false, error.details);
    throw readerError("READER_NETWORK_ERROR", true, { url });
  }
  if (!response.ok) throw responseError(response, url);
  const contentType = response.headers.get("content-type") || "";
  const text = decodeResponseBuffer(buffer, contentType);
  if (!looksLikeReadableHtml(text, contentType)) {
    throw readerError("READER_UNSUPPORTED_CONTENT", false, { status: response.status, url: response.url || url });
  }
  return { text, url: response.url || url, contentType };
}

function looksLikeReadableHtml(text, contentType) {
  if (/text\/(?:html|plain)|application\/xhtml\+xml/i.test(contentType)) return true;
  return /<(?:html|head|body|article|main)\b/i.test(String(text).slice(0, 2000));
}

function responseError(response, requestedUrl) {
  const details = { status: response.status, url: response.url || requestedUrl };
  if (response.status === 404 || response.status === 410) return readerError("READER_NOT_FOUND", false, details);
  if (response.status === 401 || response.status === 403) return readerError("READER_ACCESS_DENIED", false, details);
  const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
  return readerError("READER_HTTP_ERROR", retryable, details);
}
