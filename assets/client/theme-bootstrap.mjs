(() => {
  const storageKey = "ampira.colorMode";
  const allowedModes = new Set(["system", "dark", "light"]);
  let colorMode = "dark";

  try {
    const storedMode = localStorage.getItem(storageKey);
    if (allowedModes.has(storedMode)) colorMode = storedMode;
  } catch {
    // The dark default prevents an unstyled light first frame when storage is unavailable.
  }

  document.documentElement.dataset.colorMode = colorMode;
})();
