export function safeOrigin(value) {
  try { return new URL(value).origin; } catch { return ""; }
}

const SOURCE_QUALITY_SCHEMA_VERSION = 2;
const SOURCE_OUTCOME_LIMIT = 20;

export function summarizeQuality(quality, denied = [], sources = []) {
  const inputRecords = quality?.records && typeof quality.records === "object" ? quality.records : quality;
  const activeKeys = new Set((sources || []).map((source) => String(source?.key || "")).filter(Boolean));
  const recordsByKey = Object.fromEntries(Object.entries(inputRecords || {})
    .filter(([key]) => !activeKeys.size || activeKeys.has(String(key || "")))
    .map(([key, record]) => [
    key,
    normalizeSourceQualityRecord(record, key),
  ]));
  const deniedKeys = new Set((denied || []).map((source) => String(source?.key || "")).filter(Boolean));
  for (const source of sources || []) {
    const key = String(source?.key || "");
    if (!key || recordsByKey[key]) continue;
    recordsByKey[key] = normalizeSourceQualityRecord({
      sourceKey: key,
      sourceOrigin: safeOrigin(source.url),
      title: source.title,
      host: source.host || hostOf(source.url),
      sourceType: source.externalDiscovery === true ? "public" : "bookmark",
      status: deniedKeys.has(key) ? "permissionRequired" : "waiting",
    }, key);
  }
  for (const source of denied || []) {
    const key = String(source?.key || "");
    if (!key) continue;
    recordsByKey[key] = normalizeSourceQualityRecord({
      ...(recordsByKey[key] || {}),
      sourceKey: key,
      sourceOrigin: safeOrigin(source.url),
      title: source.title,
      host: source.host || hostOf(source.url),
      sourceType: source.externalDiscovery === true ? "public" : "bookmark",
      status: "permissionRequired",
    }, key);
  }
  const records = Object.values(recordsByKey);
  const warnings = records.filter((record) => !["healthy", "waiting"].includes(record.status));
  const suggestions = warnings.slice(0, 20).map((record) => ({
    sourceKey: record.sourceKey,
    title: record.title,
    host: record.host,
    action: "review",
    reason: record.reason || "",
    reasonKey: record.reasonKey || sourceQualityReasonKey(record.status, record.reason),
    checks: record.checks,
    consecutiveFailures: record.consecutiveFailures,
  }));
  const permissionRequiredRecords = records.filter((record) => record.status === "permissionRequired" || record.pendingFeed?.origin);
  const checkedRecords = records.filter((record) => (
    record.checks > 0
    && record.status !== "permissionRequired"
    && !record.pendingFeed?.origin
  ));
  const healthy = records.filter((record) => record.status === "healthy").length;
  const authorizedHealthy = checkedRecords.filter((record) => record.status === "healthy").length;
  const configured = records.length;
  const imageItemCount = records.reduce((total, record) => total + record.itemCount, 0);
  const imageCount = records.reduce((total, record) => total + record.imageCount, 0);
  return {
    schemaVersion: SOURCE_QUALITY_SCHEMA_VERSION,
    configured,
    authorized: Math.max(0, configured - permissionRequiredRecords.length),
    checked: checkedRecords.length,
    healthy,
    empty: records.filter((record) => record.status === "empty").length,
    failed: records.filter((record) => record.status === "error").length,
    waiting: records.filter((record) => record.status === "waiting").length,
    warnings: warnings.length,
    denied: deniedKeys.size,
    permissionRequired: permissionRequiredRecords.length,
    coveragePercent: configured ? Math.round(healthy / configured * 100) : null,
    authorizedSuccessPercent: checkedRecords.length ? Math.round(authorizedHealthy / checkedRecords.length * 100) : null,
    imageCount,
    feedImageCount: records.reduce((total, record) => total + record.feedImageCount, 0),
    enrichedImageCount: records.reduce((total, record) => total + record.enrichedImageCount, 0),
    missingImageCount: records.reduce((total, record) => total + record.missingImageCount, 0),
    imageCoveragePercent: imageItemCount ? Math.round(imageCount / imageItemCount * 100) : null,
    suggestions,
    records: recordsByKey,
  };
}

