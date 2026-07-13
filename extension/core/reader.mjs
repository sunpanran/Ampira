import { loadWithStaleCache } from "./reader-cache.mjs";
import { extractReaderDocument } from "./reader-document.mjs";
import { fetchReaderHtml, READER_REQUEST_TIMEOUT_MS } from "./reader-network.mjs";

export { extractPageMetadata, extractReaderDocument, readerTextFromBlocks } from "./reader-document.mjs";
export { fetchReaderHtml } from "./reader-network.mjs";

export async function fetchReader(url, timeoutOrOptions = READER_REQUEST_TIMEOUT_MS) {
  const options = typeof timeoutOrOptions === "object" && timeoutOrOptions ? timeoutOrOptions : {};
  const timeoutMs = typeof timeoutOrOptions === "number" ? timeoutOrOptions : (options.timeoutMs || READER_REQUEST_TIMEOUT_MS);
  const response = await fetchReaderHtml(url, timeoutMs, options);
  return extractReaderDocument(response.text, response.url, url);
}

export async function loadReaderWithCache(url, adapters = {}) {
  return loadWithStaleCache(url, {
    ...adapters,
    fetchDocument: typeof adapters.fetchDocument === "function" ? adapters.fetchDocument : fetchReader,
  });
}
