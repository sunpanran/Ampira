export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;
export const FUTURE_SKEW_MS = 15 * 60 * 1000;

export function newsTimeScope(item, nowValue = Date.now()) {
  const now = finiteTime(nowValue, Date.now());
  const published = verifiedTime(item);
  if (!published || published - now > FUTURE_SKEW_MS) return "";
  if (localDateKey(published) === localDateKey(now)) return "today";
  return now - published <= DAY_MS ? "recent" : "";
}

export function publisherIdentity(item) {
  return String(item?.publisherHost || item?.publisher || item?.host || item?.sourceKey || item?.source || "")
    .trim().toLowerCase();
}

export function localDateKey(value = Date.now()) {
  const date = new Date(finiteTime(value, Date.now()));
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function verifiedTime(item) {
  if (item?.timeUnverified === true) return 0;
  const time = Date.parse(String(item?.publishedAt || ""));
  return Number.isFinite(time) ? time : 0;
}

export function finiteTime(value, fallback) {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : fallback;
  const number = Number(value);
  if (Number.isFinite(number)) return number;
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : fallback;
}
