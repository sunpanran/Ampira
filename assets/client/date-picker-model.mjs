import { countdownDateOrdinal } from "../../extension/core/countdown.mjs";

export function normalizePickerDate(value) {
  const match = typeof value === "string" && value.trim().match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (!match) return "";
  const date = `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
  return countdownDateOrdinal(date) === null ? "" : date;
}

export function pickerDateParts(value) {
  const normalized = normalizePickerDate(value);
  if (!normalized) return null;
  const [year, month, day] = normalized.split("-").map(Number);
  const date = new Date(countdownDateOrdinal(normalized) * 86_400_000);
  return { year, month: month - 1, day, weekday: date.getUTCDay() };
}

export function calendarDate(year, month, day) {
  const value = new Date(0);
  value.setUTCFullYear(year, month, day);
  if (!Number.isFinite(value.getTime()) || value.getUTCFullYear() < 1 || value.getUTCFullYear() > 9999) return "";
  return `${String(value.getUTCFullYear()).padStart(4, "0")}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(value.getUTCDate()).padStart(2, "0")}`;
}

export function shiftPickerDate(value, { days = 0, months = 0 } = {}) {
  const parts = pickerDateParts(value);
  if (!parts || !Number.isInteger(days) || !Number.isInteger(months)) return "";
  const targetMonth = parts.year * 12 + parts.month + months;
  const year = Math.floor(targetMonth / 12), month = targetMonth % 12;
  if (year < 1 || year > 9999) return "";
  const last = new Date(0); last.setUTCFullYear(year, month + 1, 0);
  return calendarDate(year, month, Math.min(parts.day, last.getUTCDate()) + days);
}

export function calendarDays(value, weekStart = 1) {
  const parts = pickerDateParts(value);
  if (!parts) return [];
  const first = pickerDateParts(calendarDate(parts.year, parts.month, 1));
  const offset = (first.weekday - weekStart + 7) % 7;
  return Array.from({ length: 42 }, (_, index) => calendarDate(parts.year, parts.month, index - offset + 1));
}

export function pickerKeyDate(value, key, shift = false, weekStart = 1) {
  const parts = pickerDateParts(value);
  if (!parts) return "";
  const delta = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
  if (Object.hasOwn(delta, key)) return shiftPickerDate(value, { days: delta[key] });
  if (key === "Home" || key === "End") return shiftPickerDate(value, { days: (key === "End" ? 6 : 0) - (parts.weekday - weekStart + 7) % 7 });
  if (key === "PageUp" || key === "PageDown") return shiftPickerDate(value, { months: (key === "PageUp" ? -1 : 1) * (shift ? 12 : 1) });
  return "";
}
