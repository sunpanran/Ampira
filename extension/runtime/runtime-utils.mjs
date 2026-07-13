export function safeOrigin(value) {
  try { return new URL(value).origin; } catch { return ""; }
}

export function summarizeQuality(quality, denied) {
  const records = Object.values(quality);
  const warnings = records.filter((record) => record.status !== "healthy");
  const suggestions = warnings.slice(0, 20).map((record) => ({
    sourceKey: record.sourceKey,
    title: record.title,
    host: record.host,
    action: "review",
    reason: record.reason || "",
    reasonKey: record.reasonKey || (record.reason ? "" : (record.status === "empty" ? "sourceQuality.empty" : "sourceQuality.failed")),
  }));
  return {
    checked: records.length,
    healthy: records.filter((record) => record.status === "healthy").length,
    warnings: warnings.length,
    denied: denied.length,
    suggestions,
    records: quality,
  };
}

export function emptySourceQuality() {
  return { checked: 0, healthy: 0, warnings: 0, denied: 0, suggestions: [], records: {} };
}

export function pipelineStages(active) {
  return { discovering: "complete", fetching: active === "fetching" ? "running" : "complete", extracting: "complete", deduplicating: "complete", enriching: "complete", complete: active === "complete" ? "running" : "pending" };
}

export async function mapWithConcurrency(items, limit, worker) {
  let index = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) await worker(items[index++]);
  });
  await Promise.all(runners);
}

export function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value || "").trim()).filter(Boolean))];
}

export function hostOf(value) {
  try { return new URL(value).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; }
}

export function localDateKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
