const WEBSITE_SHORTCUT_LAYOUT_STORAGE_KEY = "ampira.websiteShortcutsLayout";

export function upsertWebsiteShortcut(shortcuts, shortcut, editingIndex = -1, maxShortcuts = 10) {
  const next = Array.isArray(shortcuts) ? shortcuts.map((item) => ({ ...item })) : [];
  if (editingIndex >= 0 && editingIndex < next.length) next[editingIndex] = { ...shortcut };
  else if (next.length < maxShortcuts) next.push({ ...shortcut });
  return next;
}

export function removeWebsiteShortcut(shortcuts, index) {
  return (Array.isArray(shortcuts) ? shortcuts : []).filter((_, itemIndex) => itemIndex !== index).map((item) => ({ ...item }));
}

export function moveWebsiteShortcut(shortcuts, index, direction) {
  const next = Array.isArray(shortcuts) ? shortcuts.map((item) => ({ ...item })) : [];
  const target = index + direction;
  if (!next[index] || target < 0 || target >= next.length) return next;
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export function createWebsiteShortcutsController(options) {
  const {
    state, els, t, faviconUrl, createThemedIcon, setIconLabel,
    normalizeWebsiteShortcutUrl, renderSettingsStatus, openBrowserSettings,
    maxShortcuts = 10, maxTitleLength = 60, maxUrlLength = 2048,
  } = options;
  let editingIndex = -1;
  let busy = false;

  return {
    syncWebsiteShortcutControls,
    websiteShortcutsPayload,
    renderWebsiteShortcuts,
    addOrUpdateWebsiteShortcut,
    cancelWebsiteShortcutEdit,
    setWebsiteShortcutControlsBusy,
    handleWebsiteShortcutsEnabledChange,
    currentWebsiteShortcuts,
    refreshWebsiteShortcutTranslations,
  };

  function currentWebsiteShortcuts() {
    return Array.isArray(state.settings?.websiteShortcuts)
      ? state.settings.websiteShortcuts.map((item) => ({ title: item.title, url: item.url }))
      : [];
  }

  function websiteShortcutsPayload() {
    return {
      websiteShortcutsEnabled: els.websiteShortcutsEnabledInput.checked,
      websiteShortcuts: currentWebsiteShortcuts(),
    };
  }

  function syncWebsiteShortcutControls(settings = state.settings || {}) {
    editingIndex = -1;
    els.websiteShortcutsEnabledInput.checked = settings.websiteShortcutsEnabled === true;
    cacheWebsiteShortcutLayout(settings);
    clearWebsiteShortcutForm();
    renderWebsiteShortcutSettingsList();
  }

  function handleWebsiteShortcutsEnabledChange() {
    renderSettingsStatus(t(els.websiteShortcutsEnabledInput.checked
      ? "settings.shortcuts.enabledDraft"
      : "settings.shortcuts.disabledDraft"));
  }

  function refreshWebsiteShortcutTranslations() {
    syncWebsiteShortcutFormState();
    renderWebsiteShortcutSettingsList();
    renderWebsiteShortcuts();
  }

  function addOrUpdateWebsiteShortcut() {
    const title = String(els.websiteShortcutTitleInput.value || "").replace(/\s+/g, " ").trim();
    const rawUrl = String(els.websiteShortcutUrlInput.value || "").trim();
    const url = normalizeWebsiteShortcutUrl(rawUrl);
    if (!title) return rejectShortcutDraft("settings.shortcuts.errorTitle", els.websiteShortcutTitleInput);
    if (title.length > maxTitleLength) return rejectShortcutDraft("settings.shortcuts.errorTitleLong", els.websiteShortcutTitleInput);
    if (!rawUrl || rawUrl.length > maxUrlLength || !url) {
      return rejectShortcutDraft("settings.shortcuts.errorUrl", els.websiteShortcutUrlInput);
    }
    const shortcuts = currentWebsiteShortcuts();
    if (shortcuts.some((item, index) => item.url === url && index !== editingIndex)) {
      return rejectShortcutDraft("settings.shortcuts.errorDuplicate", els.websiteShortcutUrlInput);
    }
    if (editingIndex < 0 && shortcuts.length >= maxShortcuts) {
      return rejectShortcutDraft("settings.shortcuts.errorLimit", els.websiteShortcutTitleInput, { max: maxShortcuts });
    }
    const nextShortcuts = upsertWebsiteShortcut(shortcuts, { title, url }, editingIndex, maxShortcuts);
    state.settings = {
      ...(state.settings || {}),
      websiteShortcuts: nextShortcuts,
    };
    const wasEditing = editingIndex >= 0;
    editingIndex = -1;
    clearWebsiteShortcutForm();
    renderWebsiteShortcutSettingsList();
    renderSettingsStatus(t(
      !wasEditing && nextShortcuts.length >= maxShortcuts
        ? "settings.shortcuts.errorLimit"
        : wasEditing ? "settings.shortcuts.updated" : "settings.shortcuts.added",
      { max: maxShortcuts },
    ));
    els.websiteShortcutTitleInput.focus({ preventScroll: true });
  }

  function rejectShortcutDraft(key, target, params = {}) {
    renderSettingsStatus(t(key, params));
    target.focus({ preventScroll: true });
    return false;
  }

  function editWebsiteShortcut(index) {
    const shortcut = currentWebsiteShortcuts()[index];
    if (!shortcut) return;
    editingIndex = index;
    els.websiteShortcutTitleInput.value = shortcut.title;
    els.websiteShortcutUrlInput.value = shortcut.url;
    syncWebsiteShortcutFormState();
    renderWebsiteShortcutSettingsList();
    renderSettingsStatus(t("settings.shortcuts.editing", { title: shortcut.title }));
    els.websiteShortcutTitleInput.focus({ preventScroll: true });
    els.websiteShortcutTitleInput.select();
  }

  function cancelWebsiteShortcutEdit() {
    if (editingIndex < 0) return;
    editingIndex = -1;
    clearWebsiteShortcutForm();
    renderWebsiteShortcutSettingsList();
    renderSettingsStatus();
  }

  function removeWebsiteShortcutAt(index) {
    const shortcuts = currentWebsiteShortcuts();
    if (!shortcuts[index]) return;
    state.settings = { ...(state.settings || {}), websiteShortcuts: removeWebsiteShortcut(shortcuts, index) };
    if (editingIndex === index) editingIndex = -1;
    else if (editingIndex > index) editingIndex -= 1;
    if (editingIndex < 0) clearWebsiteShortcutForm();
    renderWebsiteShortcutSettingsList();
    renderSettingsStatus(t("settings.shortcuts.removed"));
  }

  function moveWebsiteShortcutBy(index, direction) {
    const shortcuts = currentWebsiteShortcuts();
    const target = index + direction;
    if (!shortcuts[index] || target < 0 || target >= shortcuts.length) return;
    state.settings = { ...(state.settings || {}), websiteShortcuts: moveWebsiteShortcut(shortcuts, index, direction) };
    if (editingIndex === index) editingIndex = target;
    else if (editingIndex === target) editingIndex = index;
    renderWebsiteShortcutSettingsList();
    renderSettingsStatus(t("settings.shortcuts.reordered"));
  }

  function clearWebsiteShortcutForm() {
    els.websiteShortcutTitleInput.value = "";
    els.websiteShortcutUrlInput.value = "";
    syncWebsiteShortcutFormState();
  }

  function syncWebsiteShortcutFormState() {
    setIconLabel(
      els.addWebsiteShortcut,
      editingIndex >= 0 ? "check" : "plus",
      t(editingIndex >= 0 ? "settings.shortcuts.update" : "settings.shortcuts.add"),
    );
    els.cancelWebsiteShortcutEdit.hidden = editingIndex < 0;
    syncWebsiteShortcutActionState();
  }

  function renderWebsiteShortcutSettingsList() {
    const shortcuts = currentWebsiteShortcuts();
    els.websiteShortcutCount.textContent = t("settings.shortcuts.count", {
      count: shortcuts.length,
      max: maxShortcuts,
    });
    if (!shortcuts.length) {
      const empty = document.createElement("div");
      empty.className = "website-shortcut-settings-empty";
      empty.textContent = t("settings.shortcuts.emptyList");
      els.websiteShortcutSettingsList.replaceChildren(empty);
      syncWebsiteShortcutActionState();
      return;
    }
    els.websiteShortcutSettingsList.replaceChildren(...shortcuts.map((shortcut, index) => {
      const row = document.createElement("div");
      row.className = "website-shortcut-settings-row";
      row.classList.toggle("is-editing", index === editingIndex);

      const main = document.createElement("div");
      main.className = "website-shortcut-settings-main";
      const title = document.createElement("strong");
      title.textContent = shortcut.title;
      const url = document.createElement("span");
      url.textContent = shortcut.url;
      main.append(title, url);

      const actions = document.createElement("div");
      actions.className = "website-shortcut-settings-actions";
      const edit = textButton(t("settings.shortcuts.edit"), () => editWebsiteShortcut(index));
      edit.classList.add("shortcut-edit-action");
      const up = orderButton("↑", t("settings.shortcuts.moveUp", { title: shortcut.title }), () => moveWebsiteShortcutBy(index, -1));
      up.disabled = busy || index === 0;
      const down = orderButton("↓", t("settings.shortcuts.moveDown", { title: shortcut.title }), () => moveWebsiteShortcutBy(index, 1));
      down.disabled = busy || index === shortcuts.length - 1;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "btn website-shortcut-remove";
      setIconLabel(remove, "trash-01", t("settings.shortcuts.remove"));
      remove.addEventListener("click", () => removeWebsiteShortcutAt(index));
      edit.disabled = busy;
      remove.disabled = busy;
      actions.append(edit, up, down, remove);
      row.append(main, actions);
      return row;
    }));
    syncWebsiteShortcutActionState();
  }

  function textButton(label, onClick) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn";
    button.textContent = label;
    button.addEventListener("click", onClick);
    return button;
  }

  function orderButton(glyph, label, onClick) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn website-shortcut-order";
    button.textContent = glyph;
    button.setAttribute("aria-label", label);
    button.title = label;
    button.addEventListener("click", onClick);
    return button;
  }

  function setWebsiteShortcutControlsBusy(value) {
    busy = value === true;
    els.websiteShortcutsEnabledInput.disabled = busy;
    els.websiteShortcutTitleInput.disabled = busy;
    els.websiteShortcutUrlInput.disabled = busy;
    els.cancelWebsiteShortcutEdit.disabled = busy;
    renderWebsiteShortcutSettingsList();
  }

  function syncWebsiteShortcutActionState() {
    const atLimit = currentWebsiteShortcuts().length >= maxShortcuts;
    els.addWebsiteShortcut.disabled = busy || editingIndex < 0 && atLimit;
    els.websiteShortcutSettingsList.querySelectorAll("button").forEach((button) => {
      if (!button.disabled) button.disabled = busy;
    });
  }

  function renderWebsiteShortcuts() {
    const enabled = state.settings?.websiteShortcutsEnabled === true;
    const searching = Boolean(state.query);
    delete els.websiteShortcuts.dataset.loading;
    els.websiteShortcuts.removeAttribute("aria-busy");
    els.websiteShortcuts.hidden = !enabled || searching;
    els.websiteShortcuts.classList.toggle("is-empty", false);
    if (!enabled || searching) {
      els.websiteShortcutList.replaceChildren();
      return;
    }
    const shortcuts = currentWebsiteShortcuts();
    if (!shortcuts.length) {
      els.websiteShortcuts.classList.add("is-empty");
      els.websiteShortcutList.replaceChildren(createDashboardEmptyState());
      return;
    }
    els.websiteShortcutList.replaceChildren(...shortcuts.map(createDashboardShortcut));
  }

  function cacheWebsiteShortcutLayout(settings = {}) {
    const layout = {
      enabled: settings.websiteShortcutsEnabled === true,
      count: Math.min(maxShortcuts, Array.isArray(settings.websiteShortcuts) ? settings.websiteShortcuts.length : 0),
    };
    document.documentElement.classList.toggle("has-website-shortcuts", layout.enabled);
    document.documentElement.dataset.websiteShortcutCount = String(layout.count);
    try { localStorage.setItem(WEBSITE_SHORTCUT_LAYOUT_STORAGE_KEY, JSON.stringify(layout)); } catch {}
  }

  function createDashboardShortcut(shortcut) {
    const link = document.createElement("a");
    link.className = "website-shortcut";
    link.href = shortcut.url;
    link.target = "_self";
    link.rel = "noreferrer";
    link.title = shortcut.title;
    link.setAttribute("aria-label", t("shortcuts.open", { title: shortcut.title }));
    link.append(createShortcutIcon(shortcut));
    const label = document.createElement("span");
    label.className = "website-shortcut-label";
    label.textContent = shortcut.title;
    link.append(label);
    return link;
  }

  function createShortcutIcon(shortcut) {
    const source = faviconUrl(shortcut);
    if (!source || source === "favicon.svg" || source.endsWith("/favicon.svg")) return bookmarkFallback();
    const icon = document.createElement("img");
    icon.className = "website-shortcut-icon";
    icon.src = source;
    icon.alt = "";
    icon.setAttribute("aria-hidden", "true");
    icon.referrerPolicy = "no-referrer";
    icon.addEventListener("error", () => icon.replaceWith(bookmarkFallback()), { once: true });
    return icon;
  }

  function bookmarkFallback() {
    const icon = createThemedIcon("bookmark", "website-shortcut-icon is-fallback");
    icon.alt = "";
    icon.setAttribute("aria-hidden", "true");
    return icon;
  }

  function createDashboardEmptyState() {
    const empty = document.createElement("div");
    empty.className = "website-shortcuts-empty";
    const copy = document.createElement("span");
    copy.textContent = t("shortcuts.empty");
    const action = document.createElement("button");
    action.type = "button";
    action.className = "btn";
    setIconLabel(action, "plus", t("shortcuts.configure"));
    action.addEventListener("click", openBrowserSettings);
    empty.append(copy, action);
    return empty;
  }
}
