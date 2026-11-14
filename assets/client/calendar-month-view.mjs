import { calendarDate, calendarDays, pickerKeyDate, shiftPickerDate } from "./date-picker-model.mjs";
import { personalCardControls } from "./personal-card-controls.mjs";

export function createCalendarMonthView({ t, getLocale, createIcon, onSelect }) {
  const { node, iconButton, labelButton } = personalCardControls(createIcon);
  let selected = "";
  const root = node("div", "calendar-month");
  const toolbar = node("div", "calendar-month-toolbar");
  const title = node("span", "calendar-month-title"); title.setAttribute("aria-live", "polite");
  const controls = node("div", "calendar-month-actions");
  const previous = iconButton("arrow-down", () => move(-1)); previous.classList.add("calendar-previous");
  const next = iconButton("arrow-down", () => move(1)); next.classList.add("calendar-next");
  controls.append(previous, next); toolbar.append(title, controls);
  const grid = node("table", "calendar-grid"); grid.setAttribute("role", "grid");
  const headings = node("thead"), header = node("tr"), body = node("tbody");
  const weekdays = Array.from({ length: 7 }, () => { const cell = node("th"); cell.scope = "col"; header.append(cell); return cell; });
  headings.append(header); grid.append(headings, body);
  const days = Array.from({ length: 6 }, () => {
    const row = node("tr"); body.append(row);
    return Array.from({ length: 7 }, () => {
      const cell = node("td"), button = node("button", "calendar-day"); button.type = "button";
      button.addEventListener("click", () => { onSelect(button.dataset.date); focus(); });
      cell.append(button); row.append(cell); return button;
    });
  }).flat();
  grid.addEventListener("keydown", event => {
    const date = event.target.closest("button[data-date]")?.dataset.date;
    if (!date || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    const nextDate = pickerKeyDate(date, event.key, event.shiftKey, weekStart());
    if (nextDate) { onSelect(nextDate); focus(); }
  });
  root.append(toolbar, grid);
  function weekStart() { return getLocale().startsWith("zh") ? 1 : 0; }
  function format(date, options) { return new Intl.DateTimeFormat(getLocale(), { ...options, timeZone: "UTC" }).format(new Date(date + "T12:00:00Z")); }
  function move(months) { const date = shiftPickerDate(selected, { months }); if (date) onSelect(date); }
  function focus() { days.find(button => button.dataset.date === selected)?.focus({ preventScroll: true }); }
  return {
    root, focus,
    render({ date, today, items }) {
      selected = date;
      title.textContent = format(date, { year: "numeric", month: "long" }); grid.setAttribute("aria-label", title.textContent);
      labelButton(previous, t("datePicker.previousMonth")); labelButton(next, t("datePicker.nextMonth"));
      previous.disabled = !shiftPickerDate(date, { months: -1 }); next.disabled = !shiftPickerDate(date, { months: 1 });
      weekdays.forEach((cell, index) => {
        const value = calendarDate(2026, 10, 1 + (index + weekStart()) % 7);
        cell.textContent = format(value, { weekday: "narrow" }); cell.abbr = format(value, { weekday: "long" });
      });
      const counts = new Map();
      for (const item of items) counts.set(item.date, (counts.get(item.date) || 0) + 1);
      calendarDays(date, weekStart()).forEach((value, index) => {
        const button = days[index], count = counts.get(value) || 0;
        button.dataset.date = value; button.textContent = value ? String(Number(value.slice(8))) : "";
        button.disabled = !value; button.tabIndex = value === date ? 0 : -1;
        button.classList.toggle("is-outside", Boolean(value) && value.slice(0, 7) !== date.slice(0, 7));
        button.classList.toggle("has-events", count > 0);
        button.setAttribute("aria-pressed", String(value === date));
        if (value === today) button.setAttribute("aria-current", "date"); else button.removeAttribute("aria-current");
        button.setAttribute("aria-label", value ? t("calendar.dayLabel", { date: format(value, { year: "numeric", month: "long", day: "numeric", weekday: "long" }), count }) : "");
      });
    },
  };
}
