export function createInspirationPreviewController(options) {
  const cache = new Map();
  const pending = new Map();
  const pendingImages = new Map();
  let generation = 0;

  return { get, request, preload, reject, invalidate, fingerprint };

  function fingerprint(item) {
    return inspirationPreviewFingerprint(item, options.normalizeUrl);
  }

  function get(item) {
    return cache.get(fingerprint(item)) || null;
  }

  function reject(item, failedImageUrl = "") {
    const key = fingerprint(item);
    const current = key ? cache.get(key) : null;
    if (!key || (failedImageUrl && current?.imageUrl !== failedImageUrl)) return Promise.resolve(null);
    cache.set(key, { imageUrl: "" });
    if (current?.source !== "origin" || (typeof options.canFallback === "function" && !options.canFallback())) {
      return Promise.resolve(null);
    }
    return request(item, { mode: "brave-only" });
  }

  function invalidate() {
    generation += 1;
    cache.clear();
    pending.clear();
    pendingImages.clear();
  }

  async function preload(items, preloadOptions = {}) {
    const unique = new Map();
    for (const item of items || []) {
      const key = fingerprint(item);
      if (key && !unique.has(key)) unique.set(key, item);
    }
    const work = Promise.allSettled([...unique.values()].map(preloadItem));
    const timeoutMs = Number(preloadOptions.timeoutMs || 0);
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return work;
    let timer = 0;
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => resolve([]), timeoutMs);
    });
    return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
  }

  async function preloadItem(item) {
    let preview = await request(item);
    if (!preview?.imageUrl) return preview;
    if (await preloadImage(preview.imageUrl)) return preview;
    preview = await reject(item, preview.imageUrl);
    if (!preview?.imageUrl) return preview;
    if (await preloadImage(preview.imageUrl)) return preview;
    await reject(item, preview.imageUrl);
    return null;
  }

  function preloadImage(imageUrl) {
    if (typeof options.preloadImage !== "function") return Promise.resolve(true);
    const url = String(imageUrl || "").trim();
    if (!url) return Promise.resolve(false);
    if (pendingImages.has(url)) return pendingImages.get(url);
    const operation = Promise.resolve()
      .then(() => options.preloadImage(url))
      .then((loaded) => loaded !== false)
      .catch(() => false)
      .finally(() => {
        if (pendingImages.get(url) === operation) pendingImages.delete(url);
      });
    pendingImages.set(url, operation);
    return operation;
  }

  function request(item, requestOptions = {}) {
    if (!options.isEnabled() || !item?.key || !options.isHttpUrl(item.url)) return Promise.resolve(null);
    const key = fingerprint(item);
    const mode = requestOptions.mode === "brave-only" ? "brave-only" : "prefer-origin";
    if (!key || (mode === "prefer-origin" && cache.has(key))) return Promise.resolve(cache.get(key) || null);
    const pendingKey = mode === "brave-only" ? `${key}|brave-only` : key;
    if (pending.has(pendingKey)) return pending.get(pendingKey);
    const requestGeneration = generation;
    const operation = Promise.resolve()
      .then(() => options.apiGet(`/api/site-preview?url=${encodeURIComponent(item.url)}&title=${encodeURIComponent(item.title || "")}&mode=${mode}`))
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
        if (pending.get(pendingKey) === operation) pending.delete(pendingKey);
      });
    pending.set(pendingKey, operation);
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
