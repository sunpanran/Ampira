export const MOTION_EASING = Object.freeze({
  standard: "cubic-bezier(.2, 0, 0, 1)",
  enter: "cubic-bezier(.16, 1, .3, 1)",
  exit: "cubic-bezier(.4, 0, 1, 1)",
  move: "cubic-bezier(.22, .8, .3, 1)",
  ambient: "cubic-bezier(.37, 0, .63, 1)",
  brand: "cubic-bezier(.34, 1.16, .64, 1)",
});

export const MOTION_DURATION = Object.freeze({
  press: 100,
  state: 180,
  move: 240,
  overlay: 300,
  firstFrame: 360,
  reader: 360,
  ambient: 1600,
});

export function prefersReducedMotion({ includeHidden = true } = {}) {
  return (includeHidden && globalThis.document?.hidden === true)
    || globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;
}

export function animateElement(element, keyframes, options = {}) {
  if (typeof element?.animate !== "function" || prefersReducedMotion()) return null;
  const easing = MOTION_EASING[options.easing || "standard"] || MOTION_EASING.standard;
  const animation = element.animate(keyframes, {
    duration: MOTION_DURATION[options.duration || "state"] || MOTION_DURATION.state,
    delay: Math.max(0, Number(options.delay) || 0),
    easing,
    fill: options.fill || "none",
  });
  animation?.addEventListener?.("finish", () => element.style?.removeProperty?.("will-change"), { once: true });
  animation?.addEventListener?.("cancel", () => element.style?.removeProperty?.("will-change"), { once: true });
  element.style?.setProperty?.("will-change", "transform, opacity");
  return animation;
}

const actionFeedbackAnimations = new WeakMap();

export function playActionFeedback(element) {
  if (!element) return null;
  actionFeedbackAnimations.get(element)?.cancel?.();
  const animation = animateElement(element, [
    { transform: "translate3d(0, 1px, 0) scale(.985)", offset: 0 },
    { transform: "translate3d(0, 0, 0) scale(1.035)", offset: .44 },
    { transform: "translate3d(0, 0, 0) scale(.995)", offset: .72 },
    { transform: "translate3d(0, 0, 0) scale(1)", offset: 1 },
  ], { duration: "move", easing: "move" });
  if (!animation) return null;
  actionFeedbackAnimations.set(element, animation);
  const cleanup = () => {
    if (actionFeedbackAnimations.get(element) === animation) actionFeedbackAnimations.delete(element);
  };
  animation.addEventListener("finish", cleanup, { once: true });
  animation.addEventListener("cancel", cleanup, { once: true });
  return animation;
}

export function animatePanelEntrance(elements, options = {}) {
  const targets = Array.from(elements || []).filter((element) => typeof element?.animate === "function");
  if (!targets.length || prefersReducedMotion()) return [];
  const initialDelay = Math.max(0, Number(options.delay) || 0);
  const stagger = Math.max(0, Number(options.stagger) || 32);
  const maxStagger = Math.max(0, Number(options.maxStagger) || 96);
  return targets.map((target, index) => animateElement(target, [
    { opacity: .2, transform: "translate3d(0, 8px, 0)" },
    { opacity: 1, transform: "translate3d(0, 0, 0)" },
  ], {
    duration: "firstFrame",
    delay: initialDelay + Math.min(index * stagger, maxStagger),
    easing: "enter",
    fill: "backwards",
  })).filter(Boolean);
}

export function createLoadingPhaseController(elements, options = {}) {
  const targets = Array.from(elements || []).filter(Boolean);
  const revealDelay = Math.max(0, Number(options.revealDelay) || 160);
  const ambientDelay = Math.max(revealDelay, Number(options.ambientDelay) || 700);
  let revealTimer = 0;
  let ambientTimer = 0;
  let finished = false;

  const setPhase = (phase) => targets.forEach((target) => {
    target.dataset.loadingPhase = phase;
  });
  const clearTimers = () => {
    clearTimeout(revealTimer);
    clearTimeout(ambientTimer);
    revealTimer = 0;
    ambientTimer = 0;
  };
  const finish = () => {
    if (finished) return;
    finished = true;
    clearTimers();
    targets.forEach((target) => delete target.dataset.loadingPhase);
  };

  setPhase("pending");
  revealTimer = setTimeout(() => {
    if (!finished) setPhase("static");
  }, revealDelay);
  ambientTimer = setTimeout(() => {
    if (!finished && !prefersReducedMotion({ includeHidden: false })) setPhase("ambient");
  }, ambientDelay);

  return { finish };
}

export function createLoadingSurfaceController(element, options = {}) {
  if (!element) return { finish() {} };
  element.classList.add("ai-loading-surface");
  if (options.ariaBusy !== false) element.setAttribute("aria-busy", "true");
  const phases = createLoadingPhaseController([element], options);
  let finished = false;
  return {
    finish() {
      if (finished) return;
      finished = true;
      phases.finish();
      element.classList.remove("ai-loading-surface");
      if (options.ariaBusy !== false) element.removeAttribute("aria-busy");
    },
  };
}

