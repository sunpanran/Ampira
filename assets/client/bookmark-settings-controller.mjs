import { hiddenBookmarkCategories, restoreBookmarkCategory } from "./bookmark-visibility.mjs";
import {
  INSPIRATION_PRESET_VALUE,
  inspirationBookmarkValue,
  inspirationSelectionValue,
  parseInspirationSelection,
} from "./inspiration-source-selection.mjs";
import {
  PUBLIC_FEED_VALUE,
  newsBookmarkValue,
  newsSelectionValue,
  parseNewsSelection,
} from "./news-source-selection.mjs";

export function createBookmarkSettingsController(options) {
  const { state, els, t, renderSettingsStatus, setIconLabel } = options;
  return {
    syncBookmarkFolderControls,
    syncBookmarkOnlyFolderControls,
    setNewsSourceSelection,
    setInspirationSourceSelection,
    syncPublicFeedSupplementControl,
    bookmarkSourcePayload,
    addBookmarkOnlyFolder,
    renderBookmarkOnlyFolderList,
    currentBookmarkOnlyFolders,
    renderHiddenBookmarkCategoryList,
  };
function syncBookmarkFolderControls(settings = {}) {
  const options = Array.isArray(settings.bookmarkFolderOptions) ? settings.bookmarkFolderOptions : [];
  syncNewsSourceSelect(options, settings);
  syncInspirationSourceSelect(options, settings);
  syncBookmarkOnlyFolderControls();
  syncPublicFeedSupplementControl();
  renderHiddenBookmarkCategoryList();
}

function syncNewsSourceSelect(options, settings = {}) {
  const normalizedOptions = normalizeFolderOptions(options);
  const savedFolder = String(settings.newsBookmarkFolder || settings.defaultNewsBookmarkFolder || "").trim();
  const selectedValue = newsSelectionValue(settings.newsSourceMode, savedFolder);
  const optionNodes = [createFolderOption(PUBLIC_FEED_VALUE, t("settings.bookmarks.publicFeedTitle"))];
  if (settings.newsSourceMode === "bookmarks" && savedFolder
    && !normalizedOptions.some((option) => option.name === savedFolder)) {
    optionNodes.push(createFolderOption(
      newsBookmarkValue(savedFolder),
      t("settings.bookmarks.notFound", { name: savedFolder }),
    ));
  }
  optionNodes.push(...normalizedOptions.map((item) => createFolderOption(
    newsBookmarkValue(item.name),
    t("settings.bookmarks.folderOption", { name: item.name, count: item.count }),
  )));
  els.newsBookmarkFolderSelect.replaceChildren(...optionNodes);
  els.newsBookmarkFolderSelect.value = selectedValue;
  if (!els.newsBookmarkFolderSelect.value) els.newsBookmarkFolderSelect.value = PUBLIC_FEED_VALUE;
  els.newsBookmarkFolderSelect.disabled = false;
}

function syncInspirationSourceSelect(options, settings = {}) {
  const normalizedOptions = normalizeFolderOptions(options);
  const savedFolder = String(settings.inspirationBookmarkFolder || settings.defaultInspirationBookmarkFolder || "").trim();
  const selectedValue = inspirationSelectionValue(settings.inspirationSourceMode, savedFolder);
  const optionNodes = [createFolderOption(INSPIRATION_PRESET_VALUE, t("settings.bookmarks.presetTitle"))];
  if (savedFolder && !normalizedOptions.some((option) => option.name === savedFolder)) {
    optionNodes.push(createFolderOption(
      inspirationBookmarkValue(savedFolder),
      t("settings.bookmarks.notFound", { name: savedFolder }),
    ));
  }
  optionNodes.push(...normalizedOptions.map((item) => createFolderOption(
    inspirationBookmarkValue(item.name),
    t("settings.bookmarks.folderOption", { name: item.name, count: item.count }),
  )));
  els.inspirationBookmarkFolderSelect.replaceChildren(...optionNodes);
  els.inspirationBookmarkFolderSelect.value = selectedValue;
  if (!els.inspirationBookmarkFolderSelect.value) els.inspirationBookmarkFolderSelect.value = INSPIRATION_PRESET_VALUE;
  els.inspirationBookmarkFolderSelect.disabled = false;
}

function setInspirationSourceSelection(value) {
  const selection = parseInspirationSelection(value, savedInspirationFolder());
  state.settings = {
    ...(state.settings || {}),
    inspirationSourceMode: selection.mode,
    ...(selection.mode === "bookmarks" ? { inspirationBookmarkFolder: selection.folder } : {}),
  };
  syncBookmarkOnlyFolderControls();
  renderSettingsStatus();
}

function setNewsSourceSelection(value) {
  const selection = parseNewsSelection(value, savedNewsFolder());
  state.settings = {
    ...(state.settings || {}),
    newsSourceMode: selection.mode,
    ...(selection.mode === "bookmarks" ? { newsBookmarkFolder: selection.folder } : {}),
  };
  syncBookmarkOnlyFolderControls();
  syncPublicFeedSupplementControl();
  renderSettingsStatus();
}

function syncPublicFeedSupplementControl(busy = false) {
  const publicOnly = currentNewsSelection().mode === "public";
  const disabled = busy || publicOnly;
  if (publicOnly) els.publicFeedSupplementEnabledInput.checked = true;
  els.publicFeedSupplementEnabledInput.disabled = disabled;
  els.publicFeedSupplementEnabledInput.closest(".switch-field")
    ?.setAttribute("aria-disabled", String(disabled));
}

function syncBookmarkOnlyFolderControls() {
  const options = bookmarkOnlyFolderOptions();
  syncBookmarkFolderSelect(els.bookmarkOnlyFolderSelect, options, options[0]?.name || "");
  const canAdd = Boolean(els.bookmarkOnlyFolderSelect.value);
  els.bookmarkOnlyFolderSelect.disabled = !canAdd;
  els.addBookmarkOnlyFolder.disabled = !canAdd;
  renderBookmarkOnlyFolderList();
}

function syncBookmarkFolderSelect(select, options, selectedValue) {
  const selected = String(selectedValue || "").trim();
  const normalizedOptions = normalizeFolderOptions(options);
  const hasSelected = normalizedOptions.some((option) => option.name === selected);
  const optionNodes = [];
  if (!normalizedOptions.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = t("settings.bookmarks.none");
    option.disabled = true;
    optionNodes.push(option);
  } else if (selected && !hasSelected) {
    const option = document.createElement("option");
    option.value = selected;
    option.textContent = t("settings.bookmarks.notFound", { name: selected });
    optionNodes.push(option);
  }
  for (const item of normalizedOptions) {
    const option = document.createElement("option");
    option.value = item.name;
    option.textContent = t("settings.bookmarks.folderOption", { name: item.name, count: item.count });
    optionNodes.push(option);
  }
  select.replaceChildren(...optionNodes);
  if (selected && (hasSelected || normalizedOptions.length > 0)) {
    select.value = selected;
  } else {
    select.value = normalizedOptions[0]?.name || "";
  }
}

function normalizeFolderOptions(options) {
  return options.map((option) => ({
    name: String(option?.name || "").trim(),
    count: Number(option?.count || 0),
  })).filter((option) => option.name);
}

function createFolderOption(value, label) {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  return option;
}

function savedInspirationFolder() {
  return state.settings?.inspirationBookmarkFolder || state.settings?.defaultInspirationBookmarkFolder || "";
}

function savedNewsFolder() {
  return state.settings?.newsBookmarkFolder || state.settings?.defaultNewsBookmarkFolder || "";
}

function currentNewsSelection() {
  return parseNewsSelection(els.newsBookmarkFolderSelect.value, savedNewsFolder());
}

function currentInspirationSelection() {
  return parseInspirationSelection(els.inspirationBookmarkFolderSelect.value, savedInspirationFolder());
}

function bookmarkSourcePayload() {
  const news = currentNewsSelection();
  const inspiration = currentInspirationSelection();
  return {
    newsBookmarkFolder: news.folder,
    newsSourceMode: news.mode,
    inspirationBookmarkFolder: inspiration.folder,
    inspirationSourceMode: inspiration.mode,
    bookmarkOnlyFolders: currentBookmarkOnlyFolders(),
    hiddenBookmarkCategories: hiddenBookmarkCategories(state.settings),
  };
}

function bookmarkPrimaryFolders() {
  const news = currentNewsSelection();
  const inspiration = currentInspirationSelection();
  return new Set([
    news.mode === "bookmarks" ? news.folder : "",
    inspiration.mode === "bookmarks" ? inspiration.folder : "",
  ].filter(Boolean));
}

function currentBookmarkOnlyFolders() {
  const primary = bookmarkPrimaryFolders();
  const folders = Array.isArray(state.settings?.bookmarkOnlyFolders) ? state.settings.bookmarkOnlyFolders : [];
  const seen = new Set();
  const result = [];
  for (const item of folders) {
    const name = String(item || "").trim();
    if (!name || primary.has(name) || seen.has(name)) continue;
    seen.add(name);
    result.push(name);
  }
  return result;
}

function bookmarkOnlyFolderOptions() {
  const selected = new Set(currentBookmarkOnlyFolders());
  const primary = bookmarkPrimaryFolders();
  return (state.settings?.bookmarkFolderOptions || [])
    .filter((option) => option?.name && !selected.has(option.name) && !primary.has(option.name));
}

function addBookmarkOnlyFolder() {
  const folder = els.bookmarkOnlyFolderSelect.value;
  if (!folder) return;
  state.settings = {
    ...(state.settings || {}),
    bookmarkOnlyFolders: [...currentBookmarkOnlyFolders(), folder],
  };
  syncBookmarkOnlyFolderControls();
  renderSettingsStatus();
}

function removeBookmarkOnlyFolder(folder) {
  state.settings = {
    ...(state.settings || {}),
    bookmarkOnlyFolders: currentBookmarkOnlyFolders().filter((name) => name !== folder),
  };
  syncBookmarkOnlyFolderControls();
  renderSettingsStatus();
}

function renderBookmarkOnlyFolderList() {
  const folders = currentBookmarkOnlyFolders();
  if (!folders.length) {
    const empty = document.createElement("div");
    empty.className = "exclude-row";
    const main = document.createElement("div");
    main.className = "exclude-main";
    const title = document.createElement("div");
    title.className = "exclude-title";
    title.textContent = t("settings.bookmarks.noExtra");
    main.append(title);
    empty.append(main);
    els.bookmarkOnlyFolderList.replaceChildren(empty);
    return;
  }
  els.bookmarkOnlyFolderList.replaceChildren(...folders.map((folder) => {
    const row = document.createElement("div");
    row.className = "exclude-row";
    const main = document.createElement("div");
    main.className = "exclude-main";
    const title = document.createElement("div");
    title.className = "exclude-title";
    title.textContent = folder;
    const meta = document.createElement("div");
    meta.className = "exclude-meta";
    meta.textContent = t("settings.bookmarks.panel");
    main.append(title, meta);
    const button = document.createElement("button");
    button.className = "btn";
    button.type = "button";
    setIconLabel(button, "trash-01", t("settings.bookmarks.remove"));
    button.addEventListener("click", () => removeBookmarkOnlyFolder(folder));
    row.append(main, button);
    return row;
  }));
}

function restoreHiddenBookmarkCategory(item) {
  state.settings = {
    ...(state.settings || {}),
    hiddenBookmarkCategories: restoreBookmarkCategory(
      state.settings,
      item.section,
      item.category,
      item.sectionKey,
      item.categoryKey,
    ),
  };
  renderHiddenBookmarkCategoryList();
  renderSettingsStatus(t("settings.status.unsaved"));
}

function restoreAllHiddenBookmarkCategories() {
  state.settings = {
    ...(state.settings || {}),
    hiddenBookmarkCategories: [],
  };
  renderHiddenBookmarkCategoryList();
  renderSettingsStatus(t("settings.status.unsaved"));
}

function renderHiddenBookmarkCategoryList() {
  const items = hiddenBookmarkCategories(state.settings);
  els.restoreAllBookmarkCategories.hidden = items.length < 2;
  els.restoreAllBookmarkCategories.onclick = restoreAllHiddenBookmarkCategories;
  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "exclude-row";
    const main = document.createElement("div");
    main.className = "exclude-main";
    const title = document.createElement("div");
    title.className = "exclude-title";
    title.textContent = t("settings.bookmarks.hiddenEmpty");
    main.append(title);
    empty.append(main);
    els.hiddenBookmarkCategoryList.replaceChildren(empty);
    return;
  }
  els.hiddenBookmarkCategoryList.replaceChildren(...items.map((item) => {
    const row = document.createElement("div");
    row.className = "exclude-row";
    const main = document.createElement("div");
    main.className = "exclude-main";
    const title = document.createElement("div");
    title.className = "exclude-title";
    const section = item.sectionKey === "inspirationPreset" ? t("inspirationPreset.section") : item.section;
    const category = item.sectionKey === "inspirationPreset" && item.categoryKey
      ? t(`category.inspiration.${item.categoryKey}`)
      : item.category;
    title.textContent = `${section} / ${category}`;
    const meta = document.createElement("div");
    meta.className = "exclude-meta";
    meta.textContent = t("settings.bookmarks.hiddenMeta");
    main.append(title, meta);
    const button = document.createElement("button");
    button.className = "btn";
    button.type = "button";
    setIconLabel(button, "eye", t("settings.bookmarks.restore"));
    button.addEventListener("click", () => restoreHiddenBookmarkCategory(item));
    row.append(main, button);
    return row;
  }));
}
}
