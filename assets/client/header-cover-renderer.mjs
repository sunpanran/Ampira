import { isReaderUrl } from "./urls.mjs";
import {
  HEADER_COVER_STORAGE_KEY, DEFAULT_HEADER_IMAGE_URL, HEADER_IMAGE_BLUR_BLEED_MULTIPLIER,
  isHeaderVideoUrl, normalizeHeaderImageBlurAmount, normalizeHeaderImageHeightScale,
} from "./header-cover-model.mjs";

export function createHeaderCoverRenderer({ state, els }) {
  let failedLocalCoverDataUrl = "";

  function renderHeaderImage(settings = {}) {
    const url = String(settings.headerImageUrl || "").trim();
    const localUrl = String(state.localHeaderCover?.dataUrl || "");
    const enabled = settings.headerImageEnabled === true;
    const fixed = settings.headerImageFixed === true;
    const fullscreen = fixed && settings.headerImageFullscreen === true;
    const blurEnabled = settings.headerImageBlurEnabled === true;
    const blurAmount = normalizeHeaderImageBlurAmount(settings.headerImageBlurAmount);
    const heightScale = normalizeHeaderImageHeightScale(settings.headerImageHeightScale);
    const preferredLocalUrl = localUrl && localUrl !== failedLocalCoverDataUrl ? localUrl : "";
    const video = isHeaderVideoUrl(url, settings.headerImageMediaType || "auto");
    const source = preferredLocalUrl || resolveHeaderImageSource(url, video);
    const useVideo = Boolean(!preferredLocalUrl && url && video);
    const root = document.documentElement;
    cache(HEADER_COVER_STORAGE_KEY, JSON.stringify({
      enabled: enabled && Boolean(source),
      fixed,
      fullscreen,
      blurEnabled,
      blurAmount,
      heightScale,
      local: Boolean(localUrl),
      video,
      url: enabled ? url : "",
    }));
    applyHeaderImageBlur(root, enabled && blurEnabled ? blurAmount : 0);
    applyHeaderImageHeight(root, heightScale);
    if (!enabled || !source) {
      globalThis.ampiraLayoutBootstrap?.setHeaderCoverVideo?.(els.headerImageHero, "");
      els.headerImageHero.hidden = true;
      els.headerImageHero.classList.remove("is-loaded");
      setHeaderImageSource("");
      root.classList.remove("has-header-cover", "has-fixed-header-cover", "has-fullscreen-header-cover");
      return;
    }
    els.headerImageHero.hidden = false;
    root.classList.add("has-header-cover");
    root.classList.toggle("has-fixed-header-cover", fixed);
    root.classList.toggle("has-fullscreen-header-cover", fullscreen);
    if (useVideo) {
      globalThis.ampiraLayoutBootstrap?.setHeaderCoverVideo?.(els.headerImageHero, source);
      return;
    }
    globalThis.ampiraLayoutBootstrap?.setHeaderCoverVideo?.(els.headerImageHero, "");
    if (els.headerImage.getAttribute("src") !== source) {
      els.headerImageHero.classList.remove("is-loaded");
      setHeaderImageSource(source);
      return;
    }
    syncHeaderImageLoadState();
  }

  function syncHeaderImageLoadState() {
    if (!els.headerImage.getAttribute("src") || !els.headerImage.complete) return;
    if (els.headerImage.naturalWidth > 0) handleHeaderImageLoad();
    // A source change can briefly report complete with no decoded pixels.
    // Only the actual error event may reject a persisted network image.
  }

  function handleHeaderImageLoad() {
    if (els.headerImage.hidden) return;
    if (!els.headerImage.complete || els.headerImage.naturalWidth <= 0) return;
    const reveal = globalThis.ampiraLayoutBootstrap?.revealHeaderCover;
    if (typeof reveal === "function") reveal(els.headerImageHero, els.headerImage);
    else els.headerImageHero.classList.add("is-loaded");
  }

  function handleHeaderImageError() {
    if (els.headerImage.hidden || !els.headerImage.getAttribute("src")) return;
    globalThis.ampiraLayoutBootstrap?.rejectHeaderCover?.(els.headerImage.getAttribute("src"));
    const localUrl = String(state.localHeaderCover?.dataUrl || "");
    if (localUrl && els.headerImage.getAttribute("src") === localUrl) {
      failedLocalCoverDataUrl = localUrl;
      renderHeaderImage(state.settings);
      return;
    }
    els.headerImageHero.classList.remove("is-loaded");
    els.headerImageHero.hidden = true;
    document.documentElement.classList.remove("has-header-cover", "has-fixed-header-cover", "has-fullscreen-header-cover");
  }

  function setHeaderImageSource(source) {
    const assign = globalThis.ampiraLayoutBootstrap?.setHeaderCoverSource;
    if (assign) assign(els.headerImage, source);
    else if (source) els.headerImage.src = source;
    else els.headerImage.removeAttribute("src");
  }

  function resolveHeaderImageSource(url, video = false) {
    url ||= DEFAULT_HEADER_IMAGE_URL;
    if (!isReaderUrl(url) || new URL(url).username || new URL(url).password) return "";
    return video ? url : globalThis.ampiraLayoutBootstrap?.resolveHeaderCoverSource?.(url) || url;
  }

  function applyHeaderImageBlur(root, amount) {
    const normalizedAmount = normalizeHeaderImageBlurAmount(amount, 0);
    const bleed = normalizedAmount * HEADER_IMAGE_BLUR_BLEED_MULTIPLIER;
    root.style.setProperty("--header-cover-blur", `${normalizedAmount}px`);
    root.style.setProperty("--header-cover-inset", `${-bleed}px`);
    root.style.setProperty("--header-cover-size-adjustment", `${bleed * 2}px`);
  }

  function applyHeaderImageHeight(root, value) {
    const scale = normalizeHeaderImageHeightScale(value);
    root.style.setProperty("--header-cover-height-scale", String(scale / 100));
    root.style.setProperty("--header-cover-fullscreen-height", `${scale}dvh`);
  }

  function cache(key, value) {
    try { localStorage.setItem(key, value); } catch {}
  }

  return { renderHeaderImage, handleHeaderImageLoad, handleHeaderImageError, syncHeaderImageLoadState };
}
