import { buildBookmarkModel, inspirationPreviewSourceUrls, originsFromUrls } from "../core/bookmarks.mjs";
import { applyInspirationSource } from "../core/inspiration-preset.mjs";
import { buildPermissionRows, normalizeOriginPattern, originPattern } from "../core/permission-state.mjs";
import { publicFeedsForLocale } from "../core/public-feeds.mjs";
import { WEATHER_ORIGINS } from "../core/weather.mjs";

export function createPermissionGateway({
  chrome,
  getSettings,
  secretStatus,
  getRecord,
  providerCredentialAvailable = (_baseUrl, available) => Boolean(available),
}) {
  async function currentBookmarkModel(settings) {
    const model = buildBookmarkModel(await chrome.bookmarks.getTree(), settings);
    return applyInspirationSource(model, settings, settings.uiLocale || chrome.i18n?.getUILanguage?.());
  }

  function emptyBookmarkModel() {
    return { folderOptions: [], sections: [], bookmarks: [], availableNewsFolders: [], missingFolders: [] };
  }

  async function selectedOrigins(modelArg, settingsArg) {
    const settings = settingsArg || await getSettings();
    const model = modelArg || (settings.bookmarkConsentGranted ? await currentBookmarkModel(settings) : emptyBookmarkModel());
    const [secrets, granted] = await Promise.all([
      secretStatus(),
      chrome.permissions.getAll().catch(() => ({ origins: [] })),
    ]);
    const grantedOrigins = granted.origins || [];
    const publicFeeds = publicFeedsForLocale(
      settings.uiLocale || chrome.i18n?.getUILanguage?.(),
      { includeAiOnly: true },
    );
    const urls = settings.bookmarkConsentGranted
      ? model.bookmarks.filter((item) => item.cardType === "news" && !item.feedExcluded).map((item) => item.url)
      : [];
    if (settings.bookmarkConsentGranted) urls.push(...inspirationPreviewSourceUrls(model.bookmarks));
    if (settings.bookmarkConsentGranted && settings.publicFeedSupplementEnabled !== false) urls.push(...publicFeeds.map((feed) => feed.url));
    if (settings.bookmarkConsentGranted && typeof getRecord === "function") {
      const sourceQuality = await getRecord("source-quality", { records: {} });
      const activeKeys = new Set(model.bookmarks
        .filter((item) => item.cardType === "news" && !item.feedExcluded)
        .map((item) => String(item.key || "")));
      if (settings.publicFeedSupplementEnabled !== false) {
        publicFeeds.forEach((feed) => activeKeys.add(feed.key));
      }
      for (const record of Object.values(sourceQuality?.records || {})) {
        if (!activeKeys.has(String(record?.sourceKey || ""))) continue;
        if (record?.pendingFeed?.url) urls.push(record.pendingFeed.url);
        if (record?.resolvedUrl && record?.fetchOrigin) urls.push(record.resolvedUrl);
      }
    }
    if (
      settings.openaiBaseUrl
      && settings.aiDisclosureAccepted
      && providerCredentialAvailable(settings.openaiBaseUrl, secrets.hasOpenAIKey)
    ) urls.push(settings.openaiBaseUrl);
    if (settings.webImageSearchEnabled && secrets.hasImageSearchKey) urls.push("https://api.search.brave.com/");
    const clientState = typeof getRecord === "function" ? await getRecord("client-state", {}) : {};
    const weatherOptedIn = clientState?.["dash.utility.weather.optedIn"] === "true"
      || Boolean(clientState?.["dash.utility.weather.location.v1"]);
    if (weatherOptedIn || WEATHER_ORIGINS.some((origin) => grantedOrigins.includes(originPattern(origin)))) {
      urls.push(...WEATHER_ORIGINS);
    }
    return buildPermissionRows(originsFromUrls(urls), grantedOrigins);
  }

  async function permissionStatus(origins) {
    const required = uniqueStrings(origins);
    const granted = await chrome.permissions.getAll();
    return buildPermissionRows(required, granted.origins || []);
  }

  function hasOriginPermission(value) {
    return hasOriginPermissions([value]);
  }

  async function hasOriginPermissions(values) {
    const patterns = uniqueStrings((Array.isArray(values) ? values : []).map(originPattern));
    if (!patterns.length || patterns.some((pattern) => !pattern)) return false;
    try {
      const granted = await chrome.permissions.getAll();
      const grantedOrigins = new Set((granted.origins || []).map(normalizeOriginPattern).filter(Boolean));
      return patterns.every((pattern) => grantedOrigins.has(pattern));
    } catch {
      return false;
    }
  }

  return {
    currentBookmarkModel,
    emptyBookmarkModel,
    selectedOrigins,
    permissionStatus,
    hasOriginPermission,
    hasOriginPermissions,
  };
}

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value || "").trim()).filter(Boolean))];
}
