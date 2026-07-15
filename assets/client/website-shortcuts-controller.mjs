import { MAX_WEBSITE_SHORTCUTS } from "../../extension/core/settings.mjs";
import { autoScrollDragContainer, createWebsiteShortcutOverflow } from "./website-shortcut-scroll.mjs";
import { animateKeyedLayout, captureKeyedLayout, enterFirstFrame, findKeyedElement, runExitMotion, setDisclosureVisibility } from "./motion.mjs";
import { createWebsiteShortcutSettingsRow } from "./website-shortcut-settings-row.mjs";

const WEBSITE_SHORTCUT_LAYOUT_STORAGE_KEY = "ampira.websiteShortcutsLayout";

export function upsertWebsiteShortcut(shortcuts, shortcut, editingIndex = -1, maxShortcuts = MAX_WEBSITE_SHORTCUTS) {
  const next = Array.isArray(shortcuts) ? shortcuts.map((item) => ({ ...item })) : [];
  if (editingIndex >= 0 && editingIndex < next.length) next[editingIndex] = { ...shortcut };
  else if (next.length < maxShortcuts) next.push({ ...shortcut });
  return next;
}

export function removeWebsiteShortcut(shortcuts, index) {
  return (Array.isArray(shortcuts) ? shortcuts : []).filter((_, itemIndex) => itemIndex !== index).map((item) => ({ ...item }));
}

export function moveWebsiteShortcut(shortcuts, index, direction) {
  const next = Array.isArray(shortcuts) ? shortcuts : [];
  const target = index + direction;
  return reorderWebsiteShortcuts(next, index, target);
}

export function reorderWebsiteShortcuts(shortcuts, fromIndex, toIndex) {
  const next = Array.isArray(shortcuts) ? shortcuts.map((item) => ({ ...item })) : [];
  if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex)
    || fromIndex < 0 || fromIndex >= next.length || toIndex < 0 || toIndex >= next.length
    || fromIndex === toIndex) return next;
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

