(() => {
  const storageKey = "ampira.colorMode";
  const coverStorageKey = "ampira.headerCover";
  const allowedModes = new Set(["system", "dark", "light"]);
  let colorMode = "dark";

  try {
    const storedMode = localStorage.getItem(storageKey);
    if (allowedModes.has(storedMode)) colorMode = storedMode;
  } catch {
    // The dark default prevents an unstyled light first frame when storage is unavailable.
  }

  document.documentElement.dataset.colorMode = colorMode;

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
