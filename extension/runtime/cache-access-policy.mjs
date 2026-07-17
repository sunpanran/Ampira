export function createCacheAccessPolicy(options) {
  const {
    aiSearchResultPermitted, originPattern, cacheUrlsPermitted,
    previewCachePermitted, weatherCachePermitted = async () => false,
  } = options;

  async function isRecordPermitted(record, context) {
    const { settings, model, secrets, previewTargets, feedPermissions, providerCapability } = context;
    if (record.key.startsWith("search-")) {
      const requestedUrl = record.value?.type === "url"
        ? record.value?.requestedUrl || record.value?.links?.[0]?.url || ""
        : "";
      return aiSearchResultPermitted(record.value, requestedUrl, settings, feedPermissions, null, providerCapability);
    }
    if (record.key.startsWith("feed-image-") || record.value?.capability === "feed-image") {
      const expectedOrigin = feedPermissions.permittedByKey.get(String(record.value?.sourceKey || ""));
      return Boolean(expectedOrigin)
        && expectedOrigin === originPattern(record.value?.sourceOrigin || "")
        && await cacheUrlsPermitted([record.value?.requestedUrl]);
    }
    if (record.key.startsWith("preview-") || /^(?:image-preview|site-preview-)/.test(record.value?.capability || "")) {
      return previewCachePermitted(record.value, { settings, model, secrets, previewTargets });
    }
    if (record.key.startsWith("reader-content-") || record.value?.capability === "reader") {
      return cacheUrlsPermitted([record.value?.requestedUrl, record.value?.url, record.value?.canonicalUrl]);
    }
    if (record.value?.capability === "weather") return weatherCachePermitted(record.value);
    return true;
  }

  return { isRecordPermitted };
}
