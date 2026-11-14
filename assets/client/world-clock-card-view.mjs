import { WORLD_CLOCK_CITIES, WORLD_CLOCK_LIMIT } from "../../extension/core/world-clock.mjs";
import { worldClockTime } from "./world-clock-time.mjs";
import { personalCardControls } from "./personal-card-controls.mjs";

export function createWorldClockCardView({ state, t, getLocale, createIcon, worldClockState, requestRender, isActive, localizedErrorMessage, now = () => new Date() }) {
  const { node, button, iconButton, labelButton } = personalCardControls(createIcon);
  let editing = false, editingId = "", editingRevision = 0, error = "", timer = 0;
  const root = node("div", "personal-card-content world-clock-content");
  const notice = node("div", "utility-inline-status personal-card-notice"); notice.setAttribute("role", "alert");
  const list = node("div", "world-clock-list utility-scroll-list");
  const editor = node("div", "world-clock-editor");
  const search = node("input", "utility-entry-input"); search.type = "search"; search.autocomplete = "off";
  const choices = node("div", "world-clock-options utility-scroll-list");
  const noMatches = node("div", "utility-inline-status");
  editor.append(search, choices, noMatches); root.append(notice, list, editor);
  const add = iconButton("plus", () => editing ? closeEditor() : openEditor());
  const retry = iconButton("refresh-cw-01", () => {
    error = "";
    if (worldClockState.read().error) worldClockState.ensure({ force: true }); else worldClockState.retrySync();
  });
  search.addEventListener("input", renderChoices);
  editor.addEventListener("keydown", event => {
    if (event.key !== "Escape") return;
    event.preventDefault(); event.stopPropagation(); closeEditor();
  });
  document.addEventListener("visibilitychange", () => { stop(); if (isActive() && document.visibilityState === "visible") requestRender(); });
  window.addEventListener("pagehide", stop);
  worldClockState.ensure();
  return { render, contextActions, deactivate() { stop(); editing = false; editingId = ""; } };

  function stop() { clearTimeout(timer); timer = 0; }
  function openEditor(id = "") {
    const shared = worldClockState.read();
    if (!shared.loaded || shared.busy) return;
    const item = shared.value.items.find(item => item.id === id);
    if (id && id !== "local" && !item) return;
    editingId = item?.id || ""; editingRevision = item?.revision || 0;
    editing = true; error = ""; search.value = ""; requestRender(); search.focus({ preventScroll: true });
  }
  function closeEditor() {
    const focusId = editingId;
    editing = false; editingId = ""; error = ""; requestRender(); focusRow(focusId);
  }
  function focusRow(id) {
    if (!isActive()) return;
    (Array.from(list.children).find(row => row.dataset.key === id) || add).focus({ preventScroll: true });
  }
  async function change(action) {
    error = "";
    const result = await worldClockState.change(action);
    if (!result.ok) error = result.reason;
    else { editing = false; editingId = ""; }
    requestRender(); if (result.ok) focusRow(action.type === "remove" ? "" : action.id);
  }
  function contextActions(target) {
    if (editing || !worldClockState.read().loaded || worldClockState.read().busy) return [];
    const row = target?.closest?.(".world-clock-row");
    if (!row || !list.contains(row)) return [];
    const item = worldClockState.read().value.items.find(item => item.id === row.dataset.key);
    const actions = [{ label: t(item ? "worldClock.edit" : "worldClock.chooseCity"), icon: "edit-05", action: () => openEditor(row.dataset.key) }];
    if (item) actions.push({ label: t("worldClock.remove", { city: t("worldClock.city." + item.id) }), icon: "trash-01",
      action: () => change({ type: "remove", id: item.id, revision: item.revision }) });
    return actions;
  }
  function renderChoices() {
    const shared = worldClockState.read(), selected = new Set(shared.value.items.map(item => item.id));
    const query = search.value.trim().normalize("NFKC").toLocaleLowerCase();
    const matches = WORLD_CLOCK_CITIES.filter(city => (!selected.has(city.id) || city.id === editingId)
      && `${t("worldClock.city." + city.id)} ${city.id} ${city.id.replace(/([a-z])([A-Z])/g, "$1 $2")} ${city.timeZone.replaceAll("_", " ")}`.toLocaleLowerCase().includes(query));
    choices.replaceChildren(...matches.map(city => {
      const choice = button("world-clock-choice", () => city.id === editingId ? closeEditor()
        : change({ type: editingId ? "replace" : "add", id: city.id, previousId: editingId, revision: editingRevision }));
      choice.textContent = t("worldClock.city." + city.id); choice.disabled = shared.busy || !editingId && selected.size >= WORLD_CLOCK_LIMIT;
      return choice;
    }));
    noMatches.textContent = t("worldClock.noMatches"); noMatches.hidden = Boolean(matches.length);
  }
  function render() {
    if (state.settings?.syncWorldClockEnabled === false) worldClockState.clearSyncError();
    const shared = worldClockState.read(), date = now();
    const syncError = state.settings?.syncWorldClockEnabled === false ? null : shared.syncError;
    const message = error && error !== "request" ? t("worldClock.error." + error, { count: WORLD_CLOCK_LIMIT })
      : shared.error ? t("worldClock.error.request", { message: localizedErrorMessage(shared.error) })
        : syncError ? t("worldClock.syncFailed", { message: syncError.messageKey ? t(syncError.messageKey, syncError.messageParams) : localizedErrorMessage(syncError) })
          : !shared.loaded ? t("personalCards.loading") : "";
    notice.textContent = message; notice.hidden = !message;
    notice.classList.toggle("is-error", Boolean(error || shared.error || syncError));
    editor.hidden = !editing; list.hidden = editing;
    labelButton(add, t(editing ? "action.close" : shared.value.items.length >= WORLD_CLOCK_LIMIT ? "worldClock.error.limit" : "worldClock.add", { count: WORLD_CLOCK_LIMIT }));
    const icon = editing ? "x-close" : "plus";
    if (add.dataset.icon !== icon) { add.dataset.icon = icon; add.replaceChildren(createIcon(icon, "action-toggle-icon")); }
    add.disabled = shared.busy || !shared.loaded || !editing && shared.value.items.length >= WORLD_CLOCK_LIMIT;
    add.setAttribute("aria-expanded", String(editing));
    search.placeholder = t("worldClock.search"); search.setAttribute("aria-label", t("worldClock.search"));
    retry.hidden = !shared.error && !syncError; retry.disabled = shared.busy; labelButton(retry, t("personalCards.retry"));
    if (editing) renderChoices();
    else renderRows(shared, date);
    if (!timer && isActive() && document.visibilityState === "visible") timer = setTimeout(() => { timer = 0; requestRender(); }, 60_000 - Date.now() % 60_000 + 30);
    return { content: root, actions: [...(retry.hidden ? [] : [retry]), add] };
  }
  function renderRows(shared, date) {
    const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const old = new Map(Array.from(list.children, row => [row.dataset.key, row]));
    const cities = shared.value.items.length ? WORLD_CLOCK_CITIES.filter(city => shared.value.items.some(item => item.id === city.id))
      : [{ id: "local", timeZone: localZone }];
    const rows = cities.map(city => {
      let row = old.get(city.id);
      if (!row) {
        row = button("world-clock-row", () => openEditor(city.id)); row.dataset.key = city.id;
        const copy = node("span", "world-clock-copy"); copy.append(node("span", "world-clock-city"), node("span", "world-clock-date"));
        const value = node("span", "world-clock-value"); value.append(node("time", "world-clock-time"), node("span", "world-clock-offset"));
        row.append(copy, value);
      }
      const time = worldClockTime(date, city.timeZone, getLocale(), localZone);
      const name = t(city.id === "local" ? "worldClock.local" : "worldClock.city." + city.id);
      row.querySelector(".world-clock-city").textContent = name;
      row.querySelector(".world-clock-date").textContent = time.date;
      const clock = row.querySelector("time"); clock.textContent = time.time; clock.dateTime = date.toISOString();
      row.querySelector(".world-clock-offset").textContent = city.id === "local" ? t(time.working ? "worldClock.working" : "worldClock.offHours")
        : time.difference ? t("worldClock.offset", { offset: time.differenceText }) : t("worldClock.sameTime");
      row.classList.toggle("is-working", time.working);
      row.title = `${name} · ${city.timeZone} · ${t(time.working ? "worldClock.working" : "worldClock.offHours")} · ${t("worldClock.workHours")}`;
      row.disabled = shared.busy || !shared.loaded;
      row.setAttribute("aria-label", `${name} ${time.time} · ${t(city.id === "local" ? "worldClock.chooseCity" : "worldClock.edit")}`);
      return row;
    });
    rows.forEach((row, index) => { if (list.children[index] !== row) list.insertBefore(row, list.children[index] || null); });
    while (list.children.length > rows.length) list.lastElementChild.remove();
  }
}
