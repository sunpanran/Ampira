export function syncSegmentedIndicator(control, activeButton = null, { animate = true } = {}) {
  placeSegmentedIndicator(control, activeButton, animate);
  requestAnimationFrame(() => placeSegmentedIndicator(control, activeButton, animate));
}

function placeSegmentedIndicator(control, activeButton, animate) {
  if (!control) return;
  const indicator = ensureSegmentedIndicator(control);
  const button = activeButton?.matches?.("button") ? activeButton : control.querySelector("button.active");
  if (control.hidden || !button || !control.getClientRects().length || !button.getClientRects().length) {
    control.classList.remove("has-indicator", "is-indicator-moving");
    return;
  }
  const shouldAnimate = animate && control.classList.contains("has-indicator");
  control.classList.toggle("is-indicator-moving", shouldAnimate);
  // Measure layout, not the temporarily compressed press pose.
  control.style.setProperty("--segmented-x", `${button.offsetLeft}px`);
  control.style.setProperty("--segmented-y", `${button.offsetTop}px`);
  control.style.setProperty("--segmented-w", `${button.offsetWidth}px`);
  control.style.setProperty("--segmented-h", `${button.offsetHeight}px`);
  control.classList.add("has-indicator");
  // Commit the saved position before later interactions can enable transitions.
  if (!shouldAnimate) getComputedStyle(indicator).transform;
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
