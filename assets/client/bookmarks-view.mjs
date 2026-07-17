import { isBookmarkCategoryHidden } from "./bookmark-visibility.mjs";
import { bookmarkEmptyStateKind } from "./empty-state-policy.mjs";

export function belongsInArchiveIndex(entry) {
  return entry?.sectionKey !== "inspirationPreset"
    && !(entry?.sourceKind === "preset" && entry?.cardType === "inspiration");
}

export function createBookmarksView(options) {
  const {
    state, els, t, itemUrl, faviconUrl, createIcon, createThemedIcon, srOnly,
    groupItemsByKey, matchesQuery, createEmptyState, cardIconName, cardTone,
    setIconLabel, syncSegmentedIndicator, openExternal, contextAttachGroup,
    contextAttachLink, contextAttachActions, openBookmarkSettings, hideBookmarkCategory,
    toggleSeen, defaultSeenSource, isQueued, actionKey,
    toggleReadingQueue, refreshSummaryItem, allFilter, restartMotionClass, prefersReducedMotion,
  } = options;

  return {
    renderSectionFilters,
    renderCategoryFilters,
    renderCategories,
    displayBookmarkTitle,
    createBookmarkFavicon,
    createSeenButton,
    createReadingActions,
    createManualSummaryButton,
  };

function renderSectionFilters() {
  const sections = archiveIndexSections();
  const allowed = new Set([allFilter, ...sections.map((section) => section.name)]);
  if (!allowed.has(state.filter)) {
    state.filter = allFilter;
    state.categoryFilter = allFilter;
  }
  const buttons = [
    createSectionFilterButton(allFilter, t("filter.all"), "filter-lines"),
    ...sections.map((section) => createSectionFilterButton(section.name, section.name, cardIconName(section))),
  ];
  els.sectionFilter.replaceChildren(...buttons);
  syncSegmentedIndicator(els.sectionFilter);
}

function createSectionFilterButton(value, label, icon) {
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.section = value;
  setIconLabel(button, icon || "folder", label, "segment-icon", "segment-label");
  button.classList.toggle("active", state.filter === value);
  contextAttachActions(button, () => [{
    label: t("context.bookmarkSettings"),
    icon: "settings-01",
    action: openBookmarkSettings,
  }]);
  return button;
}

function renderCategoryFilters() {
  els.categoryFilter.hidden = false;
  if (state.filter === allFilter) {
    state.categoryFilter = allFilter;
    els.categoryFilter.classList.remove("is-open");
    els.categoryFilter.setAttribute("aria-hidden", "true");
    for (const button of els.categoryFilter.querySelectorAll("button")) button.tabIndex = -1;
    syncSegmentedIndicator(els.categoryFilter);
    return;
  }
  const categories = availableCategories();
  if (![allFilter, ...categories.map((category) => category.name)].includes(state.categoryFilter)) {
    state.categoryFilter = allFilter;
  }
  const buttons = [
    createCategoryFilterButton(allFilter, t("filter.allCategories"), "filter-lines"),
    ...categories.map((category) => createCategoryFilterButton(category.name, category.name, "folder", category)),
  ];
  els.categoryFilter.replaceChildren(...buttons);
  for (const button of buttons) button.tabIndex = 0;
  els.categoryFilter.setAttribute("aria-hidden", "false");
  els.categoryFilter.classList.add("is-open");
  syncSegmentedIndicator(els.categoryFilter);
}

function availableCategories() {
  const categories = [];
  const seen = new Set();
  for (const section of archiveIndexSections()) {
    if (state.filter !== allFilter && state.filter !== section.name) continue;
    for (const category of section.categories || []) {
      if (isBookmarkCategoryHidden(state.settings, section.name, category.name, section.sectionKey, category.categoryKey)) continue;
      if (seen.has(category.name)) continue;
      seen.add(category.name);
      categories.push({
        section: section.name,
        sectionKey: section.sectionKey,
        name: category.name,
        categoryKey: category.categoryKey,
      });
    }
  }
  return categories;
}

function createCategoryFilterButton(value, label, icon = "folder", identity = {}) {
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.category = value;
  setIconLabel(button, icon, label, "segment-icon", "segment-label");
  button.classList.toggle("active", state.categoryFilter === value);
  if (value !== allFilter) {
    contextAttachActions(button, () => [{
      label: t("context.hideBookmarkCategory"),
      icon: "eye-off",
      action: () => hideBookmarkCategory(
        identity.section || state.filter,
        value,
        identity.sectionKey || "",
        identity.categoryKey || "",
      ),
    }]);
  }
  return button;
}

function renderCategories() {
  els.categoryGrid.classList.toggle("is-filtered-category", state.categoryFilter !== allFilter);
  const groups = [];
  const bookmarksByCategory = groupItemsByKey(
    archiveIndexBookmarks(),
    (item) => `${item.section}\u0000${item.category}`,
    matchesQuery,
  );
  const sections = archiveIndexSections();
  for (const section of sections) {
    if (state.filter !== allFilter && state.filter !== section.name) continue;
    for (const category of section.categories) {
      if (isBookmarkCategoryHidden(state.settings, section.name, category.name, section.sectionKey, category.categoryKey)) continue;
      if (state.categoryFilter !== allFilter && state.categoryFilter !== category.name) continue;
      const items = bookmarksByCategory.get(`${section.name}\u0000${category.name}`) || [];
      if (items.length > 0) groups.push({ section: section.name, cardType: section.cardType, category: category.name, items });
    }
  }
  if (!groups.length) {
    const selectedSection = state.filter === allFilter
      ? null
      : sections.find((section) => section.name === state.filter);
    const allCategoriesHidden = Boolean(selectedSection?.categories?.length)
      && selectedSection.categories.every((category) => (
        isBookmarkCategoryHidden(state.settings, selectedSection.name, category.name, selectedSection.sectionKey, category.categoryKey)
      ));
    const noEntries = archiveIndexBookmarks().length === 0;
    const emptyKind = bookmarkEmptyStateKind({ query: state.query, allCategoriesHidden, noEntries });
    const titleKey = `empty.${emptyKind}.title`;
    const bodyKey = `empty.${emptyKind}.body`;
    const hasAction = emptyKind === "hiddenCategories" || emptyKind === "noEntries";
    els.categoryGrid.replaceChildren(createEmptyState({
      title: t(titleKey),
      body: t(bodyKey),
      variant: "plain",
      actionLabel: emptyKind === "hiddenCategories"
        ? t("context.bookmarkSettings")
        : (emptyKind === "noEntries" ? t("action.openSettings") : ""),
      onAction: hasAction ? openBookmarkSettings : undefined,
    }));
    return;
  }
  els.categoryGrid.replaceChildren(...groups.map(createCategoryBlock));
}

function archiveIndexSections() {
  return (state.data?.sections || []).filter(belongsInArchiveIndex);
}

function archiveIndexBookmarks() {
  return (state.data?.bookmarks || []).filter(belongsInArchiveIndex);
}

function createCategoryBlock(group) {
  const block = document.createElement("section");
  block.className = "category";
  const header = document.createElement("div");
  header.className = "category-header";
  const title = document.createElement("div");
  title.className = "category-title";
  const name = document.createElement("span");
  name.textContent = group.category;
  const pill = document.createElement("span");
  const groupCard = { cardType: group.cardType, section: group.section };
  pill.className = `pill ${cardTone(groupCard)}`;
  pill.textContent = group.section;
  title.append(createIcon(cardIconName(groupCard), "card-icon"), name, pill);
  const count = document.createElement("span");
  count.className = "count";
  count.textContent = String(group.items.length);
  header.append(title, count);
  contextAttachGroup(header, () => group);
  const list = document.createElement("div");
  list.className = "link-list";
  list.append(...group.items.map(createLinkRow));
  block.append(header, list);
  return block;
}

function createLinkRow(item) {
  const row = document.createElement("div");
  row.className = `link-row ${state.seen.has(item.key) ? "seen" : (state.opened.has(item.key) ? "opened" : "")}`;
  const bookmarkUrl = item.url || itemUrl(item);
  const bookmarkTitle = displayBookmarkTitle(item);
  const main = document.createElement("a");
  main.className = "link-main";
  main.href = bookmarkUrl;
  main.target = "_blank";
  main.rel = "noreferrer";
  main.title = bookmarkUrl;
  main.addEventListener("click", (event) => {
    event.preventDefault();
    openExternal(bookmarkUrl, bookmarkTitle, item);
  });
  const title = document.createElement("span");
  title.className = "link-title";
  title.textContent = bookmarkTitle;
  const host = document.createElement("span");
  host.className = "link-host";
  host.textContent = item.host || item.url;
  main.append(title, host);
  row.append(createBookmarkFavicon(item), main, createSeenButton(item, t("action.markSeen"), t("action.unmarkSeen"), "bookmark"));
  contextAttachLink(row, () => ({ url: bookmarkUrl, title: bookmarkTitle, item }));
  return row;
}

function displayBookmarkTitle(item) {
  const title = String(item.title || "").trim();
  return title || item.host || item.url;
}

function createBookmarkFavicon(item) {
  const icon = document.createElement("img");
  icon.className = "bookmark-favicon";
  icon.src = faviconUrl(item);
  icon.alt = "";
  icon.loading = "lazy";
  icon.referrerPolicy = "no-referrer";
  icon.setAttribute("aria-hidden", "true");
  icon.addEventListener("error", () => {
    icon.src = "favicon.svg";
  }, { once: true });
  return icon;
}

function createSeenButton(item, uncheckedLabel, checkedLabel, source = defaultSeenSource(item)) {
  const isSeen = state.seen.has(item.key);
  const button = document.createElement("button");
  const label = isSeen ? checkedLabel : uncheckedLabel;
  button.className = `seen-toggle ${isSeen ? "is-seen" : ""}`;
  button.type = "button";
  button.title = label;
  button.setAttribute("aria-label", label);
  button.setAttribute("aria-pressed", String(isSeen));
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    toggleSeen(item, !state.seen.has(item.key), source);
  });
  button.append(createThemedIcon("checkmark", "seen-mark"), srOnly(label));
  return button;
}

