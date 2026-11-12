import { animateElement } from "./motion.mjs";

export function createDashboardLayoutMotion(cards) {
  const animations = new Map();
  const capture = () => new Map(Array.from(cards, ([id, card]) => [id, card.getBoundingClientRect()]));

  function stop(id) {
    for (const [key, card] of cards) {
      if (id !== undefined && id !== key) continue;
      animations.delete(key);
      // Direct manipulation also takes over a still-running first-frame entrance.
      for (const animation of card.getAnimations()) {
        if (animation.effect?.getKeyframes().some((frame) => frame.transform !== undefined)) animation.cancel();
      }
      card.classList.remove("is-layout-moving", "is-layout-foreground");
    }
  }

  function play(previous, foreground) {
    const next = capture();
    for (const [id, card] of cards) {
      const before = previous.get(id);
      const after = next.get(id);
      if (!before || !after.width || !after.height) continue;
      const x = before.x - after.x;
      const y = before.y - after.y;
      if ([x, y, before.width - after.width, before.height - after.height].every((delta) => Math.abs(delta) < .5)) continue;
      card.classList.add("is-layout-moving");
      card.classList.toggle("is-layout-foreground", id === foreground);
      const animation = animateElement(card, [
        { transform: `translate3d(${x}px, ${y}px, 0) scale(${before.width / after.width}, ${before.height / after.height})` },
        { transform: "translate3d(0, 0, 0) scale(1, 1)" },
      ], { duration: "move", easing: "move" });
      if (!animation) {
        card.classList.remove("is-layout-moving", "is-layout-foreground");
        continue;
      }
      animations.set(id, { card, animation });
      const cleanup = () => {
        if (animations.get(id)?.animation !== animation) return;
        animations.delete(id);
        card.classList.remove("is-layout-moving", "is-layout-foreground");
        animation.cancel();
      };
      animation.addEventListener("finish", cleanup, { once: true });
      animation.addEventListener("cancel", cleanup, { once: true });
    }
  }

  return { capture, stop, play };
}
