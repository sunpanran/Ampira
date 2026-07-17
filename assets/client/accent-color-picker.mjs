import { DEFAULT_CUSTOM_ACCENT_COLOR, normalizeHexColor } from "./appearance-model.mjs";

const PICKER_VIEWPORT_MARGIN = 12;
const PICKER_TRIGGER_GAP = 8;

export function createAccentColorPicker(options) {
  const {
    trigger,
    picker,
    plane,
    hueInput,
    hexInput,
    inputError,
    closeButton,
    onChange,
  } = options;
  const nativePopover = typeof picker.showPopover === "function";
  let color = normalizeHexColor(hexInput.value) || DEFAULT_CUSTOM_ACCENT_COLOR;
  let hsv = hexToHsv(color);
  let dragging = false;
  let restoreFocusOnClose = false;

  if (!nativePopover) picker.hidden = true;
  sync(color);

  trigger.addEventListener("click", () => {
    if (trigger.disabled) return;
    if (isOpen()) close({ restoreFocus: true });
    else open();
  });
  closeButton.addEventListener("click", () => close({ restoreFocus: true }));
  picker.addEventListener("toggle", (event) => {
    const openState = event.newState ? event.newState === "open" : isOpen();
    trigger.setAttribute("aria-expanded", String(openState));
    if (openState) return;
    dragging = false;
    resetDraft();
    stopPositionTracking();
    if (restoreFocusOnClose) {
      restoreFocusOnClose = false;
      window.requestAnimationFrame(() => trigger.focus({ preventScroll: true }));
    }
  });
  picker.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    close({ restoreFocus: true });
  });
  plane.addEventListener("pointerdown", (event) => {
    if (plane.getAttribute("aria-disabled") === "true" || (event.pointerType === "mouse" && event.button !== 0)) return;
    event.preventDefault();
    dragging = true;
    plane.setPointerCapture?.(event.pointerId);
    updateFromPointer(event);
  });
  plane.addEventListener("pointermove", (event) => {
    if (dragging) updateFromPointer(event);
  });
  plane.addEventListener("pointerup", finishPointerInteraction);
  plane.addEventListener("pointercancel", finishPointerInteraction);
  plane.addEventListener("keydown", handlePlaneKeydown);
  hueInput.addEventListener("input", () => {
    hsv.h = wrapHue(hueInput.value);
    commitHsv();
  });
  hexInput.addEventListener("input", () => {
    const draft = formatHexDraft(hexInput.value);
    hexInput.value = draft;
    const normalized = normalizeHexColor(draft);
    clearInputError();
    if (normalized) setColor(normalized, { emit: true });
  });
  hexInput.addEventListener("blur", () => {
    if (!normalizeHexColor(hexInput.value)) showInputError();
  });
  hexInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.isComposing) return;
    event.preventDefault();
    const normalized = normalizeHexColor(hexInput.value);
    if (!normalized) {
      showInputError();
      return;
    }
    setColor(normalized, { emit: true });
    close({ restoreFocus: true });
  });

  function open() {
    resetDraft();
    if (window.matchMedia?.("(max-width: 520px)").matches) {
      trigger.scrollIntoView({ block: "center", inline: "nearest", behavior: "auto" });
    }
    if (nativePopover) picker.showPopover();
    else {
      picker.hidden = false;
      picker.classList.add("is-open");
    }
    trigger.setAttribute("aria-expanded", "true");
    startPositionTracking();
    positionPicker();
    window.requestAnimationFrame(() => {
      if (!isOpen()) return;
      positionPicker();
      plane.focus({ preventScroll: true });
    });
  }

  function close({ restoreFocus = false } = {}) {
    if (!isOpen()) return;
    restoreFocusOnClose = restoreFocus;
    if (nativePopover) picker.hidePopover();
    else {
      picker.classList.remove("is-open");
      picker.hidden = true;
      trigger.setAttribute("aria-expanded", "false");
      resetDraft();
      stopPositionTracking();
      if (restoreFocusOnClose) {
        restoreFocusOnClose = false;
        window.requestAnimationFrame(() => trigger.focus({ preventScroll: true }));
      }
    }
  }

  function sync(value) {
    setColor(normalizeHexColor(value) || DEFAULT_CUSTOM_ACCENT_COLOR);
  }

  function setBusy(busy) {
    trigger.disabled = busy;
    hueInput.disabled = busy;
    hexInput.disabled = busy;
    plane.setAttribute("aria-disabled", String(busy));
    plane.tabIndex = busy ? -1 : 0;
    if (busy) close();
  }

  function setColor(value, { emit = false } = {}) {
    const normalized = normalizeHexColor(value);
    if (!normalized) return false;
    const nextHsv = hexToHsv(normalized);
    if (nextHsv.s > 0 || !hsv) hsv.h = nextHsv.h;
    hsv.s = nextHsv.s;
    hsv.v = nextHsv.v;
    color = normalized;
    hexInput.value = normalized;
    syncVisuals();
    clearInputError();
    if (emit) onChange?.(normalized);
    return true;
  }

  function commitHsv() {
    color = hsvToHex(hsv.h, hsv.s, hsv.v);
    hexInput.value = color;
    syncVisuals();
    clearInputError();
    onChange?.(color);
  }

  function syncVisuals() {
    const saturation = clamp(hsv.s, 0, 100);
    const value = clamp(hsv.v, 0, 100);
    const hue = wrapHue(hsv.h);
    picker.style.setProperty("--picker-hue", `hsl(${hue} 100% 50%)`);
    picker.style.setProperty("--picker-color", color);
    picker.style.setProperty("--picker-x", `${saturation}%`);
    picker.style.setProperty("--picker-y", `${100 - value}%`);
    hueInput.value = String(Math.round(hue));
    plane.setAttribute("aria-valuenow", String(Math.round(saturation)));
    plane.setAttribute("aria-valuetext", color);
  }

  function updateFromPointer(event) {
    const bounds = plane.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    hsv.s = clamp(((event.clientX - bounds.left) / bounds.width) * 100, 0, 100);
    hsv.v = clamp((1 - ((event.clientY - bounds.top) / bounds.height)) * 100, 0, 100);
    commitHsv();
  }

  function finishPointerInteraction(event) {
    if (!dragging) return;
    dragging = false;
    if (plane.hasPointerCapture?.(event.pointerId)) plane.releasePointerCapture(event.pointerId);
  }

  function handlePlaneKeydown(event) {
    const step = event.shiftKey ? 5 : 1;
    const changes = {
      ArrowLeft: () => { hsv.s -= step; },
      ArrowRight: () => { hsv.s += step; },
      ArrowUp: () => { hsv.v += step; },
      ArrowDown: () => { hsv.v -= step; },
      PageUp: () => { hsv.v += 10; },
      PageDown: () => { hsv.v -= 10; },
      Home: () => { hsv.s = 0; },
      End: () => { hsv.s = 100; },
    };
    const change = changes[event.key];
    if (!change) return;
    event.preventDefault();
    change();
    hsv.s = clamp(hsv.s, 0, 100);
    hsv.v = clamp(hsv.v, 0, 100);
    commitHsv();
  }

  function resetDraft() {
    hexInput.value = color;
    clearInputError();
  }

  function showInputError() {
    hexInput.setAttribute("aria-invalid", "true");
    inputError.hidden = false;
  }

  function clearInputError() {
    hexInput.removeAttribute("aria-invalid");
    inputError.hidden = true;
  }

  function isOpen() {
    if (!nativePopover) return picker.classList.contains("is-open");
    try { return picker.matches(":popover-open"); } catch { return false; }
  }

  function startPositionTracking() {
    window.addEventListener("resize", positionPicker);
    window.addEventListener("scroll", positionPicker, true);
  }

  function stopPositionTracking() {
    window.removeEventListener("resize", positionPicker);
    window.removeEventListener("scroll", positionPicker, true);
  }

  function positionPicker() {
    if (!isOpen()) return;
    picker.style.left = "0px";
    picker.style.top = "0px";
    const triggerBounds = trigger.getBoundingClientRect();
    const pickerBounds = picker.getBoundingClientRect();
    const viewportWidth = document.documentElement.clientWidth;
    const viewportHeight = document.documentElement.clientHeight;
    const maxLeft = Math.max(PICKER_VIEWPORT_MARGIN, viewportWidth - pickerBounds.width - PICKER_VIEWPORT_MARGIN);
    const left = clamp(triggerBounds.right - pickerBounds.width, PICKER_VIEWPORT_MARGIN, maxLeft);
    const below = triggerBounds.bottom + PICKER_TRIGGER_GAP;
    const above = triggerBounds.top - pickerBounds.height - PICKER_TRIGGER_GAP;
    const belowShortfall = Math.max(0, below + pickerBounds.height - (viewportHeight - PICKER_VIEWPORT_MARGIN));
    const preferredTop = belowShortfall <= 32 ? below : above;
    const maxTop = Math.max(PICKER_VIEWPORT_MARGIN, viewportHeight - pickerBounds.height - PICKER_VIEWPORT_MARGIN);
    picker.style.left = `${Math.round(left)}px`;
    picker.style.top = `${Math.round(clamp(preferredTop, PICKER_VIEWPORT_MARGIN, maxTop))}px`;
  }

  return { sync, setBusy, open, close };
}

