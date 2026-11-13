export const HEADER_COVER_STORAGE_KEY = "ampira.headerCover";
export const HEADER_IMAGE_BLUR_MAX = 50;
export const HEADER_IMAGE_BLUR_DEFAULT = 12;
export const HEADER_IMAGE_BLUR_BLEED_MULTIPLIER = 1.5;
export const HEADER_IMAGE_HEIGHT_MIN = 70;
export const HEADER_IMAGE_HEIGHT_MAX = 300;
export const HEADER_IMAGE_HEIGHT_STEP = 5;
export const HEADER_IMAGE_HEIGHT_DEFAULT = 100;
export const DEFAULT_HEADER_IMAGE_URL = "https://images.unsplash.com/photo-1589063550334-968dce01e968?q=80&w=3648&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=NHwxMjA3fDA%3D";

export function normalizeHeaderImageBlurAmount(value, fallback = HEADER_IMAGE_BLUR_DEFAULT) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return fallback;
  return Math.min(HEADER_IMAGE_BLUR_MAX, Math.max(0, Math.round(amount)));
}

export function normalizeHeaderImageHeightScale(value, fallback = HEADER_IMAGE_HEIGHT_DEFAULT) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return fallback;
  return Math.min(
    HEADER_IMAGE_HEIGHT_MAX,
    Math.max(HEADER_IMAGE_HEIGHT_MIN, Math.round(amount / HEADER_IMAGE_HEIGHT_STEP) * HEADER_IMAGE_HEIGHT_STEP),
  );
}

export function isHeaderVideoUrl(value, mediaType = "auto") {
  if (mediaType !== "auto") return mediaType === "video";
  try { return /\.(?:mp4|webm|ogv)$/i.test(new URL(value).pathname); } catch { return false; }
}

export function normalizeHeaderImageFit(value) {
  return ["contain", "fill", "height"].includes(value) ? value : "cover";
}
