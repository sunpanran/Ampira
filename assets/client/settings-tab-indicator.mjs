export function createSettingsTabIndicator(tabs) {
  const buttons = Array.from(tabs.querySelectorAll("button[data-settings-tab]"));

  function sync({ animate = false } = {}) {
    const button = buttons.find(item => item.classList.contains("active"));
    if (!button) return;
    tabs.classList.toggle("is-indicator-moving", animate);
    // Content coordinates keep the marker attached while the tab list scrolls.
    tabs.style.setProperty("--settings-indicator-x", `${button.offsetLeft}px`);
    tabs.style.setProperty("--settings-indicator-y", `${button.offsetTop + button.offsetHeight / 2}px`);
    tabs.style.setProperty("--settings-indicator-width", `${button.offsetWidth}px`);
    tabs.style.setProperty("--settings-indicator-height", `${button.offsetHeight}px`);
    // Commit initial placement or a layout change before enabling transitions again.
    if (!animate) window.getComputedStyle(tabs, "::before").transform;
  }

  if (typeof ResizeObserver === "function") {
    const observer = new ResizeObserver(() => sync());
    observer.observe(tabs);
    for (const button of buttons) observer.observe(button);
  }

  return sync;
}
