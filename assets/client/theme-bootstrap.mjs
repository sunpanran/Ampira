(() => {
  const maxWebsiteShortcuts = 16;
  const storageKey = "ampira.colorMode";
  const coverStorageKey = "ampira.headerCover";
  const localCoverStorageKey = "ampira.header-cover.local.v1";
  const shortcutLayoutStorageKey = "ampira.websiteShortcutsLayout";
  const settingsStorageKey = "ampira.settings.v1";
  const headerCoverBlurMax = 24;
  const headerCoverBlurBleedMultiplier = 1.5;
  const defaultHeaderImageUrl = "https://images.unsplash.com/photo-1782827286498-241b8af47185?q=80&w=2487&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D";
  const defaultHeaderImageAsset = "/assets/images/default-header.webp";
  const allowedModes = new Set(["system", "dark", "light"]);
  let colorMode = "dark";

  try {
    const storedMode = localStorage.getItem(storageKey);
    if (allowedModes.has(storedMode)) colorMode = storedMode;
  } catch {
    // The dark default prevents an unstyled light first frame when storage is unavailable.
  }

  document.documentElement.dataset.colorMode = colorMode;
  const firstFrameMotionEnabled = document.hidden !== true
    && globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches !== true;
  if (firstFrameMotionEnabled) {
    document.documentElement.classList.add("has-first-frame-motion");
    globalThis.ampiraFirstFrameStartedAt = performance.now();
    setTimeout(() => document.documentElement.classList.remove("has-first-frame-motion"), 560);
  }

  const shortcutLayout = readWebsiteShortcutLayoutHint();
  applyWebsiteShortcutLayout(shortcutLayout);
  globalThis.ampiraLayoutBootstrap = {
    websiteShortcutsReady: shortcutLayout.known
      ? Promise.resolve(shortcutLayout)
      : hydrateWebsiteShortcutLayout(),
    headerCoverReady: Promise.resolve(),
  };

  try {
    const cachedCover = localStorage.getItem(coverStorageKey);
    const cover = cachedCover
      ? JSON.parse(cachedCover)
      : { enabled: true, fixed: false, fullscreen: false, blurEnabled: false, blurAmount: 12, heightScale: 100, url: defaultHeaderImageUrl };
    applyHeaderCoverBlur(cover?.enabled === true && cover?.blurEnabled === true ? cover.blurAmount : 0);
    applyHeaderCoverHeight(cover?.heightScale);
    if (cover?.enabled === true) {
      document.documentElement.classList.add("has-header-cover");
      document.documentElement.classList.toggle("has-fixed-header-cover", cover.fixed === true);
      document.documentElement.classList.toggle("has-fullscreen-header-cover", cover.fixed === true && cover.fullscreen === true);
      globalThis.ampiraLayoutBootstrap.headerCoverReady = hydrateHeaderCover(cover);
    }
  } catch {
    // A stale appearance hint must never prevent the dashboard from starting.
  }

  async function hydrateHeaderCover(cover) {
    if (cover?.local === true && location.protocol === "chrome-extension:" && globalThis.chrome?.storage?.local?.get) {
      try {
        const values = await chrome.storage.local.get(localCoverStorageKey);
        const record = values?.[localCoverStorageKey];
        if (isSafeLocalCoverRecord(record)) {
          restoreHeaderCover(record.dataUrl, cover.url);
          return;
        }
      } catch {
        // The synced URL remains the safe fallback below.
      }
    }
    restoreHeaderCover(cover?.url);
  }

  function restoreHeaderCover(imageUrl, fallbackUrl = "") {
    const apply = () => {
      const hero = document.querySelector("#headerImageHero");
      const image = document.querySelector("#headerImage");
      if (!hero || !image) return false;
      hero.hidden = false;
      const resolvedImageUrl = resolveHeaderImageSource(imageUrl);
      const resolvedFallbackUrl = resolveHeaderImageSource(fallbackUrl);
      if (isSafeCoverSource(resolvedImageUrl)) {
        const source = resolvedImageUrl;
        image.addEventListener("error", () => {
          if (image.getAttribute("src") === source && isSafeCoverSource(resolvedFallbackUrl)) image.src = resolvedFallbackUrl;
        }, { once: true });
        image.src = source;
      }
      return true;
    };
    if (apply()) return;
    const observer = new MutationObserver(() => {
      if (!apply()) return;
      observer.disconnect();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  function resolveHeaderImageSource(value) {
    const source = String(value || "");
    return source === defaultHeaderImageUrl ? defaultHeaderImageAsset : source;
  }

  function applyHeaderCoverBlur(value) {
    const numericValue = Number(value);
    const amount = Number.isFinite(numericValue)
      ? Math.min(headerCoverBlurMax, Math.max(0, Math.round(numericValue)))
      : 0;
    const bleed = amount * headerCoverBlurBleedMultiplier;
    const root = document.documentElement;
    root.style.setProperty("--header-cover-blur", `${amount}px`);
    root.style.setProperty("--header-cover-inset", `${-bleed}px`);
    root.style.setProperty("--header-cover-size-adjustment", `${bleed * 2}px`);
  }

  function applyHeaderCoverHeight(value) {
    const numericValue = Number(value);
    const scale = Number.isFinite(numericValue)
      ? Math.min(140, Math.max(70, Math.round(numericValue / 5) * 5))
      : 100;
    document.documentElement.style.setProperty("--header-cover-height-scale", String(scale / 100));
  }

  function readWebsiteShortcutLayoutHint() {
    try {
      const value = localStorage.getItem(shortcutLayoutStorageKey);
      if (!value) return { known: false, enabled: false, count: 0 };
      if (value === "on" || value === "off") {
        return { known: true, enabled: value === "on", count: value === "on" ? 1 : 0 };
      }
      const parsed = JSON.parse(value);
      return normalizeWebsiteShortcutLayout(parsed, true);
    } catch {
      return { known: false, enabled: false, count: 0 };
    }
  }

  async function hydrateWebsiteShortcutLayout() {
    if (location.protocol !== "chrome-extension:" || !globalThis.chrome?.storage?.sync?.get) return shortcutLayout;
    try {
      const records = await chrome.storage.sync.get(settingsStorageKey);
      const settings = records?.[settingsStorageKey];
      const layout = normalizeWebsiteShortcutLayout({
        enabled: settings?.websiteShortcutsEnabled === true,
        count: Array.isArray(settings?.websiteShortcuts) ? settings.websiteShortcuts.length : 0,
      }, true);
      try { localStorage.setItem(shortcutLayoutStorageKey, JSON.stringify(layout)); } catch {}
      applyWebsiteShortcutLayout(layout);
      return layout;
    } catch {
      return shortcutLayout;
    }
  }

  function normalizeWebsiteShortcutLayout(value, known = false) {
    return {
      known: known === true,
      enabled: value?.enabled === true,
      count: Math.min(maxWebsiteShortcuts, Math.max(0, Math.floor(Number(value?.count) || 0))),
    };
  }

  function applyWebsiteShortcutLayout(layout) {
    const root = document.documentElement;
    root.classList.toggle("has-website-shortcuts", layout.enabled === true);
    root.dataset.websiteShortcutCount = String(layout.count || 0);
  }

  function isSafeImageUrl(value) {
    try {
      const url = new URL(String(value || ""));
      return url.protocol === "https:"
        || (url.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(url.hostname));
    } catch {
      return false;
    }
  }

  function isSafePackagedHeaderImage(value) {
    return value === defaultHeaderImageAsset && location.protocol === "chrome-extension:";
  }

  function isSafeLocalCover(value) {
    const dataUrl = String(value || "");
    if (!/^data:image\/webp;base64,[A-Za-z0-9+/]+={0,2}$/.test(dataUrl)) return false;
    try {
      const header = atob(dataUrl.slice("data:image/webp;base64,".length, "data:image/webp;base64,".length + 16));
      return header.length >= 12 && header.slice(0, 4) === "RIFF" && header.slice(8, 12) === "WEBP";
    } catch {
      return false;
    }
  }

  function isSafeLocalCoverRecord(value) {
    const dataUrl = String(value?.dataUrl || "");
    const base64 = dataUrl.slice("data:image/webp;base64,".length);
    const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
    const byteLength = base64.length * 3 / 4 - padding;
    return Number(value?.schemaVersion) === 1
      && value?.mimeType === "image/webp"
      && isSafeLocalCover(dataUrl)
      && byteLength > 0
      && byteLength <= Math.floor(2.5 * 1024 * 1024)
      && Number(value?.byteLength) === byteLength
      && Number.isInteger(value?.width) && value.width > 0 && value.width <= 2560
      && Number.isInteger(value?.height) && value.height > 0 && value.height <= 2560;
  }

  function isSafeCoverSource(value) {
    return isSafeImageUrl(value) || isSafeLocalCover(value) || isSafePackagedHeaderImage(value);
  }
})();
