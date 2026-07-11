export function createInspirationPreviewController(options) {
  const cache = new Map();
  const pending = new Map();
  let generation = 0;

  return { get, request, reject, invalidate, fingerprint };

  function fingerprint(item) {
    return inspirationPreviewFingerprint(item, options.normalizeUrl);
  }

  function get(item) {
    return cache.get(fingerprint(item)) || null;
  }

  function reject(item) {
    const key = fingerprint(item);
    if (key) cache.set(key, { imageUrl: "" });
  }

  function invalidate() {
    generation += 1;
    cache.clear();
    pending.clear();
  }

  function request(item) {
    if (!options.isEnabled() || !item?.key || !options.isHttpUrl(item.url)) return Promise.resolve(null);
    const key = fingerprint(item);
    if (!key || cache.has(key)) return Promise.resolve(cache.get(key) || null);
    if (pending.has(key)) return pending.get(key);
    const requestGeneration = generation;
    const operation = Promise.resolve()
      .then(() => options.apiGet(`/api/site-preview?url=${encodeURIComponent(item.url)}&title=${encodeURIComponent(item.title || "")}`))
      .then((preview) => {
        if (!isCurrent(item, key, requestGeneration)) return null;
        const normalized = preview && typeof preview === "object" ? preview : {};
        cache.set(key, normalized);
        if (normalized.imageUrl) options.onImage(item, normalized.imageUrl, key);
        return normalized;
      })
      .catch(() => {
        if (isCurrent(item, key, requestGeneration)) cache.set(key, { imageUrl: "" });
        return null;
      })
      .finally(() => {
        if (pending.get(key) === operation) pending.delete(key);
      });
    pending.set(key, operation);
    return operation;
  }

  function isCurrent(item, key, requestGeneration) {
    return requestGeneration === generation && options.isEnabled() && options.isCurrent(item, key);
  }
}

export function inspirationPreviewFingerprint(item, normalizeUrl = (value) => String(value || "").trim()) {
  const key = String(item?.key || "").trim();
  const url = normalizeUrl(item?.url || "");
  const title = String(item?.title || "").replace(/\s+/g, " ").trim();
  return key && url ? `${key}|${url}|${title}` : "";
}
