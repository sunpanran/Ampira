import { hashText } from "./bookmarks.mjs";
import { searchImagePreview } from "./ai.mjs";
import { decodeResponseBuffer, fetchBounded } from "./network.mjs";
import { extractPageMetadata } from "./reader.mjs";
import { normalizeImageCandidates } from "./image-candidates.mjs";
import { isPrivateAddressLiteral } from "./network-policy.mjs";

const PREVIEW_HIT_CACHE_MS = 24 * 60 * 60 * 1000;
const ORIGIN_MISS_CACHE_MS = 2 * 60 * 60 * 1000;
const SOURCE_TIMEOUT_MS = 10000;
const SOURCE_PREFIX_BYTES = 1024 * 1024;
const BRAVE_SEARCH_URL = "https://api.search.brave.com/";

export function createPreviewService(adapters) {
  const fetchSourceImage = adapters.fetchSourceImage || fetchSourceImageCandidates;
  const searchImage = adapters.searchImage || searchImagePreview;
  const now = adapters.now || Date.now;
  const pending = new Map();

  return async function getSitePreview(body = {}) {
    const url = normalizePreviewUrl(body.url);
    if (!url) return emptyPreview(body.url, "invalid");
    const title = cleanTitle(body.title);
    const mode = body.mode === "brave-only" ? "brave-only" : "prefer-origin";
    if (!await targetAllowed(url)) return emptyPreview(url, "unavailable");
    const requestKey = `${mode}:${url}|${title}`;
    return withPending(requestKey, async () => {
      const cacheEpoch = typeof adapters.captureCacheEpoch === "function" ? adapters.captureCacheEpoch() : undefined;
      if (mode === "brave-only") {
        return { ...(await getBravePreview({ url, title, cacheEpoch })), originalStatus: "skipped" };
      }
      const original = await getOriginPreview({ url, cacheEpoch });
      if (original.imageUrl) {
        return {
          ok: true,
          imageUrl: original.imageUrl,
          imageUrls: original.imageUrls,
          url,
          source: "origin",
          originalStatus: "found",
          ...(original.cached ? { cached: true } : {}),
        };
      }
      return { ...(await getBravePreview({ url, title, cacheEpoch })), originalStatus: original.status };
    });
  };

  async function getOriginPreview({ url, cacheEpoch }) {
    if (!await hasPermission(url)) return { status: "unavailable", imageUrl: "" };
    const cacheKey = `preview-origin-${hashText(url)}`;
    return withPending(`origin:${cacheKey}`, async () => {
      const cached = await adapters.getRecord(cacheKey, null);
      if (validOriginCache(cached, url, now()) && await hasPermission(url)) {
        return {
          status: cached.outcome === "hit" ? "found" : "missing",
          imageUrl: cached.imageUrl || "",
          imageUrls: normalizePreviewImageUrls(cached.imageUrls?.length ? cached.imageUrls : [cached.imageUrl], url),
          cached: true,
        };
      }

      let imageUrls;
      try {
        const fetched = await fetchSourceImage(url, {
          validateResponse: async (response) => {
            const finalUrl = normalizePreviewUrl(response?.url || url);
            if (!finalUrl || !await hasPermission(finalUrl)) throw previewSourceError("SOURCE_PERMISSION_CHANGED", false);
          },
        });
        imageUrls = normalizePreviewImageUrls(Array.isArray(fetched) ? fetched : [fetched], url);
      } catch {
        return { status: "error", imageUrl: "", imageUrls: [] };
      }
      if (!await hasPermission(url) || !await targetAllowed(url)) return { status: "unavailable", imageUrl: "" };

      const record = {
        capability: "site-preview-origin",
        outcome: imageUrls.length ? "hit" : "miss",
        requestedUrl: url,
        sourceOrigin: new URL(url).origin,
        imageUrl: imageUrls[0] || "",
        imageUrls,
        checkedAt: new Date(now()).toISOString(),
        requiredOrigins: [new URL(url).origin],
      };
      await safeStore(cacheKey, record, cacheEpoch);
      return { status: imageUrls.length ? "found" : "missing", imageUrl: imageUrls[0] || "", imageUrls };
    });
  }

  async function getBravePreview({ url, title, cacheEpoch }) {
    const [settings, secrets] = await Promise.all([adapters.getSettings(), adapters.readSecrets()]);
    if (settings.webImageSearchEnabled !== true || !secrets.braveSearchApiKey) return emptyPreview(url);
    if (!await hasPermission(BRAVE_SEARCH_URL)) return emptyPreview(url);
    const cacheKey = `preview-brave-${hashText(`${url}|${title}`)}`;
    return withPending(`brave:${cacheKey}`, async () => {
      const cached = await adapters.getRecord(cacheKey, null);
      if (validBraveCache(cached, url, title, now()) && await hasPermission(BRAVE_SEARCH_URL)) {
        return publicBravePreview(cached, url, true);
      }

      let imageUrl;
      try {
        const query = [title, new URL(url).hostname, "website"].filter(Boolean).join(" ");
        imageUrl = normalizePreviewImageUrl(
          await searchImage(query, secrets.braveSearchApiKey, adapters.hasOriginPermission),
          url,
        );
      } catch (error) {
        return {
          ...emptyPreview(url),
          messageKey: error?.messageKey || "background.error.imageNetwork",
          messageParams: error?.messageParams || {},
          retryable: error?.retryable === true,
        };
      }
      if (!await hasPermission(BRAVE_SEARCH_URL) || !await targetAllowed(url)) return emptyPreview(url);

      const record = {
        capability: "site-preview-brave",
        outcome: imageUrl ? "hit" : "miss",
        requestedUrl: url,
        title,
        providerOrigin: new URL(BRAVE_SEARCH_URL).origin,
        imageUrl,
        imageUrls: imageUrl ? [imageUrl] : [],
        checkedAt: new Date(now()).toISOString(),
        requiredOrigins: [new URL(BRAVE_SEARCH_URL).origin],
      };
      await safeStore(cacheKey, record, cacheEpoch);
      return publicBravePreview(record, url, false);
    });
  }

  async function targetAllowed(url) {
    if (typeof adapters.isAllowedTarget !== "function") return true;
    try {
      return await adapters.isAllowedTarget(url) === true;
    } catch {
      return false;
    }
  }

  async function hasPermission(url) {
    if (typeof adapters.hasOriginPermission !== "function") return false;
    try {
      return await adapters.hasOriginPermission(url) === true;
    } catch {
      return false;
    }
  }

  async function safeStore(key, value, cacheEpoch) {
    try {
      await adapters.setRecord(key, value, "cache", cacheEpoch);
    } catch {
      // A valid live result remains useful when the local cache is unavailable.
    }
  }

  function withPending(key, operation) {
    const existing = pending.get(key);
    if (existing) return existing;
    const request = Promise.resolve().then(operation).finally(() => {
      if (pending.get(key) === request) pending.delete(key);
    });
    pending.set(key, request);
    return request;
  }
}

