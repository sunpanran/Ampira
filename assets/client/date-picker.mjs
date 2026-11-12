import { calendarDate, calendarDays, normalizePickerDate, pickerDateParts, pickerKeyDate, shiftPickerDate } from "./date-picker-model.mjs";

export function createDatePicker({ input, id, t, getLocale, createIcon, today }) {
  const doc = input.ownerDocument;
  let opened = false, selected = "", active = "", mode = "days";
  const control = doc.createElement("div"); control.className = "date-picker-control";
  input.type = "text"; input.inputMode = "numeric"; input.autocomplete = "off"; input.maxLength = 10;
  input.placeholder = "YYYY-MM-DD";
  const trigger = button("date-picker-trigger action-toggle", "calendar", () => opened ? close(true) : open());
  trigger.setAttribute("aria-haspopup", "dialog"); trigger.setAttribute("aria-controls", `${id}-calendar`);
  const hint = doc.createElement("span"); hint.className = "sr-only"; hint.id = `${id}-date-format`;
  control.append(input, trigger, hint);
  const popup = doc.createElement("div"); popup.className = "date-picker-popover"; popup.id = `${id}-calendar`;
  popup.hidden = true; popup.setAttribute("popover", "manual"); popup.setAttribute("role", "dialog");
  const head = doc.createElement("div"); head.className = "date-picker-head";
  const previous = button("action-toggle date-picker-previous", "arrow-down", () => navigate(-1));
  const title = button("date-picker-month", "", () => { mode = mode === "days" ? "months" : "days"; error.hidden = true; render(); });
  title.setAttribute("aria-live", "polite");
  const next = button("action-toggle date-picker-next", "arrow-down", () => navigate(1));
  head.append(previous, title, next);
  const body = doc.createElement("div"); body.className = "date-picker-body";
  const footer = doc.createElement("div"); footer.className = "date-picker-footer";
  const quick = doc.createElement("div"); quick.className = "date-picker-quick";
  const todayButton = button("date-picker-shortcut", "", () => select(today()));
  const weekButton = button("date-picker-shortcut", "", () => select(shiftPickerDate(today(), { days: 7 })));
  const confirm = button("btn date-picker-confirm", "", commit);
  quick.append(todayButton, weekButton); footer.append(quick, confirm);
  const error = doc.createElement("div"); error.className = "date-picker-error"; error.setAttribute("role", "alert"); error.hidden = true;
  popup.append(head, body, footer, error); doc.body.append(popup);

  input.addEventListener("change", () => { const value = normalizePickerDate(input.value); if (value) input.value = value; sync(); });
  input.addEventListener("keydown", event => {
    if (event.key !== "ArrowDown") return;
    event.preventDefault(); event.stopPropagation(); open();
  });
  popup.addEventListener("keydown", event => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(true); return; }
    if (event.key === "Tab") {
      const controls = Array.from(popup.querySelectorAll("button,input")).filter(node => !node.disabled && node.tabIndex >= 0 && node.getClientRects().length);
      if (event.shiftKey && event.target === controls[0]) { event.preventDefault(); close(false); input.focus(); }
      else if (!event.shiftKey && event.target === controls.at(-1)) {
        event.preventDefault(); close(false);
        const fields = Array.from(input.closest("form")?.querySelectorAll("input,button") || []);
        (fields.slice(fields.indexOf(trigger) + 1).find(node => !node.disabled && node.getClientRects().length) || trigger).focus();
      }
    }
    const date = event.target.closest("button[data-date]")?.dataset.date;
    if (!date) return;
    if (event.key === "Enter") { event.preventDefault(); selected = date; commit(); return; }
    const value = pickerKeyDate(date, event.key, event.shiftKey, weekStart());
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"].includes(event.key)) {
      event.preventDefault(); event.stopPropagation();
      if (value) { active = value; render(); focusDate(); }
    }
  });
  sync();
  return { control, open, close, sync, value: () => normalizePickerDate(input.value) || input.value };

  function open() {
    if (opened) { focusDate(); return; }
    selected = normalizePickerDate(input.value); active = selected || today(); mode = "days"; opened = true;
    error.hidden = true; popup.hidden = false;
    try { popup.showPopover?.(); } catch { /* Use the positioned fallback when top-layer support is unavailable. */ }
    render(); sync(); position(); focusDate();
    doc.addEventListener("pointerdown", outside, true);
    doc.addEventListener("focusin", focusOutside);
    doc.addEventListener("scroll", scrolled, true);
    window.addEventListener("resize", position);
    window.addEventListener("blur", dismiss);
  }
  function close(restoreFocus = false) {
    if (!opened) return;
    opened = false;
    try { popup.hidePopover?.(); } catch { /* The fallback uses hidden below. */ }
    popup.hidden = true; sync();
    doc.removeEventListener("pointerdown", outside, true);
    doc.removeEventListener("focusin", focusOutside);
    doc.removeEventListener("scroll", scrolled, true);
    window.removeEventListener("resize", position);
    window.removeEventListener("blur", dismiss);
    if (restoreFocus) trigger.focus({ preventScroll: true });
  }
  function outside(event) { if (!popup.contains(event.target) && !control.contains(event.target)) close(false); }
  function focusOutside(event) { outside(event); }
  function scrolled(event) { if (!popup.contains(event.target)) close(false); }
  function dismiss() { close(false); }
  function sync() {
    hint.textContent = t("datePicker.format");
    const ids = new Set((input.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean)); ids.add(hint.id);
    input.setAttribute("aria-describedby", [...ids].join(" "));
    const value = normalizePickerDate(input.value);
    label(trigger, value ? t("datePicker.change", { date: value }) : t("datePicker.choose"));
    trigger.setAttribute("aria-expanded", String(opened)); popup.setAttribute("aria-label", t("datePicker.choose"));
    if (opened) { label(previous, t(mode === "months" ? "datePicker.previousYear" : "datePicker.previousMonth")); label(next, t(mode === "months" ? "datePicker.nextYear" : "datePicker.nextMonth")); }
  }
  function weekStart() { return getLocale().startsWith("zh") ? 1 : 0; }
  function render() {
    const parts = pickerDateParts(active);
    if (!parts) return;
    title.textContent = format(active, { year: "numeric", month: "long" }); label(title, t("datePicker.chooseMonth"));
    title.setAttribute("aria-expanded", String(mode === "months"));
    previous.disabled = parts.year === 1 && (mode === "months" || parts.month === 0);
    next.disabled = parts.year === 9999 && (mode === "months" || parts.month === 11);
    todayButton.textContent = t("datePicker.today"); weekButton.textContent = t("datePicker.nextWeek"); confirm.textContent = t("datePicker.confirm");
    confirm.disabled = false;
    body.replaceChildren(mode === "months" ? monthGrid(parts) : dayGrid(parts));
    sync(); if (opened) position();
  }
  function dayGrid(parts) {
    const table = doc.createElement("table"); table.className = "date-picker-grid"; table.setAttribute("role", "grid");
    table.setAttribute("aria-label", title.textContent);
    const headings = doc.createElement("thead"), week = doc.createElement("tr");
    for (let index = 0; index < 7; index++) {
      const date = calendarDate(2026, 10, 1 + (index + weekStart()) % 7);
      const cell = doc.createElement("th"); cell.scope = "col"; cell.abbr = format(date, { weekday: "long" });
      cell.textContent = format(date, { weekday: "short" }); week.append(cell);
    }
    headings.append(week); table.append(headings);
    const dates = calendarDays(active, weekStart()), rows = doc.createElement("tbody");
    for (let index = 0; index < 42; index += 7) {
      const row = doc.createElement("tr");
      for (const date of dates.slice(index, index + 7)) {
        const cell = doc.createElement("td");
        if (date) {
          const day = button("date-picker-day", "", () => { select(date); focusDate(); });
          const value = pickerDateParts(date); day.textContent = String(value.day); day.dataset.date = date;
          label(day, format(date, { year: "numeric", month: "long", day: "numeric", weekday: "long" }));
          day.tabIndex = date === active ? 0 : -1; cell.setAttribute("aria-selected", String(date === selected));
          day.classList.toggle("is-selected", date === selected); day.classList.toggle("is-other-month", value.month !== parts.month);
          if (date === today()) { day.classList.add("is-today"); day.setAttribute("aria-current", "date"); }
          day.addEventListener("focus", () => {
            active = date;
            for (const node of body.querySelectorAll("button[data-date]")) node.tabIndex = node === day ? 0 : -1;
          });
          cell.append(day);
        }
        row.append(cell);
      }
      rows.append(row);
    }
    table.append(rows); return table;
  }
  function monthGrid(parts) {
    const panel = doc.createElement("div"); panel.className = "date-picker-month-panel";
    const yearLabel = doc.createElement("label"); yearLabel.className = "date-picker-year"; yearLabel.textContent = t("datePicker.year");
    const year = doc.createElement("input"); year.type = "number"; year.min = "1"; year.max = "9999"; year.value = String(parts.year);
    year.className = "utility-entry-input"; year.setAttribute("aria-label", t("datePicker.year"));
    const months = doc.createElement("div"); months.className = "date-picker-months";
    const applyYear = () => {
      const value = Number(year.value), valid = Number.isInteger(value) && value >= 1 && value <= 9999;
      error.hidden = valid; error.textContent = valid ? "" : t("datePicker.invalidYear"); year.setAttribute("aria-invalid", String(!valid));
      confirm.disabled = !valid;
      for (const node of months.children) node.disabled = !valid;
      if (valid) {
        active = calendarDate(value, pickerDateParts(active).month, 1);
        title.textContent = format(active, { year: "numeric", month: "long" });
        previous.disabled = value === 1; next.disabled = value === 9999;
      }
      return valid;
    };
    year.addEventListener("input", applyYear);
    year.addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); if (applyYear()) { mode = "days"; render(); focusDate(); } } });
    yearLabel.append(year); panel.append(yearLabel, months);
    for (let month = 0; month < 12; month++) {
      const option = button("date-picker-month-option", "", () => { if (!applyYear()) return; active = calendarDate(Number(year.value), month, 1); mode = "days"; error.hidden = true; render(); focusDate(); });
      option.textContent = format(calendarDate(parts.year, month, 1), { month: "short" }); option.setAttribute("aria-pressed", String(month === parts.month)); months.append(option);
    }
    return panel;
  }
  function navigate(direction) {
    const value = shiftPickerDate(active, { months: direction * (mode === "months" ? 12 : 1) });
    if (value) { active = value; error.hidden = true; render(); }
  }
  function select(value) { if (!normalizePickerDate(value)) return; selected = value; active = value; mode = "days"; error.hidden = true; render(); }
  function commit() {
    if (!normalizePickerDate(selected)) selected = active;
    input.value = selected; input.dispatchEvent(new Event("input", { bubbles: true })); input.dispatchEvent(new Event("change", { bubbles: true })); close(true);
  }
  function focusDate() { body.querySelector(`button[data-date="${active}"]`)?.focus({ preventScroll: true }); }
  function position() {
    if (!opened) return;
    const anchor = control.getBoundingClientRect();
    if (!anchor.width || !control.isConnected) { close(false); return; }
    popup.style.width = `${Math.min(304, Math.max(0, window.innerWidth - 16))}px`;
    const bounds = popup.getBoundingClientRect();
    popup.style.left = `${Math.max(8, Math.min(anchor.left, window.innerWidth - bounds.width - 8))}px`;
    const below = anchor.bottom + 6;
    popup.style.top = `${Math.max(8, Math.min(below + bounds.height <= window.innerHeight - 8 ? below : anchor.top - bounds.height - 6, window.innerHeight - bounds.height - 8))}px`;
  }
  function format(value, options) { return new Intl.DateTimeFormat(getLocale(), { ...options, timeZone: "UTC" }).format(new Date(value + "T12:00:00Z")); }
  function label(node, text) { node.title = text; node.setAttribute("aria-label", text); }
  function button(className, icon, handler) {
    const node = doc.createElement("button"); node.type = "button"; node.className = className;
    if (icon) node.append(createIcon(icon, "action-toggle-icon")); node.addEventListener("click", handler); return node;
  }
}