export function hexToHsv(value) {
  const normalized = normalizeHexColor(value);
  if (!normalized) return null;
  const channels = [1, 3, 5].map((index) => parseInt(normalized.slice(index, index + 2), 16) / 255);
  const [red, green, blue] = channels;
  const max = Math.max(...channels);
  const min = Math.min(...channels);
  const delta = max - min;
  let hue = 0;
  if (delta && max === red) hue = 60 * (((green - blue) / delta) % 6);
  else if (delta && max === green) hue = 60 * (((blue - red) / delta) + 2);
  else if (delta) hue = 60 * (((red - green) / delta) + 4);
  return {
    h: wrapHue(hue),
    s: max ? (delta / max) * 100 : 0,
    v: max * 100,
  };
}

export function hsvToHex(hue, saturation, value) {
  const h = wrapHue(hue);
  const s = clamp(Number(saturation) / 100, 0, 1);
  const v = clamp(Number(value) / 100, 0, 1);
  const chroma = v * s;
  const segment = h / 60;
  const x = chroma * (1 - Math.abs((segment % 2) - 1));
  const offset = v - chroma;
  const base = segment < 1 ? [chroma, x, 0]
    : segment < 2 ? [x, chroma, 0]
      : segment < 3 ? [0, chroma, x]
        : segment < 4 ? [0, x, chroma]
          : segment < 5 ? [x, 0, chroma]
            : [chroma, 0, x];
  return `#${base.map((channel) => Math.round((channel + offset) * 255).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

function formatHexDraft(value) {
  const digits = String(value || "").trim().replace(/^#/, "").replace(/[^a-f0-9]/gi, "").slice(0, 6);
  return `#${digits.toUpperCase()}`;
}

function wrapHue(value) {
  const hue = Number(value);
  return Number.isFinite(hue) ? ((hue % 360) + 360) % 360 : 0;
}

function clamp(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, number));
}
