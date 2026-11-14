const HIDE_DELAY = 1200;

export function createNavigationAutoHideController({ sidebar, reveal }) {
  let enabled = false;
  let position = "";
  let timer = 0;
  let hovered = false;
  let pressed = false;

  function cancelHide() {
    clearTimeout(timer);
    timer = 0;
  }

  function scheduleHide(delay = HIDE_DELAY) {
    cancelHide();
    if (!enabled || document.hidden) return;
    timer = setTimeout(() => {
      timer = 0;
      if (hovered || pressed || sidebar.querySelector(":focus-visible")) return;
      if (document.documentElement.classList.contains("has-nav-entrance")) {
        scheduleHide();
        return;
      }
      sidebar.classList.add("is-auto-hidden");
      reveal.hidden = false;
    }, delay);
  }

  function show({ focus = false, delay = HIDE_DELAY } = {}) {
    sidebar.classList.remove("is-auto-hidden");
    // Move keyboard focus before hiding the edge button.
    if (focus) sidebar.querySelector(".nav-btn:not([hidden])")?.focus({ preventScroll: true });
    reveal.hidden = true;
    scheduleHide(delay);
  }

  sidebar.addEventListener("pointerenter", (event) => {
    if (event.pointerType === "touch") return;
    hovered = true;
    show();
  });
  sidebar.addEventListener("pointerleave", () => {
    hovered = false;
    scheduleHide();
  });
  sidebar.addEventListener("pointerdown", () => { pressed = true; cancelHide(); });
  for (const type of ["pointerup", "pointercancel"]) {
    document.addEventListener(type, () => {
      if (!pressed) return;
      pressed = false;
      scheduleHide();
    });
  }
  sidebar.addEventListener("focusin", () => show());
  sidebar.addEventListener("focusout", () => scheduleHide());
  reveal.addEventListener("pointerenter", (event) => {
    if (event.pointerType !== "touch") show();
  });
  reveal.addEventListener("focusin", () => show({ focus: true, delay: 2400 }));
  reveal.addEventListener("click", () => show({ focus: true, delay: 2400 }));
  document.addEventListener("visibilitychange", () => {
    hovered = false;
    pressed = false;
    if (document.hidden) cancelHide();
    else show();
  });
  window.addEventListener("resize", () => { hovered = false; show(); });

  return {
    sync(settings = {}) {
      const nextEnabled = settings.navAutoHideEnabled === true;
      if (enabled === nextEnabled && position === settings.navPosition) return;
      enabled = nextEnabled;
      position = settings.navPosition;
      document.documentElement.dataset.navAutoHide = enabled ? "on" : "off";
      show();
    },
  };
}
