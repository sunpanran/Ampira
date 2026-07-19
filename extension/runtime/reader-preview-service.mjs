export function createReaderPreviewService(options) {
  const {
    normalizeUserUrl, hasOriginPermission, loadReaderWithCache, fetchReader, fetchReaderHtml, probeReaderUrl,
    extractPageMetadata, getRecord, setRecord, deleteRecord, cacheMutations,
    currentBookmarkModel, emptyBookmarkModel, getSettings, secretStatus,
    inspirationPreviewTargets, newsPreviewTargets, currentFeedPermissionState,
    filterFeedItemsBySources, presentableFeedItems = (items) => items, aiConfigured = async () => false,
    feedCacheOrEmpty = (value) => Array.isArray(value?.items) ? value : { items: [] },
    hashText, uniqueStrings, hasOriginPermissions, setRecords, typedError,
  } = options;
  return {
    readArticle, readCachedArticle, readWebsiteOverview, cacheUrlsPermitted, storePreviewCache,
    isSitePreviewTarget, previewCachePermitted,
  };
async function readArticle(url) {
  const normalized = normalizeUserUrl(url);
  if (!normalized) throw typedError("INVALID_URL", "background.error.invalidUrl", {}, false, { url: String(url || "") });
  const origin = new URL(normalized).origin;
  if (!await hasOriginPermission(normalized)) return readPublicArticle(normalized, origin);
  const cacheEpoch = cacheMutations.capture();
  const reader = await loadReaderWithCache(normalized, {
    readCache: readReaderCache,
    storeCache: (reader) => storeReaderCache(reader, cacheEpoch),
    validateCache: async (cached) => cachedReaderPermitted(normalized, cached),
    fetchDocument: async (target) => {
      const reader = await fetchReader(target, {
        validateResponse: async (response) => {
          const finalUrl = response.url || target;
          if (!await hasOriginPermission(finalUrl)) {
            throw typedError("ORIGIN_PERMISSION_REQUIRED", "background.error.websitePermission", {}, false, {
              origin: new URL(finalUrl).origin,
              url: finalUrl,
            });
          }
        },
      });
      const finalOrigin = new URL(reader.url).origin;
      if (finalOrigin !== origin && !await hasOriginPermission(reader.url)) {
        throw typedError("ORIGIN_PERMISSION_REQUIRED", "background.error.websitePermission", {}, false, { origin: finalOrigin, url: reader.url });
      }
      return reader;
    },
  });
  if (!await cachedReaderPermitted(normalized, reader)) {
    throw typedError("ORIGIN_PERMISSION_REQUIRED", "background.error.websitePermission", {}, false, {
      origin,
      url: normalized,
    });
  }
  return reader;
}

async function readCachedArticle(url) {
  const normalized = normalizeUserUrl(url);
  if (!normalized) throw typedError("INVALID_URL", "background.error.invalidUrl", {}, false, { url: String(url || "") });
  const origin = new URL(normalized).origin;
  if (!await hasOriginPermission(normalized)) {
    throw typedError("ORIGIN_PERMISSION_REQUIRED", "background.error.websitePermission", {}, false, {
      origin,
      url: normalized,
    });
  }
  const cached = await readReaderCache(normalized);
  if (cached && await cachedReaderPermitted(normalized, cached)) {
    return { ...cached, requestedUrl: normalized, source: "cache" };
  }
  return readArticle(normalized);
}

async function readPublicArticle(normalized, origin) {
  try {
    const reader = await fetchReader(normalized);
    return { ...reader, accessMode: "public-cors" };
  } catch (error) {
    if (error?.code !== "READER_NETWORK_ERROR") throw error;
    if (typeof probeReaderUrl !== "function" || !await probeReaderUrl(normalized)) throw error;
    throw typedError("ORIGIN_PERMISSION_REQUIRED", "background.error.websitePermission", {}, false, {
      origin,
      url: normalized,
    });
  }
}

async function readWebsiteOverview(url) {
  const normalized = normalizeUserUrl(url);
  if (!normalized) throw typedError("INVALID_URL", "background.error.invalidUrl", {}, false, { url: String(url || "") });
  const response = await fetchReaderHtml(normalized, 12000, {
    validateResponse: async (result) => {
      const finalUrl = result.url || normalized;
      if (!await hasOriginPermission(finalUrl)) {
        throw typedError("ORIGIN_PERMISSION_REQUIRED", "background.error.websitePermission", {}, false, {
          origin: new URL(finalUrl).origin,
          url: finalUrl,
        });
      }
    },
  });
  const metadata = extractPageMetadata(response.text, response.url);
  return {
    requestedUrl: normalized,
    url: response.url,
    canonicalUrl: metadata.canonicalUrl || response.url,
    title: metadata.title || metadata.siteName || new URL(response.url).hostname,
    siteName: metadata.siteName || new URL(response.url).hostname,
    description: metadata.description || "",
    blocks: [],
  };
}

async function cachedReaderPermitted(requestedUrl, cached) {
  return cacheUrlsPermitted([requestedUrl, cached?.url, cached?.canonicalUrl]);
}

async function cacheUrlsPermitted(values) {
  const urls = [];
  const seen = new Set();
  for (const value of values) {
    if (!String(value || "").trim()) continue;
    const normalized = normalizeUserUrl(value);
    if (!normalized) return false;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    urls.push(normalized);
  }
  if (!urls.length) return false;
  return hasOriginPermissions(urls);
}

async function readReaderCache(url) {
  const alias = await getRecord(readerAliasKey(url), null);
  if (!alias?.contentKey) return null;
  const value = await getRecord(alias.contentKey, null);
  return value?.capability === "reader" && Array.isArray(value.blocks) ? value : null;
}

async function storeReaderCache(reader, cacheEpoch = cacheMutations.capture()) {
  const primaryUrl = reader.canonicalUrl || reader.url || reader.requestedUrl;
  const contentKey = `reader-content-${hashText(primaryUrl)}`;
  const stored = { ...reader, capability: "reader", source: "live", staleReason: "", staleCode: "" };
  const aliases = uniqueStrings([reader.requestedUrl, reader.url, reader.canonicalUrl]);
  await cacheMutations.run(async (isCurrent) => {
    if (!isCurrent() || !await cacheUrlsPermitted(aliases)) return;
    if (!isCurrent()) return;
    await setRecords([
      { key: contentKey, value: stored, kind: "cache" },
      ...aliases.map((alias) => ({ key: readerAliasKey(alias), value: { capability: "reader-alias", contentKey }, kind: "cache" })),
    ]);
  }, cacheEpoch);
}

function storePreviewCache(key, value, kind = "cache", cacheEpoch) {
  const commit = async (isCurrent) => {
    if (!isCurrent() || !await previewCachePermitted(value)) return;
    if (!isCurrent()) return;
    await setRecord(key, value, kind);
  };
  return Number.isInteger(cacheEpoch)
    ? cacheMutations.run(commit, cacheEpoch)
    : cacheMutations.run(commit);
}

async function isSitePreviewTarget(value) {
  const settings = await getSettings();
  if (settings.bookmarkConsentGranted !== true) return false;
  const model = await currentBookmarkModel(settings);
  return previewTargetInItems(value, await currentPreviewTargets(settings, model));
}

async function previewCachePermitted(value, context = {}) {
  const settings = context.settings || await getSettings();
  if (settings.bookmarkConsentGranted !== true) return false;
  const model = context.model || await currentBookmarkModel(settings);
  const previewTargets = context.previewTargets || await currentPreviewTargets(settings, model);
  if (value?.capability === "site-preview-image-reuse") {
    const sourceOrigin = safePreviewOrigin(value.sourceOrigin);
    return Boolean(sourceOrigin)
      && previewOriginInItems(sourceOrigin, previewTargets)
      && await hasOriginPermission(`${sourceOrigin}/`);
  }
  const requestedUrl = previewIdentityUrl(value?.requestedUrl);
  if (!requestedUrl || !previewTargetInItems(requestedUrl, previewTargets)) return false;
  if (value.capability === "site-preview-origin") {
    if (value.sourceOrigin !== new URL(requestedUrl).origin) return false;
    return hasOriginPermission(requestedUrl);
  }
  if (value.capability === "site-preview-brave") {
    const secrets = context.secrets || await secretStatus();
    return value.providerOrigin === "https://api.search.brave.com"
      && settings.webImageSearchEnabled === true
      && secrets.hasImageSearchKey === true
      && await hasOriginPermission("https://api.search.brave.com/");
  }
  return false;
}

async function currentPreviewTargets(settings, model) {
  const bookmarkTargets = inspirationPreviewTargets(model?.bookmarks);
  try {
    const [feed, feedPermissions] = await Promise.all([
      getRecord("feed", { items: [] }),
      currentFeedPermissionState(settings, model),
    ]);
    const permittedFeedItems = filterFeedItemsBySources(
      feedCacheOrEmpty(feed).items,
      feedPermissions.permitted,
      feedPermissions.grantedOrigins,
    );
    const visibleFeedItems = presentableFeedItems(permittedFeedItems, settings, await aiConfigured(settings));
    return [...bookmarkTargets, ...newsPreviewTargets(visibleFeedItems)];
  } catch {
    return bookmarkTargets;
  }
}

function previewTargetInItems(value, items) {
  const requestedUrl = previewIdentityUrl(value);
  if (!requestedUrl) return false;
  return (items || []).some((item) => previewIdentityUrl(item?.url || item) === requestedUrl);
}

function previewOriginInItems(origin, items) {
  return (items || []).some((item) => safePreviewOrigin(item?.url || item) === origin);
}

function safePreviewOrigin(value) {
  try { return new URL(previewIdentityUrl(value)).origin; } catch { return ""; }
}

function previewIdentityUrl(value) {
  const normalized = normalizeUserUrl(value);
  if (!normalized) return "";
  try {
    const url = new URL(normalized);
    url.hash = "";
    return url.href;
  } catch {
    return "";
  }
}

function readerAliasKey(url) {
  return `reader-alias-${hashText(normalizeReaderCacheUrl(url))}`;
}

function normalizeReaderCacheUrl(value) {
  try {
    const url = new URL(value);
    url.hash = "";
    ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"].forEach((key) => url.searchParams.delete(key));
    return url.href;
  } catch {
    return String(value || "");
  }
}
}
