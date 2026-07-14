export const INSPIRATION_COVER_ASSETS = Object.freeze([
  "art-chroma-01", "art-chroma-02", "art-chroma-03",
  "brand-form-01", "brand-form-02", "brand-form-03", "brand-form-04",
  "material-study-01", "material-study-02",
  "motion-field-01", "motion-field-02", "motion-field-03",
  "photo-grain-01", "photo-grain-02",
  "space-light-01", "space-light-02", "space-light-03",
  "type-rhythm-01", "type-rhythm-02", "type-rhythm-03",
  "web-signal-01", "web-signal-02", "web-signal-03", "web-signal-04",
].map((key) => `assets/presets/inspiration/${key}.webp`));

const PACKAGED_COVER_PATTERN = /^assets\/presets\/inspiration\/[a-z0-9-]+\.webp$/;

export function resolveInspirationCoverUrl(asset, baseUrl = defaultBaseUrl()) {
  const normalized = String(asset || "").trim().replace(/^\/+/, "");
  if (!PACKAGED_COVER_PATTERN.test(normalized)) return "";
  try {
    return new URL(normalized, baseUrl).href;
  } catch {
    return "";
  }
}

export function inspirationFallbackCoverAsset(item = {}) {
  const identity = [item.categoryKey, item.category, item.key, item.url]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join("|");
  if (!identity) return INSPIRATION_COVER_ASSETS[0];
  return INSPIRATION_COVER_ASSETS[stableHash(identity) % INSPIRATION_COVER_ASSETS.length];
}

function defaultBaseUrl() {
  return globalThis.document?.baseURI || globalThis.location?.href || "";
}

function stableHash(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
