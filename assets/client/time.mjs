export function getTodayKey() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function formatFullDateTime(value = new Date()) {
  return formatLocaleDateTime(value, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

export function formatDateTime(value) {
  if (!value) return "";
  return formatLocaleDateTime(value, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) || value;
}
import { formatLocaleDateTime } from "./i18n.mjs";
