export function isDisplayableFeedItem(item) {
  if (!item || item.timeUnverified !== true) return Boolean(item);
  if (String(item.excerpt || "").trim()) return true;
  return Array.isArray(item.summary) && item.summary.some((line) => String(line || "").trim());
}
