export function getTodayKey() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function formatTodayMeta(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return { date: "", weekday: "", time: "", dateTime: "", label: "" };
  }

  const dateText = formatLocaleDateTime(date, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).replace(/[/-]/g, ".");
  const weekday = formatLocaleDateTime(date, { weekday: "short" });
  const time = formatLocaleDateTime(date, {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const label = formatLocaleDateTime(date, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });

  return {
    date: dateText,
    weekday,
    time,
    dateTime: date.toISOString(),
    label,
  };
}

export function formatDateTime(value) {
  if (!value) return "";
  return formatLocaleDateTime(value, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) || value;
}
import { formatLocaleDateTime } from "./i18n.mjs";