export async function fetchSourceImagePreview(url, options = {}) {
  return (await fetchSourceImageCandidates(url, options))[0] || "";
}

export async function fetchSourceImageCandidates(url, options = {}) {
  const target = normalizePreviewUrl(url);
  if (!target) throw previewSourceError("SOURCE_INVALID_URL", false);
  const { response, buffer } = await fetchBounded(target, {
    redirect: "error",
    credentials: "omit",
    referrerPolicy: "no-referrer",
    headers: { accept: "text/html, application/xhtml+xml;q=0.9, text/plain;q=0.4" },
  }, {
    timeoutMs: options.timeoutMs || SOURCE_TIMEOUT_MS,
    maxBytes: SOURCE_PREFIX_BYTES,
    truncate: true,
    validateResponse: async (response) => {
      if (typeof options.validateResponse === "function") await options.validateResponse(response);
      validateSourceResponse(response, target);
    },
  });
  const contentType = response.headers.get("content-type") || "";
  const text = decodeResponseBuffer(buffer, contentType);
  if (!looksLikePreviewHtml(text, contentType)) throw previewSourceError("SOURCE_UNSUPPORTED_CONTENT", false);
  const metadata = extractPageMetadata(text, response.url || target);
  return normalizePreviewImageUrls(metadata.heroImageUrls?.length ? metadata.heroImageUrls : [metadata.heroImageUrl], response.url || target);
}

