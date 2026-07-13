export function srOnly(text) {
  const node = document.createElement("span");
  node.className = "sr-only";
  node.textContent = text;
  return node;
}

export function spanText(text, className) {
  const node = document.createElement("span");
  if (className) node.className = className;
  node.textContent = text;
  return node;
}

export function animatePanelEntrance(elements, options = {}) {
  const panels = Array.from(elements || []).filter((element) => typeof element?.animate === "function");
  if (!panels.length || globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true) return [];
  const initialDelay = Math.max(0, Number(options.delay) || 0);
  return panels.flatMap((panel, index) => {
    const content = Array.from(panel.children || []).filter((element) => typeof element?.animate === "function");
    const targets = content.length ? content : [panel];
    return targets.map((target) => target.animate([
      { opacity: .2, transform: "translate3d(0, 8px, 0)" },
      { opacity: 1, transform: "translate3d(0, 0, 0)" },
    ], {
      duration: 520,
      delay: initialDelay + index * 48,
      easing: "cubic-bezier(.16, 1, .3, 1)",
      fill: "backwards",
    }));
  });
}
