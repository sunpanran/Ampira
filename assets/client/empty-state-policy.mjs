export function summaryEmptyStateKind(query) {
  return String(query || "").trim() ? "noMatches" : "noEntries";
}

export function bookmarkEmptyStateKind({ query = "", allCategoriesHidden = false, noEntries = false, emptySection = false } = {}) {
  if (String(query || "").trim()) return "noMatches";
  if (allCategoriesHidden) return "hiddenCategories";
  if (emptySection) return "emptySection";
  return noEntries ? "noEntries" : "noMatches";
}
