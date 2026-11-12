import { COUNTDOWN_ITEM_LIMIT, COUNTDOWN_TITLE_LIMIT } from "../../extension/core/countdown.mjs";
import { nodesEqualIgnoringIconLoadState, spanText } from "./dom.mjs";
import { createDatePicker } from "./date-picker.mjs";

export function createCountdownCardView({ id, t, tc, getLocale, createIcon, createEmptyState, countdownState, requestRender }) {
  let editing = false, editingId = "", error = "", emptyLocale = "";
  const root = document.createElement("div"); root.className = "countdown-content";
  const form = document.createElement("form");
  form.className = "countdown-form"; form.id = `countdown-form-${id}`; form.noValidate = true;
  const titleInput = document.createElement("input");
  titleInput.className = "utility-entry-input"; titleInput.type = "text"; titleInput.maxLength = COUNTDOWN_TITLE_LIMIT; titleInput.autocomplete = "off";
  const controls = document.createElement("div"); controls.className = "countdown-form-controls";
  const dateInput = document.createElement("input");
  dateInput.className = "utility-entry-input countdown-date-input";
  const datePicker = createDatePicker({ input: dateInput, id: `countdown-${id}`, t, getLocale, createIcon, today: countdownState.today });
  const save = document.createElement("button"); save.type = "submit"; save.className = "efficiency-action utility-entry-submit";
  controls.append(datePicker.control, save); form.append(titleInput, controls);
  const notice = spanText("", "utility-inline-status is-error countdown-notice");
  notice.id = `countdown-notice-${id}`; notice.setAttribute("role", "alert");
  titleInput.setAttribute("aria-describedby", notice.id); dateInput.setAttribute("aria-describedby", notice.id);
  const list = document.createElement("div"); list.className = "countdown-list utility-scroll-list";
  const empty = document.createElement("div"); empty.className = "countdown-empty";
  root.append(form, notice, list, empty);
  const add = iconButton("plus", () => editing ? closeEditor() : openEditor());
  add.setAttribute("aria-controls", form.id);
  let addIcon = "plus";
  form.addEventListener("keydown", event => {
    if (event.key !== "Escape") return;
    event.preventDefault(); event.stopPropagation(); closeEditor();
  });
  form.addEventListener("submit", event => {
    event.preventDefault();
    const outcome = countdownState.save({ title: titleInput.value, date: datePicker.value() }, editingId);
    if (!outcome.ok) {
      error = outcome.reason; requestRender();
      (error === "dateRequired" ? dateInput : titleInput).focus({ preventScroll: true });
      return;
    }
    datePicker.close(); editing = false; editingId = ""; error = ""; requestRender();
    focusItem(outcome.id);
  });

  return { render, contextActions, deactivate() { datePicker.close(); editing = false; editingId = ""; error = ""; } };

  function contextActions(target) {
    const row = target?.closest?.(".countdown-row");
    const items = countdownState.read();
    const index = items.findIndex(item => item.id === row?.dataset.key);
    if (!row || !list.contains(row) || index < 0) return [];
    const item = items[index];
    return [{ label: t("countdown.remove", { title: item.title }), icon: "trash-01", action: () => {
      if (editingId === item.id) { datePicker.close(); editing = false; editingId = ""; error = ""; }
      countdownState.remove(item.id);
      const remaining = countdownState.read();
      focusItem(remaining[Math.min(index, remaining.length - 1)]?.id);
    } }];
  }

  function render() {
    const items = countdownState.read();
    form.hidden = !editing; notice.hidden = !error;
    notice.textContent = error ? t(`countdown.error.${error}`, { count: COUNTDOWN_ITEM_LIMIT }) : "";
    titleInput.placeholder = t("countdown.placeholder"); titleInput.setAttribute("aria-label", t("countdown.titleLabel"));
    dateInput.setAttribute("aria-label", t("countdown.dateLabel"));
    datePicker.sync();
    titleInput.setAttribute("aria-invalid", String(error === "titleRequired"));
    dateInput.setAttribute("aria-invalid", String(error === "dateRequired"));
    save.textContent = t(editingId ? "countdown.save" : "countdown.add");
    const nextIcon = editing ? "x-close" : "plus";
    if (nextIcon !== addIcon) { addIcon = nextIcon; add.replaceChildren(createIcon(nextIcon, "action-toggle-icon")); }
    label(add, t(editing ? "countdown.cancel" : "countdown.addLabel")); add.setAttribute("aria-expanded", String(editing));
    empty.hidden = Boolean(items.length || editing);
    if (!empty.firstChild || emptyLocale !== getLocale()) {
      emptyLocale = getLocale();
      empty.replaceChildren(createEmptyState({ title: t("countdown.emptyTitle"), body: t("countdown.emptyBody"),
        actionLabel: t("countdown.addLabel"), actionIcon: "plus", onAction: () => openEditor(), variant: "compact" }));
    }
    syncRows(items);
    list.hidden = !items.length;
    return { content: root, meta: spanText(tc("countdown.items", items.length), "efficiency-meta utility-meta"), actions: [add] };
  }

  function openEditor(item) {
    datePicker.close();
    editing = true; editingId = item?.id || ""; error = "";
    titleInput.value = item?.title || ""; dateInput.value = item?.date || countdownState.today();
    requestRender(); titleInput.focus({ preventScroll: true });
  }
  function closeEditor() {
    datePicker.close();
    const previous = editingId;
    editing = false; editingId = ""; error = "";
    requestRender(); focusItem(previous);
  }
  function focusItem(key) {
    const row = Array.from(list.children).find(node => node.dataset.key === key);
    (row?.querySelector(".countdown-item") || add).focus({ preventScroll: true });
    if (row && !list.hidden) {
      const bounds = list.getBoundingClientRect(), item = row.getBoundingClientRect();
      if (item.top < bounds.top) list.scrollTop += item.top - bounds.top;
      else if (item.bottom > bounds.bottom) list.scrollTop += item.bottom - bounds.bottom;
    }
  }
  function syncRows(items) {
    const active = document.activeElement;
    const focusedKey = list.contains(active) ? active.closest(".countdown-row")?.dataset.key : "";
    const previous = new Map(Array.from(list.children, row => [row.dataset.key, row]));
    const rows = items.map(item => {
      const next = createRow(item), old = previous.get(item.id);
      return old && nodesEqualIgnoringIconLoadState(old, next) ? old : next;
    });
    rows.forEach((row, index) => { if (list.children[index] !== row) list.insertBefore(row, list.children[index] || null); });
    while (list.children.length > rows.length) list.lastElementChild.remove();
    if (focusedKey && active !== document.activeElement) focusItem(items.some(item => item.id === focusedKey) ? focusedKey : items[0]?.id);
  }
  function createRow(item) {
    const row = document.createElement("div"); row.className = "countdown-row"; row.dataset.key = item.id;
    row.classList.toggle("is-past", item.days < 0); row.classList.toggle("is-today", item.days === 0);
    const edit = document.createElement("button"); edit.type = "button"; edit.className = "countdown-item";
    edit.title = t("countdown.edit", { title: item.title });
    edit.addEventListener("click", () => openEditor(countdownState.read().find(current => current.id === item.id)));
    const main = spanText("", "countdown-main");
    const name = spanText(item.title, "countdown-name"); name.title = item.title;
    const date = document.createElement("time"); date.className = "countdown-date"; date.dateTime = item.date;
    const dateValue = new Date(item.date + "T12:00:00Z");
    const showYear = item.date.slice(0, 4) !== countdownState.today().slice(0, 4);
    date.textContent = [
      new Intl.DateTimeFormat(getLocale(), { ...(showYear ? { year: "numeric" } : {}), month: "short", day: "numeric", timeZone: "UTC" }).format(dateValue),
      new Intl.DateTimeFormat(getLocale(), { weekday: "short", timeZone: "UTC" }).format(dateValue),
    ].join(" · ");
    date.title = item.date;
    main.append(name, date);
    const count = spanText("", "countdown-count");
    count.classList.toggle("is-long", Math.abs(item.days) >= 10000);
    let status;
    if (item.days === 0) {
      status = t("countdown.today"); count.append(spanText(status, "countdown-today"));
    } else {
      const number = new Intl.NumberFormat(getLocale()).format(Math.abs(item.days));
      const unit = t(Math.abs(item.days) === 1 ? "countdown.day" : "countdown.days");
      const prefix = t(item.days < 0 ? "countdown.elapsed" : "countdown.remaining");
      status = `${prefix} ${number} ${unit}`;
      if (item.days < 0) count.append(spanText(prefix, "countdown-direction"));
      const amount = spanText("", "countdown-amount");
      amount.append(spanText(number, "countdown-number"), spanText(item.days < 0 ? unit : tc("countdown.daysLeft", item.days), "countdown-unit"));
      count.append(amount);
    }
    edit.setAttribute("aria-label", `${edit.title}，${date.textContent}，${status}`);
    edit.append(main, count);
    row.append(edit); return row;
  }
  function iconButton(icon, action, className = "action-toggle") {
    const button = document.createElement("button"); button.type = "button"; button.className = className;
    button.append(createIcon(icon, "action-toggle-icon")); button.addEventListener("click", action); return button;
  }
  function label(button, text) { button.title = text; button.setAttribute("aria-label", text); }
}
