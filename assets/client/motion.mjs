export const MOTION_EASING = Object.freeze({
  standard: "cubic-bezier(.2, 0, 0, 1)",
  enter: "cubic-bezier(.16, 1, .3, 1)",
  exit: "cubic-bezier(.4, 0, 1, 1)",
  move: "cubic-bezier(.22, .8, .3, 1)",
});

export const MOTION_DURATION = Object.freeze({
  press: 100,
  state: 180,
  emphasis: 240,
  move: 240,
  firstFrame: 420,
});

export function prefersReducedMotion({ includeHidden = true } = {}) {
  return (includeHidden && globalThis.document?.hidden === true)
    || globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;
}

export function animateElement(element, keyframes, options = {}) {
  if (typeof element?.animate !== "function" || prefersReducedMotion()) return null;
  const easing = MOTION_EASING[options.easing || "standard"] || MOTION_EASING.standard;
  element.style?.setProperty?.("will-change", options.willChange ?? "transform, opacity");
  const animation = element.animate(keyframes, {
    duration: MOTION_DURATION[options.duration || "state"] || MOTION_DURATION.state,
    delay: Math.max(0, Number(options.delay) || 0),
    easing,
    fill: options.fill || "none",
  });
  animation?.addEventListener?.("finish", () => element.style?.removeProperty?.("will-change"), { once: true });
  animation?.addEventListener?.("cancel", () => element.style?.removeProperty?.("will-change"), { once: true });
  return animation;
}

const elasticFeedbackAnimations = new WeakMap();
const elasticFeedbackBindings = new WeakSet();
const pressedFeedbackElements = new WeakSet();

export function bindNavigationPressFeedback(element) {
  const release = () => element.classList.remove("is-nav-pressed");
  element.addEventListener("pointerdown", event => {
    if (!element.disabled && event.button === 0 && event.isPrimary !== false) element.classList.add("is-nav-pressed");
  });
  for (const type of ["pointerup", "pointercancel", "pointerleave", "blur"]) element.addEventListener(type, release);
}

export function bindElasticActionFeedback(element) {
  if (!element || elasticFeedbackBindings.has(element)) return;
  elasticFeedbackBindings.add(element);
  const press = () => {
    if (element.disabled || prefersReducedMotion() || typeof element.animate !== "function") return;
    const transform = globalThis.getComputedStyle?.(element)?.transform || "none";
    elasticFeedbackAnimations.get(element)?.cancel();
    pressedFeedbackElements.add(element);
    const animation = element.animate([
      { transform },
      { transform: "translateY(1px) scale(.94, .9)" },
    ], { duration: MOTION_DURATION.press, easing: MOTION_EASING.standard, fill: "forwards" });
    elasticFeedbackAnimations.set(element, animation);
  };
  const release = () => {
    if (!pressedFeedbackElements.has(element)) return;
    const transform = globalThis.getComputedStyle?.(element)?.transform || "none";
    elasticFeedbackAnimations.get(element)?.cancel();
    elasticFeedbackAnimations.delete(element);
    pressedFeedbackElements.delete(element);
    if (!prefersReducedMotion()) {
      trackElasticFeedback(element, [{ transform }, { transform: "none" }], {
        duration: MOTION_DURATION.state, easing: MOTION_EASING.standard, fill: "none",
      });
    }
  };
  element.addEventListener("pointerdown", event => {
    if (event.button === 0 && event.isPrimary !== false) press();
  });
  element.addEventListener("keydown", event => {
    if (!event.repeat && (event.key === " " || event.key === "Enter")) press();
  });
  // Cancelled gestures relax without running the button's action.
  for (const type of ["pointerleave", "pointercancel", "blur"]) element.addEventListener(type, release);
  for (const type of ["pointerup", "keyup"]) element.addEventListener(type, () => {
    if (element.disabled) release();
  });
}

