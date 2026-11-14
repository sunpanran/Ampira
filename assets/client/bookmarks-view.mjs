import { isBookmarkCategoryHidden } from "./bookmark-visibility.mjs";
import { bookmarkEmptyStateKind } from "./empty-state-policy.mjs";

export function belongsInArchiveIndex(entry) {
  return entry?.sectionKey !== "inspirationPreset"
    && !(entry?.sourceKind === "preset" && entry?.cardType === "inspiration");
}

export function createBookmarksView(options) {
  const {
    state, els, t, itemUrl, faviconUrl, createIcon, createThemedIcon, srOnly,
    groupItemsByKey, createEmptyState, cardIconName, cardTone,
    setIconLabel, syncSegmentedIndicator, openExternal, contextAttachGroup,
    contextAttachLink, contextAttachActions, openBookmarkSettings, hideBookmarkCategory,
    toggleSeen, defaultSeenSource, isQueued, actionKey,
    toggleReadingQueue, refreshSummaryItem, allFilter,
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
  button.setAttribute("aria-pressed", String(state.filter === value));
  contextAttachActions(button, () => [{
    label: t("context.bookmarkSettings"),
    icon: "settings-01",
    action: openBookmarkSettings,
  }]);
  return button;
}

function renderCategoryFilters() {
  const categories = state.filter === allFilter ? [] : availableCategories();
  const showFilter = categories.length > 1;
  const restoreSectionFocus = !showFilter && els.categoryFilterControl.contains(document.activeElement);
  if (!showFilter || !categories.some((category) => category.name === state.categoryFilter)) {
    state.categoryFilter = allFilter;
  }
  els.categoryFilter.replaceChildren(
    createCategoryOption(allFilter, t("filter.allCategories")),
    ...categories.map((category) => createCategoryOption(category.name, category.name)),
  );
  els.categoryFilter.value = state.categoryFilter;
  els.categoryFilter.disabled = !showFilter;
  els.categoryFilterControl.hidden = !showFilter;
  if (restoreSectionFocus) els.sectionFilter.querySelector("button.active")?.focus({ preventScroll: true });
}

function availableCategories() {
  const categories = [];
  const seen = new Set();
  const populated = new Set(archiveIndexBookmarks().map((item) => `${item.section}\u0000${item.category}`));
  for (const section of archiveIndexSections()) {
    if (state.filter !== allFilter && state.filter !== section.name) continue;
    for (const category of section.categories || []) {
      if (isBookmarkCategoryHidden(state.settings, section.name, category.name, section.sectionKey, category.categoryKey)) continue;
      if (!populated.has(`${section.name}\u0000${category.name}`)) continue;
      if (seen.has(category.name)) continue;
      seen.add(category.name);
      categories.push(category);
    }
  }
  return categories;
}

function createCategoryOption(value, label) {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  return option;
}

function renderCategories() {
  els.categoryGrid.classList.toggle("is-filtered-category", state.categoryFilter !== allFilter);
  const groups = [];
  const bookmarksByCategory = groupItemsByKey(
    archiveIndexBookmarks(),
    (item) => `${item.section}\u0000${item.category}`,
  );
  const sections = archiveIndexSections();
  for (const section of sections) {
    if (state.filter !== allFilter && state.filter !== section.name) continue;
    for (const category of section.categories) {
      if (isBookmarkCategoryHidden(state.settings, section.name, category.name, section.sectionKey, category.categoryKey)) continue;
      if (state.categoryFilter !== allFilter && state.categoryFilter !== category.name) continue;
      const items = bookmarksByCategory.get(`${section.name}\u0000${category.name}`) || [];
      if (items.length > 0) groups.push({
        section: section.name, sectionKey: section.sectionKey,
        cardType: section.cardType, category: category.name, categoryKey: category.categoryKey, items,
      });
    }
  }
  if (!groups.length) {
    const selectedSection = state.filter === allFilter
      ? null
      : sections.find((section) => section.name === state.filter);
    const populatedCategories = (selectedSection?.categories || []).filter((category) => (
      bookmarksByCategory.has(`${selectedSection.name}\u0000${category.name}`)
    ));
    const allCategoriesHidden = populatedCategories.length > 0
      && populatedCategories.every((category) => (
        isBookmarkCategoryHidden(state.settings, selectedSection.name, category.name, selectedSection.sectionKey, category.categoryKey)
      ));
    const noEntries = archiveIndexBookmarks().length === 0;
    const emptySection = Boolean(selectedSection)
      && !archiveIndexBookmarks().some((item) => item.section === selectedSection.name);
    const emptyKind = bookmarkEmptyStateKind({ allCategoriesHidden, noEntries, emptySection });
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
  const groupCard = { cardType: group.cardType, section: group.section };
  title.append(createIcon(cardIconName(groupCard), "card-icon"), name);
  if (state.filter === allFilter) {
    const pill = document.createElement("span");
    pill.className = `pill ${cardTone(groupCard)}`;
    pill.textContent = group.section;
    title.append(pill);
  }
  header.append(title);
  contextAttachGroup(header, () => group, () => [{
    label: t("context.hideBookmarkCategory"),
    icon: "eye-off",
    action: () => hideBookmarkCategory(group.section, group.category, group.sectionKey, group.categoryKey),
  }]);
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
  row.append(createBookmarkFavicon(item), main, createSeenButton(item, t("action.markRead"), t("action.unmarkRead"), "bookmark"));
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
  button.dataset.seenKey = actionKey(item);
  button.dataset.seenUncheckedLabel = uncheckedLabel;
  button.dataset.seenCheckedLabel = checkedLabel;
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
    const uncheckedLabel = t("action.markRead");
    const checkedLabel = t("action.unmarkRead");
    actions.append(createActionToggleButton({
      active: read,
      icon: "checkmark",
      label: read ? checkedLabel : uncheckedLabel,
      className: "viewed-toggle",
      seenKey: actionKey(item),
      seenUncheckedLabel: uncheckedLabel,
      seenCheckedLabel: checkedLabel,
      onClick: () => toggleSeen(item, !state.seen.has(actionKey(item)), options.source || defaultSeenSource(item)),
    }));
  }
  return actions;
}

function createManualSummaryButton(item, isRefreshing, phase = "") {
  const button = document.createElement("button");
  const label = t(isRefreshing ? (phase === "queued" ? "aiTask.queued" : "aiTask.running") : "action.manualSummary");
  button.className = "action-toggle";
  button.type = "button";
  button.disabled = isRefreshing;
  button.title = label;
  button.setAttribute("aria-label", label);
  button.append(
    createThemedIcon("sparkling", "action-toggle-icon"),
    srOnly(label),
  );
  button.addEventListener("click", (event) => {
    refreshSummaryItem(item, event);
  });
  return button;
}

function createActionToggleButton({
  active, icon, label, className, readingQueueKey, seenKey, seenUncheckedLabel, seenCheckedLabel, onClick,
}) {
  const button = document.createElement("button");
  button.className = `action-toggle ${className || ""} ${active ? "is-active" : ""}`.trim();
  button.type = "button";
  button.title = label;
  button.setAttribute("aria-label", label);
  button.setAttribute("aria-pressed", String(Boolean(active)));
  if (readingQueueKey) button.dataset.readingQueueKey = readingQueueKey;
  if (seenKey) {
    button.dataset.seenKey = seenKey;
    button.dataset.seenUncheckedLabel = seenUncheckedLabel;
    button.dataset.seenCheckedLabel = seenCheckedLabel;
  }
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onClick();
  });
  button.append(createThemedIcon(icon, "action-toggle-icon"), srOnly(label));
  return button;
}

}
