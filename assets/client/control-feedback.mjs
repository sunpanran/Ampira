const bindings = new WeakMap();
const CONTROL_SELECTOR = "button, summary, a.btn, .empty-state-action, .website-shortcut, .select-combobox-option, .toggle, label";
const EXCLUDED_SELECTOR = ".nav-btn, #navLogo, [data-batch-action], #summaryBatch, :disabled, [aria-disabled='true'], .is-loading, .is-dragging";

export function bindControlFeedback(doc = document) {
  if (bindings.has(doc)) return bindings.get(doc);
  const view = doc.defaultView;
  const listeners = [];
  let pressed = null;

  function release() {
    pressed?.element.classList.remove("is-control-pressed");
    pressed = null;
  }

  function controlFor(target) {
    let element = target?.closest?.(CONTROL_SELECTOR);
    if (element?.matches("label, .toggle")) {
      element = element.control || element.querySelector(".toggle input, input");
      if (!element?.closest(".toggle")) return null;
    }
    if (!element || element.matches(EXCLUDED_SELECTOR) || element.closest("[inert], [aria-disabled='true']")) return null;
    return element;
  }

  function press(element, input) {
    release();
    if (!element || doc.hidden || view?.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    pressed = { element, ...input };
    element.classList.add("is-control-pressed");
  }

  function listen(target, type, handler, capture = true) {
    target?.addEventListener(type, handler, capture);
    listeners.push(() => target?.removeEventListener(type, handler, capture));
  }

  listen(doc, "pointerdown", event => {
    if (event.button === 0 && event.isPrimary !== false) press(controlFor(event.target), { pointerId: event.pointerId });
  });
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
    listen(doc, type, event => {
      if (pressed?.pointerId === event.pointerId) release();
    });
  }
  listen(doc, "pointerout", event => {
    if (pressed?.pointerId === event.pointerId && !pressed.element.contains(event.relatedTarget)) release();
  });
  listen(doc, "keydown", event => {
    if (event.repeat || event.altKey || event.ctrlKey || event.metaKey || ![" ", "Enter"].includes(event.key)) return;
    const element = controlFor(event.target);
    if ((element?.matches("a") && event.key === " ") || (element?.matches("input") && event.key === "Enter")) return;
    press(element, { key: event.key });
  });
  listen(doc, "keyup", event => { if (pressed?.key === event.key) release(); });
  listen(doc, "focusout", event => { if (pressed?.element === event.target) release(); });
  listen(doc, "dragstart", release);
  listen(doc, "visibilitychange", () => { if (doc.hidden) release(); });
  // Capturing blur here would also catch the previous button losing focus.
  listen(view, "blur", release, false);

  doc.documentElement.classList.add("has-control-feedback");
  const dispose = () => {
    release();
    listeners.forEach(remove => remove());
    doc.documentElement.classList.remove("has-control-feedback");
    bindings.delete(doc);
  };
  bindings.set(doc, dispose);
  return dispose;
}