function createReadingActions(item, options = {}) {
  const actions = document.createElement("div");
  actions.className = `reading-actions ${options.compact ? "is-compact" : ""}`.trim();
  const active = isQueued(item);
  actions.append(
    createActionToggleButton({
      active,
      icon: active ? "bookmark-filled" : "bookmark-ribbon",
      label: t(active ? "action.removeReadingQueue" : "action.addReadingQueue"),
      readingQueueKey: actionKey(item),
      onClick: () => toggleReadingQueue(item),
    }),
  );
  if (options.includeRead !== false) {
    const read = state.seen.has(actionKey(item));
    actions.append(createActionToggleButton({
      active: read,
      icon: "checkmark",
      label: t(read ? "action.unmarkRead" : "action.markRead"),
      className: "viewed-toggle",
      onClick: () => toggleSeen(item, !read, options.source || defaultSeenSource(item)),
    }));
  }
  return actions;
}

function createManualSummaryButton(item, isRefreshing) {
  const button = document.createElement("button");
  const label = t(isRefreshing ? "action.organizing" : "action.manualSummary");
  button.className = `action-toggle ${isRefreshing ? "is-active is-loading" : ""}`.trim();
  button.type = "button";
  button.disabled = isRefreshing;
  button.title = label;
  button.setAttribute("aria-label", label);
  button.append(createThemedIcon(isRefreshing ? "synchronize" : "sparkling", "action-toggle-icon"), srOnly(label));
  button.addEventListener("click", (event) => {
    playSummaryActionElastic(button);
    refreshSummaryItem(item, event);
  });
  return button;
}

function createActionToggleButton({ active, icon, label, className, readingQueueKey, onClick }) {
  const button = document.createElement("button");
  button.className = `action-toggle ${className || ""} ${active ? "is-active" : ""}`.trim();
  button.type = "button";
  button.title = label;
  button.setAttribute("aria-label", label);
  button.setAttribute("aria-pressed", String(Boolean(active)));
  if (readingQueueKey) button.dataset.readingQueueKey = readingQueueKey;
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const isSummaryAction = playSummaryActionElastic(button);
    if (isSummaryAction && button.classList.contains("viewed-toggle") && !prefersReducedMotion()) {
      window.setTimeout(onClick, 180);
      return;
    }
    onClick();
  });
  button.append(createThemedIcon(icon, "action-toggle-icon"), srOnly(label));
  return button;
}

function playSummaryActionElastic(button) {
  if (!button.closest(".summary-card-actions")) return false;
  restartMotionClass(button, "is-subtle-elastic");
  return true;
}

}
