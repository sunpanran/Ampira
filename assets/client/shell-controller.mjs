import { isBookmarkSectionVisible } from "./bookmark-visibility.mjs";

export function createShellController(options) {
  const { els } = options;
  let viewportMetricWidth = 0;
  let activeNavButton = null;
  let cachedNavButtons = null;
  let cachedScrollEntries = null;
  let scrollObserver = null;
  let scrollObserverResizeFrame = 0;

  return {
    syncViewportMetrics,
    syncNavExpandedWidth,
    syncBookmarkSectionVisibility,
    handleGlobalSearchTyping,
    focusDashboardSearch,
    initializePointerHighlights,
    initializeScrollSpy,
    syncNavToCurrentSection,
    setActiveNavButton,
    resetToDailyView,
    getCurrentSectionButton,
  };

function syncViewportMetrics() {
  const width = Math.max(320, document.documentElement.clientWidth || window.innerWidth || 0);
  if (Math.abs(width - viewportMetricWidth) < 0.5) return;
  viewportMetricWidth = width;
  document.documentElement.style.setProperty("--dashboard-viewport-w", `${width}px`);
  document.documentElement.style.setProperty("--dashboard-viewport-half-w", `${width / 2}px`);
}

function syncBookmarkSectionVisibility(settings = {}) {
  const visible = isBookmarkSectionVisible(settings);
  const wasActive = els.bookmarkNav.classList.contains("active");
  els.bookmarkNav.hidden = !visible;
  els.librarySection.hidden = !visible;
  syncNavExpandedWidth();
  if (!visible && wasActive) syncNavToCurrentSection();
}

function syncNavExpandedWidth() {
  const sidebar = document.querySelector(".sidebar");
  const buttons = [...document.querySelectorAll(".nav-btn")].filter((button) => !button.hidden);
  if (!sidebar || !buttons.length) return;

  if (window.matchMedia("(max-width: 1120px)").matches) {
    sidebar.style.removeProperty("--nav-expanded-width");
    sidebar.style.removeProperty("--nav-expanded-button-width");
    sidebar.style.removeProperty("--nav-label-slot-width");
    return;
  }

  const rootStyle = getComputedStyle(document.documentElement);
  const gap = cssLength(rootStyle, "--nav-expanded-gap", 9);
  const paddingRight = cssLength(rootStyle, "--nav-expanded-button-pad-right", 11);
  const minButtonWidth = cssLength(rootStyle, "--nav-expanded-button-min", 80);
  const iconWidth = navIconWidth(buttons) || 16;
  const iconTrackWidth = cssLength(rootStyle, "--nav-icon-track-width", iconWidth);
  const labelSlotMin = lengthValue(rootStyle.getPropertyValue("--nav-label-slot-min"));
  const maxLabelWidth = Math.max(...buttons.map((button) => navLabelWidth(button)));
  const labelSlotWidth = Math.ceil(Math.max(labelSlotMin, maxLabelWidth + 16));
  const iconRight = iconTrackWidth / 2 + iconWidth / 2;
  const fittedButtonWidth = iconRight + gap + labelSlotWidth + paddingRight + 2;
  const buttonWidth = Math.ceil(Math.max(minButtonWidth, fittedButtonWidth));
  const sidebarStyle = getComputedStyle(sidebar);
  const sidebarWidth = Math.ceil(
    buttonWidth
    + lengthValue(sidebarStyle.paddingLeft)
    + lengthValue(sidebarStyle.paddingRight)
    + lengthValue(sidebarStyle.borderLeftWidth)
    + lengthValue(sidebarStyle.borderRightWidth)
  );

  sidebar.style.setProperty("--nav-expanded-button-width", `${buttonWidth}px`);
  sidebar.style.setProperty("--nav-label-slot-width", `${labelSlotWidth}px`);
  sidebar.style.setProperty("--nav-expanded-width", `${sidebarWidth}px`);
}

function navLabelWidth(button) {
  const label = button.querySelector(".nav-label");
  const text = label?.textContent?.trim() || "";
  if (!label || !text) return 0;
  const style = getComputedStyle(label);
  const canvas = syncNavExpandedWidth.canvas || (syncNavExpandedWidth.canvas = document.createElement("canvas"));
  const context = canvas.getContext("2d");
  if (!context) return label.scrollWidth || text.length * 13;
  context.font = [
    style.fontStyle,
    style.fontVariant,
    style.fontWeight,
    style.fontSize,
    style.fontFamily,
  ].filter(Boolean).join(" ");
  return context.measureText(text).width;
}

function navIconWidth(buttons) {
  for (const button of buttons) {
    const icon = button.querySelector(".nav-icon");
    const width = icon ? lengthValue(getComputedStyle(icon).width) : 0;
    if (width > 0) return width;
  }
  return 0;
}

function cssLength(style, property, fallback) {
  const value = lengthValue(style.getPropertyValue(property));
  return value > 0 ? value : fallback;
}

function lengthValue(value) {
  const number = Number.parseFloat(value);
  return Number.isFinite(number) ? number : 0;
}

function handleGlobalSearchTyping(event) {
  if (!shouldCaptureSearchTyping(event)) return;
  event.preventDefault();
  focusDashboardSearch();
  insertSearchText(event.key);
}

function shouldCaptureSearchTyping(event) {
  if (event.defaultPrevented) return false;
  if (!event.key || event.key.length !== 1) return false;
  if (event.ctrlKey || event.metaKey || event.altKey) return false;
  if (els.settingsModal.classList.contains("open")) return false;
  if (els.aiSearchOverlay.classList.contains("open")) return false;
  if (els.webFrameOverlay.classList.contains("open")) return false;
  if (!els.linkContextMenu.hidden) return false;
  return !isInteractiveTarget(event.target);
}

function isInteractiveTarget(target) {
  return Boolean(target?.closest?.("input, textarea, select, button, a[href], [role='button'], [role='link'], [role='menuitem'], [contenteditable='true'], [contenteditable='']"));
}

function focusDashboardSearch() {
  els.search.focus({ preventScroll: true });
  els.search.scrollIntoView({ behavior: "smooth", block: "center" });
}

function insertSearchText(text) {
  const start = els.search.selectionStart ?? els.search.value.length;
  const end = els.search.selectionEnd ?? start;
  const next = `${els.search.value.slice(0, start)}${text}${els.search.value.slice(end)}`;
  const cursor = start + text.length;
  els.search.value = next;
  els.search.setSelectionRange(cursor, cursor);
  els.search.dispatchEvent(new Event("input", { bubbles: true }));
}

function initializePointerHighlights() {
  const selector = [
    ".efficiency-card",
    ".board-column",
    ".summary-card",
    ".category",
    ".daily-card",
    ".news-list-card",
    ".archive-card",
    ".link-row",
  ].join(", ");

  let frame = 0;
  let pointer = null;
  document.addEventListener("pointermove", (event) => {
    if (document.documentElement.dataset.pointerGlow === "off") return;
    pointer = { target: event.target, x: event.clientX, y: event.clientY };
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (!pointer || document.documentElement.dataset.pointerGlow === "off") return;
      let target = pointer.target instanceof Element ? pointer.target.closest(selector) : null;
      while (target?.isConnected) {
        const rect = target.getBoundingClientRect();
        target.style.setProperty("--mx", `${pointer.x - rect.left}px`);
        target.style.setProperty("--my", `${pointer.y - rect.top}px`);
        target = target.parentElement?.closest(selector);
      }
    });
  }, { passive: true });
}

