import assert from "node:assert/strict";
import { createShellController } from "../../assets/client/shell-controller.mjs";

export function runNavigationScrollTests() {
  const originals = new Map(["window", "document", "IntersectionObserver"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const sections = new Map();
  const buttons = ["daily", "news", "library"].map((id, index) => {
    const classes = new Set(index === 0 ? ["active"] : []);
    const title = { focus(options) { this.focusOptions = options; } };
    sections.set(id, {
      isConnected: true, hidden: false, top: index * 1000,
      closest() { return this.hidden ? {} : null; },
      getClientRects() { return this.hidden ? [] : [{}]; },
      getBoundingClientRect() { return { top: this.top - scrollY, bottom: this.top + 1000 - scrollY }; },
      querySelector() { return title; },
      scrollIntoView(options) { scrollRequests.push({ id, ...options }); if (reducedMotion) scrollY = this.top; },
    });
    return { dataset: { scroll: id }, hidden: false, classList: {
      contains: (name) => classes.has(name),
      toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); },
    } };
  });
  let scrollY = 0;
  let reducedMotion = false;
  let settingsOpen = false;
  let observeCrossing;
  let observerOptions;
  const observed = [];
  const scrollRequests = [];
  const history = [];
  const record = () => {
    const active = buttons.find((button) => button.classList.contains("active"))?.dataset.scroll;
    if (history.at(-1) !== active) history.push(active);
  };
  try {
    globalThis.window = {
      innerHeight: 800,
      addEventListener() {},
      getComputedStyle: () => ({ visibility: "visible", display: "block" }),
      matchMedia: () => ({ matches: reducedMotion }),
      scrollTo({ top }) { scrollY = top; },
    };
    globalThis.document = {
      querySelectorAll: () => buttons,
      getElementById: (id) => sections.get(id),
    };
    globalThis.IntersectionObserver = class {
      constructor(callback, options) { observeCrossing = callback; observerOptions = options; }
      observe(section) { observed.push(section); }
      disconnect() {}
    };
    const controller = createShellController({
      els: { settingsModal: { classList: { contains: () => settingsOpen } } }, state: {},
    });
    controller.initializeScrollSpy();
    assert.equal(observed.length, 3);
    record();
    assert.equal(controller.navigateToSection("news"), true);
    record();
    // The observer can report the old section before smooth scrolling advances.
    observeCrossing();
    record();
    scrollY = 400;
    observeCrossing();
    record();
    // A section enters at the lower edge of the observer's one-pixel band.
    const observerBottom = window.innerHeight + Number.parseFloat(observerOptions.rootMargin.split(" ")[2]);
    scrollY = sections.get("news").top - observerBottom;
    observeCrossing();
    record();
    assert.deepEqual(history, ["daily", "news"], "a click must reach news without briefly returning to today");
    assert.deepEqual(scrollRequests[0], { id: "news", behavior: "smooth", block: "start" });

    history.length = 0;
    record();
    controller.navigateToSection("daily", { focus: true });
    record();
    observeCrossing();
    record();
    scrollY = 0;
    observeCrossing();
    record();
    assert.deepEqual(history, ["news", "daily"], "upward keyboard navigation must not flash back either");
    assert.deepEqual(sections.get("daily").querySelector().focusOptions, { preventScroll: true });

    controller.navigateToSection("library");
    scrollY = 950;
    observeCrossing();
    assert.equal(controller.getCurrentSectionButton(), buttons[1]);
    scrollY = 0; // A manual interruption must keep following the visible section.
    observeCrossing();
    assert(buttons[0].classList.contains("active"));

    reducedMotion = true;
    controller.navigateToSection("news");
    assert(buttons[1].classList.contains("active"), "instant navigation must synchronize without waiting for an observer callback");
    assert.equal(scrollRequests.at(-1).behavior, "auto");
    settingsOpen = true;
    scrollY = 0;
    observeCrossing();
    assert(buttons[1].classList.contains("active"), "background scroll observation must not override an open settings modal");
    settingsOpen = false;
    observeCrossing();
    assert(buttons[0].classList.contains("active"));
    buttons[2].hidden = true;
    sections.get("library").hidden = true;
    assert.equal(controller.navigateToSection("library"), false);
    assert.equal(controller.navigateToSection("missing"), false);
  } finally {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
}
