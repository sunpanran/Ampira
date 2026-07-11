const NUMERIC_FIELDS = new Set(["dailyAiLimit", "hotNewsCacheSize", "hotNewsEntriesPerSource", "newsEntriesPerCategory"]);
const SECRET_FIELDS = new Set(["openaiApiKey", "braveSearchApiKey"]);

export function snapshotSettingsDraft(value, effectiveLocale = "") {
  const snapshot = cloneSettingsDraft(value) || {};
  snapshot.uiLocale = snapshot.uiLocale || effectiveLocale;
  return snapshot;
}

export function cloneSettingsDraft(value) {
  if (!value || typeof value !== "object") return value;
  try { return structuredClone(value); } catch { return JSON.parse(JSON.stringify(value)); }
}

export function diffSettingsDraft(draft = {}, baseline = null) {
  if (!baseline) return { ...draft };
  const changed = {};
  for (const [key, value] of Object.entries(draft)) {
    if (SECRET_FIELDS.has(key)) {
      if (String(value || "").trim()) changed[key] = value;
      continue;
    }
    if (!draftValuesEqual(key, value, baseline[key])) changed[key] = value;
  }
  const savedProviderUrl = baseline.savedBaseUrl || baseline.openaiBaseUrl || baseline.baseUrl || "";
  if (draft.aiDisclosureAccepted === true && providerOrigin(draft.openaiBaseUrl) !== providerOrigin(savedProviderUrl)) {
    changed.aiDisclosureAccepted = true;
  }
  return changed;
}

function providerOrigin(value) {
  try {
    const url = new URL(String(value || "").trim());
    if (url.protocol === "https:") return url.origin;
    if (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)) return url.origin;
  } catch {
    return "";
  }
  return "";
}

function draftValuesEqual(key, value, previous) {
  if (NUMERIC_FIELDS.has(key)) return Number(value) === Number(previous);
  if (Array.isArray(value) || Array.isArray(previous)) return JSON.stringify(value || []) === JSON.stringify(previous || []);
  return value === previous;
}
