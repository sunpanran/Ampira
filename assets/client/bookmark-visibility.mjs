export function isBookmarkSectionVisible(settings = {}) {
  return settings?.bookmarkSectionEnabled !== false;
}

export function hiddenBookmarkCategories(settings = {}) {
  return Array.isArray(settings?.hiddenBookmarkCategories)
    ? settings.hiddenBookmarkCategories.filter((item) => (
      item?.sectionKey && item?.categoryKey || item?.section && item?.category
    ))
    : [];
}

export function bookmarkCategoryIdentity(section, category, sectionKey = "", categoryKey = "") {
  const stableSection = String(sectionKey || "").trim();
  const stableCategory = String(categoryKey || "").trim();
  return stableSection && stableCategory
    ? JSON.stringify([stableSection, stableCategory])
    : JSON.stringify([String(section || "").trim(), String(category || "").trim()]);
}

export function isBookmarkCategoryHidden(settings, section, category, sectionKey = "", categoryKey = "") {
  const identity = bookmarkCategoryIdentity(section, category, sectionKey, categoryKey);
  return hiddenBookmarkCategories(settings)
    .some((item) => bookmarkCategoryIdentity(item.section, item.category, item.sectionKey, item.categoryKey) === identity);
}

export function hideBookmarkCategory(settings, section, category, sectionKey = "", categoryKey = "") {
  const hasNames = String(section || "").trim() && String(category || "").trim();
  const hasKeys = String(sectionKey || "").trim() && String(categoryKey || "").trim();
  if (!hasNames && !hasKeys
    || isBookmarkCategoryHidden(settings, section, category, sectionKey, categoryKey)) {
    return hiddenBookmarkCategories(settings);
  }
  return [...hiddenBookmarkCategories(settings), {
    section: String(section).trim(),
    category: String(category).trim(),
    ...(hasKeys ? {
      sectionKey: String(sectionKey).trim(),
      categoryKey: String(categoryKey).trim(),
    } : {}),
  }];
}

export function restoreBookmarkCategory(settings, section, category, sectionKey = "", categoryKey = "") {
  const identity = bookmarkCategoryIdentity(section, category, sectionKey, categoryKey);
  return hiddenBookmarkCategories(settings)
    .filter((item) => bookmarkCategoryIdentity(item.section, item.category, item.sectionKey, item.categoryKey) !== identity);
}
