export const READING_QUEUE_STORAGE_KEY = "dash.readingQueue";
export const RETAINED_SEEN_STORAGE_KEY = "dash.seen.retained";
export const READING_QUEUE_LIMIT = 150;

export function normalizeReadingQueueRecords(value) {
  const input = parseStoredArray(value).slice(-READING_QUEUE_LIMIT);
  const records = [];
  const keys = new Set();
  for (const item of input) {
    const record = normalizeRecord(item);
    if (!record.key || keys.has(record.key)) continue;
    keys.add(record.key);
    records.push(record);
  }
  return records;
}

function normalizeRecord(item) {
  const source = item?.source === "news" ? "news" : (item?.source ? "bookmark" : "");
  const key = cleanText(typeof item === "string" ? item : item?.key, 2200);
  if (!key) return { key: "" };
  return {
    key,
    ...(source ? { source } : {}),
    ...(item?.title ? { title: cleanText(item.title, 300) } : {}),
    ...(item?.url ? { url: cleanText(item.url, 2048) } : {}),
    ...(item?.host ? { host: cleanText(item.host, 255) } : {}),
    ...(item?.category ? { category: cleanText(item.category, 200) } : {}),
    ...(item?.addedAt ? { addedAt: cleanText(item.addedAt, 100) } : {}),
  };
}

function parseStoredArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string" || !value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function cleanText(value, limit) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}
