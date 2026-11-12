const TITLE = ".efficiency-title, .column-title";
const INTERACTIVE = "button, a, input, textarea, select, [contenteditable='true']";

export function bindDashboardLayoutDrag({ root, getCard, getOrder, isBusy, swap, announce, t, motion }) {
  let gesture = null;
  let scrollFrame = 0;
  let suppressClickUntil = 0;

  function titleOf(id) { return getCard(id)?.querySelector(TITLE); }
  function nameOf(id) { return titleOf(id)?.textContent || ""; }
  function sourceOf(event) {
    const title = event.target.closest?.(TITLE);
    if (!title || !root.contains(title) || event.target.closest(INTERACTIVE)) return null;
    return title.closest("[data-dashboard-card]")?.dataset.dashboardCard || null;
  }

  function markTarget(id) {
    const target = id === gesture.source ? null : id;
    if (gesture.target === target) return;
    root.querySelectorAll(".is-layout-target").forEach((node) => node.classList.remove("is-layout-target"));
    gesture.target = target;
    if (gesture.target) getCard(id)?.parentElement.classList.add("is-layout-target");
  }

  function hitTarget() {
    const hit = document.elementFromPoint(gesture.x, gesture.y)?.closest(".dashboard-slot");
    const id = hit && root.contains(hit) ? hit.firstElementChild?.dataset.dashboardCard : null;
    markTarget(id && titleOf(id) ? id : null);
  }

  function activate() {
    gesture.active = true;
    root.classList.add("is-layout-dragging");
    getCard(gesture.source)?.classList.add("is-layout-source");
    if (gesture.pointerId !== undefined) {
      const card = getCard(gesture.source);
      const before = card.getBoundingClientRect();
      motion.stop(gesture.source);
      const after = card.getBoundingClientRect();
      gesture.origin = { x: before.x - after.x, y: before.y - after.y,
        scaleX: before.width / after.width, scaleY: before.height / after.height,
        scrollX: window.scrollX, scrollY: window.scrollY };
      root.classList.add("is-layout-pointer-dragging");
      card.parentElement.classList.add("is-layout-source-slot");
      card.classList.add("is-layout-lifted");
      card.style.setProperty("will-change", "transform");
    }
    titleOf(gesture.source)?.setAttribute("aria-pressed", "true");
    announce(t("layout.pickedUp", { title: nameOf(gesture.source) }));
  }

  function cancel({ focus = false, animate = true } = {}) {
    if (!gesture) return;
    const { source, pointerId, active } = gesture;
    const previous = active && pointerId !== undefined && animate ? motion.capture() : null;
    gesture = null;
    if (active && pointerId !== undefined) suppressClickUntil = performance.now() + 400;
    if (pointerId !== undefined && root.hasPointerCapture?.(pointerId)) root.releasePointerCapture(pointerId);
    cancelAnimationFrame(scrollFrame);
    scrollFrame = 0;
    const card = getCard(source);
    card?.style.removeProperty("transform");
    card?.style.removeProperty("will-change");
    card?.classList.remove("is-layout-lifted");
    root.classList.remove("is-layout-dragging", "is-layout-pointer-dragging");
    root.querySelectorAll(".is-layout-source, .is-layout-target, .is-layout-source-slot").forEach((node) => node.classList.remove("is-layout-source", "is-layout-target", "is-layout-source-slot"));
    if (previous) {
      motion.stop();
      motion.play(previous, source);
    }
    titleOf(source)?.setAttribute("aria-pressed", "false");
    if (focus) titleOf(source)?.focus({ preventScroll: true });
  }

  function drawDrag() {
    const { origin } = gesture;
    const x = origin.x + gesture.x - gesture.startX + window.scrollX - origin.scrollX;
    const y = origin.y + gesture.y - gesture.startY + window.scrollY - origin.scrollY;
    getCard(gesture.source).style.transform = `translate3d(${x}px, ${y}px, 0) scale(${origin.scaleX}, ${origin.scaleY})`;
    hitTarget();
  }

  function autoScroll() {
    scrollFrame = 0;
    if (!gesture?.active || gesture.pointerId === undefined) return;
    const edge = 64;
    const height = document.documentElement.clientHeight;
    const delta = gesture.y < edge ? -Math.ceil((edge - gesture.y) / 5)
      : gesture.y > height - edge ? Math.ceil((gesture.y - height + edge) / 5) : 0;
    if (delta) {
      window.scrollBy({ top: Math.max(-18, Math.min(18, delta)), behavior: "instant" });
    }
    drawDrag();
    scrollFrame = requestAnimationFrame(autoScroll);
  }

  root.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || event.isPrimary === false || isBusy()) return;
    const source = sourceOf(event);
    if (!source) return;
    cancel();
    event.preventDefault();
    if (document.activeElement === titleOf(source)) titleOf(source).blur();
    gesture = { source, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, target: null, active: false };
    root.setPointerCapture(event.pointerId);
  });
  root.addEventListener("pointermove", (event) => {
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    gesture.x = event.clientX;
    gesture.y = event.clientY;
    if (!gesture.active && Math.hypot(gesture.x - gesture.startX, gesture.y - gesture.startY) <= 6) return;
    event.preventDefault();
    if (!gesture.active) {
      activate();
      drawDrag();
      scrollFrame = requestAnimationFrame(autoScroll);
    }
  });
  root.addEventListener("pointerup", (event) => {
    if (gesture?.pointerId !== event.pointerId) return;
    if (gesture.active) {
      gesture.x = event.clientX;
      gesture.y = event.clientY;
      drawDrag();
    }
    const { source, target, active } = gesture;
    if (active && target) void swap(source, target);
    else if (active) announce(t("layout.cancelled"));
    cancel();
  });
  for (const type of ["pointercancel", "lostpointercapture"]) root.addEventListener(type, () => cancel());
  root.addEventListener("click", (event) => {
    if (performance.now() >= suppressClickUntil) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
  root.addEventListener("dragstart", (event) => { if (sourceOf(event)) event.preventDefault(); });
  root.addEventListener("keydown", (event) => {
    if (event.key === "Tab") { cancel(); return; }
    if (isBusy() || !event.target.matches?.(TITLE)) return;
    if (["Enter", " "].includes(event.key)) {
      event.preventDefault();
      if (event.repeat) return;
      if (gesture?.pointerId !== undefined) return;
      if (gesture) {
        const { source, target } = gesture;
        cancel({ focus: true });
        if (target) void swap(source, target);
      } else {
        gesture = { source: sourceOf(event), target: null };
        activate();
      }
    } else if (gesture && gesture.pointerId === undefined && ["ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const order = getOrder();
      const delta = ["ArrowLeft", "ArrowUp"].includes(event.key) ? -1 : 1;
      const index = event.key === "Home" ? 0 : event.key === "End" ? order.length - 1
        : (order.indexOf(gesture.target || gesture.source) + delta + order.length) % order.length;
      markTarget(order[index]);
      getCard(order[index])?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
      announce(t(gesture.target ? "layout.target" : "layout.pickedUp", { title: nameOf(order[index]) }));
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !gesture) return;
    event.preventDefault();
    cancel({ focus: gesture.pointerId === undefined });
    announce(t("layout.cancelled"));
  });
  root.addEventListener("focusout", (event) => {
    if (gesture?.pointerId === undefined && !event.relatedTarget?.closest?.(TITLE)) cancel();
  });
  window.addEventListener("blur", () => cancel());
  window.addEventListener("resize", () => cancel());
  document.addEventListener("visibilitychange", () => { if (document.hidden) cancel(); });
  return { cancel, isActive: () => Boolean(gesture?.active) };
}
