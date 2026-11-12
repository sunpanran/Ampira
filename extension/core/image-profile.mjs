export const IMAGE_PROFILE_ARTICLE = "article";
export const IMAGE_PROFILE_VISUAL = "visual";

const PROFILE_DIMENSIONS = Object.freeze({
  article: Object.freeze({ shortEdge: 120, longEdge: 320, area: 70000 }),
  visual: Object.freeze({ shortEdge: 100, longEdge: 240, area: 40000 }),
});

export function normalizeImageProfile(value) {
  return value === IMAGE_PROFILE_ARTICLE ? IMAGE_PROFILE_ARTICLE : IMAGE_PROFILE_VISUAL;
}

export function imageMeetsProfileDimensions(width, height, profile = IMAGE_PROFILE_VISUAL) {
  const minimum = PROFILE_DIMENSIONS[normalizeImageProfile(profile)];
  const normalizedWidth = imageDimension(width);
  const normalizedHeight = imageDimension(height);
  if (normalizedWidth && normalizedWidth < minimum.shortEdge) return false;
  if (normalizedHeight && normalizedHeight < minimum.shortEdge) return false;
  if (!normalizedWidth || !normalizedHeight) return true;
  return Math.max(normalizedWidth, normalizedHeight) >= minimum.longEdge
    && normalizedWidth * normalizedHeight >= minimum.area;
}

export function imageDimension(value) {
  if (value && typeof value === "object") return imageDimension(value.value);
  const match = String(value || "").trim().match(/^([\d.]+)(?:px)?$/i);
  const number = Number(match?.[1] || 0);
  return Number.isFinite(number) && number > 0 ? number : 0;
}