export function playElasticActionFeedback(element) {
  if (!element) return null;
  const previous = elasticFeedbackAnimations.get(element);
  const pressed = pressedFeedbackElements.has(element);
  pressedFeedbackElements.delete(element);
  if (element.disabled || typeof element.animate !== "function" || prefersReducedMotion()) {
    previous?.cancel();
    elasticFeedbackAnimations.delete(element);
    return null;
  }
  const currentTransform = globalThis.getComputedStyle?.(element)?.transform;
  previous?.cancel();
  elasticFeedbackAnimations.delete(element);
  // Keep transient feedback out of DOM attributes so header reconciliation retains the button.
  return trackElasticFeedback(element, [
    { transform: currentTransform || "none", offset: 0, easing: pressed ? MOTION_EASING.enter : MOTION_EASING.standard },
    ...(pressed ? [] : [{ transform: "translateY(1px) scale(.94, .9)", offset: .12, easing: MOTION_EASING.enter }]),
    { transform: "translateY(-1px) scale(1.04, 1.1)", offset: .36, easing: MOTION_EASING.standard },
    { transform: "translateY(.4px) scale(.99, .97)", offset: .6, easing: MOTION_EASING.standard },
    { transform: "translateY(0) scale(1.008, 1.015)", offset: .8, easing: MOTION_EASING.standard },
    { transform: "none", offset: 1 },
  ], { duration: MOTION_DURATION.emphasis + MOTION_DURATION.state, fill: "none" });
}

function trackElasticFeedback(element, frames, options) {
  const animation = element.animate(frames, options);
  elasticFeedbackAnimations.set(element, animation);
  const cleanup = () => {
    if (elasticFeedbackAnimations.get(element) === animation) elasticFeedbackAnimations.delete(element);
  };
  animation.addEventListener("finish", cleanup, { once: true });
  animation.addEventListener("cancel", cleanup, { once: true });
  return animation;
}

export function animatePanelEntrance(elements, options = {}) {
  if (prefersReducedMotion()) return [];
  // Read every rectangle before creating effects; only visible panels need a
  // compositor layer, and saved card order should determine the reveal order.
  const targets = Array.from(elements || []).filter((element) => typeof element?.animate === "function")
    .map(element => ({ element, rect: element.getBoundingClientRect?.() }))
    .filter(({ rect }) => !rect || rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0
      && rect.top < (globalThis.innerHeight || Infinity) && rect.left < (globalThis.innerWidth || Infinity))
    .sort((a, b) => a.rect && b.rect ? a.rect.top - b.rect.top || a.rect.left - b.rect.left : 0);
  const startedAt = Number(options.startedAt);
  const elapsed = Number.isFinite(startedAt) ? performance.now() - startedAt : Infinity;
  const initialDelay = Math.max(0, Number(options.delay) || 0, (Number(options.targetDelay) || 0) - elapsed);
  const stagger = Math.max(0, options.stagger === undefined ? 24 : Number(options.stagger) || 0);
  const maxStagger = Math.max(0, options.maxStagger === undefined ? 72 : Number(options.maxStagger) || 0);
  const animations = targets.flatMap(({ element }, index) => {
    const delay = initialDelay + Math.min(index * stagger, maxStagger);
    const movement = animateElement(element, [
      { transform: "translate3d(0, 6px, 0)" },
      { transform: "translate3d(0, 0, 0)" },
    ], { duration: "firstFrame", delay, easing: "standard", fill: "backwards" });
    // Finish the fade before the movement so text and glass regain full contrast
    // while the last few pixels settle. Animate neither filters nor geometry.
    const fade = element.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: MOTION_DURATION.emphasis, delay, easing: MOTION_EASING.standard, fill: "backwards",
    });
    return [movement, fade];
  }).filter(Boolean);
  if (!animations.length) return animations;
  const pending = new Set(animations);
  const media = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)");
  const stop = () => {
    if (prefersReducedMotion()) animations.forEach(animation => animation.cancel());
  };
  const cleanup = (animation) => {
    pending.delete(animation);
    if (pending.size) return;
    globalThis.document?.removeEventListener?.("visibilitychange", stop);
    media?.removeEventListener?.("change", stop);
  };
  for (const animation of animations) {
    animation.addEventListener?.("finish", () => cleanup(animation), { once: true });
    animation.addEventListener?.("cancel", () => cleanup(animation), { once: true });
  }
  globalThis.document?.addEventListener?.("visibilitychange", stop);
  media?.addEventListener?.("change", stop);
  return animations;
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
  return animatePanelEntrance([element], options).length > 0;
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
