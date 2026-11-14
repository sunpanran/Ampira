import { MOTION_DURATION, MOTION_EASING, prefersReducedMotion } from "./motion.mjs";

export function createUtilityCardMotion(panel, { card, backdrop, onHidden }) {
  let animations = [];
  const hints = new Map();
  let generation = 0;

  function move(visible, { animate = true } = {}) {
    const hidden = panel.hidden;
    const start = (hidden ? card : panel).getBoundingClientRect();
    const opacityOf = (node) => Number(globalThis.getComputedStyle?.(node)?.opacity ?? 1);
    const panelOpacity = hidden ? 0 : opacityOf(panel);
    const cardOpacity = hidden ? 1 : opacityOf(card);
    const backdropOpacity = hidden ? 0 : opacityOf(backdrop);
    const content = Array.from(panel.children, node => ({ node, opacity: hidden ? 0 : opacityOf(node) }));
    const token = ++generation;
    cancelAnimations();
    panel.hidden = false;
    const target = panel.getBoundingClientRect();
    const transform = (rect) => target.width > 0 && target.height > 0
      ? `translate(${rect.left - target.left}px, ${rect.top - target.top}px) scale(${rect.width / target.width}, ${rect.height / target.height})`
      : "none";
    const finish = () => {
      if (token !== generation) return;
      panel.hidden = !visible;
      cancelAnimations();
      if (!visible) onHidden();
    };
    if (!animate || prefersReducedMotion()) {
      finish();
      return;
    }
    const duration = MOTION_DURATION.move + (visible ? MOTION_DURATION.press : 0);
    const animation = play(panel, [
      { transform: transform(start) },
      { transform: visible ? "none" : transform(card.getBoundingClientRect()) },
    ], duration, 0, "transform, opacity");
    if (animation) {
      // Both surfaces share the same fade clock, including when direction reverses.
      const fadeDelay = visible ? 0 : duration - MOTION_DURATION.press;
      play(panel, [{ opacity: panelOpacity }, { opacity: visible ? 1 : 0 }], MOTION_DURATION.press, fadeDelay);
      play(card, [{ opacity: cardOpacity }, { opacity: visible ? 0 : 1 }], MOTION_DURATION.press, fadeDelay);
      play(backdrop, [{ opacity: backdropOpacity }, { opacity: visible ? 1 : 0 }], MOTION_DURATION.move);
      content.forEach(({ node, opacity }) => play(node, [{ opacity }, { opacity: visible ? 1 : 0 }],
        visible ? MOTION_DURATION.state : MOTION_DURATION.press, visible ? MOTION_DURATION.press : 0));
    }
    if (animation) animation.addEventListener("finish", finish, { once: true });
    else finish();
  }

  function play(node, frames, duration, delay = 0, willChange = "opacity") {
    if (typeof node?.animate !== "function") return null;
    if (!hints.has(node)) {
      hints.set(node, node.style?.getPropertyValue?.("will-change") || "");
      node.style?.setProperty?.("will-change", willChange);
    }
    const animation = node.animate(frames, { duration, delay, easing: MOTION_EASING.standard, fill: "both" });
    animations.push(animation);
    return animation;
  }

  function cancelAnimations() {
    animations.forEach(animation => animation.cancel());
    animations = [];
    for (const [node, previous] of hints) {
      if (previous) node.style?.setProperty?.("will-change", previous);
      else node.style?.removeProperty?.("will-change");
    }
    hints.clear();
  }

  return {
    show: (options) => move(true, options),
    hide: (options) => move(false, options),
  };
}
