export async function loadWithStaleCache(url, adapters = {}) {
  const readCache = typeof adapters.readCache === "function" ? adapters.readCache : async () => null;
  const storeCache = typeof adapters.storeCache === "function" ? adapters.storeCache : async () => {};
  const fetchDocument = adapters.fetchDocument;
  const validateCache = typeof adapters.validateCache === "function" ? adapters.validateCache : async () => true;
  if (typeof fetchDocument !== "function") throw new TypeError("fetchDocument is required");

  let cached = await readCache(url);
  if (cached) {
    try {
      if (!await validateCache(cached)) cached = null;
    } catch {
      cached = null;
    }
  }
  try {
    const reader = await fetchDocument(url);
    try {
      await storeCache(reader);
    } catch {
      // Cache failures must not hide successfully fetched content.
    }
    return reader;
  } catch (error) {
    if (error?.code === "ORIGIN_PERMISSION_REQUIRED") throw error;
    if (!cached) throw error;
    return {
      ...cached,
      requestedUrl: url,
      source: "cache",
      staleReason: error?.message || error?.code || "READER_ERROR",
      staleCode: error?.code || "READER_ERROR",
      staleDetails: error?.details && typeof error.details === "object" ? error.details : {},
    };
  }
}
