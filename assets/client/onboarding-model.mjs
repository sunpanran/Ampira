import { parseNewsSelection } from "./news-source-selection.mjs";
import { parseInspirationSelection } from "./inspiration-source-selection.mjs";
import { requiredUngrantedOrigins } from "./permission-ui-model.mjs";

export function onboardingPermissionRequest(rows, { faviconSupported = false, faviconGranted = false } = {}) {
  const origins = requiredUngrantedOrigins(rows);
  return {
    ...(origins.length ? { origins } : {}),
    ...(faviconSupported && !faviconGranted ? { permissions: ["favicon"] } : {}),
  };
}

export function onboardingInitialStep(progress) {
  if (progress === "permissions" || progress === "ai") return 2;
  return progress === "sources" || progress === "folders" ? 1 : 0;
}

export function onboardingSourceMode(settings) {
  return settings.newsSourceMode === "bookmarks" || settings.inspirationSourceMode === "bookmarks" ? "bookmarks" : "preset";
}

export function onboardingSourcePatch(mode, newsValue, inspirationValue) {
  if (mode === "preset") return {
    newsSourceMode: "public", inspirationSourceMode: "preset", publicFeedSupplementEnabled: true, bookmarkSectionEnabled: false,
  };
  const news = parseNewsSelection(newsValue);
  const inspiration = parseInspirationSelection(inspirationValue);
  if (news.mode === "bookmarks" && !news.folder || inspiration.mode === "bookmarks" && !inspiration.folder) return null;
  if (news.mode === "bookmarks" && inspiration.mode === "bookmarks" && news.folder === inspiration.folder) return null;
  return {
    newsSourceMode: news.mode,
    inspirationSourceMode: inspiration.mode,
    publicFeedSupplementEnabled: news.mode === "public",
    bookmarkSectionEnabled: news.mode === "bookmarks",
    ...(news.mode === "bookmarks" ? { newsBookmarkFolder: news.folder } : {}),
    ...(inspiration.mode === "bookmarks" ? { inspirationBookmarkFolder: inspiration.folder } : {}),
  };
}
