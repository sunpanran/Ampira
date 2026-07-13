import { PUBLIC_FEEDS } from "../core/constants.mjs";
import { buildBookmarkModel, inspirationPreviewSourceUrls, originsFromUrls } from "../core/bookmarks.mjs";
import { buildPermissionRows, originPattern } from "../core/permission-state.mjs";

export function createPermissionGateway({ chrome, getSettings, secretStatus }) {
  async function currentBookmarkModel(settings) {
    return buildBookmarkModel(await chrome.bookmarks.getTree(), settings);
  }

  function emptyBookmarkModel() {
    return { folderOptions: [], sections: [], bookmarks: [], availableNewsFolders: [], missingFolders: [] };
  }

  async function selectedOrigins(modelArg, settingsArg) {
    const settings = settingsArg || await getSettings();
    const model = modelArg || (settings.bookmarkConsentGranted ? await currentBookmarkModel(settings) : emptyBookmarkModel());
    const urls = settings.bookmarkConsentGranted
      ? model.bookmarks.filter((item) => item.cardType === "news" && !item.feedExcluded).map((item) => item.url)
      : [];
    if (settings.bookmarkConsentGranted) urls.push(...inspirationPreviewSourceUrls(model.bookmarks));
    if (settings.bookmarkConsentGranted && settings.publicFeedSupplementEnabled !== false) urls.push(...PUBLIC_FEEDS.map((feed) => feed.url));
    const secrets = await secretStatus();
    if (settings.openaiBaseUrl && settings.aiDisclosureAccepted && secrets.hasOpenAIKey) urls.push(settings.openaiBaseUrl);
    if (settings.webImageSearchEnabled && secrets.hasImageSearchKey) urls.push("https://api.search.brave.com/");
    const granted = await chrome.permissions.getAll();
    return buildPermissionRows(originsFromUrls(urls), granted.origins || []);
  }

  async function permissionStatus(origins) {
    const required = uniqueStrings(origins);
    const granted = await chrome.permissions.getAll();
    return buildPermissionRows(required, granted.origins || []).filter((row) => row.required);
  }

  function hasOriginPermission(value) {
    return hasOriginPermissions([value]);
  }

  async function hasOriginPermissions(values) {
    const patterns = uniqueStrings((Array.isArray(values) ? values : []).map(originPattern));
    if (!patterns.length || patterns.some((pattern) => !pattern)) return false;
    try {
      return chrome.permissions.contains({ origins: patterns });
    } catch {
      return false;
    }
  }

  return { currentBookmarkModel, emptyBookmarkModel, selectedOrigins, permissionStatus, hasOriginPermission, hasOriginPermissions };
}

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value || "").trim()).filter(Boolean))];
}
