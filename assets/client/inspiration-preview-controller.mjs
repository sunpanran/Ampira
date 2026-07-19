export function createSitePreviewController(options) {
  const cache = new Map();
  const pending = new Map();
  const pendingImages = new Map();
  const retryTimers = new Map();
  const retryAttempts = new Map();
  const rejectedImages = new Set();
  const retryDelaysMs = normalizeRetryDelays(options.retryDelaysMs);
  let generation = 0;

  return { get, request, preload, reject, rejectUrl, isRejected, invalidate, fingerprint };

  function fingerprint(item) {
    return sitePreviewFingerprint(item, options.normalizeUrl, profile(item));
  }

  function get(item) {
    return withoutRejectedImages(item, cache.get(fingerprint(item)) || null);
  }

  function reject(item, failedImageUrl = "") {
    rejectUrl(item, failedImageUrl);
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
    if (profile(item) !== "visual"
      || current?.source !== "origin"
      || (typeof options.canFallback === "function" && !options.canFallback())) {
      return Promise.resolve(null);
    }
    return request(item, { mode: "brave-only" });
  }

  function rejectUrl(item, failedImageUrl = "") {
    const url = String(failedImageUrl || "").trim();
    if (url) rejectedImages.add(rejectedImageKey(item, url));
  }

  function isRejected(item, imageUrl = "") {
    const url = String(imageUrl || "").trim();
    return Boolean(url) && rejectedImages.has(rejectedImageKey(item, url));
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
      if (await preloadImage(item, preview.imageUrl)) return preview;
      preview = await reject(item, preview.imageUrl);
    }
    return null;
  }

  function preloadImage(item, imageUrl) {
    if (typeof options.preloadImage !== "function") return Promise.resolve(true);
    const url = String(imageUrl || "").trim();
    if (!url) return Promise.resolve(false);
    const imageKey = `${profile(item)}|${url}`;
    if (pendingImages.has(imageKey)) return pendingImages.get(imageKey);
    const operation = Promise.resolve()
      .then(() => options.preloadImage(url, { profile: profile(item) }))
      .then((loaded) => loaded !== false)
      .catch(() => false)
      .finally(() => {
        if (pendingImages.get(imageKey) === operation) pendingImages.delete(imageKey);
      });
    pendingImages.set(imageKey, operation);
    return operation;
  }

  function request(item, requestOptions = {}) {
    if (!options.isEnabled() || !item?.key || !options.isHttpUrl(item.url)) return Promise.resolve(null);
    const key = fingerprint(item);
    const mode = requestOptions.mode === "brave-only" ? "brave-only" : "prefer-origin";
    if (!key) return Promise.resolve(null);
    if (mode === "prefer-origin" && cache.has(key)) {
      const cached = withoutRejectedImages(item, cache.get(key));
      if (shouldTryBrave(item, cached)) return request(item, { mode: "brave-only" });
      return Promise.resolve(cached || null);
    }
    const pendingKey = mode === "brave-only" ? `${key}|brave-only` : key;
    if (pending.has(pendingKey)) return pending.get(pendingKey);
    cancelRetryTimer(pendingKey);
    const requestGeneration = generation;
    const operation = Promise.resolve()
      .then(() => options.apiGet(`/api/site-preview?url=${encodeURIComponent(item.url)}&title=${encodeURIComponent(item.title || "")}&mode=${mode}&profile=${profile(item)}`))
      .then((preview) => {
        if (!isCurrent(item, key, requestGeneration)) return null;
        const normalized = withoutRejectedImages(item, preview && typeof preview === "object"
          ? {
              ...preview,
              imageUrls: [...new Set((Array.isArray(preview.imageUrls) ? preview.imageUrls : [preview.imageUrl])
                .map((value) => String(value || "").trim()).filter(Boolean))],
            }
          : {});
        if (!normalized.imageUrl && isTransientPreviewFailure(normalized)) {
          scheduleRetry(item, key, pendingKey, mode, requestGeneration);
          return normalized;
        }
        cache.set(key, normalized);
        clearRetryState(pendingKey);
        if (mode === "prefer-origin" && shouldTryBrave(item, normalized)) {
          return request(item, { mode: "brave-only" });
        }
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

  function profile(item) {
    return options.profileForItem?.(item) === "article" ? "article" : "visual";
  }

  function rejectedImageKey(item, imageUrl) {
    return `${profile(item)}|${String(imageUrl || "").trim()}`;
  }

  function withoutRejectedImages(item, preview) {
    if (!preview || typeof preview !== "object") return preview;
    const imageUrls = [...new Set((Array.isArray(preview.imageUrls) ? preview.imageUrls : [preview.imageUrl])
      .map((value) => String(value || "").trim())
      .filter((value) => value && !isRejected(item, value)))];
    return { ...preview, imageUrl: imageUrls[0] || "", imageUrls };
  }

  function shouldTryBrave(item, preview) {
    return profile(item) === "visual"
      && preview?.source === "origin"
      && !preview.imageUrl
      && (typeof options.canFallback !== "function" || options.canFallback());
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

export function sitePreviewFingerprint(item, normalizeUrl = (value) => String(value || "").trim(), profile = "visual") {
  const key = String(item?.key || "").trim();
  const url = normalizeUrl(item?.url || "");
  const title = String(item?.title || "").replace(/\s+/g, " ").trim();
  const normalizedProfile = profile === "article" ? "article" : "visual";
  return key && url ? `${normalizedProfile}|${key}|${url}|${title}` : "";
}

export const createInspirationPreviewController = createSitePreviewController;
export const inspirationPreviewFingerprint = sitePreviewFingerprint;
