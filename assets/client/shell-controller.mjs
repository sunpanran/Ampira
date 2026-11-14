import { isBookmarkSectionVisible } from "./bookmark-visibility.mjs";
import { setKeyboardShortcutHint, shortcutTargetVisible } from "./keyboard-shortcuts.mjs";

export function createShellController(options) {
  const { els, state, openSearch } = options;
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
    initializePointerHighlights,
    initializeScrollSpy,
    syncNavToCurrentSection,
    setActiveNavButton,
    resetToDailyView,
    getCurrentSectionButton,
    navigateToSection,
  };

function syncViewportMetrics() {
  // Match CSS viewport units so a settling page scrollbar cannot recrop the cover.
  const width = Math.max(320, window.innerWidth || document.documentElement.clientWidth || 0);
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
  const hint = visible ? "on" : "off";
  document.documentElement.dataset.bookmarkSection = hint;
  try { localStorage.setItem("ampira.bookmarkSectionEnabled", hint); } catch {}
  syncNavExpandedWidth();
  if (!visible && wasActive) syncNavToCurrentSection();
}

function syncNavExpandedWidth() {
  for (const button of document.querySelectorAll("[data-scroll]")) {
    setKeyboardShortcutHint(button, button.dataset.scroll, button.getAttribute("aria-label"), state.settings);
  }
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
  const items = [...buttons, ...sidebar.querySelectorAll(".nav-logo")];
  const maxLabelWidth = Math.max(...items.map((item) => navLabelWidth(item)));
  const labelSlotWidth = Math.ceil(Math.max(labelSlotMin, maxLabelWidth));
  const iconRight = iconTrackWidth / 2 + iconWidth / 2;
  for (const item of items) {
    const itemWidth = Math.ceil(iconRight + gap + navLabelWidth(item) + paddingRight + 2);
    item.style.setProperty("--nav-item-expanded-width", `${Math.max(44, itemWidth)}px`);
  }
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
  openSearch(event.key);
}

function shouldCaptureSearchTyping(event) {
  if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return false;
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

function initializePointerHighlights() {
  const selector = [
    ".efficiency-card",
    ".board-column",
    ".summary-card",
    ".category",
    ".daily-card",
    ".news-list-card",
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
  const activationY = sectionActivationY() - 1;
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

function navigateToSection(id, { focus = false } = {}) {
  const entry = scrollEntries().find(({ button }) => button.dataset.scroll === id);
  if (!entry || entry.button.hidden || !shortcutTargetVisible(entry.section)) return false;
  entry.section.scrollIntoView({
    behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start",
  });
  if (focus) {
    const title = entry.section.querySelector("h2");
    if (title) { title.tabIndex = -1; title.focus({ preventScroll: true }); }
  }
  syncNavToCurrentSection();
  return true;
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
