import { CALENDAR_EVENT_LIMIT, CALENDAR_TITLE_LIMIT, calendarEventsOnDate } from "../../extension/core/calendar.mjs";
import { nodesEqualIgnoringIconLoadState, spanText } from "./dom.mjs";
import { createDatePicker } from "./date-picker.mjs";
import { shiftPickerDate } from "./date-picker-model.mjs";
import { createCalendarMonthView } from "./calendar-month-view.mjs";
import { personalCardControls } from "./personal-card-controls.mjs";

export function createCalendarCardView({ id, state, t, tc, getLocale, createIcon, calendarState, requestRender, isActive, localizedErrorMessage }) {
  const { node, button, iconButton, labelButton } = personalCardControls(createIcon);
  let selected = calendarState.today(), lastToday = selected;
  let editing = false, editingId = "", editingRevision = 0, error = "";
  const root = node("div", "calendar-content");
  const notice = node("div", "utility-inline-status calendar-notice"); notice.id = `calendar-notice-${id}`;
  const main = node("div", "calendar-main");
  const month = createCalendarMonthView({ t, getLocale, createIcon, onSelect: selectDate });
  const day = node("div", "calendar-selected-day");
  const stamp = button("calendar-date-stamp", () => selectDate(calendarState.today()));
  const dayNumber = spanText("", "calendar-date-number"), dayWeekday = spanText("", "calendar-date-weekday"); stamp.append(dayNumber, dayWeekday);
  const agenda = node("div", "calendar-agenda");
  const agendaHead = node("div", "calendar-agenda-head");
  const dateLabel = spanText("", "calendar-agenda-date"), count = spanText("", "calendar-agenda-count");
  agendaHead.append(dateLabel, count);
  const list = node("div", "calendar-event-list utility-scroll-list");
  const empty = button("calendar-empty", () => openEditor());
  agenda.append(agendaHead, list, empty); day.append(stamp, agenda); main.append(month.root, day);
  const form = node("form", "calendar-editor"); form.id = `calendar-editor-${id}`; form.noValidate = true;
  const titleInput = node("input", "utility-entry-input"); titleInput.type = "text"; titleInput.maxLength = CALENDAR_TITLE_LIMIT; titleInput.autocomplete = "off";
  const fields = node("div", "calendar-editor-fields");
  const dateInput = node("input", "utility-entry-input");
  const datePicker = createDatePicker({ input: dateInput, id: `calendar-${id}`, t, getLocale, createIcon, today: calendarState.today });
  const timeInput = node("input", "utility-entry-input calendar-time-input"); timeInput.type = "time";
  const hint = spanText("", "calendar-time-hint"); hint.id = `calendar-time-hint-${id}`;
  fields.append(datePicker.control, timeInput); form.append(titleInput, fields, hint); root.append(notice, main, form);
  for (const input of [titleInput, dateInput, timeInput]) input.setAttribute("aria-describedby", notice.id);
  timeInput.setAttribute("aria-describedby", `${notice.id} ${hint.id}`);
  const actions = node("div", "calendar-header-actions");
  const headerDate = spanText("", "efficiency-meta calendar-header-date");
  const previous = iconButton("arrow-down", () => moveDay(-1)); previous.classList.add("calendar-previous", "calendar-day-navigation");
  const next = iconButton("arrow-down", () => moveDay(1)); next.classList.add("calendar-next", "calendar-day-navigation");
  const today = button("efficiency-action calendar-today-action", () => selectDate(calendarState.today()));
  const retry = iconButton("refresh-cw-01", () => {
    error = "";
    if (calendarState.read().syncError && !calendarState.read().error) calendarState.retrySync();
    else calendarState.ensure({ force: true });
  });
  const remove = iconButton("trash-01", () => removeItem({ id: editingId, revision: editingRevision }));
  const save = iconButton("save-01"); save.type = "submit"; save.setAttribute("form", form.id);
  const add = iconButton("plus", () => editing ? closeEditor() : openEditor()); add.setAttribute("aria-controls", form.id);
  actions.append(headerDate, previous, next, today, retry, remove, save, add);
  let addIcon = "plus";
  form.addEventListener("keydown", event => {
    if (event.key !== "Escape") return;
    event.preventDefault(); event.stopPropagation(); closeEditor();
  });
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const date = datePicker.value();
    datePicker.close();
    const outcome = await change({ type: "save", id: editingId, revision: editingRevision, title: titleInput.value, date, time: timeInput.value });
    if (outcome?.ok) { selected = date; closeEditor(outcome.id); }
    else if (isActive()) (error === "dateRequired" ? dateInput : error === "timeInvalid" ? timeInput : titleInput).focus({ preventScroll: true });
  });
  calendarState.ensure();

  return { render, contextActions, deactivate: () => datePicker.close() };

  function format(date, options) { return new Intl.DateTimeFormat(getLocale(), { ...options, timeZone: "UTC" }).format(new Date(date + "T12:00:00Z")); }
  function moveDay(days) { const date = shiftPickerDate(selected, { days }); if (date) selectDate(date); }
  function selectDate(date) {
    if (!date || editing) return;
    selected = date; list.scrollTop = 0; requestRender();
  }
  async function change(action) {
    if (calendarState.read().busy) return { ok: false, reason: "busy" };
    error = "";
    const outcome = await calendarState.change(action);
    if (!outcome?.ok) error = outcome?.reason || "request";
    requestRender(); return outcome;
  }
  function openEditor(item) {
    if (!calendarState.read().loaded || calendarState.read().busy) return;
    datePicker.close(); editing = true; editingId = item?.id || ""; editingRevision = item?.revision || 0; error = "";
    titleInput.value = item?.title || ""; dateInput.value = item?.date || selected; timeInput.value = item?.time || "";
    requestRender(); titleInput.focus({ preventScroll: true });
  }
  function closeEditor(focusId = editingId) {
    datePicker.close(); editing = false; editingId = ""; error = ""; requestRender();
    if (isActive()) focusItem(focusId);
  }
  async function removeItem(item) {
    if (!item?.id) return;
    const before = calendarEventsOnDate(calendarState.read().value, selected), index = before.findIndex(value => value.id === item.id);
    const outcome = await change({ type: "remove", id: item.id, revision: item.revision });
    if (!outcome?.ok) return;
    const remaining = calendarEventsOnDate(calendarState.read().value, selected);
    closeEditor(remaining[Math.min(index, remaining.length - 1)]?.id);
  }
  function contextActions(target) {
    const row = target?.closest?.(".calendar-event");
    const item = list.contains(row) && calendarState.read().value.items.find(value => value.id === row?.dataset.key);
    if (!item) return [];
    return [
      { label: t("calendar.edit", { title: item.title }), icon: "edit-05", action: () => openEditor(item) },
      { label: t("calendar.remove", { title: item.title }), icon: "trash-01", action: () => removeItem(item) },
    ];
  }
  function focusItem(id) {
    const row = Array.from(list.children).find(value => value.dataset.key === id);
    (row || add).focus({ preventScroll: true });
    if (!row) return;
    const bounds = list.getBoundingClientRect(), rect = row.getBoundingClientRect();
    if (rect.top < bounds.top) list.scrollTop += rect.top - bounds.top;
    else if (rect.bottom > bounds.bottom) list.scrollTop += rect.bottom - bounds.bottom;
  }
  function syncEvents(items) {
    const active = document.activeElement, focusedId = list.contains(active) ? active.dataset.key : "";
    const previousRows = new Map(Array.from(list.children, row => [row.dataset.key, row]));
    const rows = items.map(item => {
      const row = button("calendar-event", () => openEditor(calendarState.read().value.items.find(value => value.id === item.id)));
      row.dataset.key = item.id; row.title = t("calendar.edit", { title: item.title });
      const time = node("time", "calendar-event-time"); time.textContent = item.time || t("calendar.allDay");
      time.dateTime = item.date + (item.time ? "T" + item.time : "");
      const title = spanText(item.title, "calendar-event-title"); title.title = item.title;
      row.append(time, title); row.setAttribute("aria-label", `${time.textContent} ${item.title}`);
      const previousRow = previousRows.get(item.id);
      return previousRow && nodesEqualIgnoringIconLoadState(previousRow, row) ? previousRow : row;
    });
    rows.forEach((row, index) => { if (list.children[index] !== row) list.insertBefore(row, list.children[index] || null); });
    while (list.children.length > rows.length) list.lastElementChild.remove();
    if (focusedId && active !== document.activeElement && isActive()) focusItem(items.some(item => item.id === focusedId) ? focusedId : items[0]?.id);
  }
  function render() {
    if (state.settings?.syncCalendarEnabled === false) calendarState.clearSyncError();
    const shared = calendarState.read(), currentToday = calendarState.today();
    const syncError = state.settings?.syncCalendarEnabled === false ? null : shared.syncError;
    if (currentToday !== lastToday) { if (!editing && selected === lastToday) selected = currentToday; lastToday = currentToday; }
    const items = calendarEventsOnDate(shared.value, selected);
    const message = error && error !== "request" ? t(`calendar.error.${error}`, { count: CALENDAR_EVENT_LIMIT, limit: CALENDAR_TITLE_LIMIT })
      : shared.error ? t("calendar.error.request", { message: localizedErrorMessage(shared.error) })
        : syncError ? t("calendar.syncFailed", { message: syncError.messageKey ? t(syncError.messageKey, syncError.messageParams) : localizedErrorMessage(syncError) })
          : !shared.loaded ? t("personalCards.loading") : "";
    notice.hidden = !message; notice.textContent = message;
    notice.classList.toggle("is-error", Boolean(error || shared.error || syncError)); notice.setAttribute("role", error || shared.error || syncError ? "alert" : "status");
    root.setAttribute("aria-busy", String(shared.busy));
    form.hidden = !editing; main.hidden = editing;
    titleInput.placeholder = t("calendar.placeholder"); titleInput.setAttribute("aria-label", t("calendar.titleLabel"));
    titleInput.title = t("calendar.titleLimit", { count: CALENDAR_TITLE_LIMIT });
    dateInput.setAttribute("aria-label", t("calendar.dateLabel")); timeInput.setAttribute("aria-label", t("calendar.timeLabel"));
    hint.textContent = t("calendar.timeHint"); datePicker.sync();
    titleInput.setAttribute("aria-invalid", String(["titleRequired", "titleLimit"].includes(error)));
    dateInput.setAttribute("aria-invalid", String(error === "dateRequired")); timeInput.setAttribute("aria-invalid", String(error === "timeInvalid"));
    for (const control of [...form.querySelectorAll("input, button"), save, remove]) control.disabled = shared.busy;
    const nextIcon = editing ? "x-close" : "plus";
    if (nextIcon !== addIcon) { addIcon = nextIcon; add.replaceChildren(createIcon(addIcon, "action-toggle-icon")); }
    labelButton(add, t(editing ? "calendar.cancel" : "calendar.add")); add.setAttribute("aria-expanded", String(editing));
    add.disabled = !editing && (!shared.loaded || shared.busy);
    labelButton(save, t("personalCards.save")); labelButton(remove, t("calendar.remove", { title: titleInput.value }));
    labelButton(previous, t("calendar.previousDay")); labelButton(next, t("calendar.nextDay"));
    previous.disabled = !shiftPickerDate(selected, { days: -1 }); next.disabled = !shiftPickerDate(selected, { days: 1 });
    today.textContent = t("datePicker.today"); labelButton(today, t("calendar.backToday")); labelButton(stamp, t("calendar.backToday"));
    labelButton(retry, t("personalCards.retry")); retry.hidden = !shared.error && !syncError; retry.disabled = shared.busy;
    remove.hidden = !editingId || !editing; save.hidden = !editing;
    for (const control of [headerDate, previous, next, today]) control.hidden = editing;
    headerDate.textContent = format(selected, { month: "short" });
    dayNumber.textContent = String(Number(selected.slice(8))); dayWeekday.textContent = format(selected, { weekday: "short" });
    dateLabel.textContent = format(selected, { month: "long", day: "numeric" }) + " · " + (selected === currentToday ? t("datePicker.today") : dayWeekday.textContent);
    count.textContent = items.length ? tc("calendar.items", items.length) : "";
    empty.textContent = t("calendar.empty"); empty.hidden = Boolean(items.length || !shared.loaded); empty.disabled = shared.busy;
    labelButton(empty, t("calendar.add")); list.hidden = !items.length;
    month.render({ date: selected, today: currentToday, items: shared.value.items }); syncEvents(items);
    return { content: root, actions: [actions], busy: shared.busy };
  }
}