function validOriginCache(value, url, timestamp) {
  return value?.capability === "site-preview-origin"
    && value?.requestedUrl === url
    && ["hit", "miss"].includes(value?.outcome)
    && freshCache(value, timestamp, value.outcome === "miss" ? ORIGIN_MISS_CACHE_MS : PREVIEW_HIT_CACHE_MS);
}

function validBraveCache(value, url, title, timestamp) {
  return value?.capability === "site-preview-brave"
    && value?.requestedUrl === url
    && value?.title === title
    && ["hit", "miss"].includes(value?.outcome)
    && freshCache(value, timestamp, PREVIEW_HIT_CACHE_MS);
}

function freshCache(value, timestamp, maxAge) {
  const checkedAt = Date.parse(value?.checkedAt || "");
  const age = timestamp - checkedAt;
  return Number.isFinite(checkedAt) && age >= 0 && age < maxAge;
}

function publicBravePreview(value, url, cached) {
  return {
    ok: value?.outcome === "hit" && Boolean(value?.imageUrl),
    imageUrl: value?.imageUrl || "",
    imageUrls: normalizePreviewImageUrls(value?.imageUrls?.length ? value.imageUrls : [value?.imageUrl], url),
    url,
    source: value?.imageUrl ? "brave" : "",
    ...(cached ? { cached: true } : {}),
  };
}

function validateSourceResponse(response, requestedUrl) {
  if (!response?.ok) {
    const status = Number(response?.status || 0);
    throw previewSourceError("SOURCE_HTTP_ERROR", status === 408 || status === 429 || status >= 500, {
      status,
      url: response?.url || requestedUrl,
    });
  }
  const mime = String(response.headers?.get?.("content-type") || "").split(";", 1)[0].trim().toLowerCase();
  if (mime && !["text/html", "application/xhtml+xml", "text/plain", "application/octet-stream"].includes(mime)) {
    throw previewSourceError("SOURCE_UNSUPPORTED_CONTENT", false, { mime, url: response.url || requestedUrl });
  }
}

function looksLikePreviewHtml(text, contentType) {
  if (/text\/(?:html|plain)|application\/xhtml\+xml/i.test(contentType)) return true;
  return /<(?:html|head|meta|title|body)\b/i.test(String(text).slice(0, 8192));
}

function normalizePreviewUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    if (url.username || url.password || url.href.length > 8192) return "";
    if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) return "";
    url.hash = "";
    return url.href;
  } catch {
    return "";
  }
}

function normalizePreviewImageUrl(value, pageUrl) {
  const safe = normalizePreviewUrl(value);
  if (!safe) return "";
  try {
    const imageUrl = new URL(safe);
    const targetUrl = new URL(pageUrl);
    if (isPrivateAddressLiteral(imageUrl.hostname) && imageUrl.origin !== targetUrl.origin) return "";
    return imageUrl.href;
  } catch {
    return "";
  }
}

function normalizePreviewImageUrls(values, pageUrl) {
  return normalizeImageCandidates(values, pageUrl, { limit: 3 })
    .map((value) => normalizePreviewImageUrl(value, pageUrl))
    .filter(Boolean);
}

function cleanTitle(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 160);
}

function emptyPreview(url, originalStatus = "skipped") {
  return { ok: false, imageUrl: "", imageUrls: [], url: String(url || ""), source: "", originalStatus };
}

function previewSourceError(code, retryable, details = {}) {
  const error = new Error(code);
  error.code = code;
  error.retryable = retryable === true;
  error.details = details;
  return error;
}
