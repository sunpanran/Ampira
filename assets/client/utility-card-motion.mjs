import { animateElement } from "./motion.mjs";

export function createUtilityCardMotion(panel) {
  let animation = null;
  let generation = 0;

  function fade(visible, { animate = true } = {}) {
    const opacity = panel.hidden ? 0 : Number(globalThis.getComputedStyle?.(panel).opacity ?? 1);
    const token = ++generation;
    animation?.cancel();
    panel.hidden = false;
    animation = animate ? animateElement(panel, [{ opacity }, { opacity: visible ? 1 : 0 }], {
      duration: visible ? "state" : "press",
      easing: visible ? "enter" : "exit",
      fill: "both",
      // A transform hint changes text rasterization when this opacity-only fade ends.
      willChange: "auto",
    }) : null;
    const finish = () => {
      if (token !== generation) return;
      panel.hidden = !visible;
      animation?.cancel();
      animation = null;
    };
    if (animation) animation.addEventListener("finish", finish, { once: true });
    else finish();
  }

  return {
    show: () => fade(true),
    hide: (options) => fade(false, options),
  };
}
