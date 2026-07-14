export function createSitePreviewController(options) {
  const cache = new Map();
  const pending = new Map();
  const pendingImages = new Map();
  const retryTimers = new Map();
  const retryAttempts = new Map();
  const retryDelaysMs = normalizeRetryDelays(options.retryDelaysMs);
  let generation = 0;

  return { get, request, preload, reject, invalidate, fingerprint };

  function fingerprint(item) {
    return sitePreviewFingerprint(item, options.normalizeUrl);
  }

  function get(item) {
    return cache.get(fingerprint(item)) || null;
  }

  function reject(item, failedImageUrl = "") {
    const key = fingerprint(item);
    const current = key ? cache.get(key) : null;
    if (!key || (failedImageUrl && current?.imageUrl !== failedImageUrl)) return Promise.resolve(null);
    const remaining = [...new Set((Array.isArray(current?.imageUrls) ? current.imageUrls : [])
      .map((value) => String(value || "").trim())
      .filter((value) => value && value !== failedImageUrl && value !== current?.imageUrl))];
    if (current?.source === "origin" && remaining.length) {
      const next = { ...current, imageUrl: remaining[0], imageUrls: remaining };
      cache.set(key, next);
      options.onImage(item, next.imageUrl, key);
      return Promise.resolve(next);
    }
    cache.set(key, { imageUrl: "", imageUrls: [] });
    if (current?.source !== "origin" || (typeof options.canFallback === "function" && !options.canFallback())) {
      return Promise.resolve(null);
    }
    return request(item, { mode: "brave-only" });
  }

  function invalidate() {
    generation += 1;
    for (const timer of retryTimers.values()) clearTimeout(timer);
    cache.clear();
    pending.clear();
    pendingImages.clear();
    retryTimers.clear();
    retryAttempts.clear();
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
    for (let attempt = 0; attempt < 5 && preview?.imageUrl; attempt += 1) {
      if (await preloadImage(preview.imageUrl)) return preview;
      preview = await reject(item, preview.imageUrl);
    }
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
    cancelRetryTimer(pendingKey);
    const requestGeneration = generation;
    const operation = Promise.resolve()
      .then(() => options.apiGet(`/api/site-preview?url=${encodeURIComponent(item.url)}&title=${encodeURIComponent(item.title || "")}&mode=${mode}`))
      .then((preview) => {
        if (!isCurrent(item, key, requestGeneration)) return null;
        const normalized = preview && typeof preview === "object"
          ? {
              ...preview,
              imageUrls: [...new Set((Array.isArray(preview.imageUrls) ? preview.imageUrls : [preview.imageUrl])
                .map((value) => String(value || "").trim()).filter(Boolean))],
            }
          : {};
        if (!normalized.imageUrl && isTransientPreviewFailure(normalized)) {
          scheduleRetry(item, key, pendingKey, mode, requestGeneration);
          return normalized;
        }
        cache.set(key, normalized);
        clearRetryState(pendingKey);
        if (normalized.imageUrl) options.onImage(item, normalized.imageUrl, key);
        return normalized;
      })
      .catch((error) => {
        if (!isCurrent(item, key, requestGeneration)) return null;
        if (error?.retryable !== false) {
          scheduleRetry(item, key, pendingKey, mode, requestGeneration);
        } else {
          cache.set(key, { imageUrl: "", imageUrls: [] });
          clearRetryState(pendingKey);
        }
        return null;
      })
      .finally(() => {
        if (pending.get(pendingKey) === operation) pending.delete(pendingKey);
      });
    pending.set(pendingKey, operation);
    return operation;
  }

  function scheduleRetry(item, key, pendingKey, mode, requestGeneration) {
    if (retryTimers.has(pendingKey)) return;
    const attempt = retryAttempts.get(pendingKey) || 0;
    if (attempt >= retryDelaysMs.length) return;
    retryAttempts.set(pendingKey, attempt + 1);
    const timer = setTimeout(() => {
      if (retryTimers.get(pendingKey) !== timer) return;
      retryTimers.delete(pendingKey);
      if (!isCurrent(item, key, requestGeneration)) {
        retryAttempts.delete(pendingKey);
        return;
      }
      request(item, { mode }).catch(() => {});
    }, retryDelaysMs[attempt]);
    retryTimers.set(pendingKey, timer);
  }

  function cancelRetryTimer(pendingKey) {
    const timer = retryTimers.get(pendingKey);
    if (timer === undefined) return;
    clearTimeout(timer);
    retryTimers.delete(pendingKey);
  }

  function clearRetryState(pendingKey) {
    cancelRetryTimer(pendingKey);
    retryAttempts.delete(pendingKey);
  }

  function isCurrent(item, key, requestGeneration) {
    return requestGeneration === generation && options.isEnabled() && options.isCurrent(item, key);
  }
}

function normalizeRetryDelays(value) {
  const delays = value === undefined ? [750, 2000] : value;
  return (Array.isArray(delays) ? delays : [])
    .map((delay) => Number(delay))
    .filter((delay) => Number.isFinite(delay) && delay >= 0);
}

function isTransientPreviewFailure(preview) {
  if (preview?.retryable === false) return false;
  return preview?.retryable === true || preview?.originalStatus === "error";
}

export function sitePreviewFingerprint(item, normalizeUrl = (value) => String(value || "").trim()) {
  const key = String(item?.key || "").trim();
  const url = normalizeUrl(item?.url || "");
  const title = String(item?.title || "").replace(/\s+/g, " ").trim();
  return key && url ? `${key}|${url}|${title}` : "";
}

export const createInspirationPreviewController = createSitePreviewController;
export const inspirationPreviewFingerprint = sitePreviewFingerprint;
