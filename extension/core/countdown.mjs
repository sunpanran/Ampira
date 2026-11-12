export const COUNTDOWN_ITEMS_KEY = "dash.countdown.items.v1";
export const COUNTDOWN_ITEM_LIMIT = 20;
export const COUNTDOWN_TITLE_LIMIT = 80;

export function normalizeCountdownTitle(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, COUNTDOWN_TITLE_LIMIT) : "";
}

export function countdownDateOrdinal(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.getTime() / 86_400_000;
}

export function countdownToday(now = new Date()) {
  return `${String(now.getFullYear()).padStart(4, "0")}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function countdownDays(date, today) {
  const target = countdownDateOrdinal(date), current = countdownDateOrdinal(today);
  return target === null || current === null ? null : target - current;
}

export function normalizeCountdownItems(value) {
  if (!Array.isArray(value)) return [];
  const ids = new Set(), items = [];
  for (const entry of value.slice(0, 100)) {
    const title = normalizeCountdownTitle(entry?.title);
    if (!title || typeof entry?.id !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(entry.id)
      || ids.has(entry.id) || countdownDateOrdinal(entry.date) === null) continue;
    ids.add(entry.id);
    items.push({ id: entry.id, title, date: entry.date });
    if (items.length >= COUNTDOWN_ITEM_LIMIT) break;
  }
  return items;
}

export function selectCountdownItems(items, today) {
  return normalizeCountdownItems(items).map(item => ({ ...item, days: countdownDays(item.date, today) }))
    .filter(item => item.days !== null)
    .sort((left, right) => Number(left.days < 0) - Number(right.days < 0)
      || (left.days < 0 ? right.days - left.days : left.days - right.days));
}