export function emptySourceQuality() {
  return summarizeQuality({}, [], []);
}

export function updateSourceQualityRecord(previous, update = {}) {
  const normalized = normalizeSourceQualityRecord(previous, update.sourceKey);
  const status = normalizeSourceStatus(update.status || normalized.status);
  const checked = ["healthy", "empty", "error"].includes(status);
  const recentOutcomes = checked
    ? [...normalized.recentOutcomes, status].slice(-SOURCE_OUTCOME_LIMIT)
    : normalized.recentOutcomes;
  return normalizeSourceQualityRecord({
    ...normalized,
    ...update,
    status,
    checks: normalized.checks + Number(checked),
    successes: normalized.successes + Number(status === "healthy"),
    consecutiveFailures: status === "healthy"
      ? 0
      : (checked ? normalized.consecutiveFailures + 1 : normalized.consecutiveFailures),
    recentOutcomes,
  }, update.sourceKey || normalized.sourceKey);
}

export function normalizeSourceQualityRecord(record = {}, fallbackKey = "") {
  const status = normalizeSourceStatus(record.status);
  return {
    sourceKey: String(record.sourceKey || fallbackKey || ""),
    sourceOrigin: safeOrigin(record.sourceOrigin || ""),
    title: String(record.title || "").trim(),
    host: String(record.host || "").trim() || hostOf(record.sourceOrigin || ""),
    sourceType: record.sourceType === "public" ? "public" : "bookmark",
    status,
    method: String(record.method || ""),
    itemCount: Math.max(0, Math.floor(Number(record.itemCount ?? record.count) || 0)),
    imageCount: Math.max(0, Math.floor(Number(record.imageCount) || 0)),
    feedImageCount: Math.max(0, Math.floor(Number(record.feedImageCount) || 0)),
    enrichedImageCount: Math.max(0, Math.floor(Number(record.enrichedImageCount) || 0)),
    missingImageCount: Math.max(0, Math.floor(Number(record.missingImageCount) || 0)),
    lastCheckedAt: String(record.lastCheckedAt || ""),
    lastSuccessAt: String(record.lastSuccessAt || ""),
    checks: Math.max(0, Math.floor(Number(record.checks) || 0)),
    successes: Math.max(0, Math.floor(Number(record.successes) || 0)),
    consecutiveFailures: Math.max(0, Math.floor(Number(record.consecutiveFailures) || 0)),
    recentOutcomes: (Array.isArray(record.recentOutcomes) ? record.recentOutcomes : [])
      .map(normalizeSourceStatus)
      .filter((value) => ["healthy", "empty", "error"].includes(value))
      .slice(-SOURCE_OUTCOME_LIMIT),
    reason: String(record.reason || ""),
    reasonKey: String(record.reasonKey || ""),
    resolvedUrl: String(record.resolvedUrl || ""),
    fetchOrigin: safeOrigin(record.fetchOrigin || ""),
    validators: {
      etag: String(record.validators?.etag || record.etag || "").replace(/[\r\n]/g, "").slice(0, 1024),
      lastModified: String(record.validators?.lastModified || record.lastModified || "").replace(/[\r\n]/g, "").slice(0, 1024),
    },
    pendingFeed: normalizePendingFeed(record.pendingFeed),
    nextEligibleAt: String(record.nextEligibleAt || ""),
  };
}

function normalizeSourceStatus(value) {
  const status = String(value || "");
  if (["healthy", "empty", "error", "waiting", "permissionRequired"].includes(status)) return status;
  return status === "failed" ? "error" : "waiting";
}

function normalizePendingFeed(value) {
  const url = String(value?.url || "").trim();
  const origin = safeOrigin(value?.origin || url);
  return url && origin ? { url, origin } : null;
}

function sourceQualityReasonKey(status, reason) {
  if (reason) return "";
  if (status === "empty") return "sourceQuality.empty";
  if (status === "permissionRequired") return "sourceQuality.permissionRequired";
  return status === "error" ? "sourceQuality.failed" : "";
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
