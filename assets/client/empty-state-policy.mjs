export function summaryEmptyStateKind(query) {
  return String(query || "").trim() ? "noMatches" : "noEntries";
}

export function bookmarkEmptyStateKind({ query = "", allCategoriesHidden = false, noEntries = false } = {}) {
  if (String(query || "").trim()) return "noMatches";
  if (allCategoriesHidden) return "hiddenCategories";
  return noEntries ? "noEntries" : "noMatches";
}