function initializeScrollSpy() {
  const scheduleObserverRefresh = () => {
    if (scrollObserverResizeFrame) return;
    scrollObserverResizeFrame = requestAnimationFrame(() => {
      scrollObserverResizeFrame = 0;
      observeScrollSections();
      syncNavToCurrentSection();
    });
  };

  window.addEventListener("resize", scheduleObserverRefresh, { passive: true });
  observeScrollSections();
  syncNavToCurrentSection();
}

function observeScrollSections() {
  scrollObserver?.disconnect();
  const activationY = sectionActivationY();
  const bottomMargin = Math.max(0, window.innerHeight - activationY - 1);
  scrollObserver = new IntersectionObserver(syncNavToCurrentSection, {
    root: null,
    rootMargin: `-${activationY}px 0px -${bottomMargin}px 0px`,
    threshold: 0,
  });
  for (const entry of scrollEntries()) scrollObserver.observe(entry.section);
}

function syncNavToCurrentSection() {
  if (els.settingsModal.classList.contains("open")) return;
  setActiveNavButton(getCurrentSectionButton());
}

function setActiveNavButton(nextActiveButton) {
  const buttons = navButtons();
  if (activeNavButton === null) activeNavButton = buttons.find((button) => button.classList.contains("active")) || null;
  if (activeNavButton === nextActiveButton) return;
  for (const button of buttons) button.classList.toggle("active", button === nextActiveButton);
  activeNavButton = nextActiveButton;
}

function resetToDailyView() {
  window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  setActiveNavButton(scrollEntries().find((entry) => entry.button.dataset.scroll === "daily")?.button || null);
}

function getCurrentSectionButton() {
  const entries = scrollEntries()
    .filter((entry) => !entry.button.hidden && entry.section.hidden !== true);
  const activationY = sectionActivationY();
  let currentButton = entries[0]?.button || null;

  for (const { button, section } of entries) {
    const rect = section.getBoundingClientRect();
    if (rect.top <= activationY) currentButton = button;
    if (rect.top <= activationY && rect.bottom > activationY) return button;
  }

  return currentButton;
}

function sectionActivationY() {
  return Math.min(220, Math.max(120, window.innerHeight * 0.32));
}

function navButtons() {
  cachedNavButtons ||= [...document.querySelectorAll(".nav-btn")];
  return cachedNavButtons;
}

function scrollEntries() {
  cachedScrollEntries ||= [...document.querySelectorAll("[data-scroll]")]
    .map((button) => ({ button, section: document.getElementById(button.dataset.scroll) }))
    .filter((entry) => entry.section);
  return cachedScrollEntries;
}

}
