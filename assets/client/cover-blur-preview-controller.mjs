const POINTER_PREVIEW_DELAY_MS = 80;
const KEYBOARD_PREVIEW_IDLE_MS = 600;
const RANGE_ADJUSTMENT_KEYS = new Set([
  "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowUp", "End", "Home", "PageDown", "PageUp",
]);

export function createCoverBlurPreviewController({ modal, input, previewClass = "is-cover-blur-previewing" }) {
  let pointerId = null;
  let pointerTimer = 0;
  let keyboardTimer = 0;

  function clearPointerTimer() {
    if (pointerTimer) window.clearTimeout(pointerTimer);
    pointerTimer = 0;
  }

  function clearKeyboardTimer() {
    if (keyboardTimer) window.clearTimeout(keyboardTimer);
    keyboardTimer = 0;
  }

  function begin() {
    if (input.disabled || !modal.classList.contains("open")) return;
    if (!modal.classList.contains(previewClass)) {
      window.scrollTo({ top: 0, left: 0, behavior: "smooth" });
    }
    modal.classList.add("is-cover-previewing");
    modal.classList.add(previewClass);
  }

  function end() {
    clearPointerTimer();
    clearKeyboardTimer();
    pointerId = null;
    modal.classList.remove(previewClass);
    if (!modal.classList.contains("is-cover-blur-previewing")
      && !modal.classList.contains("is-cover-height-previewing")) {
      modal.classList.remove("is-cover-previewing");
    }
  }

  function scheduleKeyboardEnd() {
    clearKeyboardTimer();
    keyboardTimer = window.setTimeout(end, KEYBOARD_PREVIEW_IDLE_MS);
  }

  function handlePointerDown(event) {
    if (input.disabled || event.isPrimary === false || event.button !== 0) return;
    end();
    pointerId = event.pointerId;
    try {
      input.setPointerCapture(event.pointerId);
    } catch {
      // Native range inputs may already own pointer capture.
    }
    pointerTimer = window.setTimeout(begin, POINTER_PREVIEW_DELAY_MS);
  }

  function handlePointerEnd(event) {
    if (pointerId === null || event.pointerId !== pointerId) return;
    end();
  }

  function handleInput() {
    begin();
    if (pointerId === null) scheduleKeyboardEnd();
  }

  function handleKeyDown(event) {
    if (event.key === "Escape") {
      end();
      return;
    }
    if (!RANGE_ADJUSTMENT_KEYS.has(event.key)) return;
    begin();
    scheduleKeyboardEnd();
  }

  function handleKeyUp(event) {
    if (RANGE_ADJUSTMENT_KEYS.has(event.key)) scheduleKeyboardEnd();
  }

  function bind() {
    input.addEventListener("pointerdown", handlePointerDown);
    input.addEventListener("pointerup", handlePointerEnd);
    input.addEventListener("pointercancel", handlePointerEnd);
    input.addEventListener("lostpointercapture", handlePointerEnd);
    input.addEventListener("input", handleInput);
    input.addEventListener("keydown", handleKeyDown);
    input.addEventListener("keyup", handleKeyUp);
    input.addEventListener("blur", end);
    window.addEventListener("blur", end);
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) end();
    });
  }

  return { bind, end };
}
