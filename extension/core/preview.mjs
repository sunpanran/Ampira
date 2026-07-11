import { hashText } from "./bookmarks.mjs";
import { searchImagePreview } from "./ai.mjs";

const NEGATIVE_CACHE_MS = 24 * 60 * 60 * 1000;
const BRAVE_SEARCH_URL = "https://api.search.brave.com/";

export function createPreviewService(adapters) {
  const searchImage = adapters.searchImage || searchImagePreview;
  const now = adapters.now || Date.now;
  const pendingByCacheKey = new Map();

  return async function getSitePreview(body = {}) {
    const url = normalizePreviewUrl(body.url);
    if (!url) return emptyPreview(body.url);
    const title = cleanTitle(body.title);
    const cacheKey = `preview-${hashText(`${url}|${title}`)}`;
    const pending = pendingByCacheKey.get(cacheKey);
    if (pending) return pending;

    const request = loadSitePreview({ url, title, cacheKey });
    pendingByCacheKey.set(cacheKey, request);
    try {
      return await request;
    } finally {
      if (pendingByCacheKey.get(cacheKey) === request) pendingByCacheKey.delete(cacheKey);
    }
  };

  async function loadSitePreview({ url, title, cacheKey }) {
    const cacheEpoch = typeof adapters.captureCacheEpoch === "function" ? adapters.captureCacheEpoch() : undefined;
    const [settings, secrets] = await Promise.all([adapters.getSettings(), adapters.readSecrets()]);
    if (settings.webImageSearchEnabled !== true || !secrets.braveSearchApiKey) return emptyPreview(url);
    if (typeof adapters.hasOriginPermission === "function" && !await adapters.hasOriginPermission(BRAVE_SEARCH_URL)) {
      return emptyPreview(url);
    }

    const cached = await adapters.getRecord(cacheKey, null);
    const cachedAt = Date.parse(cached?.checkedAt || "");
    if (cached && (cached.imageUrl || Number.isFinite(cachedAt) && now() - cachedAt < NEGATIVE_CACHE_MS)) {
      return { ok: Boolean(cached.imageUrl), imageUrl: cached.imageUrl || "", url, cached: true };
    }

    let imageUrl;
    try {
      const query = [title, new URL(url).hostname, "website"].filter(Boolean).join(" ");
      imageUrl = await searchImage(query, secrets.braveSearchApiKey, adapters.hasOriginPermission);
    } catch (error) {
      return {
        ...emptyPreview(url),
        messageKey: error?.messageKey || "background.error.imageNetwork",
        messageParams: error?.messageParams || {},
        retryable: error?.retryable === true,
      };
    }

    if (typeof adapters.hasOriginPermission === "function" && !await adapters.hasOriginPermission(BRAVE_SEARCH_URL)) {
      return emptyPreview(url);
    }

    const preview = {
      capability: "image-preview",
      sourceOrigin: new URL(BRAVE_SEARCH_URL).origin,
      targetOrigin: new URL(url).origin,
      imageUrl,
      checkedAt: new Date(now()).toISOString(),
    };
    try {
      await adapters.setRecord(cacheKey, preview, "cache", cacheEpoch);
    } catch {
      // A valid remote result is still useful when the local cache is unavailable.
    }

    return { ok: Boolean(imageUrl), imageUrl, url };
  }
}

function normalizePreviewUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    if (url.protocol === "https:") return url.href;
    if (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)) return url.href;
  } catch {
    return "";
  }
  return "";
}

function cleanTitle(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 160);
}

function emptyPreview(url) {
  return { ok: false, imageUrl: "", url: String(url || "") };
}
