export function syncSegmentedIndicator(control, activeButton = null) {
  placeSegmentedIndicator(control, activeButton);
  requestAnimationFrame(() => placeSegmentedIndicator(control, activeButton));
}

function placeSegmentedIndicator(control, activeButton = null) {
  if (!control) return;
  ensureSegmentedIndicator(control);
  const button = activeButton?.matches?.("button") ? activeButton : control.querySelector("button.active");
  if (control.hidden || !button || !control.getClientRects().length || !button.getClientRects().length) {
    control.classList.remove("has-indicator");
    return;
  }
  const controlRect = control.getBoundingClientRect();
  const buttonRect = button.getBoundingClientRect();
  const controlStyle = getComputedStyle(control);
  const borderLeft = parseFloat(controlStyle.borderLeftWidth) || 0;
  const borderTop = parseFloat(controlStyle.borderTopWidth) || 0;
  control.style.setProperty("--segmented-x", `${Math.round(buttonRect.left - controlRect.left - borderLeft)}px`);
  control.style.setProperty("--segmented-y", `${Math.round(buttonRect.top - controlRect.top - borderTop)}px`);
  control.style.setProperty("--segmented-w", `${Math.round(buttonRect.width)}px`);
  control.style.setProperty("--segmented-h", `${Math.round(buttonRect.height)}px`);
  control.classList.add("has-indicator");
}

function ensureSegmentedIndicator(control) {
  for (const child of control.children) {
    if (child.classList.contains("segment-indicator")) return child;
  }
  const indicator = document.createElement("span");
  indicator.className = "segment-indicator";
  indicator.setAttribute("aria-hidden", "true");
  control.prepend(indicator);
  return indicator;
}
