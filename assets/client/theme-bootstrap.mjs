(() => {
  const storageKey = "ampira.colorMode";
  const coverStorageKey = "ampira.headerCover";
  const shortcutLayoutStorageKey = "ampira.websiteShortcutsLayout";
  const settingsStorageKey = "ampira.settings.v1";
  const allowedModes = new Set(["system", "dark", "light"]);
  let colorMode = "dark";

  try {
    const storedMode = localStorage.getItem(storageKey);
    if (allowedModes.has(storedMode)) colorMode = storedMode;
  } catch {
    // The dark default prevents an unstyled light first frame when storage is unavailable.
  }

  document.documentElement.dataset.colorMode = colorMode;

  const shortcutLayout = readWebsiteShortcutLayoutHint();
  applyWebsiteShortcutLayout(shortcutLayout);
  globalThis.ampiraLayoutBootstrap = {
    websiteShortcutsReady: shortcutLayout.known
      ? Promise.resolve(shortcutLayout)
      : hydrateWebsiteShortcutLayout(),
  };

  try {
    const cachedCover = localStorage.getItem(coverStorageKey);
    const cover = cachedCover
      ? JSON.parse(cachedCover)
      : { enabled: true, fixed: false, fullscreen: false };
    if (cover?.enabled === true) {
      document.documentElement.classList.add("has-header-cover");
      document.documentElement.classList.toggle("has-fixed-header-cover", cover.fixed === true);
      document.documentElement.classList.toggle("has-fullscreen-header-cover", cover.fixed === true && cover.fullscreen === true);
      restoreHeaderCover(cover.url);
    }
  } catch {
    // A stale appearance hint must never prevent the dashboard from starting.
  }

  function restoreHeaderCover(imageUrl) {
    const apply = () => {
      const hero = document.querySelector("#headerImageHero");
      const image = document.querySelector("#headerImage");
      if (!hero || !image) return false;
      hero.hidden = false;
      if (isSafeImageUrl(imageUrl)) image.src = imageUrl;
      return true;
    };
    if (apply()) return;
    const observer = new MutationObserver(() => {
      if (!apply()) return;
      observer.disconnect();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
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
      count: Math.min(10, Math.max(0, Math.floor(Number(value?.count) || 0))),
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
})();
