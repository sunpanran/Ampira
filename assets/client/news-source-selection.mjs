export const PUBLIC_FEED_VALUE = "public";

const BOOKMARK_VALUE_PREFIX = "bookmark:";

export function newsBookmarkValue(folderName) {
  const folder = String(folderName || "").trim();
  return folder ? `${BOOKMARK_VALUE_PREFIX}${encodeURIComponent(folder)}` : "";
}

export function newsSelectionValue(mode, folderName) {
  const bookmarkValue = newsBookmarkValue(folderName);
  return mode === "bookmarks" && bookmarkValue ? bookmarkValue : PUBLIC_FEED_VALUE;
}

export function parseNewsSelection(value, preservedFolder = "") {
  const fallbackFolder = String(preservedFolder || "").trim();
  const rawValue = String(value || "");
  if (!rawValue.startsWith(BOOKMARK_VALUE_PREFIX)) {
    return { mode: "public", folder: fallbackFolder };
  }
  try {
    const folder = decodeURIComponent(rawValue.slice(BOOKMARK_VALUE_PREFIX.length)).trim();
    return folder ? { mode: "bookmarks", folder } : { mode: "public", folder: fallbackFolder };
  } catch {
    return { mode: "public", folder: fallbackFolder };
  }
}
