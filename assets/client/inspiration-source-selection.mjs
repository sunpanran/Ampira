export const INSPIRATION_PRESET_VALUE = "preset";

const BOOKMARK_VALUE_PREFIX = "bookmark:";

export function inspirationBookmarkValue(folderName) {
  const folder = String(folderName || "").trim();
  return folder ? `${BOOKMARK_VALUE_PREFIX}${encodeURIComponent(folder)}` : "";
}

export function inspirationSelectionValue(mode, folderName) {
  const bookmarkValue = inspirationBookmarkValue(folderName);
  return mode === "bookmarks" && bookmarkValue ? bookmarkValue : INSPIRATION_PRESET_VALUE;
}

export function parseInspirationSelection(value, preservedFolder = "") {
  const fallbackFolder = String(preservedFolder || "").trim();
  const rawValue = String(value || "");
  if (!rawValue.startsWith(BOOKMARK_VALUE_PREFIX)) {
    return { mode: "preset", folder: fallbackFolder };
  }
  try {
    const folder = decodeURIComponent(rawValue.slice(BOOKMARK_VALUE_PREFIX.length)).trim();
    return folder ? { mode: "bookmarks", folder } : { mode: "preset", folder: fallbackFolder };
  } catch {
    return { mode: "preset", folder: fallbackFolder };
  }
}