export function captureKeyedLayout(root, selector = "[data-key]") {
  return new Map(Array.from(root?.querySelectorAll?.(selector) || []).map((node) => [
    node.dataset.key,
    node.getBoundingClientRect(),
  ]));
}

export function animateKeyedLayout(root, previousLayout, selector = "[data-key]") {
  if (!(previousLayout instanceof Map) || prefersReducedMotion()) return [];
  return Array.from(root?.querySelectorAll?.(selector) || []).map((node) => {
    const previous = previousLayout.get(node.dataset.key);
    if (!previous) return animateElement(node, [
      { opacity: 0, transform: "translate3d(0, 6px, 0)" },
      { opacity: 1, transform: "translate3d(0, 0, 0)" },
    ], { duration: "state", easing: "enter", fill: "backwards" });
    const next = node.getBoundingClientRect();
    const x = previous.left - next.left;
    const y = previous.top - next.top;
    if (Math.abs(x) < .5 && Math.abs(y) < .5) return null;
    return animateElement(node, [
      { transform: `translate3d(${x}px, ${y}px, 0)` },
      { transform: "translate3d(0, 0, 0)" },
    ], { duration: "move", easing: "move" });
  }).filter(Boolean);
}

export function restartMotionClass(element, className) {
  if (!element || prefersReducedMotion()) return;
  element.classList.remove(className);
  void element.offsetWidth;
  element.classList.add(className);
  element.addEventListener("animationend", () => element.classList.remove(className), { once: true });
}

export function fadeElementsOut(elements, onFinish) {
  const targets = Array.from(elements || []);
  if (!targets.length || prefersReducedMotion()) return false;
  for (const target of targets) { target.classList.add("is-fading-out"); target.inert = true; }
  globalThis.setTimeout(onFinish, MOTION_DURATION.state);
  return true;
}

export function findKeyedElement(root, key, selector = "[data-key]") {
  return Array.from(root?.querySelectorAll?.(selector) || []).find((node) => node.dataset.key === key) || null;
}

export function runExitMotion(element, onFinish, options = {}) {
  if (!element || prefersReducedMotion()) return false;
  element.classList.add(options.className || "is-list-leaving");
  element.inert = true;
  globalThis.setTimeout(onFinish, Math.max(0, Number(options.duration) || 120));
  return true;
}

export function enterFirstFrame(element, options = {}) {
  if (!element || prefersReducedMotion()) return false;
  const startedAt = Number(options.startedAt);
  const targetDelay = Math.max(0, Number(options.targetDelay) || 0);
  const elapsed = Number.isFinite(startedAt) ? performance.now() - startedAt : targetDelay;
  element.style.setProperty("--first-frame-shortcuts-delay", `${Math.max(0, targetDelay - elapsed)}ms`);
  element.classList.add("is-first-frame-entering");
  element.addEventListener("animationend", () => {
    element.classList.remove("is-first-frame-entering");
    element.style.removeProperty("--first-frame-shortcuts-delay");
  }, { once: true });
  return true;
}

const disclosureAnimations = new WeakMap();

export function setDisclosureVisibility(element, visible, options = {}) {
  if (!element) return;
  const activeAnimation = disclosureAnimations.get(element);
  if (!activeAnimation && element.hidden === (visible !== true)) return;
  activeAnimation?.cancel();
  disclosureAnimations.delete(element);
  const shouldShow = visible === true;
  if (options.animate === false || prefersReducedMotion()) {
    element.hidden = !shouldShow;
    element.style.removeProperty("overflow");
    return;
  }
  if (!shouldShow && element.hidden) return;
  if (shouldShow) element.hidden = false;
  const height = Math.max(0, shouldShow ? element.scrollHeight : element.offsetHeight);
  element.style.setProperty("overflow", "clip");
  const animation = animateElement(element, shouldShow ? [
    { height: "0px", opacity: 0, transform: "translateY(-4px)" },
    { height: `${height}px`, opacity: 1, transform: "translateY(0)" },
  ] : [
    { height: `${height}px`, opacity: 1, transform: "translateY(0)" },
    { height: "0px", opacity: 0, transform: "translateY(-4px)" },
  ], {
    duration: shouldShow ? "move" : "state",
    easing: shouldShow ? "move" : "exit",
    fill: "both",
  });
  if (!animation) {
    element.hidden = !shouldShow;
    element.style.removeProperty("overflow");
    return;
  }
  disclosureAnimations.set(element, animation);
  const cleanup = (event) => {
    if (disclosureAnimations.get(element) !== animation) return;
    disclosureAnimations.delete(element);
    if (!shouldShow) element.hidden = true;
    element.style.removeProperty("overflow");
    if (event?.type === "finish") animation.cancel();
  };
  animation.addEventListener("finish", cleanup, { once: true });
  animation.addEventListener("cancel", cleanup, { once: true });
}