export function createWebsiteShortcutsController(options) {
  const {
    state, els, t, faviconUrl, createThemedIcon, setIconLabel,
    normalizeWebsiteShortcutUrl, renderSettingsStatus, openBrowserSettings,
    attachLinkContextMenu, saveWebsiteShortcutOrder, localizedErrorMessage,
    maxShortcuts = MAX_WEBSITE_SHORTCUTS, maxTitleLength = 60, maxUrlLength = 2048,
  } = options;
  let editingIndex = -1;
  let busy = false;
  let dashboardOrderBusy = false;
  let dragState = null;
  let feedbackTimer = 0;
  const shortcutOverflow = createWebsiteShortcutOverflow({
    rail: els.websiteShortcuts,
    list: els.websiteShortcutList,
  });

  bindShortcutDragEvents(els.websiteShortcutList, "dashboard", ".website-shortcut");
  bindShortcutDragEvents(els.websiteShortcutSettingsList, "settings", ".website-shortcut-settings-row");

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
    syncWebsiteShortcutDetailsVisibility({ animate: false });
    cacheWebsiteShortcutLayout(settings);
    clearWebsiteShortcutForm();
    renderWebsiteShortcutSettingsList();
  }

  function handleWebsiteShortcutsEnabledChange() {
    syncWebsiteShortcutDetailsVisibility({ animate: true });
    renderSettingsStatus(t(els.websiteShortcutsEnabledInput.checked
      ? "settings.shortcuts.enabledDraft"
      : "settings.shortcuts.disabledDraft"));
  }

  function syncWebsiteShortcutDetailsVisibility(options = {}) {
    setDisclosureVisibility(els.websiteShortcutDetails, els.websiteShortcutsEnabledInput.checked, options);
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
    const shortcutUrl = shortcuts[index].url;
    const row = findKeyedElement(els.websiteShortcutSettingsList, shortcutUrl, ".website-shortcut-settings-row[data-key]");
    if (runExitMotion(row, () => finalizeWebsiteShortcutRemoval(shortcutUrl))) return;
    finalizeWebsiteShortcutRemoval(shortcutUrl);
  }

  function finalizeWebsiteShortcutRemoval(shortcutUrl) {
    const shortcuts = currentWebsiteShortcuts();
    const index = shortcuts.findIndex((shortcut) => shortcut.url === shortcutUrl);
    if (index < 0) return;
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
    const layout = captureKeyedLayout(els.websiteShortcutSettingsList, ".website-shortcut-settings-row[data-key]");
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
    els.websiteShortcutSettingsList.replaceChildren(...shortcuts.map((shortcut, index) => createWebsiteShortcutSettingsRow({
      shortcut, index, count: shortcuts.length, editingIndex, busy, t, setIconLabel,
      onEdit: editWebsiteShortcut, onMove: moveWebsiteShortcutBy, onRemove: removeWebsiteShortcutAt,
    })));
    animateKeyedLayout(els.websiteShortcutSettingsList, layout, ".website-shortcut-settings-row[data-key]");
    syncWebsiteShortcutActionState();
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
    const isInitialEntrance = els.websiteShortcuts.dataset.loading === "true";
    const layout = captureKeyedLayout(els.websiteShortcutList, ".website-shortcut[data-key]");
    delete els.websiteShortcuts.dataset.loading;
    if (dashboardOrderBusy) els.websiteShortcuts.setAttribute("aria-busy", "true");
    else els.websiteShortcuts.removeAttribute("aria-busy");
    els.websiteShortcuts.hidden = !enabled || searching;
    els.websiteShortcuts.classList.toggle("is-empty", false);
    if (!enabled || searching) {
      els.websiteShortcutList.replaceChildren();
      shortcutOverflow.scheduleSync();
      return;
    }
    const shortcuts = currentWebsiteShortcuts();
    if (!shortcuts.length) {
      els.websiteShortcuts.classList.add("is-empty");
      els.websiteShortcutList.replaceChildren(createDashboardEmptyState());
      shortcutOverflow.scheduleSync();
      enterInitialShortcutRail();
      return;
    }
    els.websiteShortcutList.replaceChildren(...shortcuts.map((shortcut, index) => (
      createDashboardShortcut(shortcut, index, shortcuts.length)
    )));
    shortcutOverflow.scheduleSync();
    if (!isInitialEntrance) animateKeyedLayout(els.websiteShortcutList, layout, ".website-shortcut[data-key]");
    enterInitialShortcutRail();

    function enterInitialShortcutRail() {
      if (!isInitialEntrance || state.data?.onboarding?.completed === false) return;
      enterFirstFrame(els.websiteShortcuts, { startedAt: globalThis.ampiraFirstFrameStartedAt, targetDelay: 120 });
    }
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

  function createDashboardShortcut(shortcut, index, count) {
    const link = document.createElement("a");
    link.className = "website-shortcut";
    link.href = shortcut.url;
    link.target = "_self";
    link.rel = "noreferrer";
    link.title = shortcut.title;
    link.draggable = count > 1 && !dashboardOrderBusy;
    link.dataset.shortcutIndex = String(index);
    link.dataset.shortcutUrl = shortcut.url;
    link.dataset.key = shortcut.url;
    link.setAttribute("aria-label", t("shortcuts.open", { title: shortcut.title }));
    link.append(createShortcutIcon(shortcut));
    const label = document.createElement("span");
    label.className = "website-shortcut-label";
    label.textContent = shortcut.title;
    link.append(label);
    attachLinkContextMenu?.(link, () => ({ url: shortcut.url }), () => [{
      label: t("shortcuts.edit"),
      icon: "settings-01",
      action: () => openWebsiteShortcutEditor(shortcut.url),
    }]);
    return link;
  }

  async function openWebsiteShortcutEditor(url) {
    await openBrowserSettings();
    const index = currentWebsiteShortcuts().findIndex((shortcut) => shortcut.url === url);
    if (index >= 0) editWebsiteShortcut(index);
  }

  function bindShortcutDragEvents(container, scope, itemSelector) {
    if (!container) return;
    container.addEventListener("dragstart", (event) => {
      const target = event.target instanceof Element ? event.target : null;
      const item = target?.closest(itemSelector);
      const blocked = target?.closest("button, input, select, textarea");
      if (!item || !container.contains(item) || blocked || busy
        || scope === "dashboard" && dashboardOrderBusy || item.draggable !== true) {
        event.preventDefault();
        return;
      }
      const index = Number(item.dataset.shortcutIndex);
      const url = String(item.dataset.shortcutUrl || "");
      if (!Number.isInteger(index) || !url) {
        event.preventDefault();
        return;
      }
      dragState = { scope, url, fromIndex: index, toIndex: index };
      item.classList.add("is-dragging");
      container.classList.add("is-reordering");
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("application/x-ampira-shortcut", url);
      }
    });
    container.addEventListener("dragover", (event) => {
      if (dragState?.scope !== scope) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
      autoScrollDragContainer(container, event, scope === "dashboard" ? "horizontal" : "vertical");
      if (scope === "dashboard") shortcutOverflow.scheduleSync();
      updateShortcutDropTarget(container, itemSelector, event, scope);
    });
    container.addEventListener("drop", (event) => {
      if (dragState?.scope !== scope) return;
      event.preventDefault();
      const pending = { ...dragState };
      clearShortcutDragState();
      const shortcuts = currentWebsiteShortcuts();
      const fromIndex = shortcuts.findIndex((shortcut) => shortcut.url === pending.url);
      if (fromIndex < 0 || pending.toIndex === fromIndex) return;
      const next = reorderWebsiteShortcuts(shortcuts, fromIndex, pending.toIndex);
      if (scope === "settings") applySettingsShortcutOrder(next);
      else void persistDashboardShortcutOrder(shortcuts, next);
    });
    container.addEventListener("dragend", clearShortcutDragState);
  }

  function updateShortcutDropTarget(container, itemSelector, event, scope) {
    const target = event.target instanceof Element ? event.target.closest(itemSelector) : null;
    const items = Array.from(container.querySelectorAll(itemSelector));
    let targetItem = target && container.contains(target) ? target : items.at(-1);
    if (!targetItem) return;
    const targetIndex = Number(targetItem.dataset.shortcutIndex);
    if (!Number.isInteger(targetIndex)) return;
    const rect = targetItem.getBoundingClientRect();
    const after = target
      ? (scope === "dashboard" ? event.clientX >= rect.left + rect.width / 2 : event.clientY >= rect.top + rect.height / 2)
      : true;
    let toIndex = targetIndex + (after ? 1 : 0);
    if (dragState.fromIndex < toIndex) toIndex -= 1;
    dragState.toIndex = Math.max(0, Math.min(items.length - 1, toIndex));
    clearShortcutDropIndicators();
    targetItem.classList.add(after ? "is-drop-after" : "is-drop-before");
  }

  function clearShortcutDropIndicators() {
    for (const container of [els.websiteShortcutList, els.websiteShortcutSettingsList]) {
      container?.querySelectorAll(".is-drop-before, .is-drop-after").forEach((item) => {
        item.classList.remove("is-drop-before", "is-drop-after");
      });
    }
  }

  function clearShortcutDragState() {
    clearShortcutDropIndicators();
    for (const container of [els.websiteShortcutList, els.websiteShortcutSettingsList]) {
      container?.classList.remove("is-reordering");
      container?.querySelectorAll(".is-dragging").forEach((item) => item.classList.remove("is-dragging"));
    }
    dragState = null;
  }

  function applySettingsShortcutOrder(next) {
    const editingUrl = currentWebsiteShortcuts()[editingIndex]?.url || "";
    state.settings = { ...(state.settings || {}), websiteShortcuts: next };
    editingIndex = editingUrl ? next.findIndex((shortcut) => shortcut.url === editingUrl) : -1;
    renderWebsiteShortcutSettingsList();
    renderSettingsStatus(t("settings.shortcuts.reordered"));
  }

  async function persistDashboardShortcutOrder(previous, next) {
    dashboardOrderBusy = true;
    state.settings = { ...(state.settings || {}), websiteShortcuts: next };
    renderWebsiteShortcuts();
    announceShortcutFeedback("shortcuts.orderSaving");
    try {
      const saved = await saveWebsiteShortcutOrder(next);
      const savedShortcuts = Array.isArray(saved?.websiteShortcuts)
        ? saved.websiteShortcuts.map((shortcut) => ({ title: shortcut.title, url: shortcut.url }))
        : next;
      state.settings = { ...(state.settings || {}), websiteShortcuts: savedShortcuts };
      announceShortcutFeedback("shortcuts.orderSaved");
    } catch (error) {
      state.settings = { ...(state.settings || {}), websiteShortcuts: previous };
      announceShortcutFeedback("shortcuts.orderSaveFailed", {
        message: localizedErrorMessage?.(error) || error?.message || String(error),
      }, true);
    } finally {
      dashboardOrderBusy = false;
      cacheWebsiteShortcutLayout(state.settings || {});
      renderWebsiteShortcuts();
    }
  }

  function announceShortcutFeedback(key, params = {}, visibleError = false) {
    const feedback = els.websiteShortcutFeedback;
    if (!feedback) return;
    if (feedbackTimer) window.clearTimeout(feedbackTimer);
    feedback.textContent = t(key, params);
    feedback.classList.toggle("is-visible-error", visibleError);
    feedbackTimer = window.setTimeout(() => {
      feedback.textContent = "";
      feedback.classList.remove("is-visible-error");
      feedbackTimer = 0;
    }, visibleError ? 5000 : 1800);
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
