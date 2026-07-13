export function createBookmarkSettingsController(options) {
  const { state, els, t, formatLocaleList, renderSettingsStatus, setIconLabel } = options;
  return {
    syncBookmarkFolderControls,
    syncBookmarkOnlyFolderControls,
    bookmarkSourcePayload,
    renderBookmarkSourceStatus,
    addBookmarkOnlyFolder,
    renderBookmarkOnlyFolderList,
    currentBookmarkOnlyFolders,
  };
function syncBookmarkFolderControls(settings = {}) {
  const options = Array.isArray(settings.bookmarkFolderOptions) ? settings.bookmarkFolderOptions : [];
  syncBookmarkFolderSelect(els.newsBookmarkFolderSelect, options, settings.newsBookmarkFolder || settings.defaultNewsBookmarkFolder);
  syncBookmarkFolderSelect(els.inspirationBookmarkFolderSelect, options, settings.inspirationBookmarkFolder || settings.defaultInspirationBookmarkFolder);
  syncBookmarkOnlyFolderControls();
  renderBookmarkSourceStatus();
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
  const normalizedOptions = options
    .map((option) => ({
      name: String(option?.name || "").trim(),
      count: Number(option?.count || 0),
    }))
    .filter((option) => option.name);
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

function bookmarkSourcePayload() {
  return {
    newsBookmarkFolder: els.newsBookmarkFolderSelect.value,
    inspirationBookmarkFolder: els.inspirationBookmarkFolderSelect.value,
    bookmarkOnlyFolders: currentBookmarkOnlyFolders(),
  };
}

function renderBookmarkSourceStatus() {
  const news = els.newsBookmarkFolderSelect.value || "-";
  const inspiration = els.inspirationBookmarkFolderSelect.value || "-";
  const same = news && inspiration && news === inspiration;
  const extra = currentBookmarkOnlyFolders();
  els.bookmarkSourceStatus.textContent = same
    ? t("settings.bookmarks.same")
    : t("settings.bookmarks.summary", {
      news,
      inspiration,
      extra: extra.length ? formatLocaleList(extra) : t("settings.bookmarks.notAdded"),
    });
}

function bookmarkPrimaryFolders() {
  return new Set([
    els.newsBookmarkFolderSelect.value || state.settings?.newsBookmarkFolder || state.settings?.defaultNewsBookmarkFolder || "",
    els.inspirationBookmarkFolderSelect.value || state.settings?.inspirationBookmarkFolder || state.settings?.defaultInspirationBookmarkFolder || "",
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
}
